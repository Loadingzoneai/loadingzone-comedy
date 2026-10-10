/**
 * Admin-only CSV export for configuring member-specific codes in ticketing platforms.
 * Requires a Supabase Auth access token and an allowlisted ADMIN_EMAILS environment variable.
 * No service-role data is returned to the browser except the narrowly scoped CSV response.
 */
function send(res, status, body, contentType = "application/json; charset=utf-8") {
  res.statusCode = status;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  res.end(body);
}

function csvCell(value) {
  let safe = String(value ?? "");
  // Prevent spreadsheet formula execution when exported values begin with formula characters.
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(safe)) safe = "'" + safe;
  return '"' + safe.replace(/"/g, '""') + '"';
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return send(res, 405, JSON.stringify({ error: "Method not allowed" }));
  }

  const tokenMatch = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ""));
  if (!tokenMatch) {
    return send(res, 401, JSON.stringify({ error: "Sign-in required." }));
  }

  const baseUrl = process.env.SUPABASE_URL;
  const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const admins = new Set(
    String(process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );

  if (!baseUrl || !publicKey || !secretKey || admins.size === 0) {
    return send(res, 503, JSON.stringify({ error: "Admin export is not configured." }));
  }

  const root = baseUrl.replace(/\/$/, "");
  try {
    const userResponse = await fetch(root + "/auth/v1/user", {
      headers: {
        apikey: publicKey,
        Authorization: "Bearer " + tokenMatch[1],
        Accept: "application/json"
      }
    });
    if (!userResponse.ok) {
      return send(res, 401, JSON.stringify({ error: "Valid sign-in required." }));
    }
    const user = await userResponse.json();
    const email = String(user.email || "").trim().toLowerCase();
    if (!email || !admins.has(email)) {
      return send(res, 403, JSON.stringify({ error: "Administrator access required." }));
    }

    const headers = {
      apikey: secretKey,
      Authorization: "Bearer " + secretKey,
      Accept: "application/json"
    };
    const query = new URLSearchParams({
      select: "member_number,email,full_name,city,subscription_status,member_discount_codes(code,status)",
      subscription_status: "eq.active",
      order: "created_at.asc"
    });
    const membersResponse = await fetch(root + "/rest/v1/members?" + query.toString(), { headers });
    if (!membersResponse.ok) {
      // Avoid returning upstream details that might expose schema or service configuration.
      return send(res, 502, JSON.stringify({ error: "Could not retrieve membership export." }));
    }
    const members = await membersResponse.json();
    const rows = [
      ["member_number", "email", "full_name", "city", "membership_status", "discount_code", "code_status"],
      ...(Array.isArray(members) ? members : []).map((member) => {
        const code = Array.isArray(member.member_discount_codes) ? member.member_discount_codes[0] : null;
        return [
          member.member_number,
          member.email,
          member.full_name,
          member.city,
          member.subscription_status,
          code ? code.code : "",
          code ? code.status : "missing"
        ];
      })
    ];
    const csv = "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
    res.setHeader("Content-Disposition", 'attachment; filename="loading-zone-member-discount-codes.csv"');
    return send(res, 200, csv, "text/csv; charset=utf-8");
  } catch (_error) {
    return send(res, 502, JSON.stringify({ error: "Could not create membership export." }));
  }
};
