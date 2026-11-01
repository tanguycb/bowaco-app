// De factuur en de creditnota als PDF (stap 2c.6, ontwerp 2c §6 en §7.2): A4 staand, in de vormstijl van de offerte en de
// vorderingsstaat (wit, zwart, dunne lijnen, één kobaltblauw, monoletter voor bedragen, het woordmerk BOWACO, ingebedde lettertypes).
// Zoals de huidige Excel: per hoofdstuk de regels ("Voorschot 50 % op offerte …"), onderaan "reeds gefactureerd", maatstaf van heffing
// en btw per tarief, totaal, de gestructureerde mededeling en de vaste vermeldingen (6 %, btw verlegd), plus wat de wet vraagt
// (afzender met rechtsvorm, zetel, btw-nummer, ondernemingsnummer, RPR; klant met btw-nummer; datum van de dienst; vervaldag; werf en
// werfcode). Ook de herinnering bij een vervallen factuur (2c.6b). De invoer heeft GEEN veld voor een kostprijs, marge of OA-naam.
// Afbreken per regel (les 2.12). Zonder React en zonder backend-imports: Node draait dit bestand rechtstreeks (tests/factuur-2c6.mjs).
import type { PdfFonts, PdfAddress } from "./offerte.ts";
import { dayText, eur } from "./offerte.ts";

type N = bigint | number;
export type FactuurPdfLine = { kind: string; group: string; description: string; qtyMilli: bigint; unit: string; unitCents: bigint; amountCents: bigint; vatBp: bigint; baseCents: bigint | null; pctBp: bigint | null };
export type FactuurPdfIssuer = { name: string; legalForm: string; address: PdfAddress; vat: string; kbo: string; rpr: string; email: string; phone: string; website: string; iban: string; bic: string };
export type FactuurPdfData = {
  number: string;
  kindText: string;
  draft: boolean;
  issueDay: N;
  serviceDay: N | null;
  serviceTo: N | null;
  dueDay: N;
  paymentDays: N;
  issuer: FactuurPdfIssuer;
  buyer: { name: string; address: PdfAddress; vat: string; kbo: string; company: boolean };
  workCode: string;
  workName: string;
  workAddress: PdfAddress;
  analyticCode: string;
  quoteRefs: string[];
  title: string;
  note: string;
  lines: FactuurPdfLine[];
  previous: { number: string; day: N; cents: bigint; revisionCents: bigint }[];
  vatLines: { vatBp: bigint; reverse: boolean; baseCents: bigint; vatCents: bigint }[];
  netCents: bigint;
  vatCents: bigint;
  totalCents: bigint;
  mentions: string[];
  paymentRef: string;
  creditOf: string | null;
  creditOfDay: N | null;
  hash: string;
  reminder?: { level: number; day: N; text: string; openCents: bigint; paidCents: bigint } | null;
};

const qf = new Intl.NumberFormat("nl-BE", { maximumFractionDigits: 3 });
const qty = (m: bigint) => qf.format(Number(m) / 1000);
export const pctText = (bp: bigint) => `${(Number(bp) / 100).toLocaleString("nl-BE", { maximumFractionDigits: 2 })} %`;
const dn = (x: N) => Number(x);

const INK: [number, number, number] = [0.059, 0.071, 0.094];
const GRAY: [number, number, number] = [0.325, 0.357, 0.412];
const LINE: [number, number, number] = [0.882, 0.894, 0.914];
const LINE2: [number, number, number] = [0.765, 0.784, 0.82];
const ACCENT: [number, number, number] = [0.173, 0.294, 0.878];
const BRAND: [number, number, number] = [0.118, 0.122, 0.255];
const SUNK: [number, number, number] = [0.925, 0.933, 0.945];

const W = 595.28;
const H = 841.89;
const ML = 44;
const MR = 44;
const MT = 44;
const MB = 52;
const CW = W - ML - MR;

