// Het opleveringsdocument als PDF (stap 2c.8, ontwerp 2c §4.8 en §6): voor de klant en de architect. Datum, aanwezigen, de restpunten
// met wie en wanneer, ruimte voor de handtekeningen, in de voet de controlecode. Geen enkel bedrag: wat niet in HandoverPdfData
// staat, kan niet in de PDF komen (geen aankoopprijs, geen marge, geen tarief). De controlecode is de sha-256 van de vaste tekst
// (handoverText): dezelfde gegevens geven dezelfde code, ook als de PDF opnieuw gemaakt wordt.
// Afbreken zoals de offerte (review 2.12): lineair, per regel naar een volgende bladzijde, lange woorden per teken.
// Zonder React en zonder backend-imports: Node draait dit bestand rechtstreeks.
import type { PdfFonts } from "./offerte.ts";

export type HandoverPdfPoint = { title: string; firm: string; due: string; done: boolean };
export type HandoverPdfData = {
  kind: "provisional" | "final";
  workCode: string;
  workName: string;
  address: string;
  client: string;
  architect: string;
  day: string; // "12.11.2026"
  attendees: string[];
  points: HandoverPdfPoint[];
  note: string;
  madeOn: string;
};

export const kindLabel = (k: "provisional" | "final") => (k === "provisional" ? "Voorlopige oplevering" : "Definitieve oplevering");

/** De vaste tekst waarover de controlecode loopt: elke regel van het document, zonder opmaak. */
export function handoverText(d: HandoverPdfData): string {
  return [
    kindLabel(d.kind), `werf ${d.workCode} ${d.workName}`, d.address, `bouwheer ${d.client}`, `architect ${d.architect}`, `datum ${d.day}`,
    `aanwezigen ${d.attendees.join(", ")}`,
    ...d.points.map((p, i) => `restpunt ${i + 1}: ${p.title} | ${p.firm} | ${p.due} | ${p.done ? "afgewerkt" : "open"}`),
    `opmerking ${d.note}`,
  ].join("\n");
}

