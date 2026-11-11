import { createRequire } from "node:module"; const { chromium } = createRequire("/opt/node22/lib/node_modules/")("playwright"); import assert from "node:assert/strict";
const b = await chromium.launch(); const errors=[];
const mk = async () => { const ctx = await b.newContext({viewport:{width:390,height:800},locale:"he-IL",serviceWorkers:"block"}); const p = await ctx.newPage(); p.on("pageerror",e=>errors.push(String(e))); p.on("console",m=>{if(m.type()==="error")errors.push(m.text())}); p.on("dialog",d=>d.accept()); return p; };
const A = await mk(); await A.goto("http://localhost:8781/index.html");
// שם
await A.fill(".panel input", "עוז"); await A.click(".panel .act");
assert.match(await A.textContent("#meta"), /עוד לא סומן/); assert.equal(await A.textContent("#who"), "החנייה ריקה");
await A.click('.btn[data-w="c1"]'); assert.equal(await A.textContent("#who"), "יונדאי"); assert.match(await A.textContent("#meta"), /מ-\d\d:\d\d.*עודכן ע״י עוז/);
console.log("A marks hyundai ✔", await A.textContent("#meta"));
// הפעלת סנכרון
await A.click("#gear"); await A.fill('input[type=url]', "http://localhost:8780"); await A.click("text=הפעל סנכרון");
await A.waitForTimeout(1500);
const sync = await A.evaluate(()=>JSON.parse(localStorage.getItem("who-parks-v1")).sync); assert.ok(sync && sync.code.length===16);
const enc = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const B = await mk(); await B.goto("http://localhost:8781/index.html#j="+enc({u:sync.url,c:sync.code}));
await B.waitForSelector("text=להצטרף לחנייה המשותפת?"); await B.click(".panel .act:not(.sec)");
await B.fill(".panel input", "אשתי"); await B.click(".panel .act");
await B.waitForFunction(()=>document.getElementById("who").textContent==="יונדאי",null,{timeout:8000});
console.log("B joined and sees hyundai ✔", await B.textContent("#meta"));
// B מסמנת סקודה
await B.click('.btn[data-w="c2"]'); assert.equal(await B.textContent("#who"), "סקודה");
await A.waitForFunction(()=>document.getElementById("who").textContent==="סקודה",null,{timeout:9000});
assert.match(await A.textContent("#meta"), /עודכן ע״י אשתי/); console.log("A sees skoda by wife ✔");
// אורח עם הערה
await A.click('.btn[data-w="guest"]'); await A.fill(".panel input","אמא"); await A.click(".panel .act");
assert.equal(await A.textContent("#who"), "אורח · אמא");
await B.waitForFunction(()=>document.getElementById("who").textContent==="אורח · אמא",null,{timeout:9000}); console.log("guest note synced ✔");
// ביטול
await A.click('.btn[data-w="empty"]'); assert.equal(await A.textContent("#who"), "החנייה ריקה"); await A.click("#undo");
assert.equal(await A.textContent("#who"), "אורח · אמא");
await B.waitForTimeout(6500); assert.equal(await B.textContent("#who"), "אורח · אמא"); console.log("undo ✔ (B never saw empty)");
// ריקה אמיתי
await A.click('.btn[data-w="empty"]'); await B.waitForFunction(()=>document.getElementById("who").textContent==="החנייה ריקה",null,{timeout:9000}); console.log("empty synced ✔");
// החלפת רכב
await B.click("#gear"); const ins = B.locator(".panel .row input:not(.emo)"); await ins.nth(1).fill("טויוטה"); await B.locator(".panel .row input.emo").nth(1).fill("🚐"); await B.click("text=שמור");
assert.ok((await B.textContent("#btns")).includes("טויוטה"));
await A.waitForFunction(()=>document.getElementById("btns").textContent.includes("טויוטה"),null,{timeout:9000}); console.log("car rename synced ✔");
await A.click('.btn[data-w="c2"]'); assert.equal(await A.textContent("#who"), "טויוטה");
await A.screenshot({path:"shot-a.png"});
await A.waitForTimeout(9000);
const notices = await (await fetch("http://localhost:8780/__log")).json();
assert.deepEqual(notices.map(n => n.title).sort(), ["🚐 טויוטה חונה", "🚙 יונדאי חונה", "🚗 סקודה חונה", "🅿️ החנייה התפנתה", "👤 אורח חונה: אמא"].sort());
assert.ok(notices.some(n => n.title === "🚗 סקודה חונה" && n.body === "עודכן ע״י אשתי")); assert.equal(notices.filter(n => n.title === "🅿️ החנייה התפנתה").length, 1, "undo must not notify");
console.log("notifications:", notices.map(n => n.title).join(" | "));
// ---- כפתורים מהירים: חניתי / יצאתי + הרכב שלי + קיצורי דרך ----
const who = P => P.textContent("#who"), waitWho = (P, t) => P.waitForFunction(t2 => document.getElementById("who").textContent === t2, t, { timeout: 9000 });
await A.click(".qbtn.park"); await A.waitForSelector("text=באיזה רכב אתם חונים?"); await A.click(".panel .act:has-text('יונדאי')");
await waitWho(A, "יונדאי"); await waitWho(B, "יונדאי"); console.log("quick park (picked my car) synced ✔");
await A.click(".qbtn:not(.park)"); await waitWho(A, "החנייה ריקה"); await waitWho(B, "החנייה ריקה"); console.log("quick leave synced ✔");
await B.click("#gear"); await B.selectOption(".panel select", "c2"); await B.click("text=שמור");
await B.click(".qbtn.park"); await waitWho(B, "טויוטה"); await waitWho(A, "טויוטה");
A.removeAllListeners("dialog"); A.once("dialog", d => d.dismiss()); await A.click(".qbtn:not(.park)"); await A.waitForTimeout(500); assert.equal(await who(A), "טויוטה"); console.log("leave asks before clearing other's car ✔");
A.once("dialog", d => d.accept()); await A.click(".qbtn:not(.park)"); await waitWho(A, "החנייה ריקה"); await waitWho(B, "החנייה ריקה");
await A.goto("http://localhost:8781/index.html?a=park"); await waitWho(A, "יונדאי"); assert.ok(!A.url().includes("a=park")); await waitWho(B, "יונדאי"); console.log("shortcut ?a=park ✔");
await A.goto("http://localhost:8781/index.html?a=leave"); await waitWho(A, "החנייה ריקה"); console.log("shortcut ?a=leave ✔");
const man = await (await fetch("http://localhost:8781/manifest.webmanifest")).json(); assert.deepEqual(man.shortcuts.map(x => x.url), ["./index.html?a=park", "./index.html?a=leave"]);
console.log("errors:", JSON.stringify(errors));
if (errors.length) { console.log("FAIL"); process.exit(1); }
await b.close(); process.exit(0);
