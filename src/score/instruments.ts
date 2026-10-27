// Instrumentos y plantillas por estilo. Programas General MIDI sonando con GeneralUser GS.
export type Kind = "tab" | "notation" | "drums";

export interface Preset {
  id: string;
  name: string;
  group: string;
  kind: Kind;
  program: number;
  /** Afinación de la cuerda más aguda a la más grave (MIDI). */
  tuning?: number[];
  /** Mostrar notación además de tablatura. */
  notation?: boolean;
  /** Clave para pistas sin tablatura: G o F. */
  clef?: "G" | "F";
  /** Transposición escrita (la guitarra se escribe una octava arriba). */
  transpose?: number;
  /** Para baterías: piezas del kit (ids de articulación de alphaTab). */
  kit?: number[];
}

export const TUNINGS: Record<string, { name: string; strings: number[] }> = {
  std: { name: "Estándar (E A D G B E)", strings: [64, 59, 55, 50, 45, 40] },
  dropD: { name: "Drop D", strings: [64, 59, 55, 50, 45, 38] },
  halfDown: { name: "Medio tono abajo (Eb)", strings: [63, 58, 54, 49, 44, 39] },
  dStd: { name: "Re estándar (D)", strings: [62, 57, 53, 48, 43, 38] },
  dropC: { name: "Drop C", strings: [62, 57, 53, 48, 43, 36] },
  dadgad: { name: "DADGAD", strings: [62, 57, 55, 50, 45, 38] },
  openG: { name: "Open G", strings: [62, 59, 55, 50, 43, 38] },
  openD: { name: "Open D", strings: [62, 57, 54, 50, 45, 38] },
  seven: { name: "7 cuerdas (B)", strings: [64, 59, 55, 50, 45, 40, 35] },
  bass4: { name: "Bajo 4 (E A D G)", strings: [43, 38, 33, 28] },
  bass5: { name: "Bajo 5 (B E A D G)", strings: [43, 38, 33, 28, 23] },
  bassDropD: { name: "Bajo Drop D", strings: [43, 38, 33, 26] },
  requinto: { name: "Requinto (A D G C E A)", strings: [69, 64, 60, 55, 50, 45] },
  bajoSexto: { name: "Bajo sexto (E A D G C F)", strings: [65, 60, 55, 50, 45, 40] },
  vihuela: { name: "Vihuela (A D G B E)", strings: [64, 59, 67, 62, 57] },
  guitarron: { name: "Guitarrón (A D G C E A)", strings: [57, 52, 48, 43, 38, 33] },
  ukulele: { name: "Ukulele (G C E A)", strings: [69, 64, 60, 67] },
  mandolin: { name: "Mandolina (G D A E)", strings: [76, 69, 62, 55] },
  banjo: { name: "Banjo (gDGBD)", strings: [62, 59, 55, 50, 67] },
};

