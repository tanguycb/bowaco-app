// De vergelijking van OA-offertes als PDF (stap 2c.3, ontwerp 2c §6): enkel voor kantoor (dossier), VERTROUWELIJK (OA-prijzen,
// R38). A4 liggend in de zakelijke vormstijl van de prijsvraag-PDF; de matrix met de posten onder elkaar en de firma's naast elkaar
// (per blad hoogstens vier firma's; meer firma's = een volgend blok), per post de eenheidsprijs en het bedrag op de VH van BOWACO,
// laagste, ontbrekend, niet inbegrepen, alternatief, afwijkend, VH gewijzigd; hoofdstuktotalen, totaal, volledigheid; de keuze met
// de reden. De invoer heeft geen veld voor de klant: wat er niet in het type staat, kan niet in de PDF komen.
// Afbreken zoals de offerte (review 2.12): per regel naar een volgende bladzijde.
// Zonder React en zonder backend-imports: Node draait dit bestand rechtstreeks (tests/oaofferte-2c3.mjs).
import type { PdfFonts } from "./offerte.ts";

export type ComparePdfCell = { main: string; sub: string; lowest: boolean; chosen: boolean; flag: string };
export type ComparePdfRow = { chapter: string; code: string; title: string; qty: string; cells: ComparePdfCell[]; choice: string; reason: string };
export type ComparePdfSum = { label: string; values: string[]; lowest: boolean[] };
export type ComparePdfData = {
  code: string; // "PV 2026/412-1"
  title: string;
  work: string; // werfcode en -naam (intern)
  made: string; // "31.10.2026 14:05 door …"
  firms: { name: string; meta: string }[]; // "offerte 2026-0877 · 14.10.2026 · versie 2 · Excel"
  rows: ComparePdfRow[];
  chapterSums: { chapter: string; sum: ComparePdfSum }[];
  totals: ComparePdfSum[]; // totaal op de VH, korting, netto, volledigheid
  choice: string; // "Keuze: 14 van 18 posten · € 23.456,00 aankoop"
  legend: string;
};

const INK: [number, number, number] = [0.059, 0.071, 0.094];
const GRAY: [number, number, number] = [0.325, 0.357, 0.412];
const LINE: [number, number, number] = [0.882, 0.894, 0.914];
const LINE2: [number, number, number] = [0.765, 0.784, 0.82];
const BRAND: [number, number, number] = [0.118, 0.122, 0.255];
const SUNK: [number, number, number] = [0.925, 0.933, 0.945];
const OK: [number, number, number] = [0.86, 0.95, 0.88];
const PICK: [number, number, number] = [0.173, 0.294, 0.878];
const WARN: [number, number, number] = [0.72, 0.38, 0.0];
const W = 841.89;
const H = 595.28;
const ML = 36;
const MR = 36;
const MT = 40;
const MB = 46;
const CW = W - ML - MR;
const PER = 4;

