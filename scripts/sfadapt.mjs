// Adapta un SoundFont 2/3 para el sintetizador de alphaTab. Lo usan la app (en el navegador,
// al cargar un banco descargado) y las pruebas. El otro motor (efectos) recibe el archivo original.
//
// Correcciones (medidas sintetizando cada instrumento fuera de línea):
// 1. alphaTab solo toca muestras mono: los pares estéreo pasan a mono con paneo −50 %/+50 %.
// 2. La atenuación inicial se guarda al 40 %, como la aplica FluidSynth (para lo que se afinó el banco).
// 3. alphaTab no aplica moduladores: los de velocidad → filtro se fijan en generadores (velocidad 100).
// 4. alphaTab suma la atenuación de la zona global y la de cada zona: se guarda la diferencia.
// ---------- lectura y escritura de RIFF (SoundFont 2) ----------
function readChunks(buf, start, end) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = [];
  let p = start;
  while (p + 8 <= end) {
    const id = String.fromCharCode(...buf.subarray(p, p + 4));
    const size = dv.getUint32(p + 4, true);
    out.push({ id, size, data: buf.subarray(p + 8, p + 8 + size) });
    p += 8 + size + (size & 1);
  }
  return out;
}
function chunk(id, data) {
  const pad = data.length & 1;
  const b = new Uint8Array(8 + data.length + pad);
  b.set(new TextEncoder().encode(id), 0);
  new DataView(b.buffer).setUint32(4, data.length, true);
  b.set(data, 8);
  return b;
}
const concat = (parts) => {
  const b = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of parts) { b.set(x, o); o += x.length; }
  return b;
};

const ATTEN = 48, PAN = 17, SAMPLE = 53, INSTRUMENT = 41, FILTER_FC = 8, MODENV_TO_FC = 11;
const ATTEN_SCALE = 0.4;
// Velocidad de referencia para fijar lo que en FluidSynth hacen los moduladores de velocidad.
const REF_VELOCITY = 100 / 127;

const u16 = (b, dv) => Array.from({ length: b.length / 4 }, (_, i) => [dv.getUint16(i * 4, true), dv.getUint16(i * 4 + 2, true)]);
const view = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** Valor que aporta un modulador de velocidad lineal (los únicos que se fijan aquí). */
function velocityDelta(src, amount) {
  if (src === 2) return amount * REF_VELOCITY; // velocidad, unipolar positivo
  if (src === 258) return amount * (1 - REF_VELOCITY); // velocidad, unipolar negativo
  return 0;
}

/**
 * Reescribe un nivel (presets o instrumentos): bolsas, generadores y moduladores.
 * - Escala la atenuación inicial al 40 % (FluidSynth).
 * - alphaTab no aplica moduladores: los de velocidad → filtro (corte y envolvente de modulación)
 *   se convierten en generadores fijos calculados a velocidad 100. Sin esto, el piano de
 *   MuseScore_General suena tras un filtro cerrado a ~300 Hz: apagado y casi mudo.
 * - Compensa que alphaTab suma la atenuación global y la de cada zona.
 * - En instrumentos, `perZone` agrega el paneo de los pares estéreo.
 */
function rebuildLevel(bagIn, genIn, modIn, terminalOp, defaults, perZone) {
  const bags = u16(bagIn, view(bagIn));
  const gdv = view(genIn), mdv = view(modIn);
  const gens = Array.from({ length: genIn.length / 4 }, (_, i) => [gdv.getUint16(i * 4, true), gdv.getInt16(i * 4 + 2, true)]);
  const mods = Array.from({ length: modIn.length / 10 }, (_, i) => ({ src: mdv.getUint16(i * 10, true), dest: mdv.getUint16(i * 10 + 2, true), amt: mdv.getInt16(i * 10 + 4, true), amtSrc: mdv.getUint16(i * 10 + 6, true), trans: mdv.getUint16(i * 10 + 8, true) }));
  for (const g of gens) if (g[0] === ATTEN) g[1] = Math.round(g[1] * ATTEN_SCALE);

  const newGens = [], newBags = [];
  let global = null, fixed = 0, extra = 0;
  // Las bolsas de un mismo preset/instrumento van seguidas; una sin generador terminal es la global
  // y sus moduladores los heredan las demás zonas de ese grupo. `firstOfGroup` marca dónde empieza.
  const firstOfGroup = new Set(bagIn.groupStarts);
  for (let b = 0; b < bags.length; b++) {
    newBags.push([newGens.length, bags[b][1]]);
    if (b === bags.length - 1) break;
    if (firstOfGroup.has(b)) global = null;
    const zone = gens.slice(bags[b][0], bags[b + 1][0]);
    const zmods = mods.slice(bags[b][1], bags[b + 1][1]);
    const isGlobal = !zone.some(([op]) => op === terminalOp);
    if (isGlobal) { global = { zone, mods: zmods }; newGens.push(...zone); continue; }
    // Moduladores efectivos: los de la zona reemplazan a los globales con la misma fuente y destino.
    const eff = new Map();
    for (const m of [...(global?.mods ?? []), ...zmods]) eff.set(`${m.src}:${m.dest}:${m.amtSrc}`, m);
    for (const dest of [FILTER_FC, MODENV_TO_FC]) {
      let delta = 0;
      for (const m of eff.values()) if (m.dest === dest && m.amtSrc === 0 && m.trans === 0) delta += velocityDelta(m.src, m.amt);
      if (!delta) continue;
      const base = zone.find(([op]) => op === dest)?.[1] ?? global?.zone.find(([op]) => op === dest)?.[1] ?? defaults[dest];
      const val = Math.max(-12000, Math.min(13500, Math.round(base + delta)));
      const i = zone.findIndex(([op]) => op === dest);
      if (i >= 0) zone[i][1] = val; else zone.splice(zone.length - 1, 0, [dest, val]);
      fixed++;
    }
    // alphaTab suma la atenuación de la zona global y la de la zona (en SF2 la de la zona reemplaza
    // a la global): se guarda la diferencia para que la suma dé el valor correcto.
    const gAtt = global?.zone.find(([op]) => op === ATTEN)?.[1];
    const lAtt = zone.findIndex(([op]) => op === ATTEN);
    if (gAtt !== undefined && lAtt >= 0) { zone[lAtt][1] -= gAtt; fixed++; }
    extra += perZone ? perZone(zone) : 0;
    newGens.push(...zone);
  }
  newGens.push(...gens.slice(bags[bags.length - 1][0])); // registro final
  const bagOut = new Uint8Array(newBags.length * 4), genOut = new Uint8Array(newGens.length * 4);
  const bo = view(bagOut), go = view(genOut);
  newBags.forEach(([g, m], i) => { bo.setUint16(i * 4, g, true); bo.setUint16(i * 4 + 2, m, true); });
  newGens.forEach(([op, v], i) => { go.setUint16(i * 4, op, true); go.setInt16(i * 4 + 2, v, true); });
  return { bagOut, genOut, fixed, extra };
}

