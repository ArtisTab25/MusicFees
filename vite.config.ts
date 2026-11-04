import { defineConfig, type Plugin } from "vite";
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { alphaTab } from "@coderline/alphatab-vite";

// El motor WebAssembly de ONNX Runtime (21 MB) no va en el paquete: el transcriptor lo baja una vez
// como paquete descargable (scripts/models.mjs) y se lo pasa al motor en memoria.
const dropOrtWasm = (): Plugin => ({
  name: "mf-drop-ort-wasm",
  generateBundle(_, bundle) { for (const k of Object.keys(bundle)) if (/ort-wasm.*\.wasm$/.test(k)) delete bundle[k]; },
});

// Lista para el service worker: lo que hace falta para abrir la app y transcribir sin internet (código,
// fuente musical, modelo de notas y su motor). Los modelos grandes de separación tienen su propio guardado.
const precacheList = (): Plugin => ({
  name: "mf-precache-list",
  apply: "build",
  closeBundle() {
    const out = resolve(__dirname, "dist");
    if (!existsSync(out)) return;
    const files: string[] = ["./"];
    const walk = (d: string) => { for (const f of readdirSync(join(out, d))) { const r = d ? `${d}/${f}` : f; if (statSync(join(out, r)).isDirectory()) walk(r); else files.push(r); } };
    for (const d of ["assets", "font", "models/basic-pitch", "models/tfjs-wasm", "icons"]) if (existsSync(join(out, d))) walk(d);
    for (const f of ["index.html", "manifest.webmanifest"]) if (existsSync(join(out, f))) files.push(f);
    writeFileSync(join(out, "precache.json"), JSON.stringify(files));
  },
});

// Base relativa: funciona igual en GitHub Pages, en cualquier hosting y dentro de la app Android.
export default defineConfig({
  base: "./",
  plugins: [alphaTab(), dropOrtWasm(), precacheList()],
  // alphaTab calcula la ruta de su fuente musical desde su propio archivo: no se pre-empaqueta.
  optimizeDeps: { exclude: ["@coderline/alphatab", "onnxruntime-web"] },
  worker: { plugins: () => [dropOrtWasm()] },
  build: { target: "es2022", chunkSizeWarningLimit: 4000 },
  server: { host: true },
});
