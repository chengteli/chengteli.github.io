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
const GUEST_SESSION_TTL = 24 * 60 * 60;
const GUEST_CONFIG_KEY = "active-visitor-link";
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
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_");
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
async function guestPasswordHash(password, salt) {
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),"PBKDF2",false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt,iterations:150000,hash:"SHA-256"},key,256);
  return b64url(new Uint8Array(bits));
}
async function isAdmin(request, env) {
  const match = (request.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const token = match[1].trim();

  // Accept short-lived Worker sessions for the standalone /admin-login flow.
  const sessionMatch = token.match(/^([^.]+)\.([^.]+)$/);
  if (sessionMatch && env.ADMIN_SESSION_SECRET) {
    const [, payload, signature] = sessionMatch;
    const expected = b64url(await hmac(env.ADMIN_SESSION_SECRET, payload));
    const a = new TextEncoder().encode(signature), b = new TextEncoder().encode(expected);
    let diff = a.length ^ b.length;
    for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] || 0) ^ (b[i] || 0);
    if (diff === 0) {
      try {
        const data = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
        if (data.scope === "admin" && data.exp > Math.floor(Date.now()/1000)) return true;
      } catch { /* Continue with Supabase token validation. */ }
    }
  }

  // The current portfolio frontend authenticates admins with Supabase Auth.
  // Ask Supabase to validate its bearer token, then require the configured admin UID.
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY || !env.ADMIN_UID) return false;
  try {
    const response = await fetch(env.SUPABASE_URL.replace(/\/$/, "") + "/auth/v1/user", {
      headers: {
        apikey: env.SUPABASE_PUBLISHABLE_KEY,
        Authorization: "Bearer " + token
      }
    });
    if (!response.ok) return false;
    const user = await response.json();
    return user && user.id === env.ADMIN_UID;
  } catch {
    return false;
  }
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
    const url = new URL(request.url);

    // Gitee OAuth navigation endpoints: no CORS Origin is expected on top-level redirects.
    if (url.pathname === "/gitee-login" && request.method === "GET") {
      if (!env.GITEE_CLIENT_ID || !env.GITEE_CLIENT_SECRET || !env.ADMIN_SESSION_SECRET) {
        return new Response("Gitee login is not configured. Add GITEE_CLIENT_ID, GITEE_CLIENT_SECRET and ADMIN_SESSION_SECRET in Worker settings.", {status:503, headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"}});
      }
      const state = b64url(crypto.getRandomValues(new Uint8Array(32)));
      const authorize = new URL("https://gitee.com/oauth/authorize");
      authorize.searchParams.set("client_id", env.GITEE_CLIENT_ID);
      authorize.searchParams.set("redirect_uri", "https://morning-paper-de53.1529367086.workers.dev/gitee-callback");
      authorize.searchParams.set("response_type", "code");
      authorize.searchParams.set("scope", "user_info");
      authorize.searchParams.set("state", state);
      return new Response(null, {status:302, headers:{
        "Location":authorize.toString(),
        "Set-Cookie":"gitee_oauth_state="+state+"; Max-Age=300; Path=/; Secure; HttpOnly; SameSite=Lax",
        "Cache-Control":"no-store"
      }});
    }
    if (url.pathname === "/gitee-callback" && request.method === "GET") {
      const clearCookie = "gitee_oauth_state=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax";
      const fail = (message, status=400) => new Response(message, {status, headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store","Set-Cookie":clearCookie}});
      if (url.searchParams.get("error")) return fail("Gitee 授权未完成，请返回作品集重试。");
      const code = url.searchParams.get("code") || "";
      const state = url.searchParams.get("state") || "";
      const cookieState = (request.headers.get("Cookie") || "").split(";").map(v=>v.trim()).find(v=>v.startsWith("gitee_oauth_state="))?.slice("gitee_oauth_state=".length) || "";
      if (!code || !state || !cookieState || state !== cookieState) return fail("Gitee 登录状态校验失败，请重新点击登录。");
      if (!env.GITEE_CLIENT_ID || !env.GITEE_CLIENT_SECRET || !env.ADMIN_SESSION_SECRET || !env.GITEE_ADMIN_LOGIN) return fail("Worker 缺少 Gitee 登录配置，请检查加密变量和管理员用户名。",503);
      try {
        const tokenResponse = await fetch("https://gitee.com/oauth/token", {
          method:"POST",
          headers:{"Content-Type":"application/x-www-form-urlencoded","Accept":"application/json"},
          body:new URLSearchParams({grant_type:"authorization_code",code,client_id:env.GITEE_CLIENT_ID,client_secret:env.GITEE_CLIENT_SECRET,redirect_uri:"https://morning-paper-de53.1529367086.workers.dev/gitee-callback"})
        });
        const tokenData = await tokenResponse.json();
        if (!tokenResponse.ok || !tokenData.access_token) return fail("无法从 Gitee 获取授权令牌，请检查应用回调地址和密钥。",502);
        const userResponse = await fetch("https://gitee.com/api/v5/user?access_token="+encodeURIComponent(tokenData.access_token), {headers:{"Accept":"application/json"}});
        const user = await userResponse.json();
        if (!userResponse.ok || !user || !user.login) return fail("无法读取 Gitee 用户信息。",502);
        if (String(user.login).toLowerCase() !== String(env.GITEE_ADMIN_LOGIN).trim().toLowerCase()) {
          return new Response("此 Gitee 账号没有作品集管理员权限。", {status:403,headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store","Set-Cookie":clearCookie}});
        }
        const payload = b64text(JSON.stringify({exp:Math.floor(Date.now()/1000)+SESSION_TTL,scope:"admin",login:user.login}));
        const session = payload+"."+b64url(await hmac(env.ADMIN_SESSION_SECRET,payload));
        return new Response(null,{status:302,headers:{
          "Location":"https://chengteli.github.io/#gitee_token="+encodeURIComponent(session),
          "Cache-Control":"no-store",
          "Referrer-Policy":"no-referrer",
          "Set-Cookie":clearCookie
        }});
      } catch {
        return fail("Gitee 登录暂时失败，请稍后重试。",502);
      }
    }

    if (request.method === "OPTIONS") {
      if (!ALLOWED_ORIGINS.has(origin)) return new Response(null,{status:403});
      return new Response(null,{status:204,headers:{
        "Access-Control-Allow-Origin":origin,"Access-Control-Allow-Methods":"GET, POST, OPTIONS",
        "Access-Control-Allow-Headers":"Authorization, Content-Type","Access-Control-Max-Age":"86400","Vary":"Origin"
      }});
    }
    if (!ALLOWED_ORIGINS.has(origin)) return json({error:"Origin not allowed"},403,origin);
    if (url.pathname === "/guest-status" && request.method === "GET") {
      if (!env.GUEST_ACCESS) return json({error:"Visitor sharing is not configured"},503,origin);
      const config=await env.GUEST_ACCESS.get(GUEST_CONFIG_KEY,"json");
      return json({enabled:Boolean(config?.shareId)},200,origin);
    }
    if (url.pathname === "/guest-login" && request.method === "POST") {
      if (!env.GUEST_ACCESS || !env.ADMIN_SESSION_SECRET) return json({error:"Visitor sharing is not configured"},503,origin);
      let body;try{body=await request.json()}catch{return json({error:"Invalid JSON"},400,origin)}
      const config=await env.GUEST_ACCESS.get(GUEST_CONFIG_KEY,"json");
      const shareId=String(body.shareId||"");
      if(!config||shareId!==config.shareId)return json({error:"分享链接无效或已停用"},404,origin);
      const actual=await guestPasswordHash(String(body.password||""),fromB64url(config.salt));
      const a=new TextEncoder().encode(actual),b=new TextEncoder().encode(config.passwordHash);let diff=a.length^b.length;
      for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a[i]||0)^(b[i]||0);
      if(diff!==0)return json({error:"访客密码不正确"},401,origin);
      const payload=b64text(JSON.stringify({exp:Math.floor(Date.now()/1000)+GUEST_SESSION_TTL,scope:"guest",shareId}));
      return json({token:payload+"."+b64url(await hmac(env.ADMIN_SESSION_SECRET,payload)),expiresIn:GUEST_SESSION_TTL},200,origin);
    }
    if (url.pathname === "/guest-config" && request.method === "GET") {
      if(!await isAdmin(request,env))return json({error:"请先登录管理员账号"},401,origin);
      if(!env.GUEST_ACCESS)return json({error:"请先绑定 GUEST_ACCESS KV"},503,origin);
      const config=await env.GUEST_ACCESS.get(GUEST_CONFIG_KEY,"json");
      return json({enabled:Boolean(config?.shareId),shareId:config?.shareId||""},200,origin);
    }
    if (url.pathname === "/guest-config" && request.method === "POST") {
      if(!await isAdmin(request,env))return json({error:"请先登录管理员账号"},401,origin);
      if(!env.GUEST_ACCESS)return json({error:"请先绑定 GUEST_ACCESS KV"},503,origin);
      let body;try{body=await request.json()}catch{return json({error:"Invalid JSON"},400,origin)}
      if(body.disabled===true){await env.GUEST_ACCESS.delete(GUEST_CONFIG_KEY);return json({enabled:false},200,origin)}
      const shareId=String(body.shareId||""),password=String(body.password||"");
      if(!/^[A-Za-z0-9_-]{20,100}$/.test(shareId))return json({error:"分享链接编号无效"},400,origin);
      if(password.length<8||password.length>256)return json({error:"访客密码至少需要 8 个字符"},400,origin);
      const salt=crypto.getRandomValues(new Uint8Array(16));
      await env.GUEST_ACCESS.put(GUEST_CONFIG_KEY,JSON.stringify({shareId,salt:b64url(salt),passwordHash:await guestPasswordHash(password,salt)}));
      return json({enabled:true,shareId},200,origin);
    }
    if (!env.QINIU_ACCESS_KEY || !env.QINIU_SECRET_KEY || !env.QINIU_BUCKET || !env.QINIU_DOMAIN) {
      return json({error:"Qiniu service is not configured"},503,origin);
    }
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