export async function comparePdf(d: ComparePdfData, fonts: PdfFonts): Promise<Uint8Array> {
  const { PDFDocument, rgb } = await import("pdf-lib");
  const fontkit = (await import("@pdf-lib/fontkit")).default;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`Vergelijking OA-offertes ${d.code}`);
  doc.setAuthor("BOWACO");
  doc.setSubject("Vertrouwelijk");
  doc.setCreator("BOWACO werfbeheer");
  doc.setProducer("BOWACO werfbeheer (pdf-lib)");
  const F = {
    r: await doc.embedFont(fonts.regular, { subset: true }),
    m: await doc.embedFont(fonts.medium, { subset: true }),
    b: await doc.embedFont(fonts.bold, { subset: true }),
    mono: await doc.embedFont(fonts.mono, { subset: true }),
    monoB: await doc.embedFont(fonts.monoBold, { subset: true }),
  };
  type Font = typeof F.r;
  const col = (c: [number, number, number]) => rgb(c[0], c[1], c[2]);
  const sets = new Map<Font, Set<number>>();
  const known = (f: Font) => { let s = sets.get(f); if (!s) { s = new Set(f.getCharacterSet()); sets.set(f, s); } return s; };
  const clean = (f: Font, s: string) => { const k = known(f); let out = ""; for (const ch of s.replace(/ /g, " ").replace(/[‐‑‒]/g, "-")) { const cp = ch.codePointAt(0)!; out += k.has(cp) ? ch : "?"; } return out; };
  const wid = (f: Font, size: number, s: string) => f.widthOfTextAtSize(clean(f, s), size);
  const fit = (f: Font, size: number, s: string, width: number) => { let t = s; while (t.length > 1 && wid(f, size, t) > width) t = t.slice(0, -2) + "…"; return t; };
  const wrap = (f: Font, size: number, s: string, width: number): string[] => {
    const out: string[] = [];
    for (const para of s.split(/\r?\n/)) {
      let cur = "";
      for (const word0 of para.split(/\s+/).filter(Boolean)) {
        let word = word0;
        while (wid(f, size, word) > width && word.length > 1) { let k = word.length - 1; while (k > 1 && wid(f, size, word.slice(0, k)) > width) k--; if (cur) { out.push(cur); cur = ""; } out.push(word.slice(0, k)); word = word.slice(k); }
        const next = cur ? `${cur} ${word}` : word;
        if (wid(f, size, next) > width && cur) { out.push(cur); cur = word; } else cur = next;
      }
      out.push(cur);
    }
    return out;
  };

  const pages: ReturnType<typeof doc.addPage>[] = [];
  let page = doc.addPage([W, H]);
  pages.push(page);
  let y = H - MT;
  const text = (s: string, x: number, yy: number, f: Font, size: number, color = INK) => page.drawText(clean(f, s), { x, y: yy, size, font: f, color: col(color) });
  const right = (s: string, xr: number, yy: number, f: Font, size: number, color = INK) => text(s, xr - wid(f, size, s), yy, f, size, color);
  const hline = (yy: number, x1 = ML, x2 = W - MR, c = LINE, th = 0.6) => page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: th, color: col(c) });
  const label = (s: string, x: number, yy: number) => text(s.toUpperCase(), x, yy, F.mono, 6.5, GRAY);

  // ── Kop ──
  text("BOWACO", ML, y - 14, F.b, 18, BRAND);
  right("VERGELIJKING OA-OFFERTES · VERTROUWELIJK", W - MR, y - 2, F.monoB, 7.5, WARN);
  right(d.code, W - MR, y - 16, F.monoB, 13);
  y -= 30;
  hline(y, ML, W - MR, LINE2, 0.9);
  y -= 16;
  text(fit(F.b, 12, d.title, CW), ML, y, F.b, 12);
  y -= 14;
  text(fit(F.r, 8.5, `${d.work} · ${d.made}`, CW), ML, y, F.r, 8.5, GRAY);
  y -= 12;
  for (const l of wrap(F.r, 7.5, d.legend, CW)) { text(l, ML, y, F.r, 7.5, GRAY); y -= 10; }
  y -= 6;

  // ── De matrix, per blok van hoogstens vier firma's ──
  const X0 = ML;
  const NR = 38;
  const POST = 210;
  const QTY = 62;
  const CHOICE = 120;
  const firmsW = CW - NR - POST - QTY - CHOICE;
  const blocks: number[][] = [];
  for (let k = 0; k < Math.max(1, d.firms.length); k += PER) blocks.push(d.firms.map((_, i) => i).slice(k, k + PER));
  for (const [bi, idx] of blocks.entries()) {
    const cw = firmsW / Math.max(1, idx.length);
    const xf = (j: number) => X0 + NR + POST + QTY + j * cw;
    const xChoice = X0 + NR + POST + QTY + firmsW + 6;
    const head = () => {
      if (y - 40 < MB) { page = doc.addPage([W, H]); pages.push(page); y = H - MT; text("BOWACO", ML, y - 8, F.b, 9, BRAND); right(`VERGELIJKING ${d.code} · VERTROUWELIJK`, W - MR, y - 7, F.mono, 7, WARN); hline(y - 14); y -= 30; }
      label("Nr", X0, y); label("Post", X0 + NR, y); label("VH", X0 + NR + POST, y);
      idx.forEach((fi, j) => { text(fit(F.m, 8, d.firms[fi].name, cw - 6), xf(j), y, F.m, 8); text(fit(F.r, 6.5, d.firms[fi].meta, cw - 6), xf(j), y - 9, F.r, 6.5, GRAY); });
      if (bi === blocks.length - 1) label("Keuze · reden", xChoice, y);
      y -= 14;
      hline(y, ML, W - MR, LINE2, 0.8);
      y -= 11;
    };
    const need = (h: number) => { if (y - h < MB) { page = doc.addPage([W, H]); pages.push(page); y = H - MT; text("BOWACO", ML, y - 8, F.b, 9, BRAND); right(`VERGELIJKING ${d.code} · VERTROUWELIJK`, W - MR, y - 7, F.mono, 7, WARN); hline(y - 14); y -= 30; head(); } };
    if (blocks.length > 1) { need(30); text(`Firma's ${idx[0] + 1}–${idx[idx.length - 1] + 1} van ${d.firms.length}`, ML, y, F.m, 9, GRAY); y -= 14; }
    head();
    let ch = "\u0000";
    const sumRow = (s: ComparePdfSum, bold: boolean) => {
      need(14);
      text(fit(bold ? F.b : F.m, 8, s.label, NR + POST + QTY - 6), X0, y, bold ? F.b : F.m, 8);
      idx.forEach((fi, j) => { if (s.lowest[fi]) page.drawRectangle({ x: xf(j) - 2, y: y - 3, width: cw - 4, height: 11, color: col(OK) }); right(s.values[fi] ?? "", xf(j) + cw - 8, y, bold ? F.monoB : F.mono, 7.5); });
      y -= 13;
    };
    for (const r of d.rows) {
      if (r.chapter !== ch) {
        if (ch !== "\u0000") { const cs = d.chapterSums.find((c) => c.chapter === ch); if (cs) sumRow(cs.sum, false); }
        ch = r.chapter;
        need(30);
        page.drawRectangle({ x: ML, y: y - 4, width: CW, height: 15, color: col(SUNK) });
        text(fit(F.b, 8.5, r.chapter || "—", CW - 8), X0 + 3, y, F.b, 8.5);
        y -= 17;
      }
      const title = wrap(F.r, 7.8, r.title, POST - 6).slice(0, 3);
      const reason = bi === blocks.length - 1 ? wrap(F.r, 6.8, r.reason, CHOICE - 6).slice(0, 2) : [];
      const h = Math.max(title.length * 9.5, 18, 9 + reason.length * 8) + 4;
      need(h);
      const y0 = y;
      text(fit(F.mono, 7, r.code, NR - 4), X0, y0, F.mono, 7, GRAY);
      title.forEach((t, k) => text(t, X0 + NR, y0 - k * 9.5, F.r, 7.8));
      text(fit(F.mono, 7, r.qty, QTY - 4), X0 + NR + POST, y0, F.mono, 7, GRAY);
      idx.forEach((fi, j) => {
        const c = r.cells[fi];
        if (!c) return;
        if (c.lowest) page.drawRectangle({ x: xf(j) - 2, y: y0 - 12, width: cw - 4, height: 20, color: col(OK) });
        if (c.chosen) page.drawRectangle({ x: xf(j) - 2, y: y0 - 12, width: cw - 4, height: 20, borderColor: col(PICK), borderWidth: 1 });
        right(c.main, xf(j) + cw - 8, y0, F.mono, 7.5, c.main.startsWith("€") ? INK : GRAY);
        if (c.sub) right(fit(F.mono, 6.3, c.sub, cw - 10), xf(j) + cw - 8, y0 - 8.5, F.mono, 6.3, GRAY);
        if (c.flag) text(fit(F.r, 6.3, c.flag, cw - 40), xf(j), y0 - 8.5, F.r, 6.3, WARN);
      });
      if (bi === blocks.length - 1) {
        text(fit(F.m, 7.5, r.choice, CHOICE - 6), xChoice, y0, F.m, 7.5, PICK);
        reason.forEach((t, k) => text(t, xChoice, y0 - 9 - k * 8, F.r, 6.8, GRAY));
      }
      y = y0 - h;
      hline(y + 3, X0 + NR, W - MR, LINE, 0.4);
      y -= 3;
    }
    if (ch !== "\u0000") { const cs = d.chapterSums.find((c) => c.chapter === ch); if (cs) sumRow(cs.sum, false); }
    y -= 4;
    hline(y + 8, ML, W - MR, LINE2, 0.8);
    for (const s of d.totals) sumRow(s, s.label.toLowerCase().startsWith("netto"));
    y -= 10;
  }
  if (y - 20 < MB) { page = doc.addPage([W, H]); pages.push(page); y = H - MT; }
  for (const l of wrap(F.m, 9, d.choice, CW)) { text(l, ML, y, F.m, 9, PICK); y -= 12; }

  // ── Voet ──
  const n = pages.length;
  pages.forEach((p, i) => {
    page = p;
    hline(MB - 12, ML, W - MR, LINE, 0.5);
    text(`BOWACO · vergelijking ${d.code} · VERTROUWELIJK: enkel voor kantoor (prijzen van onderaannemers)`, ML, MB - 23, F.mono, 6.5, GRAY);
    right(`${i + 1} / ${n}`, W - MR, MB - 23, F.mono, 6.5, GRAY);
  });
  return await doc.save();
}
