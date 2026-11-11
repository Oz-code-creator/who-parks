// "מי חונה?": מי חונה בחנייה (רכב 1 / רכב 2 / אורח / ריקה), מסונכרן בין שני טלפונים דרך Worker (חדר פרטי לפי קוד סודי).
(function () {
  "use strict";
  const KEY = "who-parks-v1", GUEST = "guest", EMPTY = "empty";
  const DEF = { cars: { c1: { n: "יונדאי", e: "🚙", u: 0 }, c2: { n: "סקודה", e: "🚗", u: 0 } }, cur: { w: EMPTY, note: "", by: "", t: 0, v: 0 }, me: "", sync: null };
  const $ = id => document.getElementById(id);
  const clone = o => JSON.parse(JSON.stringify(o));
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const num = v => (Number.isFinite(v) && v >= 0 ? v : 0);
  const HOST_OK = u => { try { const x = new URL(u); return (x.protocol === "https:" && /\.workers\.dev$/.test(x.hostname)) || (x.hostname === "localhost" && location.hostname === "localhost"); } catch (e) { return false; } };
  const DEFAULT_URL = "https://who-parks.ozsegall.workers.dev"; // כתובת ציבורית, לא סוד
  const CODE_OK = c => /^[a-z0-9]{10,40}$/.test(c || "");

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => { if (k === "on") Object.entries(v).forEach(([e, f]) => el.addEventListener(e, f)); else if (k === "class") el.className = v; else if (k === "dataset") Object.assign(el.dataset, v); else el[k] = v; });
    kids.flat().forEach(k => el.append(k instanceof Node ? k : document.createTextNode(String(k))));
    return el;
  }

  // ---------- מצב ----------
  function cleanCar(id, v) { if (!v || typeof v !== "object") return null; return { n: str(v.n, 20) || DEF.cars[id].n, e: str(v.e, 8) || DEF.cars[id].e, u: num(v.u) }; }
  function cleanCur(v, cars) {
    if (!v || typeof v !== "object") return null;
    const w = v.w === GUEST || v.w === EMPTY || (typeof v.w === "string" && has(cars, v.w)) ? v.w : null;
    return w ? { w, note: w === GUEST ? str(v.note, 60) : "", by: str(v.by, 30), t: num(v.t), v: num(v.v) } : null;
  }
  function load() {
    const s = clone(DEF);
    try {
      const r = JSON.parse(localStorage.getItem(KEY)) || {};
      Object.keys(s.cars).forEach(id => { const c = cleanCar(id, (r.cars || {})[id]); if (c) s.cars[id] = c; });
      s.cur = cleanCur(r.cur, s.cars) || s.cur; s.me = str(r.me, 30);
      if (r.sync && HOST_OK(r.sync.url) && CODE_OK(r.sync.code)) s.sync = { url: r.sync.url.replace(/\/$/, ""), code: r.sync.code };
    } catch (e) { /* ignore */ }
    return s;
  }
  let S = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } };

  // ---------- תצוגה ----------
  const two = n => String(n).padStart(2, "0");
  const hhmm = d => two(d.getHours()) + ":" + two(d.getMinutes());
  function since(t) {
    const d = new Date(t), now = new Date(), day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diffDays = Math.round((day(now) - day(d)) / 864e5);
    let s = diffDays === 0 ? "מ-" + hhmm(d) : diffDays === 1 ? "מאתמול " + hhmm(d) : `מ-${two(d.getDate())}/${two(d.getMonth() + 1)} ${hhmm(d)}`;
    const mins = Math.floor((now - d) / 6e4);
    if (mins >= 60) { const hrs = Math.floor(mins / 60); s += hrs >= 48 ? ` (לפני ${Math.floor(hrs / 24)} ימים)` : hrs >= 24 ? " (לפני יום)" : hrs === 1 ? " (לפני שעה)" : hrs === 2 ? " (לפני שעתיים)" : ` (לפני ${hrs} שעות)`; }
    else if (mins >= 1) s += ` (לפני ${mins} דק׳)`;
    return s;
  }
  function render() {
    const c = S.cur, car = has(S.cars, c.w) ? S.cars[c.w] : null;
    const card = $("card");
    card.className = "card " + (car ? "car" : c.w === GUEST ? "guest" : "");
    $("big").textContent = car ? car.e : c.w === GUEST ? "👤" : "🅿️";
    $("who").textContent = car ? car.n : c.w === GUEST ? "אורח" + (c.note ? " · " + c.note : "") : "החנייה ריקה";
    $("meta").textContent = c.v ? [since(c.t), c.by ? "עודכן ע״י " + c.by : ""].filter(Boolean).join(" · ") : "עוד לא סומן";
    const opts = [["c1", S.cars.c1.e, S.cars.c1.n], ["c2", S.cars.c2.e, S.cars.c2.n], [GUEST, "👤", "אורח"], [EMPTY, "🅿️", "ריקה"]];
    $("btns").replaceChildren(...opts.map(([w, e, n]) => h("button", { class: "btn" + (c.w === w ? " on" : ""), type: "button", dataset: { w }, on: { click: () => choose(w) } }, h("span", { class: "e" }, e), n)));
    $("hint").hidden = !!S.sync;
    $("syncline").textContent = S.sync ? syncText : "מצב מקומי בלבד (לא מחובר לטלפון השני)";
  }
  let syncText = "";
  const setSync = t => { syncText = t; if ($("syncline")) $("syncline").textContent = S.sync ? t : "מצב מקומי בלבד (לא מחובר לטלפון השני)"; };

  // ---------- עדכון מצב + ביטול + התראה ----------
  let toastTimer = null, pending = null;
  function noticeFor(c) {
    const by = S.me ? "עודכן ע״י " + S.me : "";
    if (c.w === EMPTY) return ["🅿️ החנייה התפנתה", by];
    if (c.w === GUEST) return ["👤 אורח חונה" + (c.note ? ": " + c.note : ""), by];
    return [`${S.cars[c.w].e} ${S.cars[c.w].n} חונה`, by];
  }
  function flushNotice() {
    if (!pending) return; clearTimeout(pending.timer);
    const [title, body] = pending.n; pending = null;
    Sync.notify(title, body);
  }
  function setCur(w, note) {
    const prev = S.cur;
    S.cur = { w, note: w === GUEST ? str(note, 60) : "", by: S.me, t: Date.now(), v: Date.now() };
    save(); render(); Sync.now();
    flushNotice();
    pending = { n: noticeFor(S.cur), timer: setTimeout(flushNotice, 6000) };
    showToast("עודכן: " + noticeFor(S.cur)[0], () => { // ביטול: לפני שההתראה נשלחה
      clearTimeout(pending && pending.timer); pending = null;
      S.cur = Object.assign({}, prev, { v: Date.now() }); save(); render(); Sync.now(); hideToast();
    });
  }
  function showToast(text, undo) {
    $("toasttext").textContent = text; $("undo").onclick = undo; $("toast").hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, 6000);
  }
  function hideToast() { $("toast").hidden = true; clearTimeout(toastTimer); }
  function choose(w) {
    if (!S.me) return askName(() => choose(w));
    if (w === GUEST) return guestSheet();
    if (S.cur.w === w) return;
    setCur(w);
  }

  // ---------- חלונות ----------
  const sheet = $("sheet");
  function open(...kids) { sheet.replaceChildren(h("div", { class: "panel", role: "dialog" }, ...kids)); sheet.hidden = false; }
  function close() { sheet.hidden = true; sheet.replaceChildren(); }
  sheet.addEventListener("click", e => { if (e.target === sheet) close(); });

  function askName(then) {
    const inp = h("input", { type: "text", maxLength: 30, placeholder: "למשל: עוז", autocomplete: "off" });
    const go = () => { const v = inp.value.trim(); if (!v) return inp.focus(); S.me = v; save(); close(); then && then(); };
    inp.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
    open(h("h2", {}, "איך לקרוא לך?"), h("p", { class: "note" }, "כדי שהשני יראה מי עדכן."), inp, h("button", { class: "act", type: "button", on: { click: go } }, "המשך"));
    setTimeout(() => inp.focus(), 50);
  }
  function guestSheet() {
    const inp = h("input", { type: "text", maxLength: 40, placeholder: "למשל: אמא, שרברב (אפשר להשאיר ריק)", value: S.cur.w === GUEST ? S.cur.note : "", autocomplete: "off" });
    const go = () => { close(); setCur(GUEST, inp.value); };
    inp.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
    open(h("h2", {}, "👤 מי האורח?"), inp, h("button", { class: "act", type: "button", on: { click: go } }, "אישור"), h("button", { class: "act sec", type: "button", on: { click: close } }, "ביטול"));
    setTimeout(() => inp.focus(), 50);
  }

  function settings() {
    const name = h("input", { type: "text", maxLength: 30, value: S.me });
    const carRows = Object.keys(S.cars).map(id => {
      const e = h("input", { type: "text", class: "emo", maxLength: 8, value: S.cars[id].e, "aria-label": "אייקון" });
      const n = h("input", { type: "text", maxLength: 20, value: S.cars[id].n, "aria-label": "שם הרכב" });
      return { id, e, n, row: h("div", { class: "row" }, e, n) };
    });
    const msg = h("div", { class: "err" });
    const saveBtn = h("button", { class: "act", type: "button", on: { click: () => {
      const me = name.value.trim(); if (!me) { msg.textContent = "צריך שם"; return; }
      S.me = me.slice(0, 30);
      carRows.forEach(r => { const n = r.n.value.trim().slice(0, 20), e = r.e.value.trim().slice(0, 8), c = S.cars[r.id]; if ((n && n !== c.n) || (e && e !== c.e)) S.cars[r.id] = { n: n || c.n, e: e || c.e, u: Date.now() }; });
      save(); render(); Sync.now(); close();
    } } }, "שמור");
    open(h("h2", {}, "⚙️ הגדרות"),
      h("label", {}, "השם שלי"), name,
      h("h3", {}, "הרכבים"), h("p", { class: "note" }, "מחליפים רכב? משנים כאן את השם והאייקון, וזה יתעדכן גם בטלפון השני."), carRows.map(r => r.row),
      msg, saveBtn, h("h3", {}, "סנכרון והתראות"), syncSection(), h("button", { class: "act sec", type: "button", on: { click: close } }, "סגור"));
  }
  function syncSection() {
    const box = h("div", {});
    const err = h("div", { class: "err" });
    if (!S.sync) {
      const url = h("input", { type: "url", value: DEFAULT_URL, placeholder: "https://....workers.dev", dir: "ltr", autocomplete: "off" });
      box.append(h("p", { class: "note" }, "כדי ששני הטלפונים יראו אותו דבר: לוחצים על הכפתור למטה (הכתובת כבר מוכנה), ואז שולחים הזמנה לטלפון השני."), url,
        h("button", { class: "act", type: "button", on: { click: async () => {
          const u = url.value.trim().replace(/\/$/, "");
          if (!HOST_OK(u)) { err.textContent = "הכתובת צריכה להתחיל ב-https:// ולהסתיים ב-workers.dev"; return; }
          S.sync = { url: u, code: Sync.genCode() }; save(); Sync.start(); render(); close(); invite();
        } } }, "הפעל סנכרון"), err);
      return box;
    }
    const pushState = h("span", {}, "בודק…");
    Push.state().then(t => { pushState.textContent = t; });
    box.append(h("p", { class: "note" }, "✅ מחובר. ", syncText),
      h("button", { class: "act", type: "button", on: { click: invite } }, "📤 שלחו הזמנה לטלפון השני"),
      h("p", { class: "note" }, "התראות במכשיר הזה: ", pushState),
      h("button", { class: "act sec", type: "button", on: { click: async e => {
        const b = e.target; b.disabled = true; err.textContent = "";
        try { if ((await Push.state()).startsWith("פעיל")) await Push.disable(); else await Push.enable(); } catch (x) { err.textContent = x.message || "שגיאה"; }
        b.disabled = false; Push.state().then(t => { pushState.textContent = t; });
      } } }, "🔔 הפעל / כבה התראות"), err,
      h("button", { class: "act danger", type: "button", on: { click: () => { if (confirm("לנתק את הסנכרון? המצב יישאר בטלפון הזה בלבד.")) { Sync.stop(); S.sync = null; save(); render(); close(); } } } }, "נתק סנכרון"));
    return box;
  }
  const b64u = o => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unb64u = s => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0))));
  async function invite() {
    if (!S.sync) return;
    const link = location.origin + location.pathname + "#j=" + b64u({ u: S.sync.url, c: S.sync.code });
    const text = "הצטרפי ל\"מי חונה?\" (הקישור פרטי, אל תשתפי הלאה): " + link;
    try { if (navigator.share) { await navigator.share({ title: "מי חונה?", text }); return; } } catch (e) { if (e && e.name === "AbortError") return; }
    try { await navigator.clipboard.writeText(link); alert("הקישור הועתק. שלחו אותו לטלפון השני."); } catch (e) { prompt("העתיקו את הקישור ושלחו לטלפון השני:", link); }
  }
  function handleJoin() {
    const m = location.hash.match(/^#j=([A-Za-z0-9_-]+)$/); if (!m) return;
    let j; try { j = unb64u(m[1]); } catch (e) { return; }
    history.replaceState(null, "", location.pathname + location.search);
    if (!j || !HOST_OK(j.u) || !CODE_OK(j.c)) return;
    if (S.sync && S.sync.code === j.c) return;
    const go = () => { S.sync = { url: j.u.replace(/\/$/, ""), code: j.c }; save(); Sync.start(); render(); close(); };
    open(h("h2", {}, "להצטרף לחנייה המשותפת?"), h("p", { class: "note" }, "אחרי ההצטרפות שני הטלפונים יראו את אותו מצב."),
      h("button", { class: "act", type: "button", on: { click: () => (S.me ? go() : (close(), askName(go))) } }, "הצטרף"), h("button", { class: "act sec", type: "button", on: { click: close } }, "לא עכשיו"));
  }

  // ---------- סנכרון ----------
  const Sync = (function () {
    let iv = null, busy = false, again = false;
    const url = () => `${S.sync.url}/rooms/${S.sync.code}.json`;
    async function req(method, body) {
      const r = await fetch(url(), { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }
    function merge(r) {
      let ch = false;
      Object.keys(S.cars).forEach(id => { const c = cleanCar(id, r.cars && r.cars[id]); if (c && c.u > S.cars[id].u) { S.cars[id] = c; ch = true; } });
      const cur = cleanCur(r.cur, S.cars); if (cur && cur.v > S.cur.v) { S.cur = cur; ch = true; }
      return ch;
    }
    function patchFor(r) {
      const p = {}; if (r.app !== "parking") p.app = "parking"; // הסימון גורם ל-Worker לא לשלוח כאן התראות טיול
      Object.keys(S.cars).forEach(id => { const c = S.cars[id], x = cleanCar(id, r.cars && r.cars[id]); if (c.u > 0 && (!x || c.u > x.u)) p["cars/" + id] = c; });
      const rc = cleanCur(r.cur, S.cars); if (S.cur.v > 0 && (!rc || S.cur.v > rc.v)) p.cur = S.cur;
      return p;
    }
    async function cycle() {
      if (!S.sync) return;
      if (busy) { again = true; return; }
      busy = true;
      try {
        const r = (await req("GET")) || {}, ch = merge(r), p = patchFor(r);
        if (Object.keys(p).length) await req("PATCH", p);
        if (ch) { save(); render(); }
        setSync("🔄 מסונכרן");
      } catch (e) { setSync("⚠ לא מסונכרן (" + (e.message || "שגיאה") + ")"); }
      finally { busy = false; if (again) { again = false; cycle(); } }
    }
    return {
      start() { clearInterval(iv); if (!S.sync) return; iv = setInterval(() => { if (!document.hidden) cycle(); }, 5000); cycle(); },
      stop() { clearInterval(iv); iv = null; setSync(""); },
      now: cycle,
      genCode() { const b = new Uint8Array(16); crypto.getRandomValues(b); return Array.from(b, x => "abcdefghijklmnopqrstuvwxyz0123456789"[x % 36]).join(""); },
      async notify(title, body) {
        if (!S.sync) return;
        try { await fetch(`${S.sync.url}/notify/${S.sync.code}`, { method: "POST", headers: { "content-type": "application/json" }, keepalive: true, body: JSON.stringify({ title, body, from: await Push.hash() }) }); } catch (e) { /* ignore */ }
      }
    };
  })();

  // ---------- התראות דחיפה ----------
  const Push = (function () {
    const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    const toU8 = s => { s = s.replace(/-/g, "+").replace(/_/g, "/"); const b = atob(s + "=".repeat((4 - s.length % 4) % 4)); return Uint8Array.from(b, c => c.charCodeAt(0)); };
    async function store() { const reg = await navigator.serviceWorker.ready; return { reg, cache: await caches.open("who-parks-cfg"), key: new URL("cfg-store", reg.scope).href }; }
    async function readCfg() { const { cache, key } = await store(), r = await cache.match(key); return r ? r.json() : null; }
    return {
      async hash() { try { const c = await Promise.race([readCfg(), new Promise(r => setTimeout(() => r(null), 1500))]); return c && c.hash; } catch (e) { return undefined; } }, // לא תלוי ב-SW: אם אין, שולחים בלי hash
      async enable() {
        if (!S.sync) throw new Error("קודם מפעילים סנכרון");
        if (!supported()) throw new Error("הדפדפן לא תומך בהתראות");
        if (await Notification.requestPermission() !== "granted") throw new Error("לא אושרה הרשאת התראות");
        const { reg, cache, key } = await store(), c = S.sync;
        const vr = await fetch(c.url + "/vapid"); if (!vr.ok) throw new Error("השרת לא עונה (HTTP " + vr.status + ")");
        const { pub } = await vr.json();
        const old = await reg.pushManager.getSubscription(); if (old) { try { await old.unsubscribe(); } catch (e) { /* ignore */ } }
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toU8(pub) });
        const r = await fetch(`${c.url}/subs/${c.code}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sub: sub.toJSON() }) });
        if (!r.ok) throw new Error("הרישום נכשל (HTTP " + r.status + ")");
        const { hash } = await r.json();
        await cache.put(key, new Response(JSON.stringify({ url: c.url, code: c.code, hash }), { headers: { "content-type": "application/json" } }));
      },
      async disable() {
        const cfg = await readCfg(), { reg, cache, key } = await store();
        const sub = await reg.pushManager.getSubscription(); if (sub) { try { await sub.unsubscribe(); } catch (e) { /* ignore */ } }
        if (cfg) { try { await fetch(`${cfg.url}/subs/${cfg.code}/${cfg.hash}`, { method: "DELETE" }); } catch (e) { /* ignore */ } }
        await cache.delete(key);
      },
      async state() {
        if (!supported()) return "לא נתמך בדפדפן הזה";
        try {
          const { reg } = await store(), sub = await reg.pushManager.getSubscription(), cfg = await readCfg();
          if (Notification.permission === "denied") return "חסום בהגדרות הדפדפן";
          return sub && cfg ? "פעיל ✅" : "כבוי";
        } catch (e) { return "כבוי"; }
      }
    };
  })();

  // ---------- הפעלה ----------
  $("gear").addEventListener("click", () => (S.me ? settings() : askName(settings)));
  $("hint").addEventListener("click", () => (S.me ? settings() : askName(settings)));
  document.addEventListener("visibilitychange", () => { if (document.hidden) flushNotice(); else { render(); Sync.now(); } });
  window.addEventListener("pagehide", flushNotice);
  setInterval(() => { if (!document.hidden) render(); }, 30000);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
    navigator.serviceWorker.addEventListener("message", e => { if (e.data && e.data.type === "refresh") Sync.now(); });
  }
  render(); Sync.start(); handleJoin();
  if (!S.me && sheet.hidden) askName(); // פעם ראשונה: מבקשים שם
})();
