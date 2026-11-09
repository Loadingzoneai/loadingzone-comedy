const {send,user,db}=require('../lib/server');
module.exports=async function(req,res){
  if(req.method!=='GET') return send(res,405,{error:'Method not allowed'});
  try{
    const u=await user(req);
    const rows=await db('members?user_id=eq.'+encodeURIComponent(u.id)+'&select=id,email,city,subscription_status,current_period_end,cancel_at_period_end&limit=1');
    const member=rows[0]||null;
    const active=!!member && member.subscription_status==='active' && Date.parse(member.current_period_end)>Date.now();
    return send(res,200,{email:u.email,member,active});
  }catch(e){return send(res,e.status||503,{error:e.message});}
};
