const {send,user,db}=require('../lib/server');
module.exports=async function(req,res){
  if(req.method!=='POST')return send(res,405,{error:'Method not allowed'});
  const secret=process.env.STRIPE_SECRET_KEY||'';
  if(!secret.startsWith('sk_test_'))return send(res,503,{error:'Test billing is not configured.'});
  try{
    const u=await user(req);
    const rows=await db('members?user_id=eq.'+encodeURIComponent(u.id)+'&select=stripe_customer_id&limit=1');
    const customer=rows[0]?.stripe_customer_id;
    if(!customer)return send(res,404,{error:'No billing account exists for this member.'});
    const origin=String(req.headers.origin||'');
    if(!/^https:\/\/(loadingzonecomedy\.au|www\.loadingzonecomedy\.au|loadingzone-comedy(?:-[a-z0-9-]+)?\.vercel\.app)$/.test(origin))return send(res,403,{error:'Invalid return destination.'});
    const params=new URLSearchParams({customer,return_url:origin+'/#login'});
    const r=await fetch('https://api.stripe.com/v1/billing_portal/sessions',{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/x-www-form-urlencoded'},body:params});
    const data=await r.json();
    if(!r.ok||!data.url)return send(res,503,{error:'Billing portal unavailable. Please contact info@loadingzonecomedy.com.'});
    return send(res,200,{url:data.url});
  }catch(e){return send(res,e.status||503,{error:e.message});}
};
