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

// Demucs v4 de 6 fuentes (guitarra y piano aparte), con trozos de 3,9 s: la mitad de memoria que los
// originales de 7,8 s (~1,6 GB contra ~2,9 GB en el pico) y ~25 % más rápido, con la misma fidelidad en las
// partituras de Brayand (reparto 67 contra 68 %, bajo 63–67 contra 65 %, dentro del ruido de la medición).
const NOTE6 = "Separación en 6 fuentes (guitarra y piano aparte) para transcribir con más fidelidad.";
export const DEMUCS_PACKS = {
  graph39: { id: "demucs6-graph39", name: "Demucs 6 fuentes (red)", mb: 2.8, rev: 1, files: parts("demucs/graph39", 1), note: NOTE6 } as Pack,
  weights: { id: "demucs6-weights", name: "Demucs 6 fuentes (pesos)", mb: 54.8, rev: 1, files: parts("demucs/weights", 4), note: NOTE6 } as Pack,
};
/** Tamaño exacto de los pesos (27 414 552 en float16). */
export const DEMUCS_WEIGHT_BYTES = 54829104;
export const DEMUCS_SEG_APP = 171990;

// Beat This! (CPJKU, MIT): pulso, tiempos fuertes y compás con una red neuronal. Red y pesos en float16.
const NOTE_BT = "Pulso y compás con red neuronal (Beat This!).";
export const BEAT_PACKS = {
  graph: { id: "beatthis-graph", name: "Beat This! (red)", mb: 0.9, rev: 1, files: parts("beatthis/graph", 1), note: NOTE_BT } as Pack,
  weights: { id: "beatthis-weights", name: "Beat This! (pesos)", mb: 40.5, rev: 1, files: parts("beatthis/weights", 3), note: NOTE_BT } as Pack,
};
/** Tamaño exacto de los pesos de Beat This! (20 251 488 en float16). */
export const BEAT_WEIGHT_BYTES = 40502976;

export interface SepPlan {
  engine: "demucs" | "mdx";
  /** Muestras por trozo de Demucs. */
  seg: number;
  /** «Fiel (rápida)»: sin el modelo extra de batería (Demucs) o sin el de voz (MDX-Net), menos solape. */
  fast: boolean;
  packs: [string, Pack][];
  mb: number;
  label: string;
}

const isPhone = () => /Android|iPhone|iPad|Mobile/i.test((typeof navigator !== "undefined" && navigator.userAgent) || "");

/**
 * Qué separación usa este equipo (medido: Demucs con trozos de 3,9 s ~1,6 GB en el pico; MDX-Net ~1,4 GB). Chrome informa la memoria del equipo (redondeada, máximo 8). Si Demucs ya falló en
 * este equipo (`noDemucs`), se usa MDX-Net.
 */
export function sepPlan(fast: boolean, noDemucs = false, wantsVocals = true): SepPlan {
  const mem = (typeof navigator !== "undefined" ? (navigator as { deviceMemory?: number }).deviceMemory : undefined);
  const phone = isPhone();
  const demucs = !noDemucs && (phone ? (mem ?? 4) >= 6 : (mem ?? 8) >= 4);
  if (demucs) {
    const packs: [string, Pack][] = [["ort", SEP_PACKS.ort], ["graph", DEMUCS_PACKS.graph39], ["weights", DEMUCS_PACKS.weights], ...(fast ? [] : [["drums", SEP_PACKS.drums] as [string, Pack]])];
    return { engine: "demucs", seg: DEMUCS_SEG_APP, fast, packs, mb: packs.reduce((x, [, p]) => x + p.mb, 0), label: fast ? "Demucs en 6 fuentes" : "Demucs en 6 fuentes y MDX-Net para la batería" };
  }
  const packs: [string, Pack][] = [["ort", SEP_PACKS.ort], ...(fast && !wantsVocals ? [] : [["vocals", SEP_PACKS.vocals] as [string, Pack]]), ["drums", SEP_PACKS.drums], ["bass", SEP_PACKS.bass]];
  return { engine: "mdx", seg: 0, fast, packs, mb: packs.reduce((x, [, p]) => x + p.mb, 0), label: "MDX-Net (voz, batería y bajo)" };
}

/** Núcleos para la separación: todos menos uno (para que la pantalla siga fluida), entre 1 y 6. */
export const threadsFor = (hc?: number) => { const n = hc || 2; return n <= 2 ? n : Math.min(6, n - 1); };
