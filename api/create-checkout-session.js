/**
 * 会员付款：已登录会员填写 名字 + 电话 + 城市 + 方案（月付/年付）+ 续费方式（自动续费/单次），
 * 服务器保存会员资料后创建 Stripe Checkout。
 * - 自动续费：subscription 模式；如果当前单次会员还没到期，订阅从到期日开始扣费。
 * - 单次付款：payment 模式；webhook 收到付款后把会员有效期延长一个月或一年，到期不自动扣费。
 * 价格只在服务器决定，忽略浏览器传来的任何价格。目前只接受 Stripe 测试密钥。
 */
const { randomUUID } = require("crypto");
const { testStripeKey } = require("../lib/stripe-key");
const CITIES = new Set(["melbourne", "sydney", "brisbane"]);
const PLANS = { monthly: { cents: 1280, interval: "month", zh: "月付" }, annual: { cents: 9980, interval: "year", zh: "年付" } };
const RENEWALS = new Set(["auto", "once"]);

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  res.end(JSON.stringify(body));
}
function originFor(req) {
  const origin = String(req.headers.origin || "");
  if (/^https:\/\/(www\.|preview\.)?loadingzonecomedy\.(au|com)$/.test(origin)) return origin;
  if (/^https:\/\/loadingzone-comedy(-[a-z0-9-]+)?\.vercel\.app$/.test(origin)) return origin;
  const host = String(req.headers.host || "").toLowerCase();
  if (/^loadingzone-comedy(-[a-z0-9-]+)?\.vercel\.app$/.test(host)) return "https://" + host;
  return "";
}
const cleanName = (v) => String(v || "").replace(/\s+/g, " ").trim();
const cleanPhone = (v) => String(v || "").replace(/[\s()-]/g, "");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return send(res, 405, { error: "Method not allowed" }); }
  const stripe = testStripeKey();
  const stripeKey = stripe.key;
  const root = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY || "";
  const dbKey = process.env.SUPABASE_SECRET_KEY || "";
  if (!stripe.ok) { console.error("[checkout] " + stripe.reason); return send(res, 503, { error: "付款服务尚未配置好（" + stripe.reason + "）" }); }
  if (!root || !publicKey || !dbKey) return send(res, 503, { error: "Membership is not configured yet." });
  const token = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ""));
  if (!token) return send(res, 401, { error: "请先登录。" });
  const origin = originFor(req);
  if (!origin) return send(res, 403, { error: "This site is not allowed to start checkout." });
  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {}); } catch (_) { return send(res, 400, { error: "Invalid request body." }); }
  const plan = String(body.plan || ""), city = String(body.city || "").toLowerCase();
  const renewal = String(body.renewal || "auto");
  const name = cleanName(body.name), phone = cleanPhone(body.phone);
  if (!PLANS[plan] || !CITIES.has(city) || !RENEWALS.has(renewal)) return send(res, 400, { error: "请选择会员方案、续费方式和城市。" });
  if (name.length < 1 || name.length > 60) return send(res, 400, { error: "请填写名字（60 字以内）。" });
  if (!/^\+?\d{8,15}$/.test(phone)) return send(res, 400, { error: "请填写有效的电话号码。" });

  const db = { apikey: dbKey, Authorization: "Bearer " + dbKey, "Content-Type": "application/json", Accept: "application/json" };
  try {
    const u = await fetch(root + "/auth/v1/user", { headers: { apikey: publicKey, Authorization: "Bearer " + token[1], Accept: "application/json" } });
    if (!u.ok) return send(res, 401, { error: "登录已过期，请重新登录。" });
    const user = await u.json();
    if (!user || !user.id || !user.email) return send(res, 401, { error: "Account email is required." });

    const r = await fetch(root + "/rest/v1/members?user_id=eq." + encodeURIComponent(user.id) + "&select=id,stripe_customer_id,stripe_subscription_id,subscription_status,current_period_end,payment_mode&limit=1", { headers: db });
    if (!r.ok) return send(res, 503, { error: "暂时无法确认会员状态，请稍后再试。" });
    const member = (await r.json())[0];
    if (member && member.stripe_subscription_id && member.payment_mode !== "one_time" && !["canceled", "incomplete_expired"].includes(member.subscription_status)) {
      return send(res, 409, { error: "你已经有自动续费的会员，请在会员中心管理现有订阅。" });
    }
    // 保存报名资料（新会员入库时数据库会自动生成专属折扣码）
    const profile = { full_name: name, phone, city, updated_at: new Date().toISOString() };
    const saved = member
      ? await fetch(root + "/rest/v1/members?id=eq." + member.id, { method: "PATCH", headers: { ...db, Prefer: "return=minimal" }, body: JSON.stringify(profile) })
      : await fetch(root + "/rest/v1/members", { method: "POST", headers: { ...db, Prefer: "return=minimal" }, body: JSON.stringify({ ...profile, user_id: user.id, email: user.email }) });
    if (!saved.ok) return send(res, 503, { error: "会员资料保存失败，请稍后再试。" });

    const p = PLANS[plan];
    const params = new URLSearchParams();
    params.set("success_url", origin + "/#login?checkout=success");
    params.set("cancel_url", origin + "/#login?checkout=cancelled");
    params.set("client_reference_id", user.id);
    params.set("locale", "auto");
    if (member && member.stripe_customer_id) params.set("customer", member.stripe_customer_id);
    else params.set("customer_email", user.email);
    params.set("line_items[0][quantity]", "1");
    params.set("line_items[0][price_data][currency]", "aud");
    params.set("line_items[0][price_data][unit_amount]", String(p.cents));
    params.set("line_items[0][price_data][product_data][name]", "候场会员 Loading Zone Membership · " + p.zh + (renewal === "auto" ? "（自动续费）" : "（单次）"));
    const meta = { user_id: user.id, city, plan, renewal };
    for (const [k, v] of Object.entries(meta)) params.set("metadata[" + k + "]", v);
    if (renewal === "auto") {
      params.set("mode", "subscription");
      params.set("line_items[0][price_data][recurring][interval]", p.interval);
      for (const [k, v] of Object.entries(meta)) params.set("subscription_data[metadata][" + k + "]", v);
      // 单次会员还没到期：订阅从到期日开始扣费，避免重复收费
      const end = member && member.subscription_status === "active" ? Date.parse(member.current_period_end) : 0;
      if (end && end - Date.now() > 48 * 3600 * 1000) params.set("subscription_data[trial_end]", String(Math.floor(end / 1000)));
    } else {
      params.set("mode", "payment");
      if (!member || !member.stripe_customer_id) params.set("customer_creation", "always");
      for (const [k, v] of Object.entries(meta)) params.set("payment_intent_data[metadata][" + k + "]", v);
    }
    const s = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: "Bearer " + stripeKey, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": "lz-checkout-" + randomUUID() },
      body: params
    });
    const session = await s.json();
    if (!s.ok || !session.url) return send(res, 502, { error: "无法创建付款页面，请稍后再试。" });
    return send(res, 200, { url: session.url });
  } catch (_) {
    return send(res, 502, { error: "付款服务暂时不可用，请稍后再试。" });
  }
};
