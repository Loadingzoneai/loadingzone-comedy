const {send,user,db}=require('../../lib/server');
// 管理员查看会员列表（只读）：只返回后台需要的字段，不返回 Stripe 客户编号等内部信息。
module.exports=async function(req,res){
  if(req.method!=='GET')return send(res,405,{error:'Method not allowed'});
  try{
    await user(req,true);
    const [members,codes]=await Promise.all([
      db('members?select=id,email,full_name,phone,member_number,city,plan,payment_mode,subscription_status,current_period_end,cancel_at_period_end,member_since,created_at&order=created_at.desc&limit=2000'),
      db('member_discount_codes?select=member_id,code,status&limit=5000')
    ]);
    const byMember=new Map(codes.map(c=>[c.member_id,c]));
    const now=Date.now();
    return send(res,200,{members:members.map(m=>{
      const active=m.subscription_status==='active'&&Date.parse(m.current_period_end)>now;
      const c=byMember.get(m.id);
      return {id:m.id,email:m.email,name:m.full_name,phone:m.phone,memberNumber:m.member_number,city:m.city,status:m.subscription_status,active,
        periodEnd:m.current_period_end,autoRenew:m.payment_mode==='subscription'&&!m.cancel_at_period_end,paymentMode:m.payment_mode,plan:m.plan,
        memberSince:m.member_since||m.created_at,discountCode:c?c.code:'',discountCodeValid:!!c&&c.status==='active'&&active};
    })});
  }catch(e){return send(res,e.status||503,{error:e.message});}
};
