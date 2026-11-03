// Het PID-document (open punt van 2c.8, ontwerp 2c §4.8): een voorblad (werf, adres, datum, lijst van de fiches met hun bladzijde) gevolgd
// door de gekozen technische fiches, samengevoegd met pdf-lib. Een PDF komt er bladzijde per bladzijde in; een afbeelding (PNG, JPEG)
// als eigen bladzijde; al het andere, of een beschadigd of beveiligd bestand, wordt overgeslagen en staat met de reden op het voorblad.
// Geen enkel bedrag: het document kent enkel titels, materiaalsoorten, leveranciers en bestandsnamen.
// Zonder React en zonder backend-imports: Node draait dit bestand rechtstreeks (tests/openpunten-2c8p.mjs).
import type { PdfFonts } from "./offerte.ts";

export type PidSheet = { title: string; materialKey: string; supplier: string; fileName: string; mime: string; bytes: Uint8Array; missing?: boolean };
export type PidData = { workCode: string; workName: string; address: string; madeOn: string; sheets: PidSheet[] };
export type PidResult = {
  bytes: Uint8Array;
  pages: number; // totaal, voorblad inbegrepen
  included: { title: string; pages: number; from: number }[]; // from = eerste bladzijde in het document (1 = voorblad)
  skipped: { title: string; fileName: string; reason: string }[];
};

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
const IMG_MARGIN = 36;

export const MAX_PID_BYTES = 40 * 1024 * 1024; // totaal van de fiches; daarboven weigert de browser het document

/** Review L7: de kop "%PDF" mag na wat bytes komen (sommige programma's zetten er iets voor); gezocht in de eerste 1 KB. */
export const pdfStart = (b: Uint8Array): number => {
  const end = Math.min(b.length - 4, 1024);
  for (let i = 0; i <= end; i++) if (b[i] === 0x25 && b[i + 1] === 0x50 && b[i + 2] === 0x44 && b[i + 3] === 0x46) return i;
  return -1;
};
const isPdf = (b: Uint8Array) => b.length > 4 && pdfStart(b) >= 0;
const isPng = (b: Uint8Array) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJpg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/** Het soort bestand uit de inhoud (niet uit de naam of het opgegeven type: die kunnen liegen). */
export const pidKind = (b: Uint8Array): "pdf" | "png" | "jpg" | null => (isPdf(b) ? "pdf" : isPng(b) ? "png" : isJpg(b) ? "jpg" : null);

type Doc = import("pdf-lib").PDFDocument;

/** Het eerste deel: de fiches achter elkaar, met per fiche het aantal bladzijden of de reden van overslaan. */
async function body(d: PidData): Promise<{ doc: Doc; counts: { sheet: PidSheet; pages: number; reason?: string }[] }> {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const counts: { sheet: PidSheet; pages: number; reason?: string }[] = [];
  for (const sheet of d.sheets) {
    if (sheet.missing || sheet.bytes.length === 0) { counts.push({ sheet, pages: 0, reason: "bestand niet gevonden" }); continue; }
    const kind = pidKind(sheet.bytes);
    if (!kind) { counts.push({ sheet, pages: 0, reason: "enkel PDF, PNG en JPEG kunnen in het PID" }); continue; }
    // Review L7: elke fiche eerst in een eigen document dat bewaard moet kunnen worden (proef-save); pas daarna in het PID. Zo breekt
    // één slechte fiche het document niet.
    try {
      const piece = await PDFDocument.create();
      if (kind === "pdf") {
        const src = await PDFDocument.load(sheet.bytes.subarray(pdfStart(sheet.bytes)));
        if (src.getPageCount() === 0) { counts.push({ sheet, pages: 0, reason: "het bestand heeft geen bladzijden" }); continue; }
        (await piece.copyPages(src, src.getPageIndices())).forEach((p) => piece.addPage(p));
      } else {
        const img = kind === "png" ? await piece.embedPng(sheet.bytes) : await piece.embedJpg(sheet.bytes);
        const landscape = img.width > img.height;
        const [pw, ph] = landscape ? [H, W] : [W, H];
        const page = piece.addPage([pw, ph]);
        const k = Math.min((pw - 2 * IMG_MARGIN) / img.width, (ph - 2 * IMG_MARGIN) / img.height, 1.5);
        const w = img.width * k;
        const h = img.height * k;
        page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
      }
      const ok = await PDFDocument.load(await piece.save());
      const pages = await doc.copyPages(ok, ok.getPageIndices());
      pages.forEach((p) => doc.addPage(p));
      counts.push({ sheet, pages: pages.length });
    } catch {
      counts.push({ sheet, pages: 0, reason: "het bestand is beschadigd of beveiligd" });
    }
  }
  return { doc, counts };
}

type Entry = { sheet: PidSheet; pages: number; reason?: string };

