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

// Demucs v4 de 6 fuentes (guitarra y piano aparte). Con él solo hace falta, además, la batería de MDX-Net
// (que lee mejor bombo, caja y hi-hat).
const NOTE6 = "Separación en 6 fuentes (guitarra y piano aparte) para transcribir con más fidelidad.";
export const DEMUCS_PACKS = {
  graph: { id: "demucs6-graph", name: "Demucs 6 fuentes (red)", mb: 4.9, rev: 1, files: parts("demucs/graph", 1), note: NOTE6 } as Pack,
  weights: { id: "demucs6-weights", name: "Demucs 6 fuentes (pesos)", mb: 54.8, rev: 1, files: parts("demucs/weights", 4), note: NOTE6 } as Pack,
};
/** Tamaño exacto de los pesos (27 414 552 en float16). */
export const DEMUCS_WEIGHT_BYTES = 54829104;
export const SEP6_MB = SEP_PACKS.ort.mb + SEP_PACKS.drums.mb + DEMUCS_PACKS.graph.mb + DEMUCS_PACKS.weights.mb;

/**
 * ¿Le alcanza la memoria al dispositivo para Demucs? Necesita ~2,8 GB en el pico (el doble que MDX-Net).
 * Chrome informa la memoria del equipo (redondeada, máximo 8); si no la informa, se usa solo en
 * computadoras.
 */
export function canUseDemucs(): boolean {
  const nav = (typeof navigator !== "undefined" ? navigator : {}) as { deviceMemory?: number; userAgent?: string };
  if (typeof nav.deviceMemory === "number") return nav.deviceMemory >= 6;
  return !/Android|iPhone|iPad|Mobile/i.test(nav.userAgent ?? "");
}
