/**
 * Stripe webhook endpoint for membership subscriptions.
 * Requires raw request bytes for signature verification; never trusts unsigned payloads.
 * Preview is test-only. No schema changes are performed by this handler.
 */
const crypto = require("crypto");
const { testStripeKey } = require("../lib/stripe-key");
const { fulfilMember } = require("../lib/fulfil");
const { db: serverDb } = require("../lib/server");

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(body));
}

async function rawBody(req) {
  // 先读原始字节流：在 Vercel 上一旦访问 req.body 就会触发 JSON 解析并耗尽流，签名就无法校验。
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (typeof req.rawBody === "string") return Buffer.from(req.rawBody);
  if (typeof req[Symbol.asyncIterator] === "function" && !req.readableEnded) {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += Buffer.byteLength(chunk); if (size > 1048576) return null; chunks.push(Buffer.from(chunk)); }
    if (size > 0) return Buffer.concat(chunks);
  }
  const body = Object.getOwnPropertyDescriptor(req, "body") ? req.body : undefined;
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === "string" && body) return Buffer.from(body);
  return null;
}

function verifySignature(payload, header, secret) {
  if (!payload || !header || !secret) return false;
  const fields = Object.fromEntries(String(header).split(",").map(part => {
    const i = part.indexOf("=");
    return i < 0 ? [part, ""] : [part.slice(0, i), part.slice(i + 1)];
  }));
  const timestamp = fields.t;
  const signatures = String(header).split(",").filter(p => p.startsWith("v1=")).map(p => p.slice(3));
  if (!timestamp || !signatures.length || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(timestamp + ".").update(payload).digest();
  return signatures.some(value => {
    if (!/^[a-f0-9]{64}$/i.test(value)) return false;
    const supplied = Buffer.from(value, "hex");
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  });
}

function isoFromUnix(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0 ? new Date(Number(value) * 1000).toISOString() : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Method not allowed" });
  }
  const stripe = testStripeKey();
  const stripeKey = stripe.key;
  const webhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const supabaseKey = process.env.SUPABASE_SECRET_KEY || "";
  if (!stripe.ok || !webhookSecret.startsWith("whsec_")) {
    console.error("[stripe-webhook] " + (stripe.ok ? "STRIPE_WEBHOOK_SECRET missing or not whsec_" : stripe.reason));
    return send(res, 503, { error: "Test-mode webhook is not configured." });
  }
  if (!supabaseUrl || !supabaseKey) return send(res, 503, { error: "Membership storage is not configured." });

  const payload = await rawBody(req);
  if (!payload) return send(res, 400, { error: "Raw request body required for signature verification." });
  if (!verifySignature(payload, req.headers["stripe-signature"], webhookSecret)) {
    return send(res, 400, { error: "Invalid webhook signature." });
  }

  let event;
  try { event = JSON.parse(payload.toString("utf8")); }
  catch (_) { return send(res, 400, { error: "Invalid event payload." }); }
  if (!event || !event.id || !event.type || event.livemode !== false) {
    return send(res, 400, { error: "Only valid Stripe test-mode events are accepted." });
  }

  const dbHeaders = {
    apikey: supabaseKey,
    Authorization: "Bearer " + supabaseKey,
    "Content-Type": "application/json",
    Accept: "application/json"
  };
  const eventInsert = await fetch(supabaseUrl + "/rest/v1/stripe_events?on_conflict=id", {
    method: "POST",
    headers: { ...dbHeaders, Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({ id: event.id, event_type: event.type, livemode: false, processing_status: "processing" })
  });
  if (!eventInsert.ok) return send(res, 500, { error: "Could not record webhook event." });
  const inserted = await eventInsert.json().catch(() => []);
  if (!Array.isArray(inserted) || inserted.length === 0) {
    const existingResponse=await fetch(supabaseUrl+'/rest/v1/stripe_events?id=eq.'+encodeURIComponent(event.id)+'&select=processing_status', {headers:dbHeaders});
    if(!existingResponse.ok)return send(res,500,{error:'Could not check event status.'});
    const existing=await existingResponse.json();
    if(existing[0]?.processing_status==='processed')return send(res,200,{received:true,duplicate:true});
    // Failed or interrupted deliveries must run again; the latest subscription is
    // retrieved below, so an old notification cannot roll back its current status.
  }

  async function updateMember(filter, patch) {
    const url = supabaseUrl + "/rest/v1/members?" + filter;
    const response = await fetch(url, {
      method: "PATCH",
      headers: { ...dbHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() })
    });
    if (!response.ok) throw new Error("member_update_failed");
  }

  async function retrieveSubscription(id) {
    const response = await fetch("https://api.stripe.com/v1/subscriptions/" + encodeURIComponent(id), {
      headers: { Authorization: "Bearer " + stripeKey, Accept: "application/json" }
    });
    const data = await response.json();
    if (!response.ok || !data.id) throw new Error("subscription_fetch_failed");
    return data;
  }

  async function subscriptionIsLive(id) {
    const r = await fetch("https://api.stripe.com/v1/subscriptions/" + encodeURIComponent(id), {
      headers: { Authorization: "Bearer " + stripeKey, Accept: "application/json" }
    });
    if (!r.ok) return false;
    const sub = await r.json().catch(() => ({}));
    return ["active", "trialing", "past_due"].includes(sub && sub.status);
  }

  async function syncSubscription(subscription, userIdHint) {
    const metadata = subscription.metadata || {};
    const userId = metadata.user_id || userIdHint;
    if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
      throw new Error("missing_user_id");
    }
    const priceId = subscription.items && subscription.items.data && subscription.items.data[0] &&
      subscription.items.data[0].price && subscription.items.data[0].price.id;
    const patch = {
      stripe_customer_id: typeof subscription.customer === "string" ? subscription.customer : subscription.customer && subscription.customer.id,
      stripe_subscription_id: subscription.id,
      stripe_price_id: priceId || null,
      // 单次会员改自动续费时，订阅以 trialing 状态延后到原到期日才扣费，此期间仍是有效会员
      subscription_status: subscription.status === "trialing" ? "active" : (subscription.status || "inactive"),
      payment_mode: "subscription",
      ...(["monthly", "annual"].includes(metadata.plan) ? { plan: metadata.plan } : {}),
      current_period_start: isoFromUnix(subscription.items?.data?.[0]?.current_period_start ?? subscription.current_period_start),
      current_period_end: isoFromUnix(subscription.items?.data?.[0]?.current_period_end ?? subscription.current_period_end),
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
      member_since: isoFromUnix(subscription.start_date) || isoFromUnix(subscription.created)
    };
    const response = await fetch(supabaseUrl + "/rest/v1/members?user_id=eq." + encodeURIComponent(userId), {
      method: "GET", headers: { ...dbHeaders, Accept: "application/json" }
    });
    if (!response.ok) throw new Error("member_lookup_failed");
    const rows = await response.json();
    if (Array.isArray(rows) && rows.length) {
      // 同一会员已有另一个仍有效的订阅（例如重复付款产生的多余订阅）：保留现有订阅，忽略这个事件，
      // 避免多余订阅的创建/取消覆盖会员当前状态。
      const current = rows[0].stripe_subscription_id;
      if (current && current !== subscription.id && await subscriptionIsLive(current)) return;
      await updateMember("user_id=eq." + encodeURIComponent(userId), patch);
    } else {
      const customerResponse = await fetch("https://api.stripe.com/v1/customers/" + encodeURIComponent(patch.stripe_customer_id || ""), {
        headers: { Authorization: "Bearer " + stripeKey, Accept: "application/json" }
      });
      const customer = await customerResponse.json().catch(() => ({}));
      const email = (customer && customer.email) || "";
      if (!email) throw new Error("member_email_missing");
      const createResponse = await fetch(supabaseUrl + "/rest/v1/members", {
        method: "POST",
        headers: { ...dbHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({ ...patch, user_id: userId, email, city: metadata.city || null })
      });
      if (!createResponse.ok) throw new Error("member_create_failed");
    }
  }

  // 单次付款：把会员有效期从「现在」或「当前到期日（如果还有效）」延长一个月 / 一年
  async function activateOneTime(session) {
    const meta = session.metadata || {};
    const userId = session.client_reference_id || meta.user_id;
    if (!userId || !["monthly", "annual"].includes(meta.plan)) throw new Error("missing_one_time_metadata");
    const paymentId = typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent && session.payment_intent.id) || session.id;
    const r = await fetch(supabaseUrl + "/rest/v1/members?user_id=eq." + encodeURIComponent(userId) + "&select=id,subscription_status,current_period_end,member_since,last_payment_id&limit=1", { headers: dbHeaders });
    if (!r.ok) throw new Error("member_lookup_failed");
    const m = (await r.json())[0];
    if (!m) throw new Error("member_missing");
    if (m.last_payment_id === paymentId) return userId; // 重复通知，不重复延期
    const now = Date.now();
    const currentEnd = m.subscription_status === "active" ? Date.parse(m.current_period_end) : 0;
    const start = new Date(currentEnd > now ? currentEnd : now);
    const end = new Date(start);
    if (meta.plan === "annual") end.setUTCFullYear(end.getUTCFullYear() + 1); else end.setUTCMonth(end.getUTCMonth() + 1);
    await updateMember("id=eq." + m.id, {
      subscription_status: "active",
      payment_mode: "one_time",
      plan: meta.plan,
      current_period_start: currentEnd > now ? undefined : start.toISOString(),
      current_period_end: end.toISOString(),
      cancel_at_period_end: true,
      stripe_customer_id: typeof session.customer === "string" ? session.customer : (session.customer && session.customer.id) || undefined,
      member_since: m.member_since || new Date(now).toISOString(),
      last_payment_id: paymentId
    });
    return userId;
  }

  try {
    const obj = event.data && event.data.object;
    let fulfilUser = null;
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        if (obj && obj.mode === "subscription" && obj.subscription && obj.client_reference_id) {
          await syncSubscription(await retrieveSubscription(typeof obj.subscription === "string" ? obj.subscription : obj.subscription.id), obj.client_reference_id);
          fulfilUser = obj.client_reference_id;
        } else if (obj && obj.mode === "payment" && obj.payment_status === "paid" && (obj.metadata || {}).renewal === "once") {
          fulfilUser = await activateOneTime(obj);
        }
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        if (obj && obj.id) { await syncSubscription(await retrieveSubscription(obj.id), (obj.metadata || {}).user_id); fulfilUser = (obj.metadata || {}).user_id || null; }
        break;
      case "invoice.payment_succeeded":
      case "invoice.payment_failed": {
        const reference=obj?.subscription||obj?.parent?.subscription_details?.subscription;
        const subId = typeof reference==='string'?reference:reference?.id;
        if (subId) { const sub = await retrieveSubscription(subId); await syncSubscription(sub); fulfilUser = (sub.metadata || {}).user_id || null; }
        break;
      }
      default:
        break;
    }
    // 开通 / 续期后发送确认邮件与钱包会员卡（同一有效期只发一次）；失败则让 Stripe 重试
    if (fulfilUser) await fulfilMember(serverDb, fulfilUser);
    const done = await fetch(supabaseUrl + "/rest/v1/stripe_events?id=eq." + encodeURIComponent(event.id), {
      method: "PATCH",
      headers: { ...dbHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ processing_status: "processed", processed_at: new Date().toISOString(), error_message: null })
    });
    if (!done.ok) return send(res, 500, { error: "Event handled but processing status could not be saved." });
    return send(res, 200, { received: true });
  } catch (_) {
    await fetch(supabaseUrl + "/rest/v1/stripe_events?id=eq." + encodeURIComponent(event.id), {
      method: "PATCH",
      headers: { ...dbHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ processing_status: "failed", error_message: "Webhook processing failed." })
    }).catch(() => {});
    return send(res, 500, { error: "Webhook processing failed; Stripe may retry this event." });
  }
};
module.exports.config = { api: { bodyParser: false } };
