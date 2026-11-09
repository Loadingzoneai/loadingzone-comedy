const {send,user,db}=require('../../lib/server');
module.exports=async function(req,res){
  if(req.method!=='GET')return send(res,405,{error:'Method not allowed'});
  try{await user(req,true);const members=await db('members?select=id,email,city,subscription_status,current_period_end&order=id.desc&limit=100');return send(res,200,{members});}
  catch(e){return send(res,e.status||503,{error:e.message});}
};
