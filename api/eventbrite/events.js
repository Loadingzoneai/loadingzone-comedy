const {send}=require('../../lib/server');
// 候场喜剧 Eventbrite 主办方页面：https://www.eventbrite.com.au/o/loadingzone-comedy-75417874333
// 按主办方编号读取公开演出，不需要组织 ID；令牌只在服务器端使用。
const LOADING_ZONE_ORGANIZER_ID = '75417874333';
let cache;
function token(){
  return process.env.EVENTBRITE_PRIVATE_TOKEN||process.env.EVENTBRITE_TOKEN||process.env.EVENTBRITE_API_KEY||'';
}
function city(address){
  const region=String(address?.region||'').toUpperCase(), name=String(address?.city||'').toLowerCase();
  if(region==='VIC'||name.includes('melbourne'))return 'melbourne';
  if(region==='NSW'||name.includes('sydney'))return 'sydney';
  if(region==='QLD'||name.includes('brisbane'))return 'brisbane';
  return address?.city?'other':'';
}
module.exports=async function(req,res){
  if(req.method!=='GET') return send(res,405,{error:'Method not allowed'});
  const key=token();
  if(!key) return send(res,503,{error:'Eventbrite 尚未配置候场喜剧账号。',events:[]});
  if(cache&&cache.expires>Date.now()) return send(res,200,cache.data);
  try{
    const events=[]; let page=1, continuation='', more=true;
    while(more && page<=20){
      const query=new URLSearchParams({status:'live,started',order_by:'start_asc',expand:'venue,logo',only_public:'true'});
      if(continuation) query.set('continuation',continuation); else query.set('page',String(page));
      const r=await fetch('https://www.eventbriteapi.com/v3/organizers/'+LOADING_ZONE_ORGANIZER_ID+'/events/?'+query,{headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(12000)});
      if(!r.ok) throw Object.assign(new Error('Eventbrite unavailable'),{status:r.status});
      const data=await r.json();
      for(const e of data.events||[]){
        if(String(e.organizer_id)!==LOADING_ZONE_ORGANIZER_ID) continue;
        if(e.listed!==true || !['live','started'].includes(e.status)) continue;
        if(e.end?.utc && Date.parse(e.end.utc)<Date.now()) continue;
        events.push({id:'eb-'+e.id,externalId:e.id,title:e.name?.text||'',description:e.summary||'',start:e.start?.utc,timeZone:e.start?.timezone,image:e.logo?.original?.url||e.logo?.url||'',ticketUrl:e.url,venue:e.venue?.name||'',address:e.venue?.address?.localized_address_display||'',city:city(e.venue?.address),source:'eventbrite',published:true});
      }
      more=!!data.pagination?.has_more_items; continuation=data.pagination?.continuation||''; page++;
    }
    if(more) throw new Error('Too many events');
    const data={events,syncedAt:new Date().toISOString()};
    cache={expires:Date.now()+300000,data}; return send(res,200,data);
  }catch(err){
    const auth=err.status===401||err.status===403;
    return send(res,502,{error:auth?'Eventbrite 令牌无效，请检查 Vercel 环境变量。':'暂时无法同步演出，请稍后重试。',events:[]});
  }
};
