/**
 * 读取 Stripe 密钥（去掉复制时带进来的空格/换行），上线前只接受测试密钥。
 * 返回 { key, ok, reason }；reason 只说明密钥类型，不会泄露密钥内容。
 */
function testStripeKey() {
  const key = String(process.env.STRIPE_SECRET_KEY || "").trim();
  if (!key) return { key, ok: false, reason: "STRIPE_SECRET_KEY is missing for this environment." };
  if (/^(sk|rk)_test_/.test(key)) return { key, ok: true, reason: "" };
  if (/^(sk|rk)_live_/.test(key)) return { key, ok: false, reason: "STRIPE_SECRET_KEY is a live key; this environment only accepts test keys." };
  if (/^pk_/.test(key)) return { key, ok: false, reason: "STRIPE_SECRET_KEY is a publishable key (pk_); use the secret key (sk_test_)." };
  return { key, ok: false, reason: "STRIPE_SECRET_KEY is not a recognised Stripe secret key (expected sk_test_…)." };
}
module.exports = { testStripeKey };
