const { chromium } = require("playwright"); const http = require("http"); const fs = require("fs"); const path = require("path");
const root = "/home/claude/omr/www";
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split("?")[0])); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  const ext = path.extname(f); r.writeHead(200, { "content-type": { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".woff2": "font/woff2", ".woff": "font/woff", ".otf": "font/otf" }[ext] || "application/octet-stream" }); fs.createReadStream(f).pipe(r); }).listen(8765);
(async () => { const b = await chromium.launch(); const p = await b.newPage(); p.on("console", m => m.type() === "error" && console.log("console:", m.text()));
  await p.goto("http://localhost:8765/index.html?" + (process.argv[3] || ""));
  await p.waitForFunction(() => window.done, null, { timeout: 60000 }); await p.waitForTimeout(1500);
  const H = await p.evaluate(() => Math.max(document.body.scrollHeight, document.getElementById("at").scrollHeight)); await p.pdf({ path: process.argv[2], width: "8.27in", height: Math.ceil(H / 96 + 0.5) + "in", printBackground: true }); await b.close(); srv.close(); console.log("ok"); })();
