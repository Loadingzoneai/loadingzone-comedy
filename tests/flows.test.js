const {test,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const crypto=require('node:crypto');
const vm=require('node:vm');
const fs=require('node:fs');
const originalFetch=global.fetch;
const savedEnv={...process.env};
afterEach(()=>{global.fetch=originalFetch;for(const k of Object.keys(process.env))if(!(k in savedEnv))delete process.env[k];Object.assign(process.env,savedEnv)});
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v},end(body){this.body=JSON.parse(body)}}}
function env(){Object.assign(process.env,{SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'server-only',SUPABASE_PUBLISHABLE_KEY:'publishable',ADMIN_EMAILS:'admin@example.com',STRIPE_SECRET_KEY:'sk_test_example',STRIPE_WEBHOOK_SECRET:'whsec_example',STRIPE_TEST_PRICE_MONTHLY:'price_month',STRIPE_TEST_PRICE_ANNUAL:'price_year'})}
const json=(body,status=200)=>new Response(JSON.stringify(body),{status});
test('public content excludes drafts and member records',async()=>{env();let fetched;global.fetch=async url=>{fetched=url;return json([{content_key:'shows',content_value:{items:[{id:'draft',published:false},{id:'public',published:true}]}},{content_key:'gallery',content_value:{items:[{id:'hidden',published:false}]}}])};const res=response();await require('../api/site-content')({method:'GET'},res);assert.deepEqual(res.body.shows.items,[{id:'public',published:true}]);assert.deepEqual(res.body.gallery.items,[]);assert.match(fetched,/home,shows,gallery/)});
test('content validation rejects unsafe links and duplicate IDs',()=>{const {records}=require('../lib/content');assert.throws(()=>records({items:[{id:'x',title:'Show',ticketUrl:'javascript:alert(1)'}]}));assert.throws(()=>records({items:[{id:'x',title:'A'},{id:'x',title:'B'}]}));assert.equal(records({items:[{id:'x',title:'海报',published:true}]}).items[0].published,true)});
test('admin member list rejects a regular member without querying private records',async()=>{env();let calls=0;global.fetch=async()=>{calls++;return json({id:'member-id',email:'viewer@example.com'})};const res=response();await require('../api/admin/members')({method:'GET',headers:{authorization:'Bearer user'}},res);assert.equal(res.statusCode,403);assert.equal(calls,1)});
test('member lookup scopes records to authenticated user and rejects expired membership',async()=>{env();let query;global.fetch=async url=>{if(url.includes('/auth/'))return json({id:'own-id',email:'own@example.com'});query=url;return json([{subscription_status:'active',current_period_end:'2020-01-01T00:00:00Z'}])};const res=response();await require('../api/member-profile')({method:'GET',headers:{authorization:'Bearer user'}},res);assert.match(query,/user_id=eq.own-id/);assert.equal(res.body.active,false)});
test('checkout refuses live Stripe keys before making requests',async()=>{env();process.env.STRIPE_SECRET_KEY='sk_live_example';global.fetch=async()=>{throw new Error('Must not call Stripe')};const res=response();await require('../api/create-checkout-session')({method:'POST',headers:{},body:{}},res);assert.equal(res.statusCode,503)});
test('checkout uses verified user and server price, ignores client price and identity',async()=>{env();let params;global.fetch=async(url,options)=>{if(url.includes('/auth/'))return json({id:'verified-user',email:'own@example.com'});if(url.includes('/rest/'))return json([]);params=options.body;return json({url:'https://checkout.stripe.com/c/pay/test'})};const res=response();await require('../api/create-checkout-session')({method:'POST',headers:{authorization:'Bearer valid',origin:'https://loadingzonecomedy.au'},body:{plan:'annual',city:'melbourne',price:'1',user_id:'attacker'}},res);assert.equal(res.statusCode,200);assert.equal(params.get('client_reference_id'),'verified-user');assert.equal(params.get('line_items[0][price]'),'price_year')});
function webhookReq(event,valid=true){const body=Buffer.from(JSON.stringify(event));const timestamp=Math.floor(Date.now()/1000);const digest=crypto.createHmac('sha256',process.env.STRIPE_WEBHOOK_SECRET).update(timestamp+'.').update(body).digest('hex');const req=Readable.from([body]);req.method='POST';req.headers={'stripe-signature':`t=${timestamp},v1=${valid?digest:'0'.repeat(64)}`};return req}
test('unsigned webhook cannot query or alter the membership database',async()=>{env();global.fetch=async()=>{throw new Error('Must not call database')};const res=response();await require('../api/stripe-webhook')(webhookReq({id:'evt_bad',type:'customer.subscription.updated',livemode:false},false),res);assert.equal(res.statusCode,400)});
test('webhook retries failed delivery and reads current Stripe item billing period',async()=>{env();const uuid='12345678-1234-4234-8234-123456789abc';const patches=[];global.fetch=async(url,opts={})=>{if(url.includes('stripe_events?on_conflict'))return json([]);if(url.includes('stripe_events?')&&(!opts.method||opts.method==='GET'))return json([{processing_status:'failed'}]);if(url.includes('api.stripe.com'))return json({id:'sub_test',customer:'cus_test',status:'active',metadata:{user_id:uuid},items:{data:[{price:{id:'price_month'},current_period_start:1900000000,current_period_end:1902600000}]}});if(url.includes('members?')&&opts.method==='GET')return json([{id:'member'}]);if(opts.method==='PATCH'){patches.push({url,body:JSON.parse(opts.body)});return new Response(null,{status:204})}throw new Error('Unexpected request '+url)};const event={id:'evt_retry',type:'customer.subscription.updated',livemode:false,data:{object:{id:'sub_test',status:'past_due'}}};const res=response();await require('../api/stripe-webhook')(webhookReq(event),res);assert.equal(res.statusCode,200);const patch=patches.find(p=>p.url.includes('members?')).body;assert.equal(patch.subscription_status,'active');assert.equal(patch.current_period_end,new Date(1902600000000).toISOString())});
test('processed webhook is acknowledged without updating members again',async()=>{env();let calls=0;global.fetch=async(url)=>{calls++;return json(url.includes('on_conflict')?[]:[{processing_status:'processed'}])};const res=response();await require('../api/stripe-webhook')(webhookReq({id:'evt_done',type:'customer.subscription.updated',livemode:false}),res);assert.equal(res.body.duplicate,true);assert.equal(calls,2)});
test('existing subscription cannot start another membership checkout',async()=>{env();global.fetch=async url=>{if(url.includes('/auth/'))return json({id:'own',email:'own@example.com'});if(url.includes('/rest/'))return json([{stripe_subscription_id:'sub_existing',subscription_status:'active'}]);throw new Error('Must not create duplicate subscription')};const res=response();await require('../api/create-checkout-session')({method:'POST',headers:{authorization:'Bearer token',origin:'https://loadingzonecomedy.au'},body:{plan:'monthly',city:'melbourne'}},res);assert.equal(res.statusCode,409)});
test('billing portal uses stored customer identity and rejects an unrelated return domain',async()=>{env();global.fetch=async url=>url.includes('/auth/')?json({id:'own',email:'own@example.com'}):json([{stripe_customer_id:'cus_own'}]);const res=response();await require('../api/billing-portal')({method:'POST',headers:{authorization:'Bearer token',origin:'https://unrelated.example'},body:{customer:'cus_other'}},res);assert.equal(res.statusCode,403)});
test('CMS rejects unauthenticated writes before uploading images',async()=>{env();global.fetch=async()=>{throw new Error('Must not upload')};const res=response();await require('../api/admin/site-content')({method:'POST',headers:{},body:{mime_type:'image/png',base64:'abcd'}},res);assert.equal(res.statusCode,401)});
test('Eventbrite imports only public, active Loading Zone events across pages', async () => {
  env();
  process.env.EVENTBRITE_TOKEN = 'test';
  process.env.EVENTBRITE_ORG_ID = '123';
  let page = 0;
  const ownEvent = {organizer_id: '75417874333', listed: true, status: 'live'};
  global.fetch = async () => {
    page++;
    return json({
      events: [
        {...ownEvent, id: 'own-' + page},
        {...ownEvent, id: 'other', organizer_id: '999'},
        {...ownEvent, id: 'missing', organizer_id: undefined},
        {...ownEvent, id: 'private', listed: false},
        {...ownEvent, id: 'cancelled', status: 'canceled'}
      ],
      pagination: {has_more_items: page === 1}
    });
  };
  const res = response();
  await require('../api/eventbrite/events')({method: 'GET'}, res);
  assert.equal(page, 2);
  assert.deepEqual(res.body.events.map(event => event.externalId), ['own-1', 'own-2']);
});
test('Eventbrite sync reads the Loading Zone organizer without an organization ID and skips finished events', async () => {
  env();
  delete process.env.EVENTBRITE_TOKEN; delete process.env.EVENTBRITE_ORG_ID; delete process.env.EVENTBRITE_ORGANIZATION_ID;
  process.env.EVENTBRITE_API_KEY = 'test-key';
  delete require.cache[require.resolve('../api/eventbrite/events')];
  const urls = [];
  global.fetch = async (url, opts) => {
    urls.push({url, auth: opts.headers.Authorization});
    return json({events: [
      {id: 'next', organizer_id: '75417874333', listed: true, status: 'live', end: {utc: '2999-01-01T00:00:00Z'}, venue: {name: 'Library at The Dock', address: {city: 'Docklands', region: 'VIC'}}},
      {id: 'over', organizer_id: '75417874333', listed: true, status: 'started', end: {utc: '2000-01-01T00:00:00Z'}}
    ], pagination: {has_more_items: false}});
  };
  const res = response();
  await require('../api/eventbrite/events')({method: 'GET'}, res);
  assert.equal(res.statusCode, 200);
  assert.match(urls[0].url, /\/v3\/organizers\/75417874333\/events\//);
  assert.equal(urls[0].auth, 'Bearer test-key');
  assert.deepEqual(res.body.events.map(e => [e.externalId, e.city]), [['next', 'melbourne']]);
  delete process.env.EVENTBRITE_API_KEY;
});
test('frontend escapes show text, validates ticket links and handles Stripe return route',()=>{const app={innerHTML:''};const storage=new Map();const ctx={console,URL,Date,Intl,crypto,location:{hash:'#membership?checkout=success'},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},sessionStorage:{getItem:()=>null},document:{documentElement:{},getElementById:id=>id==='app'?app:null,querySelectorAll:()=>[],querySelector:()=>null},window:{addEventListener(){}},fetch:async()=>({ok:false,json:async()=>({})})};vm.createContext(ctx);vm.runInContext(fs.readFileSync('app.js','utf8'),ctx);vm.runInContext(fs.readFileSync('site.js','utf8'),ctx);assert.match(app.innerHTML,/A\$12.80/);const result=vm.runInContext('showMarkup([{title:"<script>alert(1)</script>",ticketUrl:"javascript:alert(1)"}])',ctx);assert.doesNotMatch(result,/<script>|href="javascript:/);assert.match(result,/&lt;script&gt;/);assert.equal(vm.runInContext('melbourneDate("2026-11-20T19:30")',ctx),'2026-11-20T08:30:00.000Z')});
