// De min-meerstaat als PDF (stap 2c.5, ontwerp 2c §6): een VERSIE zoals ze vastligt, A4 liggend, in de vormstijl van de offerte en de
// vorderingsstaat (wit, zwart, dunne lijnen, één kobaltblauw, monoletter voor bedragen, het woordmerk BOWACO, ingebedde lettertypes).
// Kolommen zoals de Excel: omschrijving (met bron en dag) · eenheid · aantal · eenheidsprijs · offerte · minwerk · meerwerk ·
// opmerking/akkoord; per hoofdstuk een subtotaal; onderaan totaal minwerk, meerwerk, saldo, aanneemsom + saldo, reeds gefactureerd,
// nog te factureren, en wat veranderde tegenover de vorige versie. De invoer heeft GEEN veld voor een kostprijs, marge of OA-naam
// (een versie ligt vast zoals de klant ze ziet). Afbreken per regel (les 2.12). Zonder React en zonder backend-imports: Node draait
// dit bestand rechtstreeks (tests/minmeer-2c5.mjs).
import type { PdfFonts, PdfAddress } from "./offerte.ts";
import { dayText, eur } from "./offerte.ts";

type N = bigint | number;
export type MinMeerPdfLine = { chapter: string; source: string; day: N | null; description: string; unit: string; qtyMilli: bigint; unitCents: bigint; offerCents: bigint; lessCents: bigint; extraCents: bigint; counted: boolean; approval: string; note: string };
export type MinMeerPdfData = {
  number: N;
  day: N;
  hash: string;
  issuer: string;
  clientName: string;
  workCode: string;
  workName: string;
  workAddress: PdfAddress;
  quoteRefs: string[];
  note: string;
  lines: MinMeerPdfLine[];
  chapters: { chapter: string; offerCents: bigint; lessCents: bigint; extraCents: bigint; balanceCents: bigint }[];
  invoiced: { title: string; day: N; cents: bigint }[];
  totals: { offerCents: bigint; lessCents: bigint; extraCents: bigint; balanceCents: bigint; contractCents: bigint; invoicedCents: bigint; toInvoiceCents: bigint; pendingCents: bigint; vatBp: bigint };
  changes: { kind: string; chapter: string; description: string; balanceDeltaCents: bigint }[];
  client: boolean; // voor de klant (de tekst onderaan)
  answer?: { ok: boolean; atDay: number; byName: string; note: string } | null;
};

const qf = new Intl.NumberFormat("nl-BE", { maximumFractionDigits: 3 });
const qty = (m: bigint) => qf.format(Number(m) / 1000);
const pct = (bp: bigint) => `${(Number(bp) / 100).toLocaleString("nl-BE", { maximumFractionDigits: 2 })} %`;
const dn = (x: N) => Number(x);

const INK: [number, number, number] = [0.059, 0.071, 0.094];
const GRAY: [number, number, number] = [0.325, 0.357, 0.412];
const LINE: [number, number, number] = [0.882, 0.894, 0.914];
const LINE2: [number, number, number] = [0.765, 0.784, 0.82];
const ACCENT: [number, number, number] = [0.173, 0.294, 0.878];
const BRAND: [number, number, number] = [0.118, 0.122, 0.255];
const SUNK: [number, number, number] = [0.925, 0.933, 0.945];

const W = 841.89;
const H = 595.28;
const ML = 40;
const MR = 40;
const MT = 40;
const MB = 48;
const CW = W - ML - MR;

const addressLines = (a: PdfAddress): string[] => {
  if (!a) return [];
  return [`${a.street} ${a.number}`.trim(), `${a.zip} ${a.city}`.trim(), a.country && a.country !== "BE" ? a.country : ""].filter(Boolean);
};

