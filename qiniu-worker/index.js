/**
 * Qiniu Kodo API for the static portfolio at https://chengteli.github.io
 * Qiniu stores all uploaded media and the public site-data.json object.
 * Cloudflare Worker is only a secure API gateway; no Supabase dependency.
 *
 * Required encrypted Worker secrets:
 *   QINIU_ACCESS_KEY, QINIU_SECRET_KEY, ADMIN_PASSWORD, ADMIN_SESSION_SECRET
 * Required Worker variables:
 *   QINIU_BUCKET=cheng-portfolio
 *   QINIU_DOMAIN=https://tn1fk7ro8.hn-bkt.clouddn.com
 */
const ALLOWED_ORIGINS = new Set(["https://chengteli.github.io"]);
const MAX_FILE_SIZE = 50 * 1024 * 1024 * 1024;
const SESSION_TTL = 12 * 60 * 60;
const DATA_KEY = "portfolio-data/site-data.json";

function json(data, status = 200, origin = "") {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
  if (ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS",
    headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return new Response(JSON.stringify(data), { status, headers });
}
function b64url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function b64text(text) {
  return b64url(new TextEncoder().encode(text));
}
function fromB64url(value) {
  const s = value.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(s + "=".repeat((4 - s.length % 4) % 4));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
async function hmac(secret, message, algorithm = "SHA-256") {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), {name:"HMAC",hash:algorithm}, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}
function safeName(value) {
  return String(value || "media").normalize("NFKC").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 100) || "media";
}
async function issueSession(env) {
  const payload = b64text(JSON.stringify({exp: Math.floor(Date.now()/1000) + SESSION_TTL, scope:"admin"}));
  return payload + "." + b64url(await hmac(env.ADMIN_SESSION_SECRET, payload));
}
async function isAdmin(request, env) {
  const match = (request.headers.get("Authorization") || "").match(/^Bearer\s+([^.]+\.[^.]+)$/i);
  if (!match || !env.ADMIN_SESSION_SECRET) return false;
  const [payload, signature] = match[1].split(".");
  const expected = b64url(await hmac(env.ADMIN_SESSION_SECRET, payload));
  if (signature.length !== expected.length) return false;
  const a = new TextEncoder().encode(signature), b = new TextEncoder().encode(expected);
  if (!crypto.subtle.timingSafeEqual) {
    let diff = 0; for (let i=0;i<a.length;i++) diff |= a[i]^b[i]; if (diff) return false;
  } else if (!crypto.subtle.timingSafeEqual(a,b)) return false;
  try {
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    return data.scope === "admin" && data.exp > Math.floor(Date.now()/1000);
  } catch { return false; }
}
async function qiniuToken(env, key, size, contentType, insertOnly = 1) {
  const deadline = Math.floor(Date.now()/1000) + 3600;
  const policy = {scope: env.QINIU_BUCKET + ":" + key, deadline, insertOnly, fsizeLimit:size, mimeLimit:contentType};
  const encoded = b64text(JSON.stringify(policy));
  const token = env.QINIU_ACCESS_KEY + ":" + b64url(await hmac(env.QINIU_SECRET_KEY, encoded, "SHA-1")) + ":" + encoded;
  return {token,key,bucket:env.QINIU_BUCKET,domain:env.QINIU_DOMAIN.replace(/\/$/,""),expiresAt:deadline};
}
async function getPublicData(env) {
  const response = await fetch(env.QINIU_DOMAIN.replace(/\/$/,"") + "/" + DATA_KEY + "?v=" + Date.now(), {cf:{cacheTtl:0}});
  if (response.status === 404) return {items:[],about:null};
  if (!response.ok) throw new Error("Could not read site data from Qiniu");
  return await response.json();
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      if (!ALLOWED_ORIGINS.has(origin)) return new Response(null,{status:403});
      return new Response(null,{status:204,headers:{
        "Access-Control-Allow-Origin":origin,"Access-Control-Allow-Methods":"GET, POST, OPTIONS",
        "Access-Control-Allow-Headers":"Authorization, Content-Type","Access-Control-Max-Age":"86400","Vary":"Origin"
      }});
    }
    if (!ALLOWED_ORIGINS.has(origin)) return json({error:"Origin not allowed"},403,origin);
    if (!env.QINIU_ACCESS_KEY || !env.QINIU_SECRET_KEY || !env.QINIU_BUCKET || !env.QINIU_DOMAIN) {
      return json({error:"Qiniu service is not configured"},503,origin);
    }
    const url = new URL(request.url);
    if (url.pathname === "/items" && request.method === "GET") {
      try { return json(await getPublicData(env),200,origin); }
      catch(e) { return json({error:e.message || "Unable to load data"},502,origin); }
    }
    if (url.pathname === "/admin-login" && request.method === "POST") {
      if (!env.ADMIN_PASSWORD || !env.ADMIN_SESSION_SECRET) return json({error:"Admin login is not configured"},503,origin);
      let body; try { body=await request.json(); } catch { return json({error:"Invalid JSON"},400,origin); }
      const supplied = String(body.password || "");
      const a = new TextEncoder().encode(supplied), b = new TextEncoder().encode(env.ADMIN_PASSWORD);
      let diff = a.length ^ b.length; for(let i=0;i<Math.max(a.length,b.length);i++) diff |= (a[i]||0) ^ (b[i]||0);
      if (diff !== 0) return json({error:"账号或密码不正确"},401,origin);
      return json({token:await issueSession(env),expiresIn:SESSION_TTL},200,origin);
    }
    if (url.pathname === "/upload-token" && request.method === "POST") {
      if (!await isAdmin(request,env)) return json({error:"请先登录管理员账号"},401,origin);
      let body; try { body=await request.json(); } catch { return json({error:"Invalid JSON"},400,origin); }
      const size=Number(body.size), contentType=String(body.contentType || "application/octet-stream").slice(0,120);
      if (!Number.isFinite(size)||size<=0||size>MAX_FILE_SIZE) return json({error:"File must be between 1 byte and 50 GB"},413,origin);
      if (!contentType.startsWith("image/") && !contentType.startsWith("video/")) return json({error:"Only image and video files are allowed"},415,origin);
      const folder=contentType.startsWith("video/")?"portfolio-videos/":"portfolio-images/";
      const key=folder+crypto.randomUUID()+"-"+safeName(body.fileName);
      return json(await qiniuToken(env,key,size,contentType,1),200,origin);
    }
    if (url.pathname === "/data-token" && request.method === "POST") {
      if (!await isAdmin(request,env)) return json({error:"请先登录管理员账号"},401,origin);
      const size=Number(request.headers.get("Content-Length") || 2*1024*1024);
      if (size > 2*1024*1024) return json({error:"Site metadata is too large"},413,origin);
      return json(await qiniuToken(env,DATA_KEY,2*1024*1024,"application/json",0),200,origin);
    }
    return json({error:"Not found"},404,origin);
  }
};
