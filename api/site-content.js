module.exports = async function handler(req,res){
 res.setHeader("Cache-Control","no-store");
 res.setHeader("X-Content-Type-Options","nosniff");
 res.setHeader("X-Robots-Tag","noindex, nofollow, noarchive");
 if(req.method!=="GET"){res.setHeader("Allow","GET");res.statusCode=405;return res.end(JSON.stringify({error:"Method not allowed"}));}
 const url=(process.env.SUPABASE_URL||"").replace(/\/$/,"");const key=process.env.SUPABASE_SECRET_KEY;
 if(!url||!key){res.statusCode=503;res.setHeader("Content-Type","application/json; charset=utf-8");return res.end(JSON.stringify({error:"CMS content is not configured"}));}
 try{const r=await fetch(url+"/rest/v1/site_content?content_key=in.(home,shows,gallery)&select=content_key,content_value",{headers:{apikey:key,Authorization:"Bearer "+key}});if(!r.ok)throw new Error("content read failed");const rows=await r.json();const content={};for(const row of rows){const value=row.content_value||{};content[row.content_key]=row.content_key==='home'?value:{items:(value.items||[]).filter(x=>x.published===true)}}res.statusCode=200;res.setHeader("Content-Type","application/json; charset=utf-8");return res.end(JSON.stringify(content));}
 catch(_){res.statusCode=503;res.setHeader("Content-Type","application/json; charset=utf-8");return res.end(JSON.stringify({error:"CMS content is not available"}));}
};