export async function minMeerPdf(d: MinMeerPdfData, fonts: PdfFonts): Promise<Uint8Array> {
  const { PDFDocument, rgb } = await import("pdf-lib");
  const fontkit = (await import("@pdf-lib/fontkit")).default;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`Min-meerstaat ${d.workCode} versie ${d.number}`);
  doc.setAuthor("BOWACO");
  doc.setSubject(`${d.workCode} ${d.workName}`);
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
  const known = (f: Font) => {
    let s = sets.get(f);
    if (!s) { s = new Set(f.getCharacterSet()); sets.set(f, s); }
    return s;
  };
  const clean = (f: Font, s: string) => {
    const k = known(f);
    let out = "";
    for (const ch of s.replace(/ /g, " ").replace(/[‐‑‒]/g, "-")) {
      const cp = ch.codePointAt(0)!;
      out += cp === 10 || cp === 13 || k.has(cp) ? ch : "?";
    }
    return out;
  };
  const wid = (f: Font, size: number, s: string) => f.widthOfTextAtSize(clean(f, s), size);
  // Zoals pdf/offerte.ts (review 2.12): een te breed woord per teken opschuiven in O(lengte), breedte per teken gecached.
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
    for (const ch of word) {
      const w = charW(f, size, ch);
      if (cur && curW + w > width) { parts.push(cur); cur = ""; curW = 0; }
      cur += ch;
      curW += w;
    }
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
  const text = (s: string, x: number, yy: number, f: Font, size: number, color = INK, extra: { spacing?: number } = {}) => {
    const t = clean(f, s);
    if (extra.spacing) {
      let cx = x;
      for (const ch of t) { page.drawText(ch, { x: cx, y: yy, size, font: f, color: col(color) }); cx += f.widthOfTextAtSize(ch, size) + extra.spacing; }
    } else page.drawText(t, { x, y: yy, size, font: f, color: col(color) });
  };
  const right = (s: string, xr: number, yy: number, f: Font, size: number, color = INK) => text(s, xr - wid(f, size, s), yy, f, size, color);
  const hline = (yy: number, x1 = ML, x2 = W - MR, c = LINE, th = 0.6) => page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: th, color: col(c) });
  const label = (s: string, x: number, yy: number) => text(s.toUpperCase(), x, yy, F.mono, 6.5, GRAY, { spacing: 0.6 });
  const rlabel = (s: string, xr: number, yy: number) => { const u = s.toUpperCase(); text(u, xr - wid(F.mono, 6.5, u) - u.length * 0.6, yy, F.mono, 6.5, GRAY, { spacing: 0.6 }); };
  const code = `MIN-MEER ${d.workCode} · VERSIE ${dn(d.number)}`;
  const newPage = () => {
    page = fresh();
    y = H - MT;
    text("BOWACO", ML, y - 8, F.b, 10, BRAND, { spacing: 1.4 });
    right(code, W - MR, y - 7, F.mono, 7.5, GRAY);
    hline(y - 16);
    y -= 32;
  };
  const need = (h: number) => { if (y - h < MB) { newPage(); return true; } return false; };

  // ── Kop ──
  text("BOWACO", ML, y - 16, F.b, 22, BRAND, { spacing: 2.6 });
  { const t = "MIN-MEERSTAAT"; text(t, W - MR - wid(F.mono, 6.8, t) - t.length * 0.7, y - 2, F.mono, 6.8, GRAY, { spacing: 0.7 }); }
  right(`versie ${dn(d.number)}`, W - MR, y - 17, F.monoB, 15, INK);
  right(`op ${dayText(dn(d.day))}`, W - MR, y - 30, F.mono, 8, GRAY);
  y -= 42;
  hline(y, ML, W - MR, LINE2, 0.9);
  y -= 16;
  const colW = CW / 3;
  const top = y;
  const block = (i: number, head: string, lines: string[], bold0 = true) => {
    const x = ML + i * colW;
    label(head, x, top);
    let yy = top - 13;
    lines.forEach((l, k) => { text(l, x, yy, k === 0 && bold0 ? F.m : F.r, 9, k === 0 && bold0 ? INK : GRAY); yy -= 11.5; });
    return top - yy;
  };
  const wc = (s: string, n: number) => wrap(F.r, 9, s, colW - 14).slice(0, n);
  const h1 = block(0, "Klant", wc(d.clientName || "—", 2));
  const h2 = block(1, "Werf", [...wc(`${d.workCode ? d.workCode + " · " : ""}${d.workName}`, 2), ...addressLines(d.workAddress)]);
  const h3 = block(2, "Afrekening", [`Datum: ${dayText(dn(d.day))}`, ...wc(`Offerte: ${d.quoteRefs.join(", ") || "—"}`, 3), `Bedragen excl. btw (${pct(d.totals.vatBp)})`], false);
  y = top - Math.max(h1, h2, h3) - 10;
  hline(y);
  y -= 18;
  if (d.note.trim()) {
    for (const l of wrap(F.r, 9, d.note, CW)) { need(13); text(l, ML, y, F.r, 9, INK); y -= 12; }
    y -= 6;
  }

  // ── Regels per hoofdstuk ──
  const X = { desc: ML, unit: ML + 300, qty: ML + 372, price: ML + 436, offer: ML + 506, less: ML + 572, extra: ML + 638, note: ML + 648 };
  const DESC_W = X.unit - X.desc - 8;
  const NOTE_W = ML + CW - X.note;
  const head = () => {
    need(22);
    label("Omschrijving", X.desc, y); label("Eenh.", X.unit, y);
    rlabel("Aantal", X.qty, y); rlabel("Prijs/eenh.", X.price, y); rlabel("Offerte", X.offer, y); rlabel("Minwerk", X.less, y); rlabel("Meerwerk", X.extra, y); label("Opmerking · akkoord", X.note, y);
    y -= 6;
    hline(y, ML, W - MR, LINE2, 0.8);
    y -= 11;
  };
  head();
  const chapters: string[] = [];
  for (const l of d.lines) if (!chapters.includes(l.chapter)) chapters.push(l.chapter);
  for (const ch of chapters) {
    const ls = d.lines.filter((l) => l.chapter === ch);
    const st = d.chapters.find((c) => c.chapter === ch);
    need(50);
    y -= 3;
    page.drawRectangle({ x: ML, y: y - 5, width: CW, height: 18, color: col(SUNK) });
    text(ch || "Algemeen", X.desc + 4, y, F.b, 9.5, INK);
    if (st) { right(eur(st.offerCents), X.offer, y, F.mono, 8, GRAY); right(eur(st.lessCents), X.less, y, F.mono, 8, GRAY); right(eur(st.extraCents), X.extra, y, F.mono, 8, GRAY); right(`saldo ${eur(st.balanceCents)}`, W - MR - 4, y, F.monoB, 8, INK); }
    y -= 20;
    for (const l of ls) {
      const tl = wrap(F.m, 8.6, l.description, DESC_W);
      const sub = [l.source, l.day !== null ? dayText(dn(l.day)) : ""].filter(Boolean).join(" · ");
      const nl = wrap(F.r, 7.6, [l.approval && l.approval !== "niet nodig" ? `Akkoord: ${l.approval}` : "", l.note].filter(Boolean).join(" — ") || "—", NOTE_W);
      if (need(Math.min(Math.max(tl.length, nl.length) * 11 + 18, 120))) { head(); text(`${ch || "Algemeen"} (vervolg)`, X.desc, y, F.m, 8.5, GRAY); y -= 14; }
      const y0 = y;
      const c = l.counted ? INK : GRAY;
      text(l.unit, X.unit, y0, F.r, 8, GRAY);
      if (l.qtyMilli !== 0n) right(qty(l.qtyMilli), X.qty, y0, F.mono, 8, c);
      if (l.unitCents !== 0n) right(eur(l.unitCents), X.price, y0, F.mono, 8, c);
      if (l.offerCents !== 0n) right(eur(l.offerCents), X.offer, y0, F.mono, 8, c);
      if (l.lessCents !== 0n) right(eur(l.lessCents), X.less, y0, F.mono, 8, c);
      if (l.extraCents !== 0n) right(eur(l.extraCents), X.extra, y0, F.mono, 8, c);
      let yy = y0;
      let yn = y0;
      const more = (step: number) => { if (Math.min(yy, yn) - step < MB) { newPage(); head(); text(`${ch || "Algemeen"} (vervolg)`, X.desc, y, F.m, 8.5, GRAY); y -= 14; yy = y; yn = y; } };
      for (const t of tl) { more(11); text(t, X.desc, yy, F.m, 8.6, c); yy -= 11; }
      for (const t of nl) { more(10); text(t, X.note, yn, F.r, 7.6, l.counted ? GRAY : ACCENT); yn -= 10; }
      more(9);
      text(l.counted ? sub : `${sub} · telt nog niet mee`, X.desc, yy, F.mono, 6.5, l.counted ? GRAY : ACCENT);
      yy -= 9;
      y = Math.min(yy, yn) - 2;
      hline(y + 2, X.desc, W - MR, LINE, 0.4);
      y -= 5;
    }
    y -= 4;
  }

  // ── Totalen ──
  need(170);
  y -= 4;
  const bx = ML + CW * 0.55;
  let yr = y;
  page.drawLine({ start: { x: bx, y: yr + 8 }, end: { x: W - MR, y: yr + 8 }, thickness: 0.8, color: col(LINE2) });
  const rowR = (l: string, v: string, bigRow = false) => { text(l, bx, yr, bigRow ? F.b : F.r, bigRow ? 10.5 : 9, INK); right(v, W - MR, yr, bigRow ? F.monoB : F.mono, bigRow ? 10.5 : 9, INK); yr -= bigRow ? 17 : 13; };
  const t = d.totals;
  rowR("Offerte (aanneemsom)", eur(t.offerCents));
  rowR("Totaal minwerk", eur(t.lessCents));
  rowR("Totaal meerwerk", eur(t.extraCents));
  rowR("Saldo min-meer", eur(t.balanceCents), true);
  page.drawLine({ start: { x: bx, y: yr + 7 }, end: { x: W - MR, y: yr + 7 }, thickness: 0.9, color: col(INK) });
  yr -= 4;
  rowR("Aanneemsom + saldo", eur(t.contractCents), true);
  rowR("Reeds gefactureerd", eur(t.invoicedCents));
  rowR("Nog te factureren (excl. btw)", eur(t.toInvoiceCents), true);
  if (t.pendingCents !== 0n) { text(`In afwachting van een akkoord (telt niet mee): ${eur(t.pendingCents)}`, bx, yr, F.r, 8, ACCENT); yr -= 12; }
  let yl = y;
  if (d.invoiced.length) {
    label("Reeds gefactureerd", ML, yl);
    yl -= 13;
    for (const x of d.invoiced.slice(0, 10)) { text(`${x.title} · ${dayText(dn(x.day))}`.slice(0, 70), ML, yl, F.r, 8.5, INK); right(eur(x.cents), ML + CW * 0.45, yl, F.mono, 8.5, INK); yl -= 12; }
    if (d.invoiced.length > 10) { text(`… en ${d.invoiced.length - 10} meer`, ML, yl, F.r, 8, GRAY); yl -= 12; }
  }
  y = Math.min(yl, yr) - 14;

  // ── Wat veranderde ──
  if (d.changes.length) {
    need(40);
    label("Wat veranderde tegenover de vorige versie", ML, y);
    y -= 13;
    for (const c of d.changes) {
      need(12);
      text(`${c.kind} · ${c.chapter ? c.chapter + " · " : ""}${c.description}`.slice(0, 140), ML, y, F.r, 8.5, INK);
      right(eur(c.balanceDeltaCents), W - MR, y, F.mono, 8.5, INK);
      y -= 12;
    }
    y -= 6;
  }

  // ── Akkoord ──
  need(60);
  if (d.answer) {
    page.drawRectangle({ x: ML, y: y - 34, width: CW, height: 42, borderColor: col(ACCENT), borderWidth: 0.9, color: rgb(0.96, 0.97, 1) });
    text(d.answer.ok ? "AKKOORD VAN DE KLANT" : "OPMERKING VAN DE KLANT", ML + 10, y - 6, F.monoB, 7.5, ACCENT, { spacing: 1 });
    text(`${d.answer.byName} op ${dayText(d.answer.atDay)}${d.answer.ok ? "" : `: ${d.answer.note}`}`.slice(0, 160), ML + 10, y - 20, F.r, 8.5, INK);
    text(`Controlecode van deze inhoud: ${d.hash.slice(0, 32)}…`, ML + 10, y - 30, F.mono, 6.8, GRAY);
    y -= 48;
  } else if (d.client) {
    for (const s of wrap(F.r, 8, "U kunt deze min-meerstaat nakijken en uw akkoord of een opmerking geven in de app BOWACO (Mijn werf → Facturatie), na het inloggen.", CW)) { text(s, ML, y, F.r, 8, GRAY); y -= 11; }
  }
  const iss = d.issuer.split(/\r?\n/).filter((x) => x.trim());
  if (iss.length) {
    need(iss.length * 10 + 20);
    y -= 6;
    label("Afzender", ML, y);
    y -= 11;
    iss.forEach((s, k) => { text(s, ML, y, k === 0 ? F.m : F.r, 8, k === 0 ? INK : GRAY); y -= 10; });
  }

  const n = pages.length;
  pages.forEach((p, i) => {
    page = p;
    hline(MB - 12, ML, W - MR, LINE, 0.5);
    text(`BOWACO · min-meerstaat ${d.workCode} versie ${dn(d.number)} · ${d.hash ? d.hash.slice(0, 16) : ""}`, ML, MB - 24, F.mono, 6.8, GRAY);
    right(`${i + 1} / ${n}`, W - MR, MB - 24, F.mono, 6.8, GRAY);
  });
  return await doc.save();
}
