// Prepara los bancos de sonido antes de compilar (corre solo con `npm run build`).
//
// MuseScore_General pesa ~40 MB: GitHub no deja subir archivos de más de 25 MB desde el
// navegador, así que no vive en el repositorio. Se descarga del servidor oficial de MuseScore
// durante la compilación (GitHub Actions sí tiene internet) y se copia a
// public/soundfont/. Si la descarga falla, la app se publica igual con GeneralUser GS.
//
// Las correcciones para alphaTab están en scripts/sfadapt.mjs y se aplican en el navegador.
//
// Uso local: node scripts/soundfonts.mjs [ruta/a/MuseScore_General.sf3]
// Con MF_APK=1 no copia nada (la APK lo descarga después).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { adaptForAlphaTab } from "./sfadapt.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "soundfont");
const CACHE = join(ROOT, ".cache");
const BASE = "https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General";
const MSG = {
  file: "MuseScore_General.sf3",
  url: `${BASE}/MuseScore_General.sf3`,
  licenseUrl: `${BASE}/MuseScore_General_License.md`,
  // Huella de la v0.2 que se probó con MusicFees (26 oct 2026).
  sha256: "5b85b6c2c61d10b2b91cddd41efcce7b25cd31c8271d511c73afafbef20b6fa3",
};

const log = (m) => console.log(`[sonidos] ${m}`);
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

async function fetchBytes(url) {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

async function museScore(localPath) {
  mkdirSync(CACHE, { recursive: true });
  const cached = join(CACHE, MSG.file);
  let raw;
  if (localPath) raw = new Uint8Array(readFileSync(localPath));
  else if (existsSync(cached)) raw = new Uint8Array(readFileSync(cached));
  else {
    log(`Descargando ${MSG.file} (~40 MB) del servidor de MuseScore…`);
    raw = await fetchBytes(MSG.url);
    writeFileSync(cached, raw);
  }
  const hash = sha256(raw);
  if (hash !== MSG.sha256) log(`Aviso: la huella no coincide con la versión probada (${hash.slice(0, 12)}…). Se usa igual: viene del servidor oficial.`);
  // Se publica el original: la app lo adapta para alphaTab al cargarlo (scripts/sfadapt.mjs)
  // y el motor de efectos lo usa tal cual.
  const { stereo } = adaptForAlphaTab(raw); // comprobación: falla aquí si el archivo está dañado
  writeFileSync(join(OUT, MSG.file), raw);
  log(`${MSG.file}: ${(raw.length / 1048576).toFixed(1)} MB (original; ${stereo} zonas estéreo se adaptan al cargar).`);
  try {
    const lic = await fetchBytes(MSG.licenseUrl);
    writeFileSync(join(OUT, "MuseScore_General-LICENSE.md"), lic);
  } catch { /* queda la nota de licencia que ya viene en el repositorio */ }
  return raw.length;
}

// ---------- principal ----------
// La APK no incluye MuseScore_General: lo descarga desde el sitio publicado cuando el usuario lo pide.
if (process.env.MF_APK) {
  log("Compilación para Android: MuseScore_General queda como descarga dentro de la app.");
} else {
  try {
    await museScore(process.argv[2]);
  } catch (e) {
    log(`No se pudo preparar MuseScore_General (${e.message}). Se publica solo GeneralUser GS; la descarga del otro banco fallará hasta la próxima compilación.`);
  }
}
