/**
 * Authenticated membership Checkout Session endpoint.
 * Safety: refuses non-test Stripe keys and requires separate Sandbox price IDs.
 * No live-mode Checkout can be created through this route.
 */
const { randomUUID } = require("crypto");
const ALLOWED_CITIES = new Set(["melbourne", "sydney", "brisbane"]);
const PLANS = new Set(["monthly", "annual"]);

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
  const allowed = new Set([
    "https://loadingzone-comedy-91r837d3n-loadingzone.vercel.app",
    "https://loadingzone-comedy-git-feature-membership-in-bcc01b-loadingzone.vercel.app",
    "https://loadingzonecomedy.au",
    "https://www.loadingzonecomedy.au"
  ]);
  if (allowed.has(origin)) return origin;
  const host = String(req.headers.host || "").toLowerCase();
  if (host.endsWith(".vercel.app") && host.includes("loadingzone-comedy")) return "https://" + host;
  return "";
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Method not allowed" });
  }
  const stripeKey = process.env.STRIPE_SECRET_KEY || "";
  const monthlyPrice = process.env.STRIPE_TEST_PRICE_MONTHLY || "";
  const annualPrice = process.env.STRIPE_TEST_PRICE_ANNUAL || "";
  const baseUrl = process.env.SUPABASE_URL || "";
  const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY || "";
  if (!stripeKey.startsWith("sk_test_")) return send(res, 503, { error: "Test-mode Stripe is not configured for this environment." });
  if (!monthlyPrice || !annualPrice || !baseUrl || !publicKey) {
    return send(res, 503, { error: "Test prices or membership authentication are not configured yet." });
  }
  const tokenMatch = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ""));
  if (!tokenMatch) return send(res, 401, { error: "Sign in before starting membership checkout." });
  const origin = originFor(req);
  if (!origin) return send(res, 403, { error: "This site is not allowed to start checkout." });
  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
  catch (_) { return send(res, 400, { error: "Invalid request body." }); }
  const plan = String((body && body.plan) || "");
  const city = String((body && body.city) || "").toLowerCase();
  if (!PLANS.has(plan) || !ALLOWED_CITIES.has(city)) return send(res, 400, { error: "Choose a valid membership plan and city." });

  const root = baseUrl.replace(/\/$/, "");
  try {
    const userResponse = await fetch(root + "/auth/v1/user", {
      headers: { apikey: publicKey, Authorization: "Bearer " + tokenMatch[1], Accept: "application/json" }
    });
    if (!userResponse.ok) return send(res, 401, { error: "Valid sign-in required." });
    const user = await userResponse.json();
    if (!user || !user.id || !user.email) return send(res, 401, { error: "Account email is required." });
    const params = new URLSearchParams();
    params.set("mode", "subscription");
    params.set("success_url", origin + "/#membership?checkout=success");
    params.set("cancel_url", origin + "/#membership?checkout=cancelled");
    params.set("client_reference_id", user.id);
    params.set("customer_email", user.email);
    params.set("line_items[0][price]", plan === "monthly" ? monthlyPrice : annualPrice);
    params.set("line_items[0][quantity]", "1");
    params.set("metadata[user_id]", user.id);
    params.set("metadata[city]", city);
    params.set("metadata[plan]", plan);
    params.set("subscription_data[metadata][user_id]", user.id);
    params.set("subscription_data[metadata][city]", city);
    params.set("subscription_data[metadata][plan]", plan);
    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + stripeKey,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": "lz-checkout-" + randomUUID()
      },
      body: params
    });
    const session = await stripeResponse.json();
    if (!stripeResponse.ok || !session.url) return send(res, 502, { error: "Could not create test checkout session." });
    return send(res, 200, { url: session.url });
  } catch (_) {
    return send(res, 502, { error: "Checkout service is temporarily unavailable." });
  }
};