// Piezas del kit: id de articulación (alphaTab/GP7) con nombre en español.
export const DRUM_PIECES: { id: number; name: string; short: string }[] = [
  { id: 49, name: "Crash", short: "Cr" },
  { id: 57, name: "Crash 2", short: "Cr2" },
  { id: 55, name: "Splash", short: "Spl" },
  { id: 52, name: "China", short: "Ch" },
  { id: 51, name: "Ride", short: "Rd" },
  { id: 53, name: "Campana del ride", short: "Bell" },
  { id: 46, name: "Hi-hat abierto", short: "HHa" },
  { id: 42, name: "Hi-hat cerrado", short: "HHc" },
  { id: 44, name: "Hi-hat pedal", short: "HHp" },
  { id: 50, name: "Tom muy agudo", short: "T1" },
  { id: 48, name: "Tom agudo", short: "T2" },
  { id: 47, name: "Tom medio", short: "T3" },
  { id: 45, name: "Tom grave", short: "T4" },
  { id: 43, name: "Tom de piso", short: "TP" },
  { id: 38, name: "Caja", short: "Cj" },
  { id: 37, name: "Aro (side stick)", short: "Aro" },
  { id: 39, name: "Palmas", short: "Pal" },
  { id: 36, name: "Bombo", short: "Bo" },
  { id: 35, name: "Bombo acústico", short: "Bo2" },
  { id: 54, name: "Pandero", short: "Pan" },
  { id: 56, name: "Cencerro", short: "Cen" },
];
export const LATIN_PIECES: { id: number; name: string; short: string }[] = [
  { id: 65, name: "Timbal alto", short: "TbA" },
  { id: 66, name: "Timbal bajo", short: "TbB" },
  { id: 56, name: "Cencerro", short: "Cen" },
  { id: 60, name: "Bongó agudo", short: "BgA" },
  { id: 61, name: "Bongó grave", short: "BgG" },
  { id: 62, name: "Conga apagada", short: "CgX" },
  { id: 63, name: "Conga abierta", short: "Cga" },
  { id: 64, name: "Tumbadora", short: "Tum" },
  { id: 73, name: "Güiro corto", short: "Gü" },
  { id: 74, name: "Güiro largo", short: "Gü2" },
  { id: 70, name: "Maracas", short: "Mar" },
  { id: 75, name: "Claves", short: "Cla" },
  { id: 69, name: "Cabasa", short: "Cab" },
  { id: 82, name: "Shaker", short: "Shk" },
  { id: 85, name: "Castañuelas", short: "Cas" },
  { id: 54, name: "Pandero", short: "Pan" },
  { id: 81, name: "Triángulo", short: "Tri" },
];
const KIT = DRUM_PIECES.map((p) => p.id);
const LATIN = LATIN_PIECES.map((p) => p.id);

