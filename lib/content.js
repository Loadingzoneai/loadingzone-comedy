function https(value, required = false) {
  if (!value && !required) return '';
  try {const u=new URL(value); if(u.protocol==='https:' && !u.username && !u.password) return u.href;} catch {}
  throw Object.assign(new Error('图片和购票地址必须是完整的 HTTPS 链接。'), {status:400});
}
function records(value) {
  if (!value || !Array.isArray(value.items) || value.items.length>300) throw Object.assign(new Error('演出列表格式错误或超过 300 条。'), {status:400});
  const ids=new Set();
  return {items:value.items.map(item=>{
    const id=String(item.id||''); const title=String(item.title||'').trim();
    if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id)||ids.has(id)||!title||title.length>200) throw Object.assign(new Error('演出编号或标题无效。'), {status:400});
    ids.add(id);
    if(item.start && !Number.isFinite(Date.parse(item.start))) throw Object.assign(new Error('演出日期无效。'),{status:400});
    return {id,title,start:item.start?new Date(item.start).toISOString():null,venue:String(item.venue||'').slice(0,300),description:String(item.description||'').slice(0,3000),image:https(item.image),ticketUrl:https(item.ticketUrl),published:item.published===true,pinned:item.pinned===true,source:'manual'};
  })};
}
module.exports={https,records};
