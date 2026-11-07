// Cloudflare Worker של "מי חונה?": סנכרון חדר + התראות דחיפה. נפרד לגמרי מכל אפליקציה אחרת.
// דרוש KV בשם ROOMS (ה-workflow יוצר ומחבר אותו). הגישה לחדר מוגנת בקוד הסודי בלבד.
//   GET/PATCH /rooms/<קוד>.json     מצב החדר (מסלולים כמו "cars/c1": ערך | null)
//   GET  /vapid                      המפתח הציבורי להתראות (נוצר אוטומטית)
//   POST /subs/<קוד>  |  DELETE /subs/<קוד>/<hash>   רישום והסרת מכשיר
//   GET  /outbox/<קוד>/<hash>        ההתראות הממתינות למכשיר (נמחקות אחרי הקריאה)
//   POST /notify/<קוד>               התראה לשאר המכשירים בחדר: {title, body, from}
const BAD = new Set(["__proto__", "constructor", "prototype"]);
const SEG = /^[A-Za-z0-9_-]{1,60}$/;
const CODE = "[a-z0-9]{10,40}";
const PUSH_HOSTS = /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)\//;
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");

function setPath(root, parts, val) {
  let o = root; const stack = [];
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (val === null && !(own(o, k) && o[k] && typeof o[k] === "object")) return;
    if (!own(o, k) || typeof o[k] !== "object" || o[k] === null) o[k] = {};
    stack.push([o, k]); o = o[k];
  }
  const last = parts[parts.length - 1];
  if (val === null) delete o[last]; else o[last] = val;
  for (let i = stack.length - 1; i >= 0; i--) { const [p, k] = stack[i]; if (Object.keys(p[k]).length === 0) delete p[k]; else break; }
}

