const {send,user,db}=require('../../lib/server');
// 管理员查看会员列表（只读）。只返回后台需要的字段，不返回 Stripe 客户编号等内部信息。
module.exports=async function(req,res){
  if(req.method!=='GET')return send(res,405,{error:'Method not allowed'});
  try{
    await user(req,true);
    const members=await db('members?select=id,email,city,subscription_status,current_period_end,cancel_at_period_end,member_since,stripe_price_id&order=member_since.desc.nullslast&limit=2000');
    const monthly=process.env.STRIPE_TEST_PRICE_MONTHLY||process.env.STRIPE_PRICE_MONTHLY||'';
    const annual=process.env.STRIPE_TEST_PRICE_ANNUAL||process.env.STRIPE_PRICE_ANNUAL||'';
    const now=Date.now();
    return send(res,200,{members:members.map(m=>({
      id:m.id,email:m.email,city:m.city,status:m.subscription_status,
      active:m.subscription_status==='active'&&Date.parse(m.current_period_end)>now,
      periodEnd:m.current_period_end,autoRenew:!m.cancel_at_period_end,memberSince:m.member_since,
      plan:m.stripe_price_id&&m.stripe_price_id===monthly?'monthly':m.stripe_price_id&&m.stripe_price_id===annual?'annual':''
    }))});
  }catch(e){return send(res,e.status||503,{error:e.message});}
};
