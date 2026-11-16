const {send,user}=require('../../lib/server');
const {sendTestEmail}=require('../../lib/fulfil');
// 管理员发送一封示例会员确认邮件到自己的邮箱，用于检查邮件配置
module.exports=async function(req,res){
  if(req.method!=='POST')return send(res,405,{error:'Method not allowed'});
  try{
    const u=await user(req,true);
    const sent=await sendTestEmail(u.email);
    if(!sent)return send(res,503,{error:'邮件尚未配置（缺少 SMTP_USER 或 SMTP_PASS）。'});
    return send(res,200,{ok:true,to:u.email});
  }catch(e){
    const auth=e.status===401||e.status===403;
    return send(res,e.status||502,{error:auth?e.message:'发送失败：请检查应用专用密码是否正确。'});
  }
};
