// Genera las páginas públicas de avisos legales (legal.html y privacidad.html) desde src/legal.json,
// el mismo texto que muestra la app. Se ejecuta antes de compilar.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const L = JSON.parse(readFileSync(join(ROOT, "src/legal.json"), "utf8"));
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const page = (title, sections) => `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  body { font-family: system-ui, "Segoe UI", Roboto, sans-serif; max-width: 760px; margin: 0 auto; padding: 24px 16px 56px; line-height: 1.55; color: #17181c; background: #fbfbf9; }
  h1 { font-size: 1.6rem; margin-bottom: .2rem; } h2 { font-size: 1.2rem; margin-top: 2rem; border-top: 1px solid #ddd; padding-top: 1rem; }
  h3 { font-size: 1rem; margin: 1rem 0 .2rem; } p { margin: .2rem 0 .6rem; } small, .sum { color: #555; }
  nav a { margin-right: 12px; }
  @media (prefers-color-scheme: dark) { body { background: #1d1e26; color: #eceef4; } small, .sum { color: #a5a8b8; } a { color: #8fb8ff; } h2 { border-color: #444; } }
</style>
</head>
<body>
<h1>MusicFees · ${esc(title)}</h1>
<small>Versión ${esc(L.version)} · vigente desde el ${esc(L.updated)}</small>
<p class="sum">${esc(L.summary)}</p>
<nav>${sections.map((s) => `<a href="#${s.id}">${esc(s.title)}</a>`).join(" ")}</nav>
${sections.map((s) => `<h2 id="${s.id}">${esc(s.title)}</h2>\n${s.items.map(([h, t]) => `<h3>${esc(h)}</h3><p>${esc(t)}</p>`).join("\n")}`).join("\n")}
</body>
</html>
`;
writeFileSync(join(ROOT, "public/legal.html"), page("Avisos legales", L.sections));
writeFileSync(join(ROOT, "public/privacidad.html"), page("Aviso de privacidad y términos", L.sections));
console.log("[legal] legal.html y privacidad.html generados");
