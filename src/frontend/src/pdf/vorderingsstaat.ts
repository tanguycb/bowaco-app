// De vorderingsstaat als PDF (stap 2.10, bouwplan §9 rij 2.10): A4 liggend, in de vormstijl van de offerte-PDF (2.7: wit, zwart,
// dunne lijnen, één kobaltblauw voor kleine accenten, een monoletter voor codes en bedragen, het woordmerk BOWACO, ingebedde
// lettertypes Archivo en IBM Plex Mono). Inhoud: klant, werf, periode, per sectie (aanneming, meerwerk, minderwerk, regie) de
// posten met offerte, vorige staten, tot nu en deze periode; de totalen met prijsherziening, btw (met de grond bij 6 %), de
// inhouding van de waarborg, te betalen en de vervaldag; het akkoord van de klant. De invoer (ProgressPdfData) heeft GEEN veld
// voor een aankoopprijs of marge. Zonder React en zonder backend-imports: Node draait dit bestand rechtstreeks (tests/pdf.mjs).
import type { PdfFonts, PdfAddress } from "./offerte.ts";
import { dayText, eur } from "./offerte.ts";

export type ProgressPdfLine = {
  section: "contract" | "extra" | "less" | "regie";
  basis: "percent" | "quantity" | "hours";
  code: string;
  title: string;
  chapter: string;
  unit: string;
  offerQtyMilli: bigint;
  unitPriceCents: bigint;
  offerCents: bigint;
  prevPctBp: bigint;
  prevQtyMilli: bigint;
  prevCents: bigint;
  cumPctBp: bigint;
  cumQtyMilli: bigint;
  cumCents: bigint;
  periodCents: bigint;
};
export type ProgressPdfData = {
  code: string; // "VS P-A/1" · "CN P-A/1" · "" (ontwerp)
  credit: boolean;
  creditsCode: string;
  frozen: boolean; // false = voorbeeld van een ontwerp (watermerk)
  hash: string;
  periodFrom: number;
  periodTo: number;
  sendDay: number | null;
  dueDay: number | null;
  paymentDays: number;
  issuer: string;
  clientName: string;
  clientAddress: PdfAddress;
  clientVat: string;
  workCode: string;
  workName: string;
  workAddress: PdfAddress;
  quoteRefs: string[];
  vatBp: bigint;
  vatNote: string;
  note: string;
  guarantee: string; // "none" · "retention" · "bankGuarantee"
  retentionOnIncl: boolean;
  revision: { formula: string; aBp: bigint; bBp: bigint; cBp: bigint; sBase: bigint; iBase: bigint; sIndex: bigint; iIndex: bigint; sLabel: string; iLabel: string } | null;
  lines: ProgressPdfLine[];
  totals: {
    periodCents: bigint;
    prevCents: bigint;
    cumCents: bigint;
    offerCents: bigint;
    restCents: bigint;
    revisionCents: bigint;
    subtotalCents: bigint;
    vatCents: bigint;
    totalCents: bigint;
    retentionBp: bigint;
    retentionCents: bigint;
    payableCents: bigint;
    sections: { section: string; offerCents: bigint; prevCents: bigint; cumCents: bigint; periodCents: bigint }[];
  };
  answer: { ok: boolean; atDay: number; byName: string; note: string } | null;
};

