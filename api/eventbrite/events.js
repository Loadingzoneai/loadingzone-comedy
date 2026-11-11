const {send}=require('../../lib/server');
// Public Eventbrite organizer profile: /o/loadingzone-comedy-75417874333.
const LOADING_ZONE_ORGANIZER_ID = '75417874333';
let cache;
module.exports=async function(req,res){
  if(req.method!=='GET') return send(res,405,{error:'Method not allowed'});
  const token=process.env.EVENTBRITE_PRIVATE_TOKEN||process.env.EVENTBRITE_TOKEN;
  const org=process.env.EVENTBRITE_ORGANIZATION_ID||process.env.EVENTBRITE_ORG_ID;
  if(!token||!/^\d+$/.test(org||'')) return send(res,503,{error:'Eventbrite 尚未配置候场喜剧账号。',events:[]});
  if(cache?.org===org && cache.expires>Date.now()) return send(res,200,cache.data);
  try{
    const events=[]; let page=1,more=true;
    while(more && page<=20){
      const query=new URLSearchParams({status:'live,started',time_filter:'current_future',order_by:'start_asc',expand:'venue,logo',only_public:'true',page:String(page)});
      const r=await fetch('https://www.eventbriteapi.com/v3/organizations/'+org+'/events/?'+query,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(12000)});
      if(!r.ok) throw new Error('Eventbrite unavailable');
      const data=await r.json();
      for(const e of data.events||[]){
        if(String(e.organizer_id) !== LOADING_ZONE_ORGANIZER_ID) continue;
        if(e.listed!==true || !['live','started'].includes(e.status)) continue;
        events.push({id:'eb-'+e.id,externalId:e.id,title:e.name?.text||'',start:e.start?.utc,timeZone:e.start?.timezone,image:e.logo?.url||'',ticketUrl:e.url,venue:e.venue?.name||'',address:e.venue?.address?.localized_address_display||'',source:'eventbrite',published:true});
      }
      more=!!data.pagination?.has_more_items; page++;
    }
    if(more) throw new Error('Too many events');
    const data={events,syncedAt:new Date().toISOString()};
    cache={org,expires:Date.now()+300000,data}; return send(res,200,data);
  }catch{return send(res,502,{error:'暂时无法同步演出，请稍后重试。',events:[]});}
};
