// Prepara los modelos de separación de fuentes antes de compilar (corre con `npm run build`).
//
// MDX-Net de KUIELab (Music Demixing Challenge 2021, MIT), en ONNX, tal como los publica el proyecto
// Ultimate Vocal Remover en GitHub: voz, batería y bajo (~30 MB cada uno). No viven en el repositorio:
// se descargan aquí (GitHub Actions tiene internet) y se parten en trozos de menos de 15 MB, que la
// app une al bajarlos una sola vez. También se copia el motor de ONNX Runtime Web (WebAssembly).
//
// Con MF_APK=1 no copia nada: la APK los baja del sitio publicado la primera vez que se usan.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, ".cache", "mdx");
const OUT = join(ROOT, "public", "models");
const PART = 15_000_000;
const UVR = "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models";
// Huellas de los archivos probados con MusicFees (2 nov 2026).
export const MODELS = {
  vocals: { file: "kuielab_a_vocals.onnx", bytes: 29703204 },
  drums: { file: "kuielab_a_drums.onnx", bytes: 29703204 },
  bass: { file: "kuielab_a_bass.onnx", bytes: 29703204 },
};
const log = (m) => console.log(`[modelos] ${m}`);

function split(bytes, dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let n = 0;
  for (let o = 0; o < bytes.length; o += PART) writeFileSync(join(dir, `part${++n}.bin`), bytes.subarray(o, o + PART));
  return n;
}

if (process.env.MF_APK) log("Compilación para Android: los modelos de separación se bajan del sitio publicado al usarlos.");
else {
  mkdirSync(CACHE, { recursive: true });
  for (const [stem, m] of Object.entries(MODELS)) {
    const cached = join(CACHE, m.file);
    let bytes = existsSync(cached) ? readFileSync(cached) : null;
    if (!bytes || bytes.length !== m.bytes) {
      try {
        log(`Descargando ${m.file} (~30 MB)…`);
        const r = await fetch(`${UVR}/${m.file}`, { redirect: "follow" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        bytes = Buffer.from(await r.arrayBuffer());
        if (bytes.length !== m.bytes) throw new Error(`tamaño inesperado (${bytes.length})`);
        writeFileSync(cached, bytes);
      } catch (e) { log(`No se pudo descargar ${m.file}: ${e.message}. La separación no estará disponible en esta compilación.`); continue; }
    }
    const parts = split(bytes, join(OUT, "mdx", stem));
    log(`${stem}: ${parts} partes · sha256 ${createHash("sha256").update(bytes).digest("hex").slice(0, 12)}`);
  }
  const wasm = join(ROOT, "node_modules", "onnxruntime-web", "dist", "ort-wasm-simd-threaded.jsep.wasm");
  if (existsSync(wasm)) log(`ONNX Runtime Web: ${split(readFileSync(wasm), join(OUT, "ort"))} partes.`);
  else log("Falta onnxruntime-web (corre npm install).");
}
