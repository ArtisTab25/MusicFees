import { defineConfig, type Plugin } from "vite";
import { alphaTab } from "@coderline/alphatab-vite";

// El motor WebAssembly de ONNX Runtime (21 MB) no va en el paquete: el transcriptor lo baja una vez
// como paquete descargable (scripts/models.mjs) y se lo pasa al motor en memoria.
const dropOrtWasm = (): Plugin => ({
  name: "mf-drop-ort-wasm",
  generateBundle(_, bundle) { for (const k of Object.keys(bundle)) if (/ort-wasm.*\.wasm$/.test(k)) delete bundle[k]; },
});

// Base relativa: funciona igual en GitHub Pages, en cualquier hosting y dentro de la app Android.
export default defineConfig({
  base: "./",
  plugins: [alphaTab(), dropOrtWasm()],
  // alphaTab calcula la ruta de su fuente musical desde su propio archivo: no se pre-empaqueta.
  optimizeDeps: { exclude: ["@coderline/alphatab", "onnxruntime-web"] },
  worker: { plugins: () => [dropOrtWasm()] },
  build: { target: "es2022", chunkSizeWarningLimit: 4000 },
  server: { host: true },
});