const T = TUNINGS;
export const PRESETS: Preset[] = [
  // Guitarras y cuerdas pulsadas
  { id: "gtr_nylon", name: "Guitarra de nylon", group: "Guitarras", kind: "tab", program: 24, tuning: T.std.strings, notation: true, transpose: 12 },
  { id: "gtr_steel", name: "Guitarra acústica", group: "Guitarras", kind: "tab", program: 25, tuning: T.std.strings, notation: true, transpose: 12 },
  { id: "gtr_jazz", name: "Guitarra de jazz", group: "Guitarras", kind: "tab", program: 26, tuning: T.std.strings, notation: true, transpose: 12 },
  { id: "gtr_clean", name: "Eléctrica limpia", group: "Guitarras", kind: "tab", program: 27, tuning: T.std.strings, notation: true, transpose: 12 },
  { id: "gtr_muted", name: "Eléctrica apagada (funk)", group: "Guitarras", kind: "tab", program: 28, tuning: T.std.strings, notation: true, transpose: 12 },
  { id: "gtr_od", name: "Eléctrica con overdrive", group: "Guitarras", kind: "tab", program: 29, tuning: T.std.strings, notation: true, transpose: 12 },
  { id: "gtr_dist", name: "Eléctrica distorsionada", group: "Guitarras", kind: "tab", program: 30, tuning: T.std.strings, notation: true, transpose: 12 },
  { id: "gtr_7", name: "Guitarra 7 cuerdas", group: "Guitarras", kind: "tab", program: 30, tuning: T.seven.strings, notation: true, transpose: 12 },
  { id: "requinto", name: "Requinto", group: "Guitarras", kind: "tab", program: 24, tuning: T.requinto.strings, notation: true, transpose: 12 },
  { id: "bajo_sexto", name: "Bajo sexto", group: "Guitarras", kind: "tab", program: 25, tuning: T.bajoSexto.strings, notation: true, transpose: 12 },
  { id: "vihuela", name: "Vihuela", group: "Guitarras", kind: "tab", program: 24, tuning: T.vihuela.strings, notation: true, transpose: 12 },
  { id: "ukulele", name: "Ukulele", group: "Guitarras", kind: "tab", program: 24, tuning: T.ukulele.strings, notation: true },
  { id: "mandolin", name: "Mandolina", group: "Guitarras", kind: "tab", program: 25, tuning: T.mandolin.strings, notation: true },
  { id: "banjo", name: "Banjo", group: "Guitarras", kind: "tab", program: 105, tuning: T.banjo.strings, notation: true, transpose: 12 },
  // Bajos
  { id: "bass_finger", name: "Bajo eléctrico (dedos)", group: "Bajos", kind: "tab", program: 33, tuning: T.bass4.strings, notation: true, transpose: 12 },
  { id: "bass_pick", name: "Bajo con púa", group: "Bajos", kind: "tab", program: 34, tuning: T.bass4.strings, notation: true, transpose: 12 },
  { id: "bass_slap", name: "Bajo slap", group: "Bajos", kind: "tab", program: 36, tuning: T.bass4.strings, notation: true, transpose: 12 },
  { id: "bass_fretless", name: "Bajo sin trastes", group: "Bajos", kind: "tab", program: 35, tuning: T.bass4.strings, notation: true, transpose: 12 },
  { id: "bass_5", name: "Bajo 5 cuerdas", group: "Bajos", kind: "tab", program: 33, tuning: T.bass5.strings, notation: true, transpose: 12 },
  { id: "tololoche", name: "Tololoche / contrabajo", group: "Bajos", kind: "tab", program: 32, tuning: T.bass4.strings, notation: true, transpose: 12 },
  { id: "guitarron", name: "Guitarrón", group: "Bajos", kind: "tab", program: 32, tuning: T.guitarron.strings, notation: true, transpose: 12 },
  { id: "synbass", name: "Bajo de sintetizador", group: "Bajos", kind: "notation", program: 38, clef: "F" },
  { id: "synbass2", name: "Bajo sinte (808/sub)", group: "Bajos", kind: "notation", program: 39, clef: "F" },
  // Teclados
  { id: "piano", name: "Piano", group: "Teclados", kind: "notation", program: 0, clef: "G" },
  { id: "piano_bright", name: "Piano brillante", group: "Teclados", kind: "notation", program: 1, clef: "G" },
  { id: "rhodes", name: "Piano eléctrico (Rhodes)", group: "Teclados", kind: "notation", program: 4, clef: "G" },
  { id: "dx7", name: "Piano FM (DX7, 80s)", group: "Teclados", kind: "notation", program: 5, clef: "G" },
  { id: "clavinet", name: "Clavinet", group: "Teclados", kind: "notation", program: 7, clef: "G" },
  { id: "harpsichord", name: "Clavecín (barroco)", group: "Teclados", kind: "notation", program: 6, clef: "G" },
  { id: "organ", name: "Órgano Hammond", group: "Teclados", kind: "notation", program: 16, clef: "G" },
  { id: "organ_rock", name: "Órgano de rock", group: "Teclados", kind: "notation", program: 18, clef: "G" },
  { id: "organ_church", name: "Órgano de iglesia", group: "Teclados", kind: "notation", program: 19, clef: "G" },
  { id: "accordion", name: "Acordeón", group: "Teclados", kind: "notation", program: 21, clef: "G" },
  { id: "vibes", name: "Vibráfono", group: "Teclados", kind: "notation", program: 11, clef: "G" },
  { id: "marimba", name: "Marimba", group: "Teclados", kind: "notation", program: 12, clef: "G" },
  // Cuerdas y voces
  { id: "violin", name: "Violín", group: "Cuerdas y voces", kind: "notation", program: 40, clef: "G" },
  { id: "viola", name: "Viola", group: "Cuerdas y voces", kind: "notation", program: 41, clef: "G" },
  { id: "cello", name: "Chelo", group: "Cuerdas y voces", kind: "notation", program: 42, clef: "F" },
  { id: "strings", name: "Ensamble de cuerdas", group: "Cuerdas y voces", kind: "notation", program: 48, clef: "G" },
  { id: "strings_slow", name: "Cuerdas lentas", group: "Cuerdas y voces", kind: "notation", program: 49, clef: "G" },
  { id: "pizz", name: "Cuerdas pizzicato", group: "Cuerdas y voces", kind: "notation", program: 45, clef: "G" },
  { id: "harp", name: "Arpa", group: "Cuerdas y voces", kind: "notation", program: 46, clef: "G" },
  { id: "choir", name: "Coro (aahs)", group: "Cuerdas y voces", kind: "notation", program: 52, clef: "G" },
  { id: "voice", name: "Voz (oohs)", group: "Cuerdas y voces", kind: "notation", program: 53, clef: "G" },
  // Vientos
  { id: "trumpet", name: "Trompeta", group: "Vientos", kind: "notation", program: 56, clef: "G" },
  { id: "trumpet_mute", name: "Trompeta con sordina", group: "Vientos", kind: "notation", program: 59, clef: "G" },
  { id: "trombone", name: "Trombón", group: "Vientos", kind: "notation", program: 57, clef: "F" },
  { id: "tuba", name: "Tuba / charcheta", group: "Vientos", kind: "notation", program: 58, clef: "F" },
  { id: "horn", name: "Corno francés", group: "Vientos", kind: "notation", program: 60, clef: "G" },
  { id: "brass", name: "Sección de metales", group: "Vientos", kind: "notation", program: 61, clef: "G" },
  { id: "sax_alto", name: "Saxofón alto", group: "Vientos", kind: "notation", program: 65, clef: "G" },
  { id: "sax_tenor", name: "Saxofón tenor", group: "Vientos", kind: "notation", program: 66, clef: "G" },
  { id: "sax_bari", name: "Saxofón barítono", group: "Vientos", kind: "notation", program: 67, clef: "F" },
  { id: "clarinet", name: "Clarinete", group: "Vientos", kind: "notation", program: 71, clef: "G" },
  { id: "flute", name: "Flauta", group: "Vientos", kind: "notation", program: 73, clef: "G" },
  { id: "panflute", name: "Flauta de pan", group: "Vientos", kind: "notation", program: 75, clef: "G" },
  { id: "harmonica", name: "Armónica", group: "Vientos", kind: "notation", program: 22, clef: "G" },
  // Sintetizadores
  { id: "lead_square", name: "Lead cuadrado", group: "Sintetizadores", kind: "notation", program: 80, clef: "G" },
  { id: "lead_saw", name: "Lead sierra", group: "Sintetizadores", kind: "notation", program: 81, clef: "G" },
  { id: "pad_warm", name: "Pad cálido", group: "Sintetizadores", kind: "notation", program: 89, clef: "G" },
  { id: "pad_poly", name: "Polysynth (80s)", group: "Sintetizadores", kind: "notation", program: 90, clef: "G" },
  { id: "pad_halo", name: "Pad halo", group: "Sintetizadores", kind: "notation", program: 94, clef: "G" },
  { id: "pad_sweep", name: "Pad sweep", group: "Sintetizadores", kind: "notation", program: 95, clef: "G" },
  { id: "synth_brass", name: "Metales de sinte", group: "Sintetizadores", kind: "notation", program: 62, clef: "G" },
  { id: "synth_strings", name: "Cuerdas de sinte", group: "Sintetizadores", kind: "notation", program: 50, clef: "G" },
  { id: "orch_hit", name: "Orchestra hit (90s)", group: "Sintetizadores", kind: "notation", program: 55, clef: "G" },
  // Percusión (programa = kit GS en el canal 10)
  { id: "drums", name: "Batería estándar", group: "Percusión", kind: "drums", program: 0, kit: KIT },
  { id: "drums_room", name: "Batería de cuarto", group: "Percusión", kind: "drums", program: 8, kit: KIT },
  { id: "drums_power", name: "Batería power (rock)", group: "Percusión", kind: "drums", program: 16, kit: KIT },
  { id: "drums_jazz", name: "Batería de jazz", group: "Percusión", kind: "drums", program: 32, kit: KIT },
  { id: "drums_brush", name: "Batería con escobillas", group: "Percusión", kind: "drums", program: 40, kit: KIT },
  { id: "drums_electronic", name: "Batería electrónica", group: "Percusión", kind: "drums", program: 24, kit: KIT },
  { id: "drums_808", name: "TR-808", group: "Percusión", kind: "drums", program: 25, kit: KIT },
  { id: "latin", name: "Percusión latina", group: "Percusión", kind: "drums", program: 0, kit: LATIN },
];
export const presetById = (id: string) => PRESETS.find((p) => p.id === id);

