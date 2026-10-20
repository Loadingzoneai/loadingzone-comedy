/**
 * Stripe webhook endpoint for membership subscriptions.
 * Requires raw request bytes for signature verification; never trusts unsigned payloads.
 * Preview is test-only. No schema changes are performed by this handler.
 */
const crypto = require("crypto");

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(body));
}

function rawBody(req) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.rawBody === "string") return Buffer.from(req.rawBody);
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
  const stripeKey = process.env.STRIPE_SECRET_KEY || "";
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
  const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const supabaseKey = process.env.SUPABASE_SECRET_KEY || "";
  if (!stripeKey.startsWith("sk_test_") || !webhookSecret.startsWith("whsec_")) {
    return send(res, 503, { error: "Test-mode webhook is not configured." });
  }
  if (!supabaseUrl || !supabaseKey) return send(res, 503, { error: "Membership storage is not configured." });

  const payload = rawBody(req);
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
  if (!Array.isArray(inserted) || inserted.length === 0) return send(res, 200, { received: true, duplicate: true });

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
      subscription_status: subscription.status || "inactive",
      current_period_start: isoFromUnix(subscription.current_period_start),
      current_period_end: isoFromUnix(subscription.current_period_end),
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
      member_since: isoFromUnix(subscription.start_date) || isoFromUnix(subscription.created)
    };
    const response = await fetch(supabaseUrl + "/rest/v1/members?user_id=eq." + encodeURIComponent(userId), {
      method: "GET", headers: { ...dbHeaders, Accept: "application/json" }
    });
    if (!response.ok) throw new Error("member_lookup_failed");
    const rows = await response.json();
    if (Array.isArray(rows) && rows.length) {
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

  try {
    const obj = event.data && event.data.object;
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        if (obj && obj.mode === "subscription" && obj.subscription && obj.client_reference_id) {
          await syncSubscription(await retrieveSubscription(typeof obj.subscription === "string" ? obj.subscription : obj.subscription.id), obj.client_reference_id);
        }
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        if (obj && obj.id) await syncSubscription(obj, (obj.metadata || {}).user_id);
        break;
      case "invoice.payment_succeeded":
      case "invoice.payment_failed": {
        const subId = typeof (obj && obj.subscription) === "string" ? obj.subscription : obj && obj.subscription && obj.subscription.id;
        if (subId) await syncSubscription(await retrieveSubscription(subId));
        break;
      }
      default:
        break;
    }
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
