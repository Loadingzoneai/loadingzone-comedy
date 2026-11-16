const {send,user,db}=require('../lib/server');
// 会员本人资料：基本信息、会员状态、方案、专属折扣码、钱包卡链接
module.exports=async function(req,res){
  if(req.method!=='GET') return send(res,405,{error:'Method not allowed'});
  try{
    const u=await user(req);
    const rows=await db('members?user_id=eq.'+encodeURIComponent(u.id)+'&select=id,email,full_name,phone,member_number,city,plan,payment_mode,subscription_status,current_period_end,cancel_at_period_end,wallet_pass_url,stripe_customer_id&limit=1');
    const m=rows[0]||null;
    const active=!!m && m.subscription_status==='active' && Date.parse(m.current_period_end)>Date.now();
    let discountCode=null;
    if(m&&active){const codes=await db('member_discount_codes?member_id=eq.'+m.id+'&select=code,status&limit=1');discountCode=codes[0]&&codes[0].status==='active'?codes[0].code:null;}
    const member=m?{full_name:m.full_name,phone:m.phone,member_number:m.member_number,city:m.city,plan:m.plan,payment_mode:m.payment_mode,subscription_status:m.subscription_status,current_period_end:m.current_period_end,cancel_at_period_end:m.cancel_at_period_end,wallet_pass_url:m.wallet_pass_url,has_billing:!!m.stripe_customer_id&&m.payment_mode==='subscription'}:null;
    return send(res,200,{email:u.email,member,active,discountCode});
  }catch(e){return send(res,e.status||503,{error:e.message});}
};
