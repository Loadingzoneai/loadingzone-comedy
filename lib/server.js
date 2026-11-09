const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
};
function config() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY;
  const pub = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || !pub) throw Object.assign(new Error('服务尚未完成配置。'), {status:503});
  return {url, key, pub};
}
async function db(path, options = {}) {
  const {url,key} = config();
  const response = await fetch(url + '/rest/v1/' + path, {...options, headers:{apikey:key, Authorization:'Bearer '+key, 'Content-Type':'application/json', ...options.headers}});
  if (!response.ok) throw Object.assign(new Error('数据库暂不可用，请稍后重试。'), {status:503});
  return response.status === 204 ? null : response.json();
}
async function user(req, admin = false) {
  const {url,pub} = config();
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!match) throw Object.assign(new Error('请先登录。'), {status:401});
  const r = await fetch(url+'/auth/v1/user', {headers:{apikey:pub, Authorization:'Bearer '+match[1]}});
  if (!r.ok) throw Object.assign(new Error('登录已过期，请重新登录。'), {status:401});
  const u = await r.json();
  if (!u.id || !u.email) throw Object.assign(new Error('请使用邮箱登录。'), {status:401});
  if (admin && !(process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map(s=>s.trim()).includes(u.email.toLowerCase())) throw Object.assign(new Error('没有管理员权限。'), {status:403});
  return u;
}
module.exports = {send,config,db,user};
