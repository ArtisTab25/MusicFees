import { defineConfig } from "vite";
import { alphaTab } from "@coderline/alphatab-vite";

// Base relativa: funciona igual en GitHub Pages, en cualquier hosting y dentro de la app Android.
export default defineConfig({
  base: "./",
  plugins: [alphaTab()],
  // alphaTab calcula la ruta de su fuente musical desde su propio archivo: no se pre-empaqueta.
  optimizeDeps: { exclude: ["@coderline/alphatab"] },
  build: { target: "es2022", chunkSizeWarningLimit: 4000 },
  server: { host: true },
});