export interface StyleTemplate {
  id: string;
  name: string;
  era: string;
  tempo: number;
  tracks: { preset: string; name: string; tuning?: string }[];
}
export const STYLES: StyleTemplate[] = [
  { id: "blank_gtr", name: "Hoja en blanco (guitarra)", era: "", tempo: 100, tracks: [{ preset: "gtr_clean", name: "Guitarra" }] },
  { id: "classic_rock", name: "Classic rock", era: "60s–70s", tempo: 120, tracks: [{ preset: "gtr_od", name: "Guitarra" }, { preset: "bass_pick", name: "Bajo" }, { preset: "organ_rock", name: "Órgano" }, { preset: "drums_room", name: "Batería" }] },
  { id: "hard_rock", name: "Hard rock", era: "70s–80s", tempo: 132, tracks: [{ preset: "gtr_dist", name: "Guitarra rítmica" }, { preset: "gtr_dist", name: "Guitarra líder" }, { preset: "bass_pick", name: "Bajo" }, { preset: "drums_power", name: "Batería" }] },
  { id: "post_punk", name: "Post punk", era: "late 70s–80s", tempo: 140, tracks: [{ preset: "gtr_clean", name: "Guitarra" }, { preset: "bass_pick", name: "Bajo" }, { preset: "pad_poly", name: "Sinte" }, { preset: "drums_room", name: "Batería" }] },
  { id: "grunge", name: "Grunge", era: "90s", tempo: 116, tracks: [{ preset: "gtr_dist", name: "Guitarra", tuning: "dropD" }, { preset: "bass_pick", name: "Bajo", tuning: "bassDropD" }, { preset: "drums_power", name: "Batería" }] },
  { id: "shoegaze", name: "Shoegaze", era: "90s", tempo: 110, tracks: [{ preset: "gtr_dist", name: "Guitarra muro" }, { preset: "gtr_clean", name: "Guitarra limpia" }, { preset: "bass_finger", name: "Bajo" }, { preset: "pad_halo", name: "Pad" }, { preset: "drums", name: "Batería" }] },
  { id: "indie", name: "Indie rock", era: "2000s", tempo: 124, tracks: [{ preset: "gtr_clean", name: "Guitarra 1" }, { preset: "gtr_od", name: "Guitarra 2" }, { preset: "bass_pick", name: "Bajo" }, { preset: "drums", name: "Batería" }] },
  { id: "math_rock", name: "Math rock", era: "2000s–hoy", tempo: 150, tracks: [{ preset: "gtr_clean", name: "Guitarra tapping" }, { preset: "gtr_clean", name: "Guitarra 2" }, { preset: "bass_finger", name: "Bajo" }, { preset: "drums", name: "Batería" }] },
  { id: "jazz", name: "Jazz trío", era: "50s–60s", tempo: 140, tracks: [{ preset: "piano", name: "Piano" }, { preset: "tololoche", name: "Contrabajo" }, { preset: "drums_brush", name: "Batería" }, { preset: "gtr_jazz", name: "Guitarra" }] },
  { id: "bossa", name: "Bossa nova", era: "60s", tempo: 128, tracks: [{ preset: "gtr_nylon", name: "Violão" }, { preset: "bass_finger", name: "Bajo" }, { preset: "rhodes", name: "Rhodes" }, { preset: "flute", name: "Flauta" }, { preset: "drums_brush", name: "Batería" }] },
  { id: "funk", name: "Funk", era: "70s", tempo: 104, tracks: [{ preset: "gtr_muted", name: "Guitarra" }, { preset: "bass_slap", name: "Bajo slap" }, { preset: "clavinet", name: "Clavinet" }, { preset: "brass", name: "Metales" }, { preset: "drums", name: "Batería" }] },
  { id: "disco", name: "Disco", era: "70s", tempo: 120, tracks: [{ preset: "gtr_muted", name: "Guitarra" }, { preset: "bass_finger", name: "Bajo" }, { preset: "strings", name: "Cuerdas" }, { preset: "piano_bright", name: "Piano" }, { preset: "drums", name: "Batería" }] },
  { id: "eighties_pop", name: "Pop 80s", era: "80s", tempo: 118, tracks: [{ preset: "dx7", name: "Piano FM" }, { preset: "pad_poly", name: "Polysynth" }, { preset: "synbass", name: "Bajo sinte" }, { preset: "gtr_clean", name: "Guitarra" }, { preset: "drums_electronic", name: "Batería" }] },
  { id: "pop", name: "Pop actual", era: "hoy", tempo: 100, tracks: [{ preset: "piano", name: "Piano" }, { preset: "gtr_steel", name: "Guitarra" }, { preset: "synbass2", name: "Bajo" }, { preset: "pad_warm", name: "Pad" }, { preset: "drums_electronic", name: "Batería" }] },
  { id: "house", name: "House / dance", era: "90s–hoy", tempo: 124, tracks: [{ preset: "synbass2", name: "Bajo" }, { preset: "rhodes", name: "Acordes" }, { preset: "lead_saw", name: "Lead" }, { preset: "drums_808", name: "Batería 808" }] },
  { id: "techno", name: "Techno / electro", era: "90s–hoy", tempo: 132, tracks: [{ preset: "synbass", name: "Bajo" }, { preset: "lead_square", name: "Secuencia" }, { preset: "pad_sweep", name: "Pad" }, { preset: "drums_808", name: "Batería 808" }] },
  { id: "hiphop", name: "Hip hop", era: "90s–hoy", tempo: 90, tracks: [{ preset: "rhodes", name: "Rhodes" }, { preset: "synbass2", name: "Bajo 808" }, { preset: "strings", name: "Cuerdas" }, { preset: "drums_808", name: "Batería" }] },
  { id: "bolero", name: "Bolero", era: "40s–60s", tempo: 76, tracks: [{ preset: "requinto", name: "Requinto" }, { preset: "gtr_nylon", name: "Guitarra" }, { preset: "tololoche", name: "Contrabajo" }, { preset: "latin", name: "Percusión" }] },
  { id: "corrido_clasico", name: "Corrido clásico (norteño)", era: "70s–90s", tempo: 112, tracks: [{ preset: "accordion", name: "Acordeón" }, { preset: "bajo_sexto", name: "Bajo sexto" }, { preset: "bass_finger", name: "Bajo" }, { preset: "drums", name: "Batería" }] },
  { id: "corrido_moderno", name: "Corrido moderno (tumbado)", era: "hoy", tempo: 100, tracks: [{ preset: "requinto", name: "Requinto" }, { preset: "gtr_steel", name: "Guitarra" }, { preset: "tuba", name: "Charcheta" }, { preset: "tololoche", name: "Tololoche" }] },
  { id: "mariachi", name: "Mariachi", era: "clásico", tempo: 120, tracks: [{ preset: "trumpet", name: "Trompeta 1" }, { preset: "trumpet", name: "Trompeta 2" }, { preset: "violin", name: "Violines" }, { preset: "vihuela", name: "Vihuela" }, { preset: "gtr_nylon", name: "Guitarra" }, { preset: "guitarron", name: "Guitarrón" }] },
  { id: "oldies", name: "Oldies / doo-wop", era: "50s–60s", tempo: 96, tracks: [{ preset: "piano", name: "Piano" }, { preset: "gtr_clean", name: "Guitarra" }, { preset: "bass_finger", name: "Bajo" }, { preset: "sax_tenor", name: "Saxofón" }, { preset: "voice", name: "Coros" }, { preset: "drums_room", name: "Batería" }] },
  { id: "baroque", name: "Barroco", era: "1600–1750", tempo: 88, tracks: [{ preset: "harpsichord", name: "Clavecín" }, { preset: "violin", name: "Violín" }, { preset: "cello", name: "Chelo" }] },
];
export const styleById = (id: string) => STYLES.find((s) => s.id === id);