const addressLines = (a: PdfAddress): string[] => {
  if (!a) return [];
  return [`${a.street} ${a.number}`.trim(), `${a.zip} ${a.city}`.trim(), a.country && a.country !== "BE" ? a.country : ""].filter(Boolean);
};

/** De woorden die op elke uitgereikte factuur moeten staan (§7.2); de proef zoekt ze in de tekst van de PDF. */
export function verplicht(d: FactuurPdfData): string[] {
  const out = [d.number, d.issuer.name, d.issuer.vat, d.issuer.kbo, d.issuer.rpr, d.issuer.iban, d.buyer.name, d.workCode];
  if (d.buyer.vat) out.push(d.buyer.vat);
  if (d.paymentRef) out.push(d.paymentRef);
  if (d.creditOf) out.push(d.creditOf);
  return out.filter((x) => x && x.trim());
}

export async function factuurPdf(d: FactuurPdfData, fonts: PdfFonts): Promise<Uint8Array> {
  const { PDFDocument, rgb } = await import("pdf-lib");
  const fontkit = (await import("@pdf-lib/fontkit")).default;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`${d.kindText} ${d.number}`);
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
  const reminder = d.reminder ?? null;
  const kind = reminder ? `Herinnering ${reminder.level}` : d.kindText;
  const code = `${kind.toUpperCase()} ${d.draft ? "ONTWERP" : d.number}`;
  const newPage = () => {
    page = fresh();
    y = H - MT;
    text("BOWACO", ML, y - 8, F.b, 10, BRAND, { spacing: 1.4 });
    right(code, W - MR, y - 7, F.mono, 7.5, GRAY);
    hline(y - 16);
    y -= 32;
  };
  const need = (h: number) => { if (y - h < MB) { newPage(); return true; } return false; };
  const para = (s: string, f: Font, size: number, color = INK, width = CW, x = ML) => {
    for (const l of wrap(f, size, s, width)) { need(size + 4); text(l, x, y, f, size, color); y -= size + 3; }
  };

  // ── Kop ──
  text("BOWACO", ML, y - 16, F.b, 22, BRAND, { spacing: 2.6 });
  { const t = kind.toUpperCase(); text(t, W - MR - wid(F.mono, 7, t) - t.length * 0.7, y - 2, F.mono, 7, GRAY, { spacing: 0.7 }); }
  right(d.draft ? "ONTWERP" : d.number, W - MR, y - 18, F.monoB, 15, d.draft ? ACCENT : INK);
  right(`datum ${dayText(dn(reminder ? reminder.day : d.issueDay))}`, W - MR, y - 31, F.mono, 8, GRAY);
  y -= 44;
  if (d.draft) {
    page.drawRectangle({ x: ML, y: y - 16, width: CW, height: 18, color: col(SUNK) });
    text("Ontwerp: nog geen factuur (geen nummer, niet geldig). Het nummer komt bij het uitreiken.", ML + 6, y - 10, F.m, 8.5, ACCENT);
    y -= 24;
  }
  hline(y, ML, W - MR, LINE2, 0.9);
  y -= 16;
  const colW = CW / 3;
  const top = y;
  const block = (i: number, head: string, lines: string[]) => {
    const x = ML + i * colW;
    label(head, x, top);
    let yy = top - 13;
    lines.forEach((l, k) => { for (const w of wrap(k === 0 ? F.m : F.r, 8.5, l, colW - 12)) { text(w, x, yy, k === 0 ? F.m : F.r, 8.5, k === 0 ? INK : GRAY); yy -= 11; } });
    return top - yy;
  };
  const is = d.issuer;
  const h1 = block(0, "Van", [`${is.name}${is.legalForm ? " " + is.legalForm : ""}`, ...addressLines(is.address), is.vat ? `Btw ${is.vat}` : "", is.kbo ? `Ondernemingsnr. ${is.kbo}` : "", is.rpr, [is.email, is.website].filter(Boolean).join(" · ")].filter(Boolean));
  const h2 = block(1, "Aan", [d.buyer.name || "—", ...addressLines(d.buyer.address), d.buyer.vat ? `Btw ${d.buyer.vat}` : ""].filter(Boolean));
  const h3 = block(2, "Werf", [`${d.workCode}${d.workName ? " · " + d.workName : ""}`, ...addressLines(d.workAddress), d.quoteRefs.length ? `Offerte ${d.quoteRefs.join(", ")}` : "", d.analyticCode ? `Werfcode ${d.analyticCode}` : ""].filter(Boolean));
  y = top - Math.max(h1, h2, h3) - 8;
  hline(y);
  y -= 16;
  // Datums: factuurdatum, datum van de dienst (als ze verschilt), vervaldag.
  {
    const svc = d.serviceDay !== null ? (d.serviceTo !== null && dn(d.serviceTo) !== dn(d.serviceDay) ? `${dayText(dn(d.serviceDay))} tot ${dayText(dn(d.serviceTo))}` : dayText(dn(d.serviceDay))) : "";
    const cells: [string, string][] = [["Factuurdatum", dayText(dn(d.issueDay))]];
    if (svc) cells.push(["Datum van de dienst", svc]);
    if (!d.creditOf) cells.push(["Vervaldag", `${dayText(dn(d.dueDay))} (${dn(d.paymentDays)} dagen)`]);
    else cells.push(["Bij factuur", `${d.creditOf}${d.creditOfDay !== null ? " van " + dayText(dn(d.creditOfDay)) : ""}`]);
    const cw = CW / cells.length;
    cells.forEach(([k, v], i) => { label(k, ML + i * cw, y); text(v, ML + i * cw, y - 12, F.r, 8.5, INK); });
    y -= 28;
  }
  if (d.title.trim()) { para(d.title, F.m, 11); y -= 2; }
  if (d.note.trim()) { para(d.note, F.r, 9, GRAY); y -= 4; }
  if (reminder) {
    need(60);
    page.drawRectangle({ x: ML, y: y - 18, width: CW, height: 22, color: col(SUNK) });
    text(`Openstaand: ${eur(reminder.openCents)} (factuur ${d.number}, vervallen op ${dayText(dn(d.dueDay))})`, ML + 8, y - 10, F.m, 9.5, INK);
    y -= 30;
    para(reminder.text, F.r, 9, INK);
    y -= 8;
  }

  // ── Regels per hoofdstuk ──
  const X = { desc: ML, base: ML + 268, qty: ML + 318, unit: ML + 324, price: ML + 412, vat: ML + 446, amount: ML + CW };
  const DESC_W = X.base - X.desc - 70;
  const head = () => {
    need(22);
    label("Omschrijving", X.desc, y); rlabel("Basis", X.base, y); rlabel("Aantal", X.qty, y); label("Eenh.", X.unit, y);
    rlabel("Prijs/eenh.", X.price, y); rlabel("Btw", X.vat, y); rlabel("Bedrag", X.amount, y);
    y -= 6;
    hline(y, ML, W - MR, LINE2, 0.6);
    y -= 12;
  };
  head();
  let group: string | null = null;
  const shown = d.lines;
  for (const l of shown) {
    if (l.group !== group) {
      group = l.group;
      if (need(30)) head();
      y -= 2;
      text(group || "Algemeen", X.desc, y, F.m, 9, INK);
      y -= 13;
    }
    const descLines = wrap(F.r, 8.5, l.description, DESC_W + 60);
    const hgt = descLines.length * 11 + 3;
    if (need(hgt)) head();
    descLines.forEach((s, k) => text(s, X.desc + 8, y - k * 11, F.r, 8.5, l.kind === "aftrek" ? GRAY : INK));
    if (l.baseCents !== null) right(`${eur(l.baseCents)}${l.pctBp !== null ? " × " + pctText(l.pctBp) : ""}`, X.base, y, F.mono, 7, GRAY);
    if (!(l.unit === "ff" && l.qtyMilli === 1000n)) { right(qty(l.qtyMilli), X.qty, y, F.mono, 7.5); text(l.unit, X.unit, y, F.r, 7.5, GRAY); right(eur(l.unitCents), X.price, y, F.mono, 7.5); }
    right(pctText(l.vatBp), X.vat, y, F.mono, 7, GRAY);
    right(eur(l.amountCents), X.amount, y, F.monoB, 8);
    y -= hgt;
  }
  y -= 4;
  hline(y);
  y -= 14;

  // ── Reeds gefactureerd (ter info; bij de slotfactuur staat de aftrek bij de regels) ──
  if (d.previous.length && !d.lines.some((l) => l.kind === "aftrek")) {
    need(30);
    label("Reeds gefactureerd op deze werf", ML, y);
    y -= 12;
    for (const p of d.previous) {
      need(12);
      text(`${p.number} van ${dayText(dn(p.day))}`, ML + 8, y, F.r, 8.5, GRAY);
      right(eur(p.cents) + (p.revisionCents !== 0n ? ` + prijsherziening ${eur(p.revisionCents)}` : ""), X.amount, y, F.mono, 8, GRAY);
      y -= 11;
    }
    y -= 8;
  }

  // ── Btw per tarief en totaal ──
  need(30 + d.vatLines.length * 26);
  const TX = ML + CW * 0.45;
  for (const v of d.vatLines) {
    if (v.reverse) {
      text("Maatstaf van heffing, btw verlegd (0 %)", TX, y, F.r, 9); right(eur(v.baseCents), X.amount, y, F.mono, 9); y -= 13;
    } else {
      text(`Maatstaf van heffing ${pctText(v.vatBp)}`, TX, y, F.r, 9); right(eur(v.baseCents), X.amount, y, F.mono, 9); y -= 13;
      text(`Btw ${pctText(v.vatBp)}`, TX, y, F.r, 9); right(eur(v.vatCents), X.amount, y, F.mono, 9); y -= 13;
    }
  }
  hline(y + 4, TX, W - MR, LINE2, 0.6);
  y -= 8;
  text("Totaal excl. btw", TX, y, F.r, 9); right(eur(d.netCents), X.amount, y, F.mono, 9); y -= 13;
  text("Btw", TX, y, F.r, 9); right(eur(d.vatCents), X.amount, y, F.mono, 9); y -= 16;
  page.drawRectangle({ x: TX - 6, y: y - 6, width: W - MR - TX + 6, height: 20, color: col(SUNK) });
  text(d.creditOf ? "Totaal creditnota" : "Te betalen", TX, y, F.b, 10.5); right(eur(d.totalCents), X.amount, y, F.monoB, 11);
  y -= 30;

  // ── Betaling en vermeldingen ──
  if (!d.creditOf) {
    need(40);
    label("Betaling", ML, y);
    y -= 12;
    para(`Te betalen uiterlijk op ${dayText(dn(d.dueDay))} op rekening ${is.iban || "—"}${is.bic ? " (BIC " + is.bic + ")" : ""} met de mededeling ${d.paymentRef || "(volgt bij het uitreiken)"}.`, F.r, 9);
    y -= 6;
  }
  for (const m of d.mentions) { if (m.trim()) { need(20); para(m, F.r, 7.8, GRAY); y -= 5; } }

  const n = pages.length;
  pages.forEach((p, i) => {
    page = p;
    hline(MB - 12, ML, W - MR, LINE, 0.5);
    text(`BOWACO · ${kind.toLowerCase()} ${d.draft ? "ontwerp" : d.number} · ${d.workCode} · ${d.hash ? d.hash.slice(0, 16) : ""}`, ML, MB - 24, F.mono, 6.8, GRAY);
    right(`${i + 1} / ${n}`, W - MR, MB - 24, F.mono, 6.8, GRAY);
  });
  return await doc.save();
}
