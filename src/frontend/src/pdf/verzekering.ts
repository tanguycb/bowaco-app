// "Gegevens voor de verzekering" als PDF (stap 2c.8, ontwerp 2c §6): voor de makelaar of verzekeraar. Enkel kantoor maakt ze (werfwaarde
// vraagt #readCosts). Werf, adres, bouwheer, architect, start en einde, werfwaarde met btw-tarief, periode, soort, polis, verzekeraar en makelaar.
// Geen OA-prijzen, geen aankoopgegevens, geen marges: wat niet in InsuranceSheetPdfData staat, kan niet in de PDF komen.
// Zonder React en zonder backend-imports: Node draait dit bestand rechtstreeks.
import type { PdfFonts } from "./offerte.ts";

export type InsuranceSheetPdfData = {
  kindName: string; policyRef: string; insurer: string; broker: string; period: string;
  workCode: string; workName: string; address: string; client: string; architect: string;
  start: string; end: string; workValue: string; vat: string; madeOn: string;
};

/** De regels van het document (label, waarde), ook voor de test. */
export function insuranceSheetRows(d: InsuranceSheetPdfData): [string, string][] {
  return [
    ["Werf", `${d.workCode} · ${d.workName}`], ["Adres van de werf", d.address], ["Bouwheer", d.client || "—"], ["Architect", d.architect || "—"],
    ["Start van de werken", d.start], ["Einde van de werken", d.end], ["Werfwaarde (excl. btw)", d.workValue], ["Btw-tarief", d.vat],
    ["Verzekering", d.kindName], ["Polisnummer", d.policyRef || "—"], ["Periode", d.period], ["Verzekeraar", d.insurer || "—"], ["Makelaar", d.broker || "—"],
  ];
}

const INK: [number, number, number] = [0.059, 0.071, 0.094];
const GRAY: [number, number, number] = [0.325, 0.357, 0.412];
const LINE: [number, number, number] = [0.882, 0.894, 0.914];
const BRAND: [number, number, number] = [0.118, 0.122, 0.255];

export async function insuranceSheetPdf(d: InsuranceSheetPdfData, fonts: PdfFonts): Promise<Uint8Array> {
  const { PDFDocument, rgb } = await import("pdf-lib");
  const fontkit = (await import("@pdf-lib/fontkit")).default;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`Gegevens voor de verzekering – ${d.workCode}`);
  doc.setAuthor("BOWACO");
  doc.setProducer("BOWACO werfbeheer (pdf-lib)");
  const r = await doc.embedFont(fonts.regular, { subset: true });
  const m = await doc.embedFont(fonts.medium, { subset: true });
  const b = await doc.embedFont(fonts.bold, { subset: true });
  const known = new Set(r.getCharacterSet());
  const clean = (s: string) => { let o = ""; for (const ch of s.replace(/ /g, " ")) o += known.has(ch.codePointAt(0)!) ? ch : "?"; return o; };
  const page = doc.addPage([595.28, 841.89]);
  const col = (c: [number, number, number]) => rgb(c[0], c[1], c[2]);
  let y = 841.89 - 60;
  page.drawText("BOWACO", { x: 52, y, size: 22, font: b, color: col(BRAND) });
  y -= 34;
  page.drawText("Gegevens voor de verzekering", { x: 52, y, size: 15, font: b, color: col(INK) });
  page.drawText(clean(d.madeOn), { x: 595.28 - 52 - r.widthOfTextAtSize(clean(d.madeOn), 9), y: y + 2, size: 9, font: r, color: col(GRAY) });
  y -= 26;
  for (const [label, value] of insuranceSheetRows(d)) {
    page.drawText(clean(label), { x: 52, y, size: 9, font: m, color: col(GRAY) });
    // lange waarden over meerdere regels, per teken afgebroken
    let line = "";
    const lines: string[] = [];
    for (const ch of clean(value)) { if (r.widthOfTextAtSize(line + ch, 10) > 330) { lines.push(line); line = ""; } line += ch; }
    lines.push(line);
    for (const l of lines) { page.drawText(l, { x: 200, y, size: 10, font: r, color: col(INK) }); y -= 15; }
    page.drawLine({ start: { x: 52, y: y + 6 }, end: { x: 595.28 - 52, y: y + 6 }, thickness: 0.4, color: col(LINE) });
    y -= 6;
  }
  return await doc.save();
}
