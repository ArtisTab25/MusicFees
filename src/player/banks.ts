// Bancos de sonido: uno incluido (carga en segundos) y otros que se descargan una vez y quedan
// guardados en el dispositivo. La web, la APK y el artefacto usan el mismo mecanismo.
import { SOUNDFONT_URL } from "../config";
import { MUSESCORE, type Pack } from "./downloads";

export interface Bank { id: string; name: string; mb: number; note: string; pack?: Pack }

export const BANKS: Bank[] = [
  { id: "gu", name: "GeneralUser GS", mb: 8, note: "Incluido en la app. Carga en segundos." },
  { id: "ms", name: MUSESCORE.name, mb: MUSESCORE.mb, note: MUSESCORE.note, pack: MUSESCORE },
];
export const BUILTIN_URL = SOUNDFONT_URL;
export const bankById = (id: unknown) => BANKS.find((b) => b.id === id) ?? BANKS[0];
