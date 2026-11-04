// Importar tablaturas desde PDF digitales: PDF → primitivas (pdf.js) → tablatura → alphaTex → canción.
import { extractPages } from "./pdfextract";
import { readTabs, type TabReading } from "./pdftab";
import { findMeter, findTempo, toAlphaTex } from "./totex";

export interface PdfTabResult { tex: string; reading: TabReading; meter: [number, number]; tempo?: number }

export async function pdfToTex(pdfjs: any, bytes: Uint8Array, title: string): Promise<PdfTabResult> {
  const pages = await extractPages(pdfjs, bytes);
  const reading = readTabs(pages);
  if (!reading.bars.some((b) => b.columns.length)) throw new Error(reading.warnings[0] ?? "No encontré tablaturas en el PDF.");
  const meter = findMeter(pages), tempo = findTempo(pages);
  return { tex: toAlphaTex(reading, { title, tempo, meter }), reading, meter, tempo };
}
