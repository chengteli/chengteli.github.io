/**
 * Qiniu Kodo upload-token service for chengteli.github.io
 *
 * Deploy as a Cloudflare Worker. Configure these Worker secrets:
 * QINIU_ACCESS_KEY, QINIU_SECRET_KEY
 * Configure Worker variables:
 * QINIU_BUCKET=cheng-portfolio
 * QINIU_DOMAIN=https://tn1fk7ro8.hn-bkt.clouddn.com
 * SUPABASE_URL=https://rtsvmmxwlufrmwuwvtbp.supabase.co
 * SUPABASE_ADMIN_UID=fa045953-4acb-4987-9ed1-e645bd5aefd8
 *
 * Never put Qiniu secrets in the GitHub Pages frontend.
 */
const ALLOWED_ORIGINS = new Set(["https://chengteli.github.io"]);
const MAX_FILE_SIZE = 50 * 1024 * 1024 * 1024; // policy ceiling; actual limits depend on Qiniu/account/browser

function json(data, status = 200, origin = "") {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
  if (ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function base64UrlBytes(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_");
}
function base64UrlText(text) {
  return btoa(unescape(encodeURIComponent(text)))
    .replace(/\+/g, "-").replace(/\//g, "_");
}
async function hmacSha1(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}
function safeName(value) {
  const name = String(value || "video").normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 100);
  return name || "video";
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      if (!ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
      }});
    }
    if (!ALLOWED_ORIGINS.has(origin)) return json({ error: "Origin not allowed" }, 403, origin);
    const url = new URL(request.url);
    if (url.pathname !== "/upload-token" || request.method !== "POST") {
      return json({ error: "Not found" }, 404, origin);
    }
    if (!env.QINIU_ACCESS_KEY || !env.QINIU_SECRET_KEY || !env.QINIU_BUCKET || !env.QINIU_DOMAIN ||
        !env.SUPABASE_URL || !env.SUPABASE_ADMIN_UID) {
      return json({ error: "Upload service is not configured yet" }, 503, origin);
    }
    const auth = request.headers.get("Authorization") || "";
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (!match) return json({ error: "Sign in as the portfolio administrator first" }, 401, origin);

    // Validate the Supabase access token with Supabase Auth; never trust a user ID from the browser.
    let authResponse;
    try {
      authResponse = await fetch(env.SUPABASE_URL.replace(/\/$/, "") + "/auth/v1/user", {
        headers: { "Authorization": "Bearer " + match[1], "apikey": env.SUPABASE_ANON_KEY || "" },
      });
    } catch {
      return json({ error: "Could not verify administrator session" }, 502, origin);
    }
    if (!authResponse.ok) return json({ error: "Session expired; please sign in again" }, 401, origin);
    const user = await authResponse.json();
    if (user.id !== env.SUPABASE_ADMIN_UID) return json({ error: "Administrator access required" }, 403, origin);

    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, origin); }
    const fileName = safeName(body.fileName);
    const size = Number(body.size);
    const contentType = String(body.contentType || "application/octet-stream").slice(0, 120);
    if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_SIZE) {
      return json({ error: "File must be between 1 byte and 50 GB" }, 413, origin);
    }
    if (!contentType.startsWith("video/")) return json({ error: "Only video files are allowed" }, 415, origin);

    const key = "portfolio-videos/" + crypto.randomUUID() + "-" + fileName;
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const policy = {
      scope: env.QINIU_BUCKET + ":" + key,
      deadline,
      insertOnly: 1,
      fsizeLimit: size,
      mimeLimit: "video/*",
      returnBody: JSON.stringify({ key: "$(key)", hash: "$(etag)", fsize: "$(fsize)", mimeType: "$(mimeType)" }),
    };
    const encodedPolicy = base64UrlText(JSON.stringify(policy));
    const signature = base64UrlBytes(await hmacSha1(env.QINIU_SECRET_KEY, encodedPolicy));
    const token = env.QINIU_ACCESS_KEY + ":" + signature + ":" + encodedPolicy;
    return json({
      token,
      key,
      bucket: env.QINIU_BUCKET,
      domain: env.QINIU_DOMAIN.replace(/\/$/, ""),
      expiresAt: deadline,
      maxFileSize: size,
    }, 200, origin);
  }
};
