// Paquetes descargables del modo «Fiel» del transcriptor: los tres modelos de separación (MDX-Net) y el
// motor ONNX Runtime Web. Se bajan una vez (~110 MB) y quedan guardados en el dispositivo.
import { ARTIFACT } from "../config";
import type { Pack } from "../player/downloads";

const parts = (dir: string, n: number) => Array.from({ length: n }, (_, i) => `models/${dir}/part${i + 1}.bin${ARTIFACT ? ".ogg" : ""}`);
const NOTE = "Separación de fuentes para transcribir con más fidelidad.";
export const SEP_PACKS = {
  ort: { id: "ort-jsep", name: "Motor ONNX Runtime", mb: 20.7, rev: 1, files: parts("ort", 2), note: NOTE } as Pack,
  vocals: { id: "mdx-vocals", name: "Modelo de voz", mb: 28.3, rev: 1, files: parts("mdx/vocals", 2), note: NOTE } as Pack,
  drums: { id: "mdx-drums", name: "Modelo de batería", mb: 28.3, rev: 1, files: parts("mdx/drums", 2), note: NOTE } as Pack,
  bass: { id: "mdx-bass", name: "Modelo de bajo", mb: 28.3, rev: 1, files: parts("mdx/bass", 2), note: NOTE } as Pack,
};
export const SEP_MB = Object.values(SEP_PACKS).reduce((s, p) => s + p.mb, 0);
