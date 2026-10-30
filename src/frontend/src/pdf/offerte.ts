// De offerte als PDF (stap 2.7, bouwplan §9 rij 2.7 ⚖): A4 in de vormstijl van het design system v2 (zakelijk en strak: wit,
// zwart, dunne lijnen, één kobaltblauw voor kleine accenten, een monoletter voor codes en bedragen; NIET de stijl van
// bowaco.eu), met het woordmerk BOWACO en INGEBEDDE lettertypes (Archivo en IBM Plex Mono, subset). Gemaakt in de browser met
// pdf-lib en @pdf-lib/fontkit; hetzelfde bestand maakt de PDF voor kantoor en voor de klant (tests/pdf.mjs draait het in Node).
// Inhoud: klant, werf, posten per hoofdstuk met VH en contractvorm, opties apart (niet in het totaal), subtotaal, btw 6/21 %
// met de grond, totaal, geldigheid, betaaltermijn, het akkoord en de algemene voorwaarden. De invoer (QuotePdfData) heeft
// GEEN veld voor een aankoopprijs, een marge of een interne notitie: wat er niet in het type staat, kan niet in de PDF komen.
// Zonder React en zonder backend-imports: Node draait dit bestand rechtstreeks.

export type PdfFonts = { regular: Uint8Array; medium: Uint8Array; bold: Uint8Array; mono: Uint8Array; monoBold: Uint8Array };

export type PdfLine = {
  chapter: string; // sleutel van het hoofdstuk
  kind: "item" | "text" | "option";
  code: string;
  title: string;
  text: string;
  specRef: string;
  qtyMilli: bigint;
  unitName: string;
  form: string; // fixed · vh · regie · estimate · budget · perAttachment
  unitSellCents: bigint | null;
  lineSellCents: bigint;
  key?: string; // 2c.1: het id van de lijn (voor de subgroep)
};
// 2c.1: soort, subgroepen, tekstblokken, korting en regietekst (enkel een versie die met de nieuwe rekenregels rekent).
export type PdfForm = {
  kind: string; // "standard" · "damage" · "regie"
  insurer: string;
  claimRef: string;
  subgroups: { key: string; chapter: string; title: string }[]; // in hun volgorde
  lineSub: Record<string, string>; // lijn → subgroep
  blocks: { title: string; text: string; place: string }[]; // place: "top" · "end" · de code van een hoofdstuk
  grossCents: bigint;
  discountCents: bigint;
  discountText: string;
  regieSellCents: bigint | null;
};
export type PdfChapter = { key: string; code: string; title: string; sellCents: bigint };
export type PdfAddress = { street: string; number: string; zip: string; city: string; country: string } | null;
export type QuotePdfData = {
  number: string;
  version: number;
  title: string;
  intro: string;
  status: string; // "ontwerp" · "verstuurd" · "aanvaard" · "geweigerd" · "vervangen"
  frozen: boolean; // false = voorbeeld van een ontwerp (watermerk)
  hash: string; // "" voor een ontwerp
  sentDay: number | null; // dag van verzending (dagen sinds 1970)
  validUntilDay: number | null; // ontwerp: null
  validDays: number;
  paymentDays: number;
  vatBp: bigint;
  vatNote: string;
  issuer: string;
  clientName: string;
  clientAddress: PdfAddress;
  clientVat: string;
  workCode: string;
  workName: string;
  workAddress: PdfAddress;
  chapters: PdfChapter[];
  lines: PdfLine[];
  subtotalCents: bigint;
  vatCents: bigint;
  totalCents: bigint;
  optionsPlusCents: bigint;
  optionsMinusCents: bigint;
  terms: { version: number; title: string; text: string; provisional: boolean };
  accepted: { digital: { atDay: number; byName: string } | null; signed: { atDay: number; byName: string } | null } | null;
  form?: PdfForm | null;
};

