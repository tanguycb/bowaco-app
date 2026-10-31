// De prijsvraag als PDF, per firma (stap 2c.2, ontwerp 2c §6): A4 in de zakelijke vormstijl van de offerte-PDF (2.7), met het
// woordmerk BOWACO en ingebedde lettertypes (Archivo, IBM Plex Mono). Kop met de code van de prijsvraag, de firma, de werf (adres of
// enkel de gemeente, ⚖4: nooit de klant), het contact van BOWACO en de deadline; de posten per hoofdstuk en subgroep met VH en
// eenheid en een lege prijskolom; de bijlagen; "Zo antwoordt u" (Excel, in de app met de toegangscode, of de eigen offerte); de
// verwijzing naar de overeenkomst onderaanneming; in de voet de controlecode van de inhoud. De invoer (TenderPdfData) heeft GEEN
// veld voor een prijs, een klantnaam of een andere firma: wat er niet in het type staat, kan niet in de PDF komen.
// Afbreken zoals de offerte (review 2.12): per regel naar een volgende bladzijde, lange woorden per teken.
// Zonder React en zonder backend-imports: Node draait dit bestand rechtstreeks.
import type { PdfFonts } from "./offerte.ts";

export type TenderPdfItem = { chapter: string; subgroup: string; code: string; title: string; text: string; unit: string; qtyMilli: bigint; form: string };
export type TenderPdfData = {
  code: string; // "PV 2026/412-1"
  title: string;
  firm: string;
  firmContact: string;
  place: string[]; // werfadres (regels) of enkel de gemeente
  deadlineDay: number; // dagen sinds 1970
  contact: { name: string; phone: string; email: string };
  message: string;
  items: TenderPdfItem[];
  files: string[];
  accessCode: string | null; // enkel als de code net gemaakt werd (de app bewaart enkel de controlecode van een code)
  appUrl: string;
  hash: string;
};

