/**
 * 会员开通后的交付：生成/更新手机钱包会员卡（Passcreator），发送确认邮件（Gmail SMTP）。
 * 每个会员有效期只发一次确认邮件（用 members.confirmation_period_end 记录），重复的 Stripe 通知不会重复发信。
 * 邮件或钱包服务未配置时跳过对应步骤，不影响会员开通。
 */
const SITE = () => (process.env.SITE_URL || 'https://loadingzonecomedy.au').replace(/\/$/, '');
const CITY = { melbourne: '墨尔本 Melbourne', sydney: '悉尼 Sydney', brisbane: '布里斯班 Brisbane' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function dateAU(iso) {
  try { return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Australia/Melbourne', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(iso)); } catch { return String(iso || ''); }
}
function planLabel(m) {
  const p = m.plan === 'annual' ? '年付' : m.plan === 'monthly' ? '月付' : '';
  return p ? p + (m.payment_mode === 'one_time' ? '（单次）' : '（自动续费）') : '';
}

/* ---------- 钱包卡（Passcreator） ---------- */
function walletConfigured() { return !!(process.env.PASSCREATOR_API_KEY && process.env.PASSCREATOR_TEMPLATE_ID); }
function walletFields(m, code) {
  // Passcreator 模板里的占位字段需要使用这些名称
  return {
    memberName: m.full_name || m.email,
    memberNumber: m.member_number || '',
    validUntil: dateAU(m.current_period_end),
    plan: planLabel(m),
    city: CITY[m.city] || '',
    discountCode: code || '',
    barcodeValue: m.member_number || ''
  };
}
async function upsertWalletPass(m, code) {
  if (!walletConfigured()) return null;
  const key = process.env.PASSCREATOR_API_KEY, tpl = process.env.PASSCREATOR_TEMPLATE_ID;
  const base = 'https://app.passcreator.com/api/pass';
  const url = m.wallet_pass_id
    ? base + '/' + encodeURIComponent(m.wallet_pass_id) + '?zapierStyle=true'
    : base + '?passtemplate=' + encodeURIComponent(tpl) + '&zapierStyle=true';
  const r = await fetch(url, { method: m.wallet_pass_id ? 'PUT' : 'POST', headers: { Authorization: key, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(walletFields(m, code)), signal: AbortSignal.timeout(15000) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('wallet_pass_failed');
  return { id: data.identifier || m.wallet_pass_id || null, url: data.linkToPassPage || m.wallet_pass_url || null };
}

/* ---------- 确认邮件 ---------- */
function mailConfigured() { return !!(process.env.SMTP_USER && process.env.SMTP_PASS); }
function emailHtml(m, code, walletUrl, renewal) {
  const site = SITE();
  const row = (k, v) => v ? `<tr><td style="padding:4px 0;color:#bdb5a6;font-size:13px">${k}</td><td style="padding:4px 0;color:#fff;font-size:14px;text-align:right"><b>${esc(v)}</b></td></tr>` : '';
  return `<!doctype html><html><body style="margin:0;background:#f4efe6;font-family:-apple-system,'PingFang SC','Noto Sans SC',Arial,sans-serif;color:#171717">
<div style="max-width:560px;margin:0 auto;padding:28px 16px">
<p style="font-size:16px">${esc(m.full_name || '')}，你好：</p>
<p style="font-size:15px;line-height:1.7">${renewal ? '你的<b>候场会员</b>已续期，新的有效期见下方会员卡。' : '欢迎加入<b>候场会员</b>！你的会员已经开通，下面是你的电子会员卡。'}</p>
<div style="background:#0b0b0b;border-radius:18px;padding:22px 22px 18px;margin:20px 0;border:1px solid #2a2a2a">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td><img src="${esc(process.env.EMAIL_LOGO_URL || site + '/email-logo.png')}" alt="候场喜剧 Loading Zone Comedy" width="80" height="80" style="display:block;border-radius:50%"></td><td style="text-align:right;color:#ffb52f;font-size:12px;letter-spacing:2px">MEMBER</td></tr></table>
  <div style="color:#fff;font-size:22px;font-weight:800;margin:18px 0 4px">${esc(m.full_name || m.email)}</div>
  <div style="color:#ffb52f;font-size:15px;letter-spacing:1px;margin-bottom:14px">${esc(m.member_number || '')}</div>
  <table width="100%" cellpadding="0" cellspacing="0">${row('有效期至', dateAU(m.current_period_end))}${row('方案', planLabel(m))}${row('城市', CITY[m.city])}${row('专属折扣码', code)}</table>
</div>
${walletUrl ? `<p style="text-align:center;margin:22px 0"><a href="${esc(walletUrl)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:13px 22px;border-radius:999px;font-weight:700">添加到 Apple 钱包 / Google 钱包</a></p>` : ''}
<h3 style="font-size:16px;margin:24px 0 8px">会员权益</h3>
<ul style="font-size:14px;line-height:1.8;padding-left:20px;margin:0">
<li>符合规则的开放麦活动免费入场</li>
<li>符合条件的商业 / 专业演出门票 A$10 优惠：购票时使用你的专属折扣码 <b>${esc(code || '')}</b></li>
<li>所在城市的合作商家福利</li>
</ul>
<p style="font-size:13px;color:#555;line-height:1.7;margin-top:18px">专属折扣码仅限本人使用，具体适用场次以每场演出的说明为准。${m.payment_mode === 'one_time' ? '你选择的是单次付款，到期后不会自动扣费，如需继续可在会员中心再次购买。' : '你选择的是自动续费，可随时在会员中心管理或关闭自动续费。'}</p>
<p style="text-align:center;margin:22px 0"><a href="${site}/#login" style="color:#d94a32;font-weight:700">进入会员中心</a></p>
<p style="font-size:12px;color:#888;border-top:1px solid #ddd;padding-top:14px">候场喜剧 Loading Zone Comedy · 如有问题请回复本邮件或联系 info@loadingzonecomedy.com</p>
</div></body></html>`;
}
function emailText(m, code, walletUrl) {
  return `${m.full_name || ''}，你好：\n\n欢迎加入候场会员！\n会员号：${m.member_number || ''}\n有效期至：${dateAU(m.current_period_end)}\n方案：${planLabel(m)}\n专属折扣码：${code || ''}\n${walletUrl ? '添加到手机钱包：' + walletUrl + '\n' : ''}\n会员中心：${SITE()}/#login\n\n候场喜剧 Loading Zone Comedy`;
}
async function sendConfirmation(m, code, walletUrl, renewal) {
  if (!mailConfigured()) return false;
  const nodemailer = require('nodemailer');
  const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST || 'smtp.gmail.com', port: Number(process.env.SMTP_PORT || 465), secure: true, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
  await transport.sendMail({
    from: process.env.MAIL_FROM || `候场喜剧 Loading Zone Comedy <${process.env.SMTP_USER}>`,
    to: m.email,
    replyTo: process.env.MAIL_REPLY_TO || 'info@loadingzonecomedy.com',
    subject: renewal ? '候场会员已续期｜新的有效期' : '欢迎加入候场会员｜你的电子会员卡',
    text: emailText(m, code, walletUrl),
    html: emailHtml(m, code, walletUrl, renewal)
  });
  return true;
}

/**
 * db(path, options) 与 lib/server.js 的 db 相同签名。
 * 对一个已开通的会员执行交付；如果本期已经发过确认邮件，只更新钱包卡（有效期变化时）。
 */
async function fulfilMember(db, userId) {
  const rows = await db('members?user_id=eq.' + encodeURIComponent(userId) + '&select=id,email,full_name,member_number,city,plan,payment_mode,subscription_status,current_period_end,wallet_pass_id,wallet_pass_url,confirmation_period_end&limit=1');
  const m = rows && rows[0];
  if (!m || m.subscription_status !== 'active' || !(Date.parse(m.current_period_end) > Date.now())) return { skipped: 'inactive' };
  if (m.confirmation_period_end && Date.parse(m.confirmation_period_end) === Date.parse(m.current_period_end)) return { skipped: 'already_sent' };
  const codes = await db('member_discount_codes?member_id=eq.' + m.id + '&select=code&limit=1');
  const code = codes && codes[0] && codes[0].code;
  const pass = await upsertWalletPass(m, code);
  const patch = {};
  if (pass) { patch.wallet_pass_id = pass.id; patch.wallet_pass_url = pass.url; }
  const sent = await sendConfirmation(m, code, pass ? pass.url : m.wallet_pass_url, !!m.confirmation_period_end);
  if (sent) patch.confirmation_period_end = m.current_period_end;
  if (Object.keys(patch).length) await db('members?id=eq.' + m.id, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
  return { sent, wallet: !!pass };
}

async function sendTestEmail(to) {
  const sample = { email: to, full_name: '测试会员', member_number: 'LZ-000000', current_period_end: new Date(Date.now() + 30 * 864e5).toISOString(), plan: 'monthly', payment_mode: 'subscription', city: 'melbourne' };
  return sendConfirmation(sample, 'LZCTEST0000', null, false);
}

module.exports = { fulfilMember, emailHtml, walletFields, planLabel, sendTestEmail };