/** Het voorblad (één of meer bladzijden). `first` = de bladzijde van de eerste fiche, na het voorblad. */
async function cover(d: PidData, fonts: PdfFonts, entries: Entry[], first: number): Promise<{ bytes: Uint8Array; pages: number }> {
  const { PDFDocument, rgb } = await import("pdf-lib");
  const fontkit = (await import("@pdf-lib/fontkit")).default;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`PID – ${d.workCode}`);
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
  const known = new Map<Font, Set<number>>();
  const clean = (f: Font, s: string) => {
    let k = known.get(f);
    if (!k) { k = new Set(f.getCharacterSet()); known.set(f, k); }
    let o = "";
    for (const ch of s.replace(/ /g, " ").replace(/[‐‑‒]/g, "-")) o += k.has(ch.codePointAt(0)!) ? ch : "?";
    return o;
  };
  const wid = (f: Font, size: number, s: string) => f.widthOfTextAtSize(clean(f, s), size);
  const wrap = (f: Font, size: number, s: string, width: number): string[] => {
    const out: string[] = [];
    let cur = "";
    for (const word of s.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (wid(f, size, w) > width && w.length > 1) { // lange woorden per teken afbreken
        let n = w.length - 1;
        while (n > 1 && wid(f, size, w.slice(0, n)) > width) n--;
        if (cur) { out.push(cur); cur = ""; }
        out.push(w.slice(0, n));
        w = w.slice(n);
      }
      const next = cur ? `${cur} ${w}` : w;
      if (wid(f, size, next) > width && cur) { out.push(cur); cur = w; } else cur = next;
    }
    if (cur) out.push(cur);
    return out;
  };
  const pages: ReturnType<typeof doc.addPage>[] = [];
  let page = doc.addPage([W, H]);
  pages.push(page);
  let y = H - MT;
  const text = (s: string, x: number, yy: number, f: Font, size: number, color = INK) => page.drawText(clean(f, s), { x, y: yy, size, font: f, color: col(color) });
  const hline = (yy: number, c = LINE, th = 0.6) => page.drawLine({ start: { x: ML, y: yy }, end: { x: W - MR, y: yy }, thickness: th, color: col(c) });
  const need = (h: number) => { if (y - h < MB) { page = doc.addPage([W, H]); pages.push(page); y = H - MT; text("BOWACO · PID", ML, y - 8, F.b, 10, BRAND); hline(y - 16); y -= 36; } };
  const para = (s: string, f: Font, size: number, color = INK, lead = size + 3.5, x = ML, width = CW) => { for (const l of wrap(f, size, s, width)) { need(lead); text(l, x, y, f, size, color); y -= lead; } };

  text("BOWACO", ML, y - 16, F.b, 22, BRAND);
  text(d.madeOn, W - MR - wid(F.mono, 9, d.madeOn), y - 17, F.mono, 9, INK);
  y -= 40;
  hline(y, LINE2, 0.9);
  y -= 24;
  para("PID: technische fiches", F.b, 15, INK, 19);
  para(`Werf ${d.workCode} · ${d.workName}`, F.m, 10, GRAY);
  para(d.address || "—", F.r, 9.5, GRAY);
  y -= 8;
  hline(y + 6, LINE2, 0.8);
  const ok = entries.filter((e) => e.pages > 0);
  const no = entries.filter((e) => e.pages === 0);
  para(ok.length ? `Inhoud (${ok.length} ${ok.length === 1 ? "fiche" : "fiches"})` : "Geen fiches in dit document", F.b, 11, INK, 16);
  let at = first;
  ok.forEach((e, i) => {
    need(30);
    const s = e.sheet;
    para(`${i + 1}. ${s.title}`, F.m, 9.5, INK, 13);
    para([s.materialKey, s.supplier, `bladzijde ${at}${e.pages > 1 ? ` tot ${at + e.pages - 1}` : ""}`].filter(Boolean).join(" · "), F.r, 8.5, GRAY, 12, ML + 14, CW - 14);
    y -= 3;
    at += e.pages;
  });
  if (no.length) {
    y -= 8;
    need(40);
    para("Niet opgenomen", F.b, 11, INK, 16);
    no.forEach((e) => { need(30); para(e.sheet.title, F.m, 9.5, INK, 13); para(`${e.sheet.fileName}: ${e.reason ?? ""}`, F.r, 8.5, GRAY, 12, ML + 14, CW - 14); y -= 3; });
  }
  const n = pages.length;
  pages.forEach((p, i) => {
    page = p;
    hline(MB - 14, LINE, 0.5);
    text(`BOWACO · PID · ${d.workCode}`, ML, MB - 26, F.mono, 6.8, GRAY);
    const pg = `voorblad ${i + 1} / ${n}`;
    text(pg, W - MR - wid(F.mono, 6.8, pg), MB - 26, F.mono, 6.8, GRAY);
  });
  return { bytes: await doc.save(), pages: n };
}

/** Het PID: voorblad + fiches. Het voorblad kent zijn eigen lengte vooraf niet: opnieuw tot het stabiel is (hoogstens tien rondes). */
export async function buildPid(d: PidData, fonts: PdfFonts): Promise<PidResult> {
  const { PDFDocument } = await import("pdf-lib");
  const { doc, counts } = await body(d);
  let guess = 1;
  let c = await cover(d, fonts, counts, guess + 1);
  for (let k = 0; k < 10 && c.pages !== guess; k++) { guess = c.pages; c = await cover(d, fonts, counts, guess + 1); }
  const out = await PDFDocument.create();
  const front = await PDFDocument.load(c.bytes);
  (await out.copyPages(front, front.getPageIndices())).forEach((p) => out.addPage(p));
  // Een leeg document zou pdf-lib bij het teruglezen één lege bladzijde geven: enkel samenvoegen als er echt bladzijden zijn.
  if (doc.getPageCount() > 0) {
    const rest = await PDFDocument.load(await doc.save());
    (await out.copyPages(rest, rest.getPageIndices())).forEach((p) => out.addPage(p));
  }
  out.setTitle(`PID – ${d.workCode}`);
  out.setAuthor("BOWACO");
  out.setProducer("BOWACO werfbeheer (pdf-lib)");
  let at = c.pages + 1;
  const included = counts.filter((e) => e.pages > 0).map((e) => { const r = { title: e.sheet.title, pages: e.pages, from: at }; at += e.pages; return r; });
  const skipped = counts.filter((e) => e.pages === 0).map((e) => ({ title: e.sheet.title, fileName: e.sheet.fileName, reason: e.reason ?? "" }));
  return { bytes: await out.save(), pages: out.getPageCount(), included, skipped };
}
