// Tipos del transcriptor y del análisis musical de MusicFees.
// Todo lo de esta carpeta (salvo build.ts y ui.ts) es puro: no toca el DOM ni alphaTab, para poder
// correrlo en un worker y probarlo en Node.

/** Nota detectada. Tiempos en segundos (o en tiempos de negra, en el análisis de una partitura). */
export interface RawNote {
  /** Inicio */ s: number;
  /** Fin */ e: number;
  /** Altura MIDI (en batería: la pieza GM, 36 bombo, 38 caja, 42 hi-hat…) */ p: number;
  /** Fuerza o confianza 0–1 */ a: number;
}

export type Role = "melody" | "harmony" | "bass" | "drums" | "all";

export interface Part { role: Role; notes: RawNote[] }

export interface KeyInfo {
  tonic: number; // 0 = Do
  mode: "major" | "minor";
  /** Armadura para alphaTab: −7 (7 bemoles) … 7 (7 sostenidos). */
  sig: number;
  /** 0–1: qué tan clara es la tonalidad. */
  conf: number;
  name: string;
}

export interface ChordSeg {
  /** Primer y último tiempo (índices en la lista de tiempos) que dura el acorde. */
  b0: number; b1: number;
  /** −1 = sin acorde */ root: number;
  type: string;
  name: string;
  roman: string;
  /** Nota del bajo si no es la fundamental (inversión), si no −1. */
  bass: number;
}

export interface FormSection { b0: number; b1: number; label: string; name: string }

export interface CounterpointReport {
  voices: [string, string];
  slices: number;
  motion: { parallel: number; similar: number; contrary: number; oblique: number };
  parallelPerfect: { bar: number; kind: "5as" | "8as" }[];
  crossings: number[];
  strongDissonances: number;
  resolved: number;
  /** Intervalos armónicos más usados (en semitonos módulo 12). */
  intervals: { iv: number; n: number }[];
  summary: string[];
}

export interface Analysis {
  duration: number;
  tempo: number;
  /** Tiempos (negras) en segundos. */
  beats: number[];
  meter: 3 | 4;
  /** Índice del tiempo donde empieza el primer compás completo. */
  downbeat: number;
  key: KeyInfo;
  chords: ChordSeg[];
  sections: FormSection[];
  parts: Part[];
  counterpoint: CounterpointReport | null;
  /** Compases (índice) con notas dudosas. */
  doubtful: number[];
  notes: number;
  /** Advertencias para el usuario. */
  notesForUser: string[];
}

/** Ajustes del usuario para transcribir. */
export interface TranscribeOpts {
  /** "mix": canción completa → bajo, armonía, melodía y batería. "solo": un instrumento. */
  mode: "mix" | "solo";
  /** Preset de MusicFees para cada parte (en "solo", el de "all"). */
  presets: Partial<Record<Role, string>>;
  drums: boolean;
  /** Sensibilidad 0–1 (más alto = más notas, más ruido). */
  sensitivity: number;
  /** Marca con un comentario los compases dudosos. */
  markDoubtful: boolean;
  title: string;
}