/** Los 128 sonidos General MIDI (los bancos de MusicFees los traen todos). */
export const GM_NAMES: string[] = [
  "Piano de cola", "Piano brillante", "Piano eléctrico de cola", "Piano de cantina", "Piano eléctrico (Rhodes)", "Piano eléctrico (FM)", "Clavecín", "Clavinet",
  "Celesta", "Glockenspiel", "Caja de música", "Vibráfono", "Marimba", "Xilófono", "Campanas tubulares", "Dulcimer",
  "Órgano de barras", "Órgano percusivo", "Órgano de rock", "Órgano de iglesia", "Armonio", "Acordeón", "Armónica", "Bandoneón",
  "Guitarra de nylon", "Guitarra acústica", "Guitarra de jazz", "Eléctrica limpia", "Eléctrica apagada", "Eléctrica con overdrive", "Eléctrica distorsionada", "Armónicos de guitarra",
  "Bajo acústico", "Bajo eléctrico (dedos)", "Bajo eléctrico (púa)", "Bajo sin trastes", "Bajo slap 1", "Bajo slap 2", "Bajo sintetizado 1", "Bajo sintetizado 2",
  "Violín", "Viola", "Violonchelo", "Contrabajo", "Cuerdas en trémolo", "Cuerdas pizzicato", "Arpa", "Timbales sinfónicos",
  "Ensamble de cuerdas 1", "Ensamble de cuerdas 2", "Cuerdas sintetizadas 1", "Cuerdas sintetizadas 2", "Coro «aah»", "Voz «ooh»", "Voz sintetizada", "Golpe de orquesta",
  "Trompeta", "Trombón", "Tuba", "Trompeta con sordina", "Corno francés", "Sección de metales", "Metales sintetizados 1", "Metales sintetizados 2",
  "Saxofón soprano", "Saxofón alto", "Saxofón tenor", "Saxofón barítono", "Oboe", "Corno inglés", "Fagot", "Clarinete",
  "Flautín", "Flauta", "Flauta dulce", "Flauta de pan", "Botella soplada", "Shakuhachi", "Silbido", "Ocarina",
  "Sinte: onda cuadrada", "Sinte: diente de sierra", "Sinte: calíope", "Sinte: chiff", "Sinte: charango", "Sinte: voz", "Sinte: quintas", "Sinte: bajo y lead",
  "Pad: new age", "Pad: cálido", "Pad: polisintetizador", "Pad: coro", "Pad: arco", "Pad: metálico", "Pad: halo", "Pad: barrido",
  "FX: lluvia", "FX: banda sonora", "FX: cristal", "FX: atmósfera", "FX: brillo", "FX: duendes", "FX: ecos", "FX: ciencia ficción",
  "Sitar", "Banjo", "Shamisen", "Koto", "Kalimba", "Gaita", "Violín folk", "Shehnai",
  "Campanita", "Agogó", "Tambores metálicos (steel drum)", "Caja china", "Taiko", "Tom melódico", "Tambor sintetizado", "Platillo al revés",
  "Ruido de traste", "Respiración", "Mar", "Pájaro", "Teléfono", "Helicóptero", "Aplausos", "Disparo",
];
export const gmName = (p: number) => GM_NAMES[p] ?? `Sonido ${p}`;
