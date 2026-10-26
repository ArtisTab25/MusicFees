// Bancos de sonido disponibles. La lista la escribe scripts/soundfonts.mjs al compilar:
// si MuseScore_General no se pudo descargar, solo aparece GeneralUser GS.
import { ARTIFACT, SOUNDFONT_URL } from "../config";

export interface Bank { id: string; name: string; file: string; mb: number; note: string }

const FALLBACK: Bank = { id: "gu", name: "GeneralUser GS", file: "GeneralUser-GS.sf3", mb: 8, note: "Ligero, carga rápido" };

export async function loadBanks(): Promise<Bank[]> {
  if (ARTIFACT) return [FALLBACK];
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}soundfont/banks.json`, { cache: "no-cache" });
    if (!r.ok) throw new Error(String(r.status));
    const list = (await r.json()) as Bank[];
    return Array.isArray(list) && list.length ? list : [FALLBACK];
  } catch {
    return [FALLBACK];
  }
}

export function bankUrl(b: Bank): string {
  return b.id === "gu" ? SOUNDFONT_URL : `${import.meta.env.BASE_URL}soundfont/${b.file}`;
}

/** El banco guardado en preferencias si sigue disponible; si no, el primero (el más completo). */
export function pickBank(list: Bank[], saved: unknown): Bank {
  return list.find((b) => b.id === saved) ?? list[0];
}
