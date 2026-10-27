// Compila la versión que corre como artefacto dentro de Claude (dist-artifact/).
// - Sin Supabase (Claude bloquea esa conexión): la biblioteca usa la cuenta de Claude.
// - Los archivos binarios van con extensión .ogg porque el artefacto solo sirve tipos conocidos.
// - MuseScore_General va partido en trozos de menos de 15 MB (límite por archivo).
// Al final escribe dist-artifact/files.json con el mapa para publicar.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist-artifact");
rmSync(OUT, { recursive: true, force: true });
execSync("npx vite build --outDir dist-artifact", { cwd: ROOT, stdio: "inherit", env: { ...process.env, VITE_TARGET: "artifact" } });

const drop = ["font/Bravura.svg", "font/Bravura.eot", "font/Bravura.otf", "font/Bravura-FONTLOG.txt", "font/Bravura-OFL-FAQ.txt",
  "icons/logo-full.png", "icons/icon-512.png", "manifest.webmanifest", "soundfont/README.md", "soundfont/LICENSE", "soundfont/sonivox.sf2", "soundfont/sonivox.sf3"];
for (const f of drop) rmSync(join(OUT, f), { force: true });
renameSync(join(OUT, "soundfont/GeneralUser-GS.sf3"), join(OUT, "soundfont/GeneralUser-GS.sf3.ogg"));
for (const f of readdirSync(join(OUT, "samples"))) renameSync(join(OUT, "samples", f), join(OUT, "samples", `${f}.ogg`));

// MuseScore_General en tres partes
const ms = [join(OUT, "soundfont/MuseScore_General.sf3"), join(ROOT, "public/soundfont/MuseScore_General.sf3"), join(ROOT, ".cache/MuseScore_General.sf3")].find(existsSync);
const msBytes = ms ? readFileSync(ms) : null;
rmSync(join(OUT, "soundfont/MuseScore_General.sf3"), { force: true });
if (msBytes) {
  const b = msBytes, n = 3, size = Math.ceil(b.length / n);
  mkdirSync(join(OUT, "soundfont/ms"), { recursive: true });
  for (let i = 0; i < n; i++) writeFileSync(join(OUT, `soundfont/ms/part${i + 1}.ogg`), b.subarray(i * size, (i + 1) * size));
  console.log(`[artefacto] MuseScore_General en ${n} partes de ${(size / 1048576).toFixed(1)} MB`);
} else console.log("[artefacto] Sin MuseScore_General (corre antes scripts/soundfonts.mjs): solo GeneralUser.");

// Página: el visor pone su propio esqueleto, así que se publica el contenido con el CSS en línea.
const html = readFileSync(join(OUT, "index.html"), "utf8");
const head = html.match(/<head>([\s\S]*)<\/head>/)[1]
  .replace(/\s*<meta charset[^>]*>/, "").replace(/\s*<meta name="viewport"[^>]*>/, "").replace(/\s*<link rel="manifest"[^>]*>/, "");
const cssHref = head.match(/<link rel="stylesheet" crossorigin href="\.\/(assets\/[^"]+\.css)">/)[1];
const css = readFileSync(join(OUT, cssHref), "utf8");
const page = `${head.replace(/\s*<link rel="stylesheet" crossorigin href="\.\/assets\/[^"]+\.css">/, "").trim()}
<style>
${css}
/* Dentro de Claude el visor ya deja el espacio de las barras del sistema. */
html, body { height: 100%; }
#app { height: 100%; padding-top: 0; padding-bottom: 0; }
</style>
<div id="app"></div>
`;
writeFileSync(join(OUT, "MusicFees.html"), page);
rmSync(join(OUT, "index.html"));
rmSync(join(OUT, cssHref));

const files = {};
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else { const r = relative(OUT, p); if (r !== "MusicFees.html") files[r] = r; } } };
walk(OUT);
writeFileSync(join(OUT, "files.json"), JSON.stringify(files, null, 1));
const total = Object.keys(files).reduce((n, f) => n + statSync(join(OUT, f)).size, 0);
console.log(`[artefacto] ${Object.keys(files).length} archivos, ${(total / 1048576).toFixed(1)} MB`);