// ── Opmaak van getallen en data ───────────────────────────────────────────
const nf = new Intl.NumberFormat("nl-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qf = new Intl.NumberFormat("nl-BE", { maximumFractionDigits: 3 });
export function eur(c: bigint): string {
  const neg = c < 0n;
  const abs = neg ? -c : c;
  return `${neg ? "-" : ""}€ ${nf.format(Number(abs) / 100)}`;
}
const qty = (m: bigint) => qf.format(Number(m) / 1000);
export function dayText(d: number): string {
  return new Date(d * 86_400_000).toLocaleDateString("nl-BE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
const pct = (bp: bigint) => `${(Number(bp) / 100).toString().replace(".", ",")} %`;
const FORM: Record<string, string> = { fixed: "vast", vh: "VH", regie: "regie", estimate: "raming", budget: "budget", perAttachment: "bijlage" };
const FORM_LONG: Record<string, string> = {
  vh: "VH = geschatte hoeveelheid (wordt op de werf nagemeten)",
  fixed: "vast = vaste prijs",
  regie: "regie = naar werkelijk gepresteerde uren en gebruikt materiaal",
  estimate: "raming = geraamd bedrag",
  budget: "budget = voorzien bedrag",
  perAttachment: "bijlage = volgens bijlage",
};

// ── Kleuren (tokens.css) ──────────────────────────────────────────────────
const INK: [number, number, number] = [0.059, 0.071, 0.094];
const GRAY: [number, number, number] = [0.325, 0.357, 0.412];
const LINE: [number, number, number] = [0.882, 0.894, 0.914];
const LINE2: [number, number, number] = [0.765, 0.784, 0.82];
const ACCENT: [number, number, number] = [0.173, 0.294, 0.878];
const BRAND: [number, number, number] = [0.118, 0.122, 0.255];
const WARN: [number, number, number] = [0.639, 0.329, 0];
const SUNK: [number, number, number] = [0.925, 0.933, 0.945];

const W = 595.28;
const H = 841.89;
const ML = 48;
const MR = 48;
const MT = 52;
const MB = 62;
const CW = W - ML - MR;

const addressLines = (a: PdfAddress): string[] => {
  if (!a) return [];
  const l1 = `${a.street} ${a.number}`.trim();
  const l2 = `${a.zip} ${a.city}`.trim();
  const l3 = a.country && a.country !== "BE" ? a.country : "";
  return [l1, l2, l3].filter(Boolean);
};

export async function quotePdf(d: QuotePdfData, fonts: PdfFonts): Promise<Uint8Array> {
  const { PDFDocument, rgb, degrees } = await import("pdf-lib");
  const fontkit = (await import("@pdf-lib/fontkit")).default;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`Offerte ${d.number} v${d.version}`);
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
  // Tekens die het lettertype niet kent worden vervangen in plaats van te falen.
  const sets = new Map<Font, Set<number>>();
  const known = (f: Font) => {
    let s = sets.get(f);
    if (!s) { s = new Set(f.getCharacterSet()); sets.set(f, s); }
    return s;
  };
  const clean = (f: Font, s: string) => {
    const k = known(f);
    let out = "";
    for (const ch of s.replace(/ /g, " ").replace(/[‐‑‒]/g, "-")) {
      const cp = ch.codePointAt(0)!;
      out += cp === 10 || cp === 13 || k.has(cp) ? ch : "?";
    }
    return out;
  };
  const wid = (f: Font, size: number, s: string) => f.widthOfTextAtSize(clean(f, s), size);

  // Breedte per teken (één keer gemeten per lettertype en grootte). Een woord breder dan de kolom wordt per teken opgeschoven in
  // O(lengte); de vorige lus mat het hele restwoord opnieuw voor elke af te breken regel (O(lengte³)): een woord van 4.000 tekens
  // zonder spaties (een geplakt lastenboek) legde de browser minutenlang plat (securityreview 2.12).
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

  // Regels afbreken op woorden (en op tekens als een woord zelf te breed is).
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
  // Een ontwerp krijgt een lichtgrijs watermerk, onder de tekst (dus meteen bij het maken van de bladzijde).
  const fresh = () => {
    const p = doc.addPage([W, H]);
    if (!d.frozen) p.drawText("ONTWERP", { x: 110, y: 250, size: 110, font: F.b, color: rgb(0.93, 0.94, 0.955), rotate: degrees(35) });
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
  const label = (s: string, x: number, yy: number) => text(s.toUpperCase(), x, yy, F.mono, 6.8, GRAY, { spacing: 0.7 });

  const newPage = (cont = true) => {
    page = fresh();
    y = H - MT;
    if (cont) {
      text("BOWACO", ML, y - 8, F.b, 10, BRAND, { spacing: 1.4 });
      right(`OFFERTE ${d.number}  v${d.version}`, W - MR, y - 7, F.mono, 7.5, GRAY);
      hline(y - 16);
      y -= 36;
    }
  };
  const need = (h: number) => { if (y - h < MB) newPage(); };

  // ── Kop ──────────────────────────────────────────────────────────────────
  text("BOWACO", ML, y - 16, F.b, 22, BRAND, { spacing: 2.6 });
  { const t = "OFFERTE"; text(t, W - MR - wid(F.mono, 6.8, t) - t.length * 0.7, y - 2, F.mono, 6.8, GRAY, { spacing: 0.7 }); }
  right(d.number, W - MR, y - 17, F.monoB, 15, INK);
  right(`versie ${d.version}${d.frozen ? "" : " · ontwerp"}`, W - MR, y - 30, F.mono, 8, GRAY);
  y -= 42;
  hline(y, ML, W - MR, LINE2, 0.9);
  y -= 18;

  // ── Klant · Werf · Offerte ───────────────────────────────────────────────
  const colW = CW / 3;
  const top = y;
  const block = (i: number, head: string, lines: string[], bold0 = true) => {
    const x = ML + i * colW;
    label(head, x, top);
    let yy = top - 14;
    lines.forEach((l, k) => { text(l, x, yy, k === 0 && bold0 ? F.m : F.r, 9.5, k === 0 ? INK : GRAY); yy -= 12.5; });
    return top - yy;
  };
  const wc = (s: string, n: number) => wrap(F.r, 9.5, s, colW - 14).slice(0, n);
  const h1 = block(0, "Klant", [...wc(d.clientName || "—", 2), ...addressLines(d.clientAddress), ...(d.clientVat ? [`BTW ${d.clientVat}`] : [])]);
  const h2 = block(1, "Werf", [...wc(`${d.workCode ? d.workCode + " · " : ""}${d.workName}`, 2), ...addressLines(d.workAddress)]);
  const facts: string[] = [
    `Datum: ${d.sentDay !== null ? dayText(d.sentDay) : "—"}`,
    d.validUntilDay !== null ? `Geldig tot: ${dayText(d.validUntilDay)}` : `Geldig: ${d.validDays} dagen na datum`,
    `Betaaltermijn: ${d.paymentDays} dagen`,
    d.vatBp === 0n ? "Btw: verlegd (0 %)" : `Btw-tarief: ${pct(d.vatBp)}`,
    ...(d.form?.kind === "damage" ? [`Schadedossier${d.form.claimRef ? ` ${d.form.claimRef}` : ""}`, ...(d.form.insurer ? [`Verzekeraar: ${d.form.insurer}`] : [])] : []),
  ];
  const h3 = block(2, "Offerte", facts, false);
  y = top - Math.max(h1, h2, h3) - 14;
  hline(y);
  y -= 22;

  // ── Titel en inleiding ───────────────────────────────────────────────────
  for (const l of wrap(F.b, 14, d.title, CW)) { need(20); text(l, ML, y, F.b, 14); y -= 18; }
  if (d.intro.trim()) {
    y -= 2;
    for (const l of wrap(F.r, 9.5, d.intro, CW)) { need(14); if (l) text(l, ML, y, F.r, 9.5, INK); y -= 13; }
  }
  y -= 12;
  // 2c.1: tekstblokken (bovenaan, bij een hoofdstuk, onderaan).
  const blocksAt = (place: string, x = ML, w = CW) => {
    for (const b of (d.form?.blocks ?? []).filter((x2) => x2.place === place)) {
      need(30);
      if (b.title) { for (const t of wrap(F.m, 9, b.title, w)) { need(12); text(t, x, y, F.m, 9, INK); y -= 12; } }
      for (const t of wrap(F.r, 8.5, b.text, w)) { need(11); if (t) text(t, x, y, F.r, 8.5, GRAY); y -= 11; }
      y -= 6;
    }
  };
  blocksAt("top");

  // ── Posten per hoofdstuk ─────────────────────────────────────────────────
  const X = { code: ML, desc: ML + 44, form: ML + 262, qty: ML + 346, unit: ML + 352, price: ML + 440, total: ML + CW };
  const DESC_W = X.form - X.desc - 8;
  const head = () => {
    need(24);
    label("Code", X.code, y); label("Omschrijving", X.desc, y); label("Vorm", X.form, y);
    const r = (s: string, xr: number) => text(s.toUpperCase(), xr - wid(F.mono, 6.8, s.toUpperCase()) - s.length * 0.7, y, F.mono, 6.8, GRAY, { spacing: 0.7 });
    r("Hoev.", X.qty); label("Eenh.", X.unit, y); r("Prijs/eenh.", X.price); r("Totaal", X.total);
    y -= 6;
    hline(y, ML, W - MR, LINE2, 0.8);
    y -= 12;
  };
  const items = (key: string) => d.lines.filter((l) => l.chapter === key && l.kind !== "option");
  let first = true;
  for (const c of d.chapters) {
    const ls = items(c.key);
    if (ls.length === 0) continue;
    need(70);
    if (first) { head(); first = false; }
    // hoofdstukkop
    y -= 4;
    page.drawRectangle({ x: ML, y: y - 5, width: CW, height: 19, color: col(SUNK) });
    text(c.code, X.code + 4, y, F.monoB, 8.5, INK);
    text(c.title, X.desc, y, F.b, 10, INK);
    right(eur(c.sellCents), X.total - 4, y, F.monoB, 9, INK);
    y -= 22;
    if (c.code) blocksAt(c.code, X.desc, CW - 44);
    // 2c.1: eerst de posten zonder subgroep, dan per subgroep een kop met het eigen subtotaal.
    const subOf = (l: PdfLine) => (l.key !== undefined ? d.form?.lineSub[l.key] : undefined);
    const subs = (d.form?.subgroups ?? []).filter((g) => g.chapter === c.key);
    const ordered: (PdfLine | { sub: string; title: string; sum: bigint })[] = [...ls.filter((l) => !subs.some((g) => g.key === subOf(l)))];
    for (const g of subs) {
      const gl = ls.filter((l) => subOf(l) === g.key);
      if (!gl.length) continue;
      ordered.push({ sub: g.key, title: g.title, sum: gl.reduce((a, l) => a + (l.kind === "item" ? l.lineSellCents : 0n), 0n) }, ...gl);
    }
    for (const l of ordered) {
      if ("sub" in l) {
        need(40);
        y -= 2;
        text(l.title, X.desc, y, F.m, 9.5, INK);
        right(eur(l.sum), X.total - 4, y, F.mono, 8.5, GRAY);
        y -= 6;
        hline(y, X.desc, W - MR, LINE2, 0.6);
        y -= 12;
        continue;
      }
      if (l.kind === "text") {
        const tl = wrap(F.r, 9, `${l.title}${l.title && l.text ? "\n" : ""}${l.text}`, CW - 44);
        // Per regel naar een volgende bladzijde: een blok hoger dan een bladzijde liep anders stil onder de marge (review 2.12).
        need(18);
        for (const t of tl) { need(12); if (t) text(t, X.desc, y, F.r, 9, GRAY); y -= 12; }
        y -= 4;
        continue;
      }
      const title = wrap(F.m, 9.5, l.title || l.text.split("\n")[0] || "", DESC_W);
      const body = l.title && l.text ? wrap(F.r, 7.8, l.text, DESC_W) : [];
      const ref = l.specRef ? [`Lastenboek: ${l.specRef}`] : [];
      const h = title.length * 12 + body.length * 10 + ref.length * 10 + 8;
      if (y - h < MB) { newPage(); head(); text(`${c.code}  ${c.title} (vervolg)`, X.desc, y, F.m, 8.5, GRAY); y -= 16; }
      const y0 = y;
      if (l.code) text(l.code, X.code + 4, y0, F.mono, 8, GRAY);
      text(FORM[l.form] ?? l.form, X.form, y0, F.mono, 8, l.form === "vh" ? INK : ACCENT);
      const pm = l.qtyMilli === 0n;
      right(qty(l.qtyMilli), X.qty, y0, F.mono, 8.5, INK);
      text(l.unitName.length > 6 ? l.unitName.split(/[ (·]/)[0] : l.unitName, X.unit, y0, F.r, 8.5, GRAY);
      if (l.unitSellCents !== null) right(eur(l.unitSellCents), X.price, y0, F.mono, 8.5, INK);
      right(pm ? "p.m." : eur(l.lineSellCents), X.total - 4, y0, pm ? F.mono : F.monoB, 8.5, INK);
      let yy = y0;
      // Een post langer dan een bladzijde (lastenboektekst tot 4.000 tekens): per regel naar een volgende bladzijde (review 2.12).
      const more = (step: number) => { if (yy - step < MB) { newPage(); head(); text(`${c.code}  ${c.title} (vervolg)`, X.desc, y, F.m, 8.5, GRAY); y -= 16; yy = y; } };
      for (const t of title) { more(12); text(t, X.desc, yy, F.m, 9.5, INK); yy -= 12; }
      for (const t of body) { more(10); if (t) text(t, X.desc, yy, F.r, 7.8, GRAY); yy -= 10; }
      for (const t of ref) { more(10); text(t, X.desc, yy, F.mono, 6.8, GRAY); yy -= 10; }
      y = yy - 4;
      hline(y + 2, X.desc, W - MR, LINE, 0.4);
      y -= 6;
    }
    y -= 6;
  }

  // ── Opties (niet in het totaal) ──────────────────────────────────────────
  const opts = d.lines.filter((l) => l.kind === "option");
  if (opts.length) {
    need(70);
    y -= 6;
    text("Opties", ML, y, F.b, 11);
    text("niet inbegrepen in het totaal", ML + 44, y, F.r, 8.5, GRAY);
    y -= 8;
    hline(y, ML, W - MR, LINE2, 0.8);
    y -= 14;
    const chTitle = new Map(d.chapters.map((c) => [c.key, `${c.code} ${c.title}`.trim()]));
    for (const l of opts) {
      const title = wrap(F.m, 9.5, l.title || l.text.split("\n")[0] || "", DESC_W);
      const body = l.title && l.text ? wrap(F.r, 7.8, l.text, DESC_W) : [];
      const h = title.length * 12 + body.length * 10 + 10;
      need(h + 6);
      const y0 = y;
      text(FORM[l.form] ?? l.form, X.form, y0, F.mono, 8, ACCENT);
      right(qty(l.qtyMilli), X.qty, y0, F.mono, 8.5, INK);
      text(l.unitName.length > 6 ? l.unitName.split(/[ (·]/)[0] : l.unitName, X.unit, y0, F.r, 8.5, GRAY);
      if (l.unitSellCents !== null) right(eur(l.unitSellCents), X.price, y0, F.mono, 8.5, INK);
      right(eur(l.lineSellCents), X.total - 4, y0, F.monoB, 8.5, INK);
      let yy = y0;
      for (const t of title) { text(t, X.desc, yy, F.m, 9.5, INK); yy -= 12; }
      text(`${l.lineSellCents < 0n ? "minprijs" : "meerprijs"} · ${chTitle.get(l.chapter) ?? ""}`, X.desc, yy, F.mono, 6.8, GRAY); yy -= 10;
      for (const t of body) { if (t) text(t, X.desc, yy, F.r, 7.8, GRAY); yy -= 10; }
      y = yy - 4;
      hline(y + 2, X.desc, W - MR, LINE, 0.4);
      y -= 6;
    }
    y -= 6;
  }

  // ── Totalen ──────────────────────────────────────────────────────────────
  need(130);
  y -= 6;
  const bx = ML + CW * 0.46;
  hline(y, bx, W - MR, LINE2, 0.8);
  y -= 16;
  const row = (l: string, v: string, big = false) => {
    text(l, bx, y, big ? F.b : F.r, big ? 11 : 9.5, INK);
    right(v, W - MR, y, big ? F.monoB : F.mono, big ? 11 : 9.5, INK);
    y -= big ? 18 : 14;
  };
  if (d.form && d.form.discountCents !== 0n) {
    row("Totaal vóór korting", eur(d.form.grossCents));
    row(d.form.discountText ? `Korting: ${d.form.discountText}` : "Korting", `−${eur(d.form.discountCents)}`);
  }
  row("Subtotaal excl. btw", eur(d.subtotalCents));
  row(d.vatBp === 0n ? "Btw verlegd (0 %)" : `Btw ${pct(d.vatBp)}`, eur(d.vatCents));
  if (d.vatBp === 600n && d.vatNote.trim()) {
    for (const t of wrap(F.r, 7.8, `Grond voor het btw-tarief: ${d.vatNote}`, W - MR - bx)) { text(t, bx, y + 1, F.r, 7.8, GRAY); y -= 10; }
    y -= 2;
  }
  hline(y + 6, bx, W - MR, INK, 0.9);
  y -= 6;
  row("Totaal incl. btw", eur(d.totalCents), true);
  if (opts.length) {
    if (d.optionsPlusCents !== 0n) { text("Opties (meerprijs, niet in het totaal)", bx, y, F.r, 8, GRAY); right(eur(d.optionsPlusCents), W - MR, y, F.mono, 8, GRAY); y -= 12; }
    if (d.optionsMinusCents !== 0n) { text("Opties (minprijs, niet in het totaal)", bx, y, F.r, 8, GRAY); right(eur(d.optionsMinusCents), W - MR, y, F.mono, 8, GRAY); y -= 12; }
  }
  y -= 14;

  // ── Voorwaarden van deze offerte ─────────────────────────────────────────
  const legendForms = [...new Set(d.lines.filter((l) => l.kind !== "text").map((l) => l.form))].map((f) => FORM_LONG[f]).filter(Boolean);
  const cond: string[] = [];
  cond.push(d.validUntilDay !== null ? `Deze offerte is geldig tot ${dayText(d.validUntilDay)}.` : `Deze offerte is ${d.validDays} dagen geldig vanaf de datum van verzending.`);
  cond.push(`Betaaltermijn: ${d.paymentDays} dagen.`);
  cond.push("Prijzen in euro. Opties zijn niet in het totaal begrepen.");
  if (legendForms.length) cond.push(`Vorm: ${legendForms.join(" · ")}.`);
  if (d.form?.regieSellCents != null) cond.push(`Werken buiten de offerte worden uitgevoerd in regie à ${eur(d.form.regieSellCents)}/u (excl. btw).`);
  if (d.vatBp === 0n) cond.push("Btw verlegd: de btw is verschuldigd door de medecontractant.");
  cond.push(`De algemene voorwaarden (versie ${d.terms.version === 0 ? "voorlopig" : d.terms.version}) staan op de volgende bladzijden en maken deel uit van deze offerte.`);
  blocksAt("end");
  const condLines = cond.flatMap((c) => wrap(F.r, 8.5, c, CW));
  need(condLines.length * 12 + 20);
  for (const t of condLines) { text(t, ML, y, F.r, 8.5, GRAY); y -= 12; }
  y -= 8;
  const iss = d.issuer.split(/\r?\n/).filter((x) => x.trim());
  if (iss.length) {
    need(iss.length * 11 + 22);
    label("Afzender", ML, y);
    y -= 12;
    iss.forEach((t, k) => { text(t, ML, y, k === 0 ? F.m : F.r, 8.5, k === 0 ? INK : GRAY); y -= 11; });
  }
  y -= 14;

  // ── Akkoord ──────────────────────────────────────────────────────────────
  need(110);
  if (d.accepted) {
    page.drawRectangle({ x: ML, y: y - 62, width: CW, height: 70, borderColor: col(ACCENT), borderWidth: 0.9, color: rgb(0.96, 0.97, 1) });
    text("AANVAARD", ML + 12, y - 8, F.monoB, 8, ACCENT, { spacing: 1 });
    let yy = y - 24;
    if (d.accepted.digital) { text(`Digitaal akkoord van ${d.accepted.digital.byName} op ${dayText(d.accepted.digital.atDay)}, na het inloggen van de klant.`, ML + 12, yy, F.r, 9, INK); yy -= 13; }
    if (d.accepted.signed) { text(`Getekende offerte ontvangen op ${dayText(d.accepted.signed.atDay)} (registratie door ${d.accepted.signed.byName}).`, ML + 12, yy, F.r, 9, INK); yy -= 13; }
    text(`Controlecode van deze inhoud: ${d.hash.slice(0, 32)}…`, ML + 12, yy, F.mono, 7.2, GRAY);
    y -= 80;
  } else {
    text("Voor akkoord", ML, y, F.b, 11);
    text("Gelezen en goedgekeurd, met de algemene voorwaarden.", ML + 82, y, F.r, 8.5, GRAY);
    y -= 14;
    const bw = (CW - 24) / 2;
    for (let i = 0; i < 2; i++) {
      const x = ML + i * (bw + 24);
      page.drawRectangle({ x, y: y - 56, width: bw, height: 60, borderColor: col(LINE2), borderWidth: 0.7 });
      label(i === 0 ? "Naam, datum en handtekening klant" : "Voor BOWACO", x + 8, y - 10);
    }
    y -= 70;
    if (d.frozen) {
      for (const t of wrap(F.r, 8, "U kunt de offerte ook digitaal aanvaarden in de app BOWACO (Mijn offerte), na het inloggen. Het akkoord geldt dan voor exact deze versie.", CW)) { text(t, ML, y, F.r, 8, GRAY); y -= 11; }
    }
  }

  // ── Algemene voorwaarden ─────────────────────────────────────────────────
  newPage();
  text("Algemene voorwaarden", ML, y, F.b, 14);
  y -= 16;
  text(`${d.terms.title} · ${d.terms.version === 0 ? "voorlopige tekst" : "versie " + d.terms.version}`, ML, y, F.mono, 8, GRAY);
  y -= 16;
  if (d.terms.provisional) {
    const bl = wrap(F.m, 8.5, "Voorlopige tekst. Dit zijn nog niet de definitieve algemene voorwaarden van BOWACO. Ze zijn nog niet nagekeken door BOWACO en een jurist en mogen niet als geldende voorwaarden gebruikt worden.", CW - 20);
    const hh = bl.length * 12 + 12;
    page.drawRectangle({ x: ML, y: y - hh + 6, width: CW, height: hh, borderColor: col(WARN), borderWidth: 0.9, color: rgb(1, 0.973, 0.92) });
    let yy = y - 6;
    for (const t of bl) { text(t, ML + 10, yy, F.m, 8.5, WARN); yy -= 12; }
    y -= hh + 10;
  }
  for (const para of d.terms.text.split(/\r?\n/)) {
    const isHead = /^\s*(\d+(\.\d+)*\.?|artikel\s+\d+)\s+\S/i.test(para) && para.length < 80;
    const f = isHead ? F.m : F.r;
    const size = isHead ? 9.5 : 8.8;
    if (para.trim() === "") { y -= 6; continue; }
    const ls = wrap(f, size, para, CW);
    // Per regel naar een volgende bladzijde: een alinea langer dan een bladzijde verdween anders stil onder de marge, terwijl de
    // hash de hele tekst dekt (review 2.12). Een kop blijft bij zijn eerste regel.
    need(isHead ? 24 : 14);
    if (isHead) y -= 4;
    for (const t of ls) { need(12); text(t, ML, y, f, size, isHead ? INK : [0.18, 0.2, 0.25]); y -= 12; }
  }

  // ── Voet en watermerk op elke bladzijde ──────────────────────────────────
  const n = pages.length;
  pages.forEach((p, i) => {
    page = p;
    hline(MB - 14, ML, W - MR, LINE, 0.5);
    const foot = `BOWACO · offerte ${d.number} · v${d.version} · ${d.frozen && d.hash ? d.hash.slice(0, 16) : "ONTWERP"}`;
    text(foot, ML, MB - 26, F.mono, 6.8, GRAY);
    right(`${i + 1} / ${n}`, W - MR, MB - 26, F.mono, 6.8, GRAY);
  });

  return await doc.save();
}