/** Adapta un SoundFont para alphaTab. Devuelve el archivo nuevo y un resumen de lo corregido. */
export function adaptForAlphaTab(sf) {
  const top = view(sf);
  if (String.fromCharCode(...sf.subarray(0, 4)) !== "RIFF" || String.fromCharCode(...sf.subarray(8, 12)) !== "sfbk") throw new Error("No es un SoundFont 2/3.");
  const lists = readChunks(sf, 12, Math.min(sf.length, 8 + top.getUint32(4, true)));
  const pdtaIdx = lists.findIndex((c) => c.id === "LIST" && String.fromCharCode(...c.data.subarray(0, 4)) === "pdta");
  if (pdtaIdx < 0) throw new Error("El SoundFont no trae datos de presets (pdta).");
  const sub = readChunks(lists[pdtaIdx].data, 4, lists[pdtaIdx].data.length);
  const get = (id) => sub.find((c) => c.id === id).data;

  const shdr = new Uint8Array(get("shdr"));
  const sdv = view(shdr);
  const typeOf = (s) => sdv.getUint16(s * 46 + 44, true);

  // Dónde empieza cada preset / instrumento dentro de sus bolsas.
  const starts = (hdr, size, off) => { const dv = view(hdr); return Array.from({ length: hdr.length / size }, (_, i) => dv.getUint16(i * size + off, true)); };
  const pbag = get("pbag"), ibag = get("ibag");
  pbag.groupStarts = starts(get("phdr"), 38, 24);
  ibag.groupStarts = starts(get("inst"), 22, 20);

  const P = rebuildLevel(pbag, get("pgen"), get("pmod"), INSTRUMENT, { [FILTER_FC]: 0, [MODENV_TO_FC]: 0 });
  const I = rebuildLevel(ibag, get("igen"), get("imod"), SAMPLE, { [FILTER_FC]: 13500, [MODENV_TO_FC]: 0 }, (zone) => {
    const s = zone[zone.length - 1][1] & 0xffff, t = typeOf(s);
    const side = (t & 4) ? -500 : (t & 2) ? 500 : 0; // 4 = izquierda, 2 = derecha
    if (side && !zone.some(([op]) => op === PAN)) { zone.splice(zone.length - 1, 0, [PAN, side]); return 1; }
    return 0;
  });
  // Los pares estéreo pasan a ser mono (bit 1) conservando la marca de Vorbis (bit 16).
  for (let s = 0; s < shdr.length / 46 - 1; s++) { const t = typeOf(s); if (t & 6) sdv.setUint16(s * 46 + 44, (t & 16) | 1, true); }

  const out = { pbag: P.bagOut, pgen: P.genOut, ibag: I.bagOut, igen: I.genOut, shdr };
  const pdta = concat([new TextEncoder().encode("pdta"), ...sub.map((c) => chunk(c.id, out[c.id] ?? c.data))]);
  const body = concat([new TextEncoder().encode("sfbk"), ...lists.map((c, i) => (i === pdtaIdx ? chunk("LIST", pdta) : chunk(c.id, c.data)))]);
  return { bytes: chunk("RIFF", body), stereo: I.extra, filters: P.fixed + I.fixed };
}

