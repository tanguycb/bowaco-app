// Het OA-contract als PDF (stap 2c.4, ontwerp 2c §4.4 en §6): de overeenkomst onderaanneming zoals ze in de app vastligt onder een
// controlecode (AgreementFrozen): de tekst van het sjabloon met de velden ingevuld (firma, werken, prijs, voorschot, betaling,
// planning, werfadres), een bijlage met de posten (VH, eenheid, eenheidsprijs van DEZE firma) en de tarieven met datum, ruimte voor
// de handtekeningen, in de voet de controlecode en de versie (een aanhangsel = een nieuwe versie). Geen klantnaam, geen andere firma,
// geen verkoopprijs van BOWACO: wat niet in ContractPdfData staat, kan niet in de PDF komen.
// Afbreken zoals de offerte (review 2.12): lineair, per regel naar een volgende bladzijde, lange woorden per teken.
// Zonder React en zonder backend-imports: Node draait dit bestand rechtstreeks.
import type { PdfFonts } from "./offerte.ts";

export type ContractPdfPost = { title: string; unit: string; qtyMilli: bigint; unitCents: bigint | null };
export type ContractPdfRate = { name: string; unit: string; cents: bigint; from: string };
export type ContractPdfData = {
  title: string;
  version: number;
  provisional: boolean;
  firm: string;
  work: string; // werfcode + adres
  text: string;
  posts: ContractPdfPost[];
  rates: ContractPdfRate[];
  total: bigint | null;
  advance: string;
  hash: string;
  madeOn: string;
  signedOn: string | null;
};

