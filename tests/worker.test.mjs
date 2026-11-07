// בדיקות ה-Worker: חדר, מכשירים, התראות (בלי רשת אמיתית)
import worker from "../worker/worker.js";
import assert from "node:assert/strict";
const store = new Map();
const env = { ROOMS: {
  async get(k) { const v = store.get(k); return v === undefined ? null : JSON.parse(v); },
  async put(k, v) { store.set(k, v); }, async delete(k) { store.delete(k); },
  async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; }
} };
const R = "parkingroom1234567890";
let pushStatus = 201; const pushed = [];
globalThis.fetch = async (url, init) => { pushed.push({ url, auth: init.headers.Authorization }); return new Response(null, { status: pushStatus }); };
const call = (method, path, body) => worker.fetch(new Request("http://w" + path, { method, body: body ? JSON.stringify(body) : undefined }), env);
// חדר
assert.equal(await (await call("GET", `/rooms/${R}.json`)).json(), null);
await call("PATCH", `/rooms/${R}.json`, { app: "parking", cur: { w: "c1", v: 5 }, "cars/c1": { n: "טויוטה", u: 7 } });
let room = await (await call("GET", `/rooms/${R}.json`)).json();
assert.equal(room.cur.w, "c1"); assert.equal(room.cars.c1.n, "טויוטה");
assert.equal((await call("PATCH", `/rooms/${R}.json`, { "__proto__/x": 1 })).status, 400);
assert.equal((await call("PATCH", `/rooms/${R}.json`, { "a/b/c/d": 1 })).status, 400);
assert.equal((await call("GET", `/rooms/short.json`)).status, 404);
// vapid + מכשירים
const v1 = await (await call("GET", "/vapid")).json(), v2 = await (await call("GET", "/vapid")).json(); assert.equal(v1.pub, v2.pub);
assert.equal((await call("POST", `/subs/${R}`, { sub: { endpoint: "https://evil.com/x" } })).status, 400);
const a = await (await call("POST", `/subs/${R}`, { sub: { endpoint: "https://fcm.googleapis.com/fcm/send/AAA" } })).json();
const b = await (await call("POST", `/subs/${R}`, { sub: { endpoint: "https://fcm.googleapis.com/fcm/send/BBB" } })).json();
// notify: לכולם חוץ מהשולח
assert.equal((await call("POST", `/notify/${R}`, { body: "x" })).status, 400);
assert.equal((await call("POST", `/notify/${R}`, { title: "t".repeat(101) })).status, 400);
assert.equal((await (await call("POST", `/notify/${R}`, { title: "🚗 סקודה חונה", body: "עודכן ע״י עוז", from: a.hash })).json()).sent, 1);
assert.equal(pushed.length, 1); assert.match(pushed[0].auth, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
assert.equal((await (await call("GET", `/outbox/${R}/${a.hash}`)).json()).length, 0);
const ob = await (await call("GET", `/outbox/${R}/${b.hash}`)).json();
assert.equal(ob.length, 1); assert.equal(ob[0].title, "🚗 סקודה חונה");
assert.equal((await (await call("GET", `/outbox/${R}/${b.hash}`)).json()).length, 0);
// מכשיר שנסגר (410) נמחק
pushStatus = 410; await call("POST", `/notify/${R}`, { title: "t" }); pushStatus = 201;
assert.equal((await (await call("POST", `/notify/${R}`, { title: "t" })).json()).sent, 0);
await call("DELETE", `/subs/${R}/${a.hash}`);
console.log("worker ok");