const qf = new Intl.NumberFormat("nl-BE", { maximumFractionDigits: 3 });
const qty = (m: bigint) => qf.format(Number(m) / 1000);
export function dayText(d: number): string {
  return new Date(d * 86_400_000).toLocaleDateString("nl-BE", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
const FORM: Record<string, string> = { fixed: "vast", vh: "VH", regie: "regie", estimate: "raming", budget: "budget", perAttachment: "bijlage" };

const INK: [number, number, number] = [0.059, 0.071, 0.094];
const GRAY: [number, number, number] = [0.325, 0.357, 0.412];
const LINE: [number, number, number] = [0.882, 0.894, 0.914];
const LINE2: [number, number, number] = [0.765, 0.784, 0.82];
const ACCENT: [number, number, number] = [0.173, 0.294, 0.878];
const BRAND: [number, number, number] = [0.118, 0.122, 0.255];
const SUNK: [number, number, number] = [0.925, 0.933, 0.945];
const W = 595.28;
const H = 841.89;
const ML = 48;
const MR = 48;
const MT = 52;
const MB = 62;
const CW = W - ML - MR;

export async function tenderPdf(d: TenderPdfData, fonts: PdfFonts): Promise<Uint8Array> {
  const { PDFDocument, rgb } = await import("pdf-lib");
  const fontkit = (await import("@pdf-lib/fontkit")).default;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`Prijsvraag ${d.code}`);
  doc.setAuthor("BOWACO");
  doc.setSubject(d.title);
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
  const clean = (f: Font, s: string) => {
    const k = known(f);
    let out = "";
    for (const ch of s.replace(/ /g, " ").replace(/[‐‑‒]/g, "-")) { const cp = ch.codePointAt(0)!; out += cp === 10 || cp === 13 || k.has(cp) ? ch : "?"; }
    return out;
  };
  const wid = (f: Font, size: number, s: string) => f.widthOfTextAtSize(clean(f, s), size);
  const cwCache = new Map<Font, Map<string, number>>();
  const charW = (f: Font, size: number, ch: string) => {
    let m = cwCache.get(f);
    if (!m) { m = new Map(); cwCache.set(f, m); }
    const k = `${size}|${ch}`;
    let w = m.get(k);
    if (w === undefined) { w = f.widthOfTextAtSize(clean(f, ch), size); m.set(k, w); }
    return w;
  };
  const breakWord = (f: Font, size: number, word: string, width: number): string[] => {
    const parts: string[] = [];
    let cur = "";
    let curW = 0;
    for (const ch of word) { const w = charW(f, size, ch); if (cur && curW + w > width) { parts.push(cur); cur = ""; curW = 0; } cur += ch; curW += w; }
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
        if (wid(f, size, w) > width) {
          const parts = breakWord(f, size, w, width);
          if (cur) { out.push(cur); cur = ""; }
          for (const p of parts.slice(0, -1)) out.push(p);
          w = parts[parts.length - 1] ?? "";
        }
        const next = cur ? `${cur} ${w}` : w;
        if (wid(f, size, next) > width && cur) { out.push(cur); cur = w; } else cur = next;
      }
      if (cur) out.push(cur);
    }
    return out;
  };

  const pages: ReturnType<typeof doc.addPage>[] = [];
  const fresh = () => { const p = doc.addPage([W, H]); pages.push(p); return p; };
  let page = fresh();
  let y = H - MT;
  const text = (s: string, x: number, yy: number, f: Font, size: number, color = INK, spacing = 0) => {
    const t = clean(f, s);
    if (spacing) { let cx = x; for (const ch of t) { page.drawText(ch, { x: cx, y: yy, size, font: f, color: col(color) }); cx += f.widthOfTextAtSize(ch, size) + spacing; } }
    else page.drawText(t, { x, y: yy, size, font: f, color: col(color) });
  };
  const right = (s: string, xr: number, yy: number, f: Font, size: number, color = INK) => text(s, xr - wid(f, size, s), yy, f, size, color);
  const hline = (yy: number, x1 = ML, x2 = W - MR, c = LINE, th = 0.6) => page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: th, color: col(c) });
  const label = (s: string, x: number, yy: number) => text(s.toUpperCase(), x, yy, F.mono, 6.8, GRAY, 0.7);
  const newPage = () => {
    page = fresh();
    y = H - MT;
    text("BOWACO", ML, y - 8, F.b, 10, BRAND, 1.4);
    right(`PRIJSVRAAG ${d.code}`, W - MR, y - 7, F.mono, 7.5, GRAY);
    hline(y - 16);
    y -= 36;
  };
  const need = (h: number) => { if (y - h < MB) newPage(); };

  // ── Kop ──
  text("BOWACO", ML, y - 16, F.b, 22, BRAND, 2.6);
  { const t = "PRIJSVRAAG"; text(t, W - MR - wid(F.mono, 6.8, t) - t.length * 0.7, y - 2, F.mono, 6.8, GRAY, 0.7); }
  right(d.code, W - MR, y - 17, F.monoB, 15, INK);
  y -= 42;
  hline(y, ML, W - MR, LINE2, 0.9);
  y -= 18;
  const colW = CW / 3;
  const top = y;
  const block = (i: number, head: string, lines: string[]) => {
    const x = ML + i * colW;
    label(head, x, top);
    let yy = top - 14;
    lines.forEach((l, k) => { for (const t of wrap(k === 0 ? F.m : F.r, 9.5, l, colW - 14).slice(0, 3)) { text(t, x, yy, k === 0 ? F.m : F.r, 9.5, k === 0 ? INK : GRAY); yy -= 12.5; } });
    return top - yy;
  };
  const h1 = block(0, "Voor", [d.firm, ...(d.firmContact ? [d.firmContact] : [])]);
  const h2 = block(1, "Werf", d.place.length ? d.place : ["—"]);
  const h3 = block(2, "Antwoord vóór", [dayText(d.deadlineDay), `Contact: ${d.contact.name}`, ...(d.contact.phone ? [d.contact.phone] : []), ...(d.contact.email ? [d.contact.email] : [])]);
  y = top - Math.max(h1, h2, h3) - 14;
  hline(y);
  y -= 22;
  for (const l of wrap(F.b, 14, d.title, CW)) { need(20); text(l, ML, y, F.b, 14); y -= 18; }
  for (const l of wrap(F.r, 9.5, "BOWACO vraagt uw prijs per post, excl. btw. De hoeveelheden zijn die van BOWACO (VH = vermoedelijke hoeveelheid).", CW)) { need(14); text(l, ML, y, F.r, 9.5, GRAY); y -= 13; }
  if (d.message.trim()) {
    y -= 4;
    for (const l of wrap(F.r, 9.5, d.message, CW)) { need(14); if (l) text(l, ML, y, F.r, 9.5, INK); y -= 13; }
  }
  y -= 12;

  // ── Posten per hoofdstuk en subgroep ──
  const X = { code: ML, desc: ML + 44, form: ML + 270, qty: ML + 346, unit: ML + 352, price: ML + 430, total: ML + CW };
  const DESC_W = X.form - X.desc - 8;
  const head = () => {
    need(24);
    label("Nr", X.code, y); label("Omschrijving", X.desc, y); label("Vorm", X.form, y);
    const r = (s: string, xr: number) => text(s.toUpperCase(), xr - wid(F.mono, 6.8, s.toUpperCase()) - s.length * 0.7, y, F.mono, 6.8, GRAY, 0.7);
    r("VH", X.qty); label("Eenh.", X.unit, y); r("Prijs/eenh.", X.price); r("Totaal", X.total);
    y -= 6;
    hline(y, ML, W - MR, LINE2, 0.8);
    y -= 12;
  };
  const chapters: string[] = [];
  for (const it of d.items) if (!chapters.includes(it.chapter)) chapters.push(it.chapter);
  let first = true;
  for (const ch of chapters) {
    need(70);
    if (first) { head(); first = false; }
    y -= 4;
    page.drawRectangle({ x: ML, y: y - 5, width: CW, height: 19, color: col(SUNK) });
    text(ch || "—", X.code + 4, y, F.b, 10, INK);
    y -= 22;
    let sub = "";
    for (const l of d.items.filter((x) => x.chapter === ch)) {
      if (l.subgroup !== sub) {
        sub = l.subgroup;
        if (sub) { need(40); text(sub, X.desc, y, F.m, 9.5, INK); y -= 6; hline(y, X.desc, W - MR, LINE2, 0.6); y -= 12; }
      }
      const title = wrap(F.m, 9.5, l.title || l.text.split("\n")[0] || "", DESC_W);
      const body = l.title && l.text ? wrap(F.r, 7.8, l.text, DESC_W) : [];
      const h = title.length * 12 + body.length * 10 + 8;
      if (y - Math.min(h, 60) < MB) { newPage(); head(); text(`${ch} (vervolg)`, X.desc, y, F.m, 8.5, GRAY); y -= 16; }
      const y0 = y;
      if (l.code) text(l.code, X.code + 4, y0, F.mono, 8, GRAY);
      text(FORM[l.form] ?? l.form, X.form, y0, F.mono, 8, l.form === "vh" ? INK : ACCENT);
      right(qty(l.qtyMilli), X.qty, y0, F.mono, 8.5, INK);
      text(l.unit.length > 8 ? l.unit.slice(0, 8) : l.unit, X.unit, y0, F.r, 8.5, GRAY);
      right("……………", X.price, y0, F.mono, 8.5, LINE2);
      right("……………", X.total - 4, y0, F.mono, 8.5, LINE2);
      let yy = y0;
      const more = (step: number) => { if (yy - step < MB) { newPage(); head(); text(`${ch} (vervolg)`, X.desc, y, F.m, 8.5, GRAY); y -= 16; yy = y; } };
      for (const t of title) { more(12); text(t, X.desc, yy, F.m, 9.5, INK); yy -= 12; }
      for (const t of body) { more(10); if (t) text(t, X.desc, yy, F.r, 7.8, GRAY); yy -= 10; }
      y = yy - 4;
      hline(y + 2, X.desc, W - MR, LINE, 0.4);
      y -= 6;
    }
    y -= 6;
  }

  // ── Bijlagen en zo antwoordt u ──
  y -= 6;
  if (d.files.length) {
    need(30 + d.files.length * 12);
    label("Bijlagen", ML, y);
    y -= 13;
    for (const f of d.files) { for (const t of wrap(F.r, 9, `· ${f}`, CW)) { need(12); text(t, ML, y, F.r, 9, INK); y -= 12; } }
    y -= 8;
  }
  const how = [
    "1. Vul de Excel in die bij deze prijsvraag hoort (enkel de gele vakken) en stuur ze terug naar BOWACO.",
    d.accessCode
      ? `2. Of antwoord in de app van BOWACO${d.appUrl ? ` (${d.appUrl})` : ""}: log in en geef de eerste keer de toegangscode ${d.accessCode} in. Daarna staat de prijsvraag bij Mijn prijsvragen.`
      : `2. Of antwoord in de app van BOWACO${d.appUrl ? ` (${d.appUrl})` : ""} met de toegangscode die u van BOWACO kreeg (Mijn prijsvragen).`,
    "3. Of stuur uw eigen offerte; vermeld per post de eenheidsprijs.",
    "De overeenkomst onderaanneming van BOWACO is van toepassing op de uitvoering.",
  ];
  const howLines = how.flatMap((h) => wrap(F.r, 9, h, CW - 20));
  need(howLines.length * 12 + 34);
  const boxH = howLines.length * 12 + 26;
  page.drawRectangle({ x: ML, y: y - boxH + 8, width: CW, height: boxH, borderColor: col(ACCENT), borderWidth: 0.8, color: rgb(0.96, 0.97, 1) });
  text("ZO ANTWOORDT U", ML + 10, y - 6, F.monoB, 7.5, ACCENT, 0.8);
  let yy = y - 21;
  for (const t of howLines) { text(t, ML + 10, yy, F.r, 9, INK); yy -= 12; }
  y -= boxH + 10;

  // ── Voet ──
  const n = pages.length;
  pages.forEach((p, i) => {
    page = p;
    hline(MB - 14, ML, W - MR, LINE, 0.5);
    text(`BOWACO · prijsvraag ${d.code} · ${d.firm.slice(0, 40)} · controlecode ${d.hash.slice(0, 16)}`, ML, MB - 26, F.mono, 6.8, GRAY);
    right(`${i + 1} / ${n}`, W - MR, MB - 26, F.mono, 6.8, GRAY);
  });
  return await doc.save();
}