export async function handoverCode(d: HandoverPdfData): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(handoverText(d)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const INK: [number, number, number] = [0.059, 0.071, 0.094];
const GRAY: [number, number, number] = [0.325, 0.357, 0.412];
const LINE: [number, number, number] = [0.882, 0.894, 0.914];
const LINE2: [number, number, number] = [0.765, 0.784, 0.82];
const BRAND: [number, number, number] = [0.118, 0.122, 0.255];
const W = 595.28;
const H = 841.89;
const ML = 52;
const MR = 52;
const MT = 52;
const MB = 62;
const CW = W - ML - MR;

export async function handoverPdf(d: HandoverPdfData, fonts: PdfFonts, code: string): Promise<Uint8Array> {
  const { PDFDocument, rgb } = await import("pdf-lib");
  const fontkit = (await import("@pdf-lib/fontkit")).default;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`${kindLabel(d.kind)} – ${d.workCode}`);
  doc.setAuthor("BOWACO");
  doc.setCreator("BOWACO werfbeheer");
  doc.setProducer("BOWACO werfbeheer (pdf-lib)");
  const F = {
    r: await doc.embedFont(fonts.regular, { subset: true }),
    m: await doc.embedFont(fonts.medium, { subset: true }),
    b: await doc.embedFont(fonts.bold, { subset: true }),
    mono: await doc.embedFont(fonts.mono, { subset: true }),
  };
  type Font = typeof F.r;
  const col = (c: [number, number, number]) => rgb(c[0], c[1], c[2]);
  const sets = new Map<Font, Set<number>>();
  const known = (f: Font) => { let s = sets.get(f); if (!s) { s = new Set(f.getCharacterSet()); sets.set(f, s); } return s; };
  const clean = (f: Font, s: string) => { const k = known(f); let o = ""; for (const ch of s.replace(/ /g, " ").replace(/[‐‑‒]/g, "-")) { const cp = ch.codePointAt(0)!; o += k.has(cp) ? ch : "?"; } return o; };
  const wid = (f: Font, size: number, s: string) => f.widthOfTextAtSize(clean(f, s), size);
  const breakWord = (f: Font, size: number, word: string, width: number): string[] => {
    const parts: string[] = [];
    let cur = "";
    for (const ch of word) { if (cur && wid(f, size, cur + ch) > width) { parts.push(cur); cur = ""; } cur += ch; }
    if (cur) parts.push(cur);
    return parts;
  };
  const wrap = (f: Font, size: number, s: string, width: number): string[] => {
    const out: string[] = [];
    for (const para of s.split(/\r?\n/)) {
      if (para.trim() === "") { out.push(""); continue; }
      let cur = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        let w = word;
        if (wid(f, size, w) > width) { const parts = breakWord(f, size, w, width); if (cur) { out.push(cur); cur = ""; } for (const p of parts.slice(0, -1)) out.push(p); w = parts[parts.length - 1] ?? ""; }
        const next = cur ? `${cur} ${w}` : w;
        if (wid(f, size, next) > width && cur) { out.push(cur); cur = w; } else cur = next;
      }
      if (cur) out.push(cur);
    }
    return out;
  };
  const pages: ReturnType<typeof doc.addPage>[] = [];
  let page = doc.addPage([W, H]);
  pages.push(page);
  let y = H - MT;
  const text = (s: string, x: number, yy: number, f: Font, size: number, color = INK) => page.drawText(clean(f, s), { x, y: yy, size, font: f, color: col(color) });
  const hline = (yy: number, c = LINE, th = 0.6) => page.drawLine({ start: { x: ML, y: yy }, end: { x: W - MR, y: yy }, thickness: th, color: col(c) });
  const newPage = () => { page = doc.addPage([W, H]); pages.push(page); y = H - MT; text("BOWACO", ML, y - 8, F.b, 10, BRAND); hline(y - 16); y -= 36; };
  const need = (h: number) => { if (y - h < MB) newPage(); };
  const para = (s: string, f: Font, size: number, color = INK, lead = size + 3.5, x = ML, width = CW) => { for (const l of wrap(f, size, s, width)) { need(lead); if (l) text(l, x, y, f, size, color); y -= lead; } };

  text("BOWACO", ML, y - 16, F.b, 22, BRAND);
  text(d.madeOn, W - MR - wid(F.mono, 9, d.madeOn), y - 17, F.mono, 9, INK);
  y -= 40;
  hline(y, LINE2, 0.9);
  y -= 24;
  para(kindLabel(d.kind), F.b, 15, INK, 19);
  para(`Werf ${d.workCode} · ${d.workName}`, F.m, 10, GRAY);
  para(d.address, F.r, 9.5, GRAY);
  y -= 8;
  para(`Datum van de oplevering: ${d.day}`, F.m, 10);
  para(`Bouwheer: ${d.client || "—"}`, F.r, 9.5);
  para(`Architect: ${d.architect || "—"}`, F.r, 9.5);
  para(`Aanwezig: ${d.attendees.length ? d.attendees.join(", ") : "—"}`, F.r, 9.5);
  y -= 8;
  hline(y + 6, LINE2, 0.8);
  para(d.points.length ? "Restpunten" : "Geen restpunten", F.b, 11, INK, 16);
  d.points.forEach((p, i) => {
    need(30);
    para(`${i + 1}. ${p.title}`, F.m, 9.5, INK, 13);
    para(`${p.firm || "BOWACO"} · uiterlijk ${p.due} · ${p.done ? "afgewerkt" : "open"}`, F.r, 8.5, GRAY, 12, ML + 14, CW - 14);
    y -= 3;
  });
  if (d.note.trim()) { y -= 6; para("Opmerking", F.m, 10, INK, 14); para(d.note, F.r, 9.5); }
  y -= 16;
  need(100);
  const half = CW / 2;
  text("Voor BOWACO", ML, y, F.m, 9.5); text("Voor de bouwheer", ML + half, y, F.m, 9.5);
  y -= 50;
  page.drawLine({ start: { x: ML, y }, end: { x: ML + half - 30, y }, thickness: 0.6, color: col(LINE2) });
  page.drawLine({ start: { x: ML + half, y }, end: { x: W - MR, y }, thickness: 0.6, color: col(LINE2) });
  y -= 12;
  text("naam, datum, handtekening", ML, y, F.r, 7.5, GRAY); text("naam, datum, handtekening", ML + half, y, F.r, 7.5, GRAY);
  const n = pages.length;
  pages.forEach((p, i) => {
    page = p;
    hline(MB - 14, LINE, 0.5);
    text(`BOWACO · ${kindLabel(d.kind).toLowerCase()} · ${d.workCode} · controlecode ${code.slice(0, 16)}`, ML, MB - 26, F.mono, 6.8, GRAY);
    const pg = `${i + 1} / ${n}`;
    text(pg, W - MR - wid(F.mono, 6.8, pg), MB - 26, F.mono, 6.8, GRAY);
  });
  return await doc.save();
}
