const crypto = require("crypto");
const BUCKET = "site-media";
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
function send(res, status, body) { res.statusCode=status; res.setHeader("Content-Type","application/json; charset=utf-8"); res.setHeader("Cache-Control","no-store"); res.setHeader("X-Content-Type-Options","nosniff"); return res.end(JSON.stringify(body)); }
function env() { return { url:(process.env.SUPABASE_URL||"").replace(/\/$/,""), key:process.env.SUPABASE_SECRET_KEY, pub:process.env.SUPABASE_PUBLISHABLE_KEY, admins:(process.env.ADMIN_EMAILS||"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean) }; }
async function admin(req) {
  const e=env(); if(!e.url||!e.key||!e.pub||!e.admins.length) throw Object.assign(new Error("Admin CMS is not configured."),{status:503});
  const auth=req.headers.authorization||""; const token=auth.startsWith("Bearer ")?auth.slice(7):"";
  if(!token) throw Object.assign(new Error("Please sign in as an administrator."),{status:401});
  const r=await fetch(e.url+"/auth/v1/user",{headers:{apikey:e.pub,Authorization:"Bearer "+token}});
  if(!r.ok) throw Object.assign(new Error("Your session has expired. Please sign in again."),{status:401});
  const user=await r.json(); const email=String(user.email||"").toLowerCase();
  if(!email||!e.admins.includes(email)) throw Object.assign(new Error("This email is not on the admin allowlist."),{status:403});
  return {e,email};
}
module.exports = async function handler(req,res) {
  if(req.method==="OPTIONS"){res.setHeader("Allow","GET, PUT, POST, OPTIONS");return res.status(204).end();}
  if(!["GET","PUT","POST"].includes(req.method)){res.setHeader("Allow","GET, PUT, POST, OPTIONS");return send(res,405,{error:"Method not allowed"});}
  let ctx; try{ctx=await admin(req);}catch(err){return send(res,err.status||500,{error:err.message||"Admin authentication failed."});}
  const {e,email}=ctx;
  if(req.method==="GET"){
    const r=await fetch(e.url+"/rest/v1/site_content?select=content_key,content_value,updated_at,updated_by&order=content_key",{headers:{apikey:e.key,Authorization:"Bearer "+e.key}});
    const data=await r.json().catch(()=>[]); if(!r.ok)return send(res,502,{error:"Could not load CMS content. Check that the CMS migration has been applied."});
    return send(res,200,{items:data});
  }
  if(req.method==="PUT"){
    const b=req.body||{}; const contentKey=String(b.content_key||""); const value=b.content_value;
    if(!/^[a-z0-9_-]{1,80}$/.test(contentKey)||!value||typeof value!=="object"||Array.isArray(value))return send(res,400,{error:"Invalid content payload."});
    const r=await fetch(e.url+"/rest/v1/site_content?on_conflict=content_key",{method:"POST",headers:{apikey:e.key,Authorization:"Bearer "+e.key,"Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify({content_key:contentKey,content_value:value,updated_at:new Date().toISOString(),updated_by:email})});
    const data=await r.json().catch(()=>[]); if(!r.ok)return send(res,502,{error:"Could not save content. Check CMS database setup."});
    return send(res,200,{ok:true,item:data[0]||null});
  }
  const b=req.body||{}; const mime=String(b.mime_type||""); const base64=String(b.base64||"");
  if(!["image/jpeg","image/png","image/webp","image/gif"].includes(mime)||!base64)return send(res,400,{error:"Only JPG, PNG, WEBP or GIF images are supported."});
  const bytes=Buffer.from(base64.replace(/^data:[^;]+;base64,/,""),"base64");
  if(!bytes.length||bytes.length>MAX_IMAGE_BYTES)return send(res,413,{error:"Image must be smaller than 3 MB."});
  const ext={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/gif":"gif"}[mime];
  const name=Date.now()+"-"+crypto.randomBytes(5).toString("hex")+"."+ext;
  const r=await fetch(e.url+"/storage/v1/object/"+BUCKET+"/"+name,{method:"POST",headers:{apikey:e.key,Authorization:"Bearer "+e.key,"Content-Type":mime,"x-upsert":"false"},body:bytes});
  if(!r.ok)return send(res,502,{error:"Image upload failed. Check that the site-media bucket exists."});
  return send(res,200,{ok:true,url:e.url+"/storage/v1/object/public/"+BUCKET+"/"+name,name});
};