const qf = new Intl.NumberFormat("nl-BE", { maximumFractionDigits: 3 });
const qty = (m: bigint) => qf.format(Number(m) / 1000);
const pct = (bp: bigint) => `${(Number(bp) / 100).toLocaleString("nl-BE", { maximumFractionDigits: 2 })} %`;
const idx = (m: bigint) => (Number(m) / 1000).toLocaleString("nl-BE", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
const SECTION: Record<string, string> = { contract: "Aanneming (getekende offerte)", extra: "Meerwerk", less: "Minderwerk", regie: "Regie" };

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

export async function progressPdf(d: ProgressPdfData, fonts: PdfFonts): Promise<Uint8Array> {
  const { PDFDocument, rgb, degrees } = await import("pdf-lib");
  const fontkit = (await import("@pdf-lib/fontkit")).default;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const kind = d.credit ? "Creditnota" : "Vorderingsstaat";
  doc.setTitle(`${kind} ${d.code || "ontwerp"}`);
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
  const wrap = (f: Font, size: number, s: string, width: number): string[] => {
    const out: string[] = [];
    for (const para of s.split(/\r?\n/)) {
      if (para.trim() === "") { out.push(""); continue; }
      let cur = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        let w = word;
        while (wid(f, size, w) > width) {
          let n = w.length;
          while (n > 1 && wid(f, size, w.slice(0, n)) > width) n--;
          if (cur) { out.push(cur); cur = ""; }
          out.push(w.slice(0, n));
          w = w.slice(n);
        }
        const next = cur ? `${cur} ${w}` : w;
        if (wid(f, size, next) > width && cur) { out.push(cur); cur = w; } else cur = next;
      }
      if (cur) out.push(cur);
    }
    return out;
  };

  const pages: ReturnType<typeof doc.addPage>[] = [];
  const fresh = () => {
    const p = doc.addPage([W, H]);
    if (!d.frozen) p.drawText("ONTWERP", { x: 200, y: 140, size: 120, font: F.b, color: rgb(0.93, 0.94, 0.955), rotate: degrees(25) });
    pages.push(p);
    return p;
  };
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
  const title = `${d.credit ? "CREDITNOTA" : "VORDERINGSSTAAT"} ${d.code || "ONTWERP"}`;
  const newPage = () => {
    page = fresh();
    y = H - MT;
    text("BOWACO", ML, y - 8, F.b, 10, BRAND, { spacing: 1.4 });
    right(title, W - MR, y - 7, F.mono, 7.5, GRAY);
    hline(y - 16);
    y -= 32;
  };
  const need = (h: number) => { if (y - h < MB) { newPage(); return true; } return false; };

  // ── Kop ──
  text("BOWACO", ML, y - 16, F.b, 22, BRAND, { spacing: 2.6 });
  { const t = d.credit ? "CREDITNOTA" : "VORDERINGSSTAAT"; text(t, W - MR - wid(F.mono, 6.8, t) - t.length * 0.7, y - 2, F.mono, 6.8, GRAY, { spacing: 0.7 }); }
  right(d.code || "ontwerp", W - MR, y - 17, F.monoB, 15, INK);
  right(d.credit && d.creditsCode ? `crediteert ${d.creditsCode}` : `periode ${dayText(d.periodFrom)} – ${dayText(d.periodTo)}`, W - MR, y - 30, F.mono, 8, GRAY);
  y -= 42;
  hline(y, ML, W - MR, LINE2, 0.9);
  y -= 16;
  const colW = CW / 4;
  const top = y;
  const block = (i: number, head: string, lines: string[], bold0 = true) => {
    const x = ML + i * colW;
    label(head, x, top);
    let yy = top - 13;
    lines.forEach((l, k) => { text(l, x, yy, k === 0 && bold0 ? F.m : F.r, 9, k === 0 && bold0 ? INK : GRAY); yy -= 11.5; });
    return top - yy;
  };
  const wc = (s: string, n: number) => wrap(F.r, 9, s, colW - 14).slice(0, n);
  const h1 = block(0, "Klant", [...wc(d.clientName || "—", 2), ...addressLines(d.clientAddress), ...(d.clientVat ? [`BTW ${d.clientVat}`] : [])]);
  const h2 = block(1, "Werf", [...wc(`${d.workCode ? d.workCode + " · " : ""}${d.workName}`, 2), ...addressLines(d.workAddress)]);
  const h3 = block(2, "Staat", [
    `Datum: ${d.sendDay !== null ? dayText(d.sendDay) : "—"}`,
    `Vervaldag: ${d.dueDay !== null ? dayText(d.dueDay) : `${d.paymentDays} dagen na datum`}`,
    `Periode: ${dayText(d.periodFrom)} – ${dayText(d.periodTo)}`,
    d.quoteRefs.length ? `Offerte: ${d.quoteRefs.join(", ")}` : "",
  ].filter(Boolean), false);
  const contract = [
    `Btw-tarief: ${pct(d.vatBp)}`,
    d.guarantee === "retention" ? `Waarborg: inhouding ${pct(d.totals.retentionBp)} (${d.retentionOnIncl ? "incl." : "excl."} btw)` : d.guarantee === "bankGuarantee" ? "Waarborg: bankwaarborg" : "Waarborg: geen",
    d.revision ? "Prijsherziening: volgens formule" : "Prijsherziening: geen",
  ];
  const h4 = block(3, "Contract", contract, false);
  y = top - Math.max(h1, h2, h3, h4) - 10;
  hline(y);
  y -= 18;
  if (d.note.trim()) {
    for (const l of wrap(F.r, 9, d.note, CW)) { need(13); text(l, ML, y, F.r, 9, INK); y -= 12; }
    y -= 6;
  }

  // ── Posten per sectie ──
  const X = { code: ML, desc: ML + 40, unit: ML + 262, offerQ: ML + 336, price: ML + 400, offer: ML + 470, prev: ML + 540, cumQ: ML + 600, cum: ML + 670, period: ML + CW };
  const DESC_W = X.unit - X.desc - 8;
  const head = () => {
    need(22);
    label("Code", X.code, y); label("Omschrijving", X.desc, y); label("Eenh.", X.unit, y);
    rlabel("Offerte", X.offerQ, y); rlabel("Prijs/eenh.", X.price, y); rlabel("Bedrag off.", X.offer, y); rlabel("Vorige", X.prev, y); rlabel("Tot nu", X.cumQ, y); rlabel("Tot nu €", X.cum, y); rlabel("Deze periode", X.period, y);
    y -= 6;
    hline(y, ML, W - MR, LINE2, 0.8);
    y -= 11;
  };
  const cumOf = (l: ProgressPdfLine) => (l.basis === "percent" ? pct(l.cumPctBp) : qty(l.cumQtyMilli));
  let first = true;
  for (const sec of ["contract", "extra", "less", "regie"] as const) {
    const ls = d.lines.filter((l) => l.section === sec);
    if (ls.length === 0) continue;
    const st = d.totals.sections.find((s) => s.section === sec);
    need(60);
    if (first) { head(); first = false; }
    y -= 3;
    page.drawRectangle({ x: ML, y: y - 5, width: CW, height: 18, color: col(SUNK) });
    text(SECTION[sec], X.code + 4, y, F.b, 9.5, INK);
    if (st) { right(eur(st.offerCents), X.offer, y, F.mono, 8, GRAY); right(eur(st.prevCents), X.prev, y, F.mono, 8, GRAY); right(eur(st.cumCents), X.cum, y, F.mono, 8, GRAY); right(eur(st.periodCents), X.period - 4, y, F.monoB, 8.5, INK); }
    y -= 20;
    for (const l of ls) {
      const tl = wrap(F.m, 8.8, l.title, DESC_W);
      const sub = [l.chapter, l.basis === "percent" ? "% uitgevoerd" : l.basis === "hours" ? "regie-uren" : "volgens opmeting"].filter(Boolean).join(" · ");
      const h = tl.length * 11 + 18;
      if (need(h)) { head(); text(`${SECTION[sec]} (vervolg)`, X.desc, y, F.m, 8.5, GRAY); y -= 14; }
      const y0 = y;
      if (l.code) text(l.code, X.code + 4, y0, F.mono, 7.5, GRAY);
      text(l.unit, X.unit, y0, F.r, 8, GRAY);
      right(qty(l.offerQtyMilli), X.offerQ, y0, F.mono, 8, INK);
      right(eur(l.unitPriceCents), X.price, y0, F.mono, 8, INK);
      right(eur(l.offerCents), X.offer, y0, F.mono, 8, INK);
      right(eur(l.prevCents), X.prev, y0, F.mono, 8, GRAY);
      right(cumOf(l), X.cumQ, y0, F.mono, 8, l.basis === "percent" ? ACCENT : INK);
      right(eur(l.cumCents), X.cum, y0, F.mono, 8, INK);
      right(eur(l.periodCents), X.period - 4, y0, F.monoB, 8.2, INK);
      let yy = y0;
      for (const t of tl) { text(t, X.desc, yy, F.m, 8.8, INK); yy -= 11; }
      text(sub, X.desc, yy, F.mono, 6.5, GRAY);
      yy -= 9;
      y = yy - 2;
      hline(y + 2, X.desc, W - MR, LINE, 0.4);
      y -= 5;
    }
    y -= 4;
  }

  // ── Totalen ──
  need(190);
  y -= 4;
  const bx = ML + CW * 0.55;
  const lx = ML;
  // links: cumulatief; rechts: deze periode
  let yl = y;
  label("Cumulatief", lx, yl);
  yl -= 14;
  const rowL = (l: string, v: string, b = false) => { text(l, lx, yl, b ? F.m : F.r, 9, INK); right(v, lx + CW * 0.4, yl, b ? F.monoB : F.mono, 9, INK); yl -= 13; };
  rowL("Offerte (aangepast, excl. btw)", eur(d.totals.offerCents));
  rowL("Vorige staten", eur(d.totals.prevCents));
  rowL("Totaal uitgevoerd tot nu", eur(d.totals.cumCents), true);
  rowL("Nog te factureren", eur(d.totals.restCents));
  if (d.revision) {
    yl -= 6;
    const r = d.revision;
    const lines = wrap(F.r, 7.8, `Prijsherziening: ${r.formula}. Model: ${pct(r.aBp)} · s/S + ${pct(r.bBp)} · i/I + ${pct(r.cBp)}; S = ${idx(r.sBase)}, I = ${idx(r.iBase)}; deze staat: s = ${idx(r.sIndex)}${r.sLabel ? ` (${r.sLabel})` : ""}, i = ${idx(r.iIndex)}${r.iLabel ? ` (${r.iLabel})` : ""}. Herzien wordt het bedrag van deze periode zonder regie.`, CW * 0.48);
    for (const t of lines) { text(t, lx, yl, F.r, 7.8, GRAY); yl -= 10; }
  }
  let yr = y;
  page.drawLine({ start: { x: bx, y: yr + 8 }, end: { x: W - MR, y: yr + 8 }, thickness: 0.8, color: col(LINE2) });
  const rowR = (l: string, v: string, big = false) => { text(l, bx, yr, big ? F.b : F.r, big ? 10.5 : 9, INK); right(v, W - MR, yr, big ? F.monoB : F.mono, big ? 10.5 : 9, INK); yr -= big ? 17 : 13; };
  rowR("Deze periode excl. btw", eur(d.totals.periodCents));
  if (d.revision || d.totals.revisionCents !== 0n) rowR("Prijsherziening", eur(d.totals.revisionCents));
  rowR("Subtotaal excl. btw", eur(d.totals.subtotalCents));
  rowR(`Btw ${pct(d.vatBp)}`, eur(d.totals.vatCents));
  if (d.vatBp === 600n && d.vatNote.trim()) {
    for (const t of wrap(F.r, 7.5, `Grond voor het btw-tarief: ${d.vatNote}`, W - MR - bx)) { text(t, bx, yr + 1, F.r, 7.5, GRAY); yr -= 9.5; }
    yr -= 2;
  }
  page.drawLine({ start: { x: bx, y: yr + 7 }, end: { x: W - MR, y: yr + 7 }, thickness: 0.9, color: col(INK) });
  yr -= 4;
  rowR("Totaal incl. btw", eur(d.totals.totalCents), true);
  if (d.totals.retentionCents !== 0n) {
    rowR(`Inhouding waarborg ${pct(d.totals.retentionBp)}`, eur(-d.totals.retentionCents));
    rowR("Te betalen", eur(d.totals.payableCents), true);
  }
  if (d.dueDay !== null) { text(`Te betalen uiterlijk op ${dayText(d.dueDay)} (${d.paymentDays} dagen).`, bx, yr, F.r, 8, GRAY); yr -= 12; }
  y = Math.min(yl, yr) - 14;

  // ── Akkoord ──
  if (!d.credit) {
    need(70);
    if (d.answer) {
      page.drawRectangle({ x: ML, y: y - 34, width: CW, height: 42, borderColor: col(ACCENT), borderWidth: 0.9, color: rgb(0.96, 0.97, 1) });
      text(d.answer.ok ? "AKKOORD VAN DE KLANT" : "OPMERKING VAN DE KLANT", ML + 10, y - 6, F.monoB, 7.5, ACCENT, { spacing: 1 });
      text(`${d.answer.byName} op ${dayText(d.answer.atDay)}${d.answer.ok ? "" : `: ${d.answer.note}`}`.slice(0, 160), ML + 10, y - 20, F.r, 8.5, INK);
      text(`Geldt voor exact deze inhoud: ${d.hash.slice(0, 32)}…`, ML + 10, y - 30, F.mono, 6.8, GRAY);
      y -= 48;
    } else if (d.frozen) {
      for (const t of wrap(F.r, 8, "U kunt deze vorderingsstaat nakijken en uw akkoord geven in de app BOWACO (Mijn vorderingsstaten), na aanmelding met uw Internet Identity.", CW)) { text(t, ML, y, F.r, 8, GRAY); y -= 11; }
    }
  }
  const iss = d.issuer.split(/\r?\n/).filter((x) => x.trim());
  if (iss.length) {
    need(iss.length * 10 + 20);
    y -= 6;
    label("Afzender", ML, y);
    y -= 11;
    iss.forEach((t, k) => { text(t, ML, y, k === 0 ? F.m : F.r, 8, k === 0 ? INK : GRAY); y -= 10; });
  }

  const n = pages.length;
  pages.forEach((p, i) => {
    page = p;
    hline(MB - 12, ML, W - MR, LINE, 0.5);
    text(`BOWACO · ${d.credit ? "creditnota" : "vorderingsstaat"} ${d.code || "ontwerp"} · ${d.workCode} · ${d.frozen && d.hash ? d.hash.slice(0, 16) : "ONTWERP"}`, ML, MB - 24, F.mono, 6.8, GRAY);
    right(`${i + 1} / ${n}`, W - MR, MB - 24, F.mono, 6.8, GRAY);
  });
  return await doc.save();
}
