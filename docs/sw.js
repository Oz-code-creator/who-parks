const V = "who-parks-v2", CFG = "who-parks-cfg";
const FILES = ["./", "index.html", "styles.css", "app.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "badge-96.png"];
self.addEventListener("install", e => e.waitUntil(caches.open(V).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== CFG).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  // רשת קודם (כדי לקבל עדכונים), ואם אין קליטה: מהמטמון
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then(r => { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match("index.html"))));
});
async function readCfg() {
  try { const c = await caches.open(CFG), r = await c.match(new URL("cfg-store", self.registration.scope).href); return r ? await r.json() : null; } catch (e) { return null; }
}
// דחיפה בלי מטען: ההתראה נשלפת מהשרת (outbox)
self.addEventListener("push", e => e.waitUntil((async () => {
  const cfg = await readCfg();
  let list = [];
  if (cfg) { try { const r = await fetch(`${cfg.url}/outbox/${cfg.code}/${cfg.hash}`); if (r.ok) list = await r.json(); } catch (err) { /* ignore */ } }
  if (!Array.isArray(list) || !list.length) list = [{ title: "מי חונה?", body: "יש עדכון בחנייה" }];
  const icon = new URL("icon-192.png", self.registration.scope).href, badge = new URL("badge-96.png", self.registration.scope).href;
  for (const n of list.slice(-1)) { // רק העדכון האחרון: המצב הנוכחי הוא מה שחשוב
    await self.registration.showNotification(String(n.title || "מי חונה?"), { body: String(n.body || ""), tag: "parking", renotify: true, lang: "he", dir: "rtl", icon, badge });
  }
  (await self.clients.matchAll({ type: "window" })).forEach(c => c.postMessage({ type: "refresh" }));
})()));
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil((async () => {
    const cs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (cs.length) return cs[0].focus();
    return self.clients.openWindow("./index.html");
  })());
});