// ---------- VAPID / Web Push (בלי מטען: ההתראה נשלפת מה-outbox) ----------
async function getVapid(env) {
  let v = await env.ROOMS.get("vapid", { type: "json" });
  if (v && v.pub && v.priv) return v;
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  v = { pub: b64u(await crypto.subtle.exportKey("raw", kp.publicKey)), priv: await crypto.subtle.exportKey("jwk", kp.privateKey) };
  await env.ROOMS.put("vapid", JSON.stringify(v));
  return v;
}
async function vapidAuth(env, endpoint) {
  const v = await getVapid(env);
  const header = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "https://oz-code-creator.github.io/who-parks/" })));
  const key = await crypto.subtle.importKey("jwk", v.priv, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(header + "." + claims));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${v.pub}`;
}
async function pushTo(env, code, hash, sub) {
  try {
    const r = await fetch(sub.endpoint, { method: "POST", headers: { Authorization: await vapidAuth(env, sub.endpoint), TTL: "3600", Urgency: "high" } });
    if (r.status === 404 || r.status === 410) await env.ROOMS.delete(`sub:${code}:${hash}`);
    return r.status;
  } catch (e) { return 0; }
}
async function listSubs(env, code) {
  const out = []; let cursor;
  do {
    const l = await env.ROOMS.list({ prefix: `sub:${code}:`, cursor });
    for (const k of l.keys) { const sub = await env.ROOMS.get(k.name, { type: "json" }); if (sub && sub.endpoint) out.push({ hash: k.name.split(":")[2], sub }); }
    cursor = l.list_complete ? null : l.cursor;
  } while (cursor);
  return out;
}
async function notify(env, code, subs, notif) {
  for (const { hash, sub } of subs) {
    const k = `outbox:${code}:${hash}`;
    const list = (await env.ROOMS.get(k, { type: "json" })) || [];
    list.push(notif);
    await env.ROOMS.put(k, JSON.stringify(list.slice(-5)), { expirationTtl: 86400 });
    await pushTo(env, code, hash, sub);
  }
}

// ---------- HTTP ----------
export default {
  async fetch(req, env) {
    const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" };
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: Object.assign({ "content-type": "application/json", "cache-control": "no-store" }, cors) });
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (!env.ROOMS) return json({ error: "KV binding ROOMS missing" }, 500);
    const path = new URL(req.url).pathname;
    let m;

    if (path === "/vapid" && req.method === "GET") return json({ pub: (await getVapid(env)).pub });

    if ((m = path.match(new RegExp(`^/rooms/(${CODE})\\.json$`)))) {
      const key = "room:" + m[1];
      if (req.method === "GET") return json(await env.ROOMS.get(key, { type: "json" }));
      if (req.method === "PATCH") {
        const txt = await req.text();
        if (txt.length > 20000) return json({ error: "too large" }, 413);
        let patch; try { patch = JSON.parse(txt); } catch (e) { return json({ error: "bad json" }, 400); }
        if (!patch || typeof patch !== "object" || Array.isArray(patch)) return json({ error: "bad patch" }, 400);
        const keys = Object.keys(patch);
        if (keys.length > 50) return json({ error: "too many keys" }, 413);
        const data = (await env.ROOMS.get(key, { type: "json" })) || {};
        for (const p of keys) {
          const parts = p.split("/");
          if (parts.length > 3 || parts.some(s => BAD.has(s) || !SEG.test(s))) return json({ error: "bad path" }, 400);
          setPath(data, parts, patch[p]);
        }
        const out = JSON.stringify(data);
        if (out.length > 20000) return json({ error: "room too large" }, 413);
        await env.ROOMS.put(key, out, { expirationTtl: 60 * 60 * 24 * 365 });
        return json(patch);
      }
      return new Response("method not allowed", { status: 405, headers: cors });
    }
    if ((m = path.match(new RegExp(`^/subs/(${CODE})$`))) && req.method === "POST") {
      let b; try { b = await req.json(); } catch (e) { return json({ error: "bad json" }, 400); }
      const endpoint = b && b.sub && b.sub.endpoint;
      if (typeof endpoint !== "string" || endpoint.length > 600 || !PUSH_HOSTS.test(endpoint)) return json({ error: "bad endpoint" }, 400);
      const hash = hex(await crypto.subtle.digest("SHA-256", enc.encode(endpoint))).slice(0, 16);
      const existing = await listSubs(env, m[1]);
      if (existing.length >= 6 && !existing.some(x => x.hash === hash)) return json({ error: "too many devices" }, 429);
      await env.ROOMS.put(`sub:${m[1]}:${hash}`, JSON.stringify({ endpoint, t: Date.now() }), { expirationTtl: 60 * 60 * 24 * 365 });
      return json({ hash });
    }
    if ((m = path.match(new RegExp(`^/subs/(${CODE})/([a-f0-9]{16})$`))) && req.method === "DELETE") {
      await env.ROOMS.delete(`sub:${m[1]}:${m[2]}`); return json({ ok: true });
    }
    if ((m = path.match(new RegExp(`^/outbox/(${CODE})/([a-f0-9]{16})$`))) && req.method === "GET") {
      const k = `outbox:${m[1]}:${m[2]}`;
      const list = (await env.ROOMS.get(k, { type: "json" })) || [];
      if (list.length) await env.ROOMS.delete(k);
      return json(list);
    }
    if ((m = path.match(new RegExp(`^/notify/(${CODE})$`))) && req.method === "POST") {
      let b; try { b = await req.json(); } catch (e) { return json({ error: "bad json" }, 400); }
      if (!b || typeof b.title !== "string" || !b.title.trim() || b.title.length > 100 || (b.body !== undefined && (typeof b.body !== "string" || b.body.length > 200))) return json({ error: "bad notification" }, 400);
      const from = typeof b.from === "string" && /^[a-f0-9]{16}$/.test(b.from) ? b.from : null;
      const subs = (await listSubs(env, m[1])).filter(x => x.hash !== from);
      if (!subs.length) return json({ sent: 0 });
      await notify(env, m[1], subs, { id: "x" + Date.now(), title: b.title.trim(), body: String(b.body || "") });
      return json({ sent: subs.length });
    }
    return new Response("not found", { status: 404, headers: cors });
  }
};