const qf = new Intl.NumberFormat("nl-BE", { maximumFractionDigits: 3 });
const qty = (m: bigint) => qf.format(Number(m) / 1000);
/** Afronden op de cent, half weg van nul (zoals QuoteCalc.roundDiv in de backend). */
export function roundDiv(n: bigint, d: bigint): bigint {
  const neg = (n < 0n) !== (d < 0n);
  const a = n < 0n ? -n : n;
  const b = d < 0n ? -d : d;
  const q = (2n * a + b) / (2n * b);
  return neg ? -q : q;
}
const ef = new Intl.NumberFormat("nl-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const euro = (c: bigint) => `€ ${ef.format(Number(c) / 100)}`;

const INK: [number, number, number] = [0.059, 0.071, 0.094];
const GRAY: [number, number, number] = [0.325, 0.357, 0.412];
const LINE: [number, number, number] = [0.882, 0.894, 0.914];
const LINE2: [number, number, number] = [0.765, 0.784, 0.82];
const BRAND: [number, number, number] = [0.118, 0.122, 0.255];
const WARN: [number, number, number] = [0.70, 0.33, 0.04];
const W = 595.28;
const H = 841.89;
const ML = 52;
const MR = 52;
const MT = 52;
const MB = 62;
const CW = W - ML - MR;

export async function contractPdf(d: ContractPdfData, fonts: PdfFonts): Promise<Uint8Array> {
  const { PDFDocument, rgb } = await import("pdf-lib");
  const fontkit = (await import("@pdf-lib/fontkit")).default;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`${d.title} – ${d.firm} – versie ${d.version}`);
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
  const right = (s: string, xr: number, yy: number, f: Font, size: number, color = INK) => text(s, xr - wid(f, size, s), yy, f, size, color);
  const hline = (yy: number, c = LINE, th = 0.6) => page.drawLine({ start: { x: ML, y: yy }, end: { x: W - MR, y: yy }, thickness: th, color: col(c) });
  const newPage = () => { page = doc.addPage([W, H]); pages.push(page); y = H - MT; text("BOWACO", ML, y - 8, F.b, 10, BRAND); right(`OVEREENKOMST · VERSIE ${d.version}`, W - MR, y - 7, F.mono, 7.5, GRAY); hline(y - 16); y -= 36; };
  const need = (h: number) => { if (y - h < MB) newPage(); };
  const para = (s: string, f: Font, size: number, color = INK, lead = size + 3.5) => { for (const l of wrap(f, size, s, CW)) { need(lead); if (l) text(l, ML, y, f, size, color); y -= lead; } };

  // ── Kop ──
  text("BOWACO", ML, y - 16, F.b, 22, BRAND);
  right(`VERSIE ${d.version}${d.version > 1 ? " (AANHANGSEL)" : ""}`, W - MR, y - 4, F.mono, 7.5, GRAY);
  right(d.madeOn, W - MR, y - 17, F.mono, 9, INK);
  y -= 40;
  hline(y, LINE2, 0.9);
  y -= 24;
  para(d.title, F.b, 15, INK, 19);
  para(`${d.firm} · werf ${d.work}`, F.m, 10, GRAY);
  if (d.provisional) { y -= 2; para("VOORLOPIGE TEKST: nog na te kijken door BOWACO en een jurist.", F.m, 8.5, WARN); }
  y -= 10;
  // ── De tekst (artikels) ──
  for (const l of d.text.split(/\r?\n/)) {
    if (l.trim() === "") { y -= 5; continue; }
    const head = /^Artikel\s+\d+/.test(l);
    para(l, head ? F.m : F.r, 9.5, INK, 13);
  }
  // ── Bijlage: posten en tarieven ──
  y -= 12;
  need(80);
  hline(y + 6, LINE2, 0.8);
  para("Bijlage – posten en eenheidsprijzen (excl. btw)", F.b, 11, INK, 16);
  const X = { desc: ML, qty: ML + 330, unit: ML + 336, price: ML + 430, tot: W - MR };
  const head = () => { need(20); text("POST", X.desc, y, F.mono, 6.8, GRAY); right("VH", X.qty, y, F.mono, 6.8, GRAY); text("EENH.", X.unit, y, F.mono, 6.8, GRAY); right("PRIJS/EENH.", X.price, y, F.mono, 6.8, GRAY); right("TOTAAL", X.tot, y, F.mono, 6.8, GRAY); y -= 5; hline(y, LINE2); y -= 12; };
  head();
  for (const p of d.posts) {
    const t = wrap(F.r, 9, p.title || "—", X.qty - X.desc - 50);
    if (y - t.length * 12 < MB) { newPage(); head(); }
    right(qty(p.qtyMilli), X.qty, y, F.mono, 8.5);
    text(p.unit.slice(0, 8), X.unit, y, F.r, 8.5, GRAY);
    right(p.unitCents === null ? "—" : euro(p.unitCents), X.price, y, F.mono, 8.5);
    right(p.unitCents === null ? "—" : euro(roundDiv(p.unitCents * p.qtyMilli, 1000n)), X.tot, y, F.mono, 8.5);
    for (const l of t) { text(l, X.desc, y, F.r, 9); y -= 12; }
    hline(y + 8, LINE, 0.4);
    y -= 2;
  }
  if (d.total !== null) { need(18); right(`Samen ${euro(d.total)} excl. btw (VH; afrekening volgens de uitvoering)`, X.tot, y, F.m, 9); y -= 16; }
  para(`Voorschot: ${d.advance}`, F.r, 9, INK);
  if (d.rates.length) {
    y -= 8;
    para("Tarieven op deze werf (excl. btw)", F.m, 10, INK, 15);
    for (const r of d.rates) para(`· ${r.name}: ${euro(r.cents)} per ${r.unit}, vanaf ${r.from}`, F.r, 9, INK, 12.5);
  }
  // ── Handtekeningen ──
  y -= 16;
  need(90);
  const half = CW / 2;
  text("Voor BOWACO", ML, y, F.m, 9.5); text(`Voor ${d.firm}`.slice(0, 60), ML + half, y, F.m, 9.5);
  y -= 50;
  page.drawLine({ start: { x: ML, y }, end: { x: ML + half - 30, y }, thickness: 0.6, color: col(LINE2) });
  page.drawLine({ start: { x: ML + half, y }, end: { x: W - MR, y }, thickness: 0.6, color: col(LINE2) });
  y -= 12;
  text("naam, datum, handtekening", ML, y, F.r, 7.5, GRAY); text("naam, datum, handtekening", ML + half, y, F.r, 7.5, GRAY);
  if (d.signedOn) { y -= 16; para(`Getekend bewijs geregistreerd op ${d.signedOn}.`, F.r, 8.5, GRAY); }
  // ── Voet ──
  const n = pages.length;
  pages.forEach((p, i) => {
    page = p;
    hline(MB - 14, LINE, 0.5);
    text(`BOWACO · overeenkomst onderaanneming · ${d.firm.slice(0, 40)} · versie ${d.version} · controlecode ${d.hash.slice(0, 16)}`, ML, MB - 26, F.mono, 6.8, GRAY);
    right(`${i + 1} / ${n}`, W - MR, MB - 26, F.mono, 6.8, GRAY);
  });
  return await doc.save();
}
