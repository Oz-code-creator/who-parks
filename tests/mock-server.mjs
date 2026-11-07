// שרת מדומה לבדיקות: אתר (8781) + Worker מצומצם (8780): rooms GET/PATCH, notify. רץ מקומית בלבד.
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const rooms = {}, log = [];
const set = (o, parts, v) => { for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] ??= {}; o[parts.at(-1)] = v; };
http.createServer(async (req, res) => {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "*", "access-control-allow-headers": "content-type" };
  const chunks = []; for await (const c of req) chunks.push(c); const body = Buffer.concat(chunks).toString();
  const send = (o, s = 200) => { res.writeHead(s, { ...cors, "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  let m;
  if ((m = req.url.match(/^\/rooms\/(\w+)\.json$/))) {
    if (req.method === "GET") return send(rooms[m[1]] ?? null);
    const room = rooms[m[1]] ??= {}; for (const [p, v] of Object.entries(JSON.parse(body))) set(room, p.split("/"), v); return send({});
  }
  if (req.url.startsWith("/notify/")) { log.push(JSON.parse(body)); return send({ sent: 0 }); }
  if (req.url === "/__log") return send(log);
  send({ error: "nope" }, 404);
}).listen(8780);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "docs"), T = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html"; const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": T[path.extname(f)] || "application/octet-stream" }); res.end(fs.readFileSync(f));
}).listen(8781);
