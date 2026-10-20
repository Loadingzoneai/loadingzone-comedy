/**
 * Public, read-only membership content endpoint.
 * Never returns member records and never accepts writes.
 * Uses the server-side Supabase secret key; do not rename this to a NEXT_PUBLIC_* variable.
 */
const ALLOWED_CITIES = new Set(["melbourne", "sydney", "brisbane"]);

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return send(res, 405, { error: "Method not allowed" });
  }

  const city = String((req.query && req.query.city) || "").toLowerCase();
  if (!ALLOWED_CITIES.has(city)) {
    return send(res, 400, { error: "Choose Melbourne, Sydney, or Brisbane." });
  }

  const baseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!baseUrl || !secretKey) {
    return send(res, 503, { error: "Membership content is temporarily unavailable." });
  }

  const headers = {
    apikey: secretKey,
    Authorization: `Bearer ${secretKey}`,
    Accept: "application/json"
  };

  try {
    const root = baseUrl.replace(/\/$/, "");
    const [partnersResponse, eventsResponse] = await Promise.all([
      fetch(`${root}/rest/v1/member_partners?select=id,name,city,category,benefit_title,benefit_description,discount_text,terms,website_url,display_order&city=eq.${city}&is_active=eq.true&order=display_order.asc,name.asc`, { headers }),
      fetch(`${root}/rest/v1/member_events?select=id,title,city,event_type,venue,starts_at,booking_url,capacity,description,source,display_order&city=eq.${city}&is_active=eq.true&source=eq.eventbrite&event_type=eq.free_open_mic&order=starts_at.asc.nullslast,display_order.asc,title.asc`, { headers })
    ]);

    if (!partnersResponse.ok || !eventsResponse.ok) {
      return send(res, 502, { error: "Could not load membership content." });
    }

    const [partners, events] = await Promise.all([
      partnersResponse.json(),
      eventsResponse.json()
    ]);

    return send(res, 200, {
      city,
      partners: Array.isArray(partners) ? partners : [],
      events: Array.isArray(events) ? events : []
    });
  } catch (_error) {
    return send(res, 502, { error: "Could not load membership content." });
  }
};
