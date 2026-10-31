// De teruggestuurde prijsvraag-Excel INLEZEN (stap 2c.2 als module, het scherm komt in 2c.3; ontwerp 2c §5 "Inlezen"), zonder AI:
// enkel .xlsx tot 5 MB en 2.000 regels; uitpakken met tender/zip.ts; het zeer verborgen tabblad _bowaco zegt welke prijsvraag en
// welke firma (sleutel van de uitnodiging); de tabel wordt gelezen op de sleutel in kolom A (controleteken nagekeken), ENKEL de
// bewaarde waarde van een cel (<v>; een formule zonder waarde = leeg + markering), getallen verdraagzaam ("1.234,56", "1234.56",
// "€ 12"). Nooit een formule uitvoeren, nooit een externe koppeling volgen, geen macro's; tekst blijft tekst (geen HTML).
// Zonder React en zonder backend-imports: Node draait dit bestand rechtstreeks (tests/prijsvraag-excel.mjs).
import { FORM_ID, NAMES, SHEET_META, SHEET_OWN, SHEET_TABLE, checkChars } from "./sheet.ts";
import { lineAmount, totals, type Included } from "./calc.ts";
import { unzip, ZipError } from "./zip.ts";

export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 2000;

export type ReadItem = { id: bigint; pos: number; chapter: string; title: string; unit: string; unitName?: string; qtyMilli: bigint };
export type ReadInvite = { id: bigint; orgName: string; sheetKey: string };
export type ReadContext = { tenderId: bigint; code: string; items: ReadItem[]; invites: ReadInvite[]; expectInviteId?: bigint | null };

export type LineFlag = "ontbreekt" | "geen-prijs" | "niet-inbegrepen" | "alternatief" | "prijs-0" | "vh" | "eenheid" | "formule-zonder-waarde" | "eigen";
export type ReadLine = {
  itemId: bigint | null;
  row: number; // rij in de Excel (0 = ontbreekt)
  description: string;
  unit: string;
  qtyMilli: bigint; // de hoeveelheid van de OA (bij een gewijzigde VH die van de OA)
  unitCents: bigint | null;
  amountCents: bigint | null;
  included: Included;
  remark: string;
  changed: string[]; // "vh" · "eenheid"
  flags: LineFlag[];
  error: string | null; // fout op deze regel (tekst in een prijscel …)
};
export type SheetHeader = { number: string; quoteDay: bigint | null; validUntil: bigint | null; discountBp: bigint | null; reverse: boolean; totalCents: bigint | null };
export type SheetCounts = { read: number; noPrice: number; notIncluded: number; changed: number; own: number; missing: number; errors: number };
export type SheetResult =
  | { ok: true; inviteId: bigint; orgName: string; header: SheetHeader; lines: ReadLine[]; counts: SheetCounts; flags: string[]; netCents: bigint }
  | { ok: false; error: string };

// ── XML lezen (enkel wat een .xlsx gebruikt: elementen, attributen, tekst) ───────────
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e]));
}
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1]] = unescapeXml(m[3] ?? m[4] ?? "");
  return out;
}
/** Alle <t>-teksten binnen een stuk XML (een gedeelde tekst met opmaak bestaat uit runs; fonetiek <rPh> telt niet). */
function texts(xml: string): string {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of clean.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) out += unescapeXml(m[1] ?? "");
  return out;
}

type RawCell = { ref: string; col: string; row: number; type: string; value: string | null; formula: boolean };
export type SheetCells = { cells: Map<string, RawCell>; rows: number[]; maxRow: number };

function colOf(ref: string): string { return ref.replace(/\d+$/, ""); }
function rowOf(ref: string): number { return parseInt(ref.replace(/^[A-Z]+/, ""), 10); }

function parseSheet(xml: string, shared: string[]): SheetCells {
  const cells = new Map<string, RawCell>();
  const rows = new Set<number>();
  let maxRow = 0;
  const data = xml.match(/<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>|<sheetData\b[^>]*\/>/);
  const body = data?.[1] ?? "";
  for (const m of body.matchAll(/<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g)) {
    const a = attrs(m[1]);
    const ref = a.r;
    if (!ref || !/^[A-Z]{1,3}\d+$/.test(ref)) continue;
    const inner = m[3] ?? "";
    const t = a.t ?? "n";
    const formula = /<f\b/.test(inner);
    const vm = inner.match(/<v>([\s\S]*?)<\/v>/);
    let value: string | null = vm ? unescapeXml(vm[1]) : null;
    if (t === "s" && value !== null) value = shared[parseInt(value, 10)] ?? "";
    if (t === "inlineStr") { const is = inner.match(/<is>([\s\S]*?)<\/is>/); value = is ? texts(is[1]) : null; }
    const row = rowOf(ref);
    rows.add(row);
    if (row > maxRow) maxRow = row;
    cells.set(ref, { ref, col: colOf(ref), row, type: t, value, formula });
  }
  for (const m of body.matchAll(/<row\b([^>]*)>/g)) { const r = parseInt(attrs(m[1]).r ?? "0", 10); if (r > maxRow) maxRow = r; }
  return { cells, rows: [...rows].sort((x, y) => x - y), maxRow };
}

export type Workbook = { sheets: Map<string, SheetCells>; names: Map<string, string> };

/** Het werkboek: tabbladen (naam → cellen) en de vaste namen (naam → "Blad!$D$7"). */
export async function readWorkbook(bytes: Uint8Array): Promise<Workbook> {
  const files = await unzip(bytes);
  const dec = new TextDecoder();
  const get = (n: string) => { const b = files.get(n); return b ? dec.decode(b) : null; };
  const wb = get("xl/workbook.xml");
  if (!wb) throw new ZipError("Geen Excel-werkboek (.xlsx) in dit bestand");
  if (files.has("xl/vbaProject.bin")) throw new ZipError("Een bestand met macro's (.xlsm) leest de app niet: bewaar als .xlsx");
  const rels = new Map<string, string>();
  for (const m of (get("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const a = attrs(m[1]);
    if (a.Id && a.Target) rels.set(a.Id, a.Target.replace(/^\/?xl\//, "").replace(/^\//, ""));
  }
  const shared: string[] = [];
  const ss = get("xl/sharedStrings.xml");
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(texts(m[1]));
  const sheets = new Map<string, SheetCells>();
  for (const m of wb.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const a = attrs(m[1]);
    const target = rels.get(a["r:id"] ?? "");
    if (!a.name || !target) continue;
    const xml = get(`xl/${target}`);
    if (xml) sheets.set(a.name, parseSheet(xml, shared));
  }
  const names = new Map<string, string>();
  for (const m of wb.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g)) names.set(attrs(m[1]).name ?? "", unescapeXml(m[2]).trim());
  return { sheets, names };
}

// ── Waarden ───────────────────────────────────────────────────────────────
/** Een getal zoals mensen het tikken: "1.234,56" · "1234,56" · "1234.56" · "€ 12" · "12 €" → duizendsten; ongeldig = undefined.
 *  `text`: de waarde stond als TEKST in de cel (niet als getal van Excel). Dan is "1.234" of "12.500" een duizendtal (Belgische
 *  schrijfwijze), zoals "1.234,56"; in een getalcel is de punt altijd het decimaalteken van Excel zelf. */
export function parseMilli(raw: string, text = false): bigint | undefined {
  let s = raw.replace(/[€\s ]/g, "").replace(/EUR$/i, "");
  if (s === "") return undefined;
  let neg = false;
  if (s.startsWith("-")) { neg = true; s = s.slice(1); }
  let norm: string;
  if (text && /^\d{1,3}(\.\d{3})+$/.test(s)) norm = s.replace(/\./g, ""); // "1.234" als tekst = duizendtal
  else if (/^\d+(\.\d+)?(e[+-]?\d+)?$/i.test(s)) norm = s; // 1234.56 (en de notatie van Excel zelf)
  else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) norm = s.replace(/\./g, "").replace(",", "."); // 1.234,56
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) norm = s.replace(/,/g, ""); // 1,234.56
  else if (/^\d+,\d+$/.test(s)) norm = s.replace(",", "."); // 1234,56
  else return undefined;
  const n = Number(norm);
  if (!Number.isFinite(n) || n > 1e12) return undefined;
  const m = BigInt(Math.round(n * 1000));
  return neg ? -m : m;
}
const milliToCents = (m: bigint): bigint => (m >= 0n ? (m + 5n) / 10n : -((-m + 5n) / 10n));
const fmtCents = (c: bigint) => `€ ${(Number(c) / 100).toLocaleString("nl-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Een datum: een getal van Excel (dagen sinds 30.12.1899) of "24.10.2026" / "24/10/2026" / "2026-10-24" → dagnummer (D4). */
export function parseDay(c: RawCell | undefined): bigint | null {
  if (!c || c.value === null || c.value.trim() === "") return null;
  const v = c.value.trim();
  if (c.type === "n" && /^\d+(\.\d+)?$/.test(v)) { const n = Math.floor(Number(v)); return n > 0 ? BigInt(n - 25569) : null; }
  let m = v.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) return BigInt(Math.floor(Date.UTC(+m[3], +m[2] - 1, +m[1]) / 86_400_000));
  m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return BigInt(Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86_400_000));
  return null;
}

function nameCell(wb: Workbook, name: string): RawCell | undefined {
  const ref = wb.names.get(name);
  if (!ref) return undefined;
  const m = ref.match(/^'?(.+?)'?!\$?([A-Z]{1,3})\$?(\d+)$/);
  if (!m) return undefined;
  return wb.sheets.get(m[1].replace(/''/g, "'"))?.cells.get(`${m[2]}${m[3]}`);
}
const textOf = (c: RawCell | undefined) => (c && c.value !== null ? c.value : "");

// ── Inlezen ──────────────────────────────────────────────────────────────
export async function readTenderSheet(bytes: Uint8Array, name: string, ctx: ReadContext): Promise<SheetResult> {
  const fail = (error: string): SheetResult => ({ ok: false, error });
  const lower = name.toLowerCase();
  if (bytes.length >= 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return fail("Dit is een oud Excel-bestand (.xls). Vraag de firma het als .xlsx te bewaren, of voer de prijzen met de hand in naast de PDF.");
  if (!lower.endsWith(".xlsx")) return fail(lower.endsWith(".xlsm") ? "Een bestand met macro's (.xlsm) leest de app niet: bewaar als .xlsx." : "Enkel een .xlsx-bestand. Of voer de prijzen met de hand in naast de PDF.");
  if (bytes.length > MAX_BYTES) return fail("Het bestand is groter dan 5 MB.");
  let wb: Workbook;
  try { wb = await readWorkbook(bytes); } catch (e) { return fail(e instanceof ZipError ? `${e.message}. Voer de prijzen met de hand in naast de PDF.` : "De app kan dit bestand niet lezen. Voer de prijzen met de hand in naast de PDF."); }
  // 1. Welke prijsvraag en welke firma (verborgen tabblad).
  const meta = wb.sheets.get(SHEET_META);
  if (!meta) return fail("Deze Excel komt niet uit de app (het verborgen tabblad ontbreekt). Voer de prijzen met de hand in naast de PDF.");
  const mv = (r: number) => textOf(meta.cells.get(`B${r}`)).trim();
  if (mv(1) !== FORM_ID) return fail(`Onbekende vorm van de Excel (${mv(1) || "leeg"}). Voer de prijzen met de hand in naast de PDF.`);
  // De sleutel van de firma (12 tekens) is de enige herkenning: hij hoort bij precies één uitnodiging van DEZE prijsvraag.
  const key = mv(2);
  const inv = /^[0-9A-Z]{12}$/.test(key) ? ctx.invites.find((i) => i.sheetKey === key) : undefined;
  if (!inv) return fail(`Deze Excel hoort bij een andere prijsvraag dan ${ctx.code}.`);
  if (mv(3) !== String(ctx.items.length)) return fail("Het verborgen tabblad is gewijzigd (het aantal posten klopt niet met de prijsvraag).");
  if (ctx.expectInviteId != null && inv.id !== ctx.expectInviteId) {
    const want = ctx.invites.find((i) => i.id === ctx.expectInviteId);
    return fail(`Deze Excel hoort bij ${inv.orgName}, niet bij ${want?.orgName ?? "deze firma"}.`);
  }
  // 2. De tabel.
  const tab = wb.sheets.get(SHEET_TABLE);
  if (!tab) return fail(`Het tabblad ${SHEET_TABLE} ontbreekt.`);
  const own = wb.sheets.get(SHEET_OWN);
  if (tab.maxRow > MAX_ROWS || (own?.maxRow ?? 0) > MAX_ROWS) return fail(`Meer dan ${MAX_ROWS} regels: dit is geen prijsvraag-Excel van de app.`);
  const headRow = tab.rows.find((r) => norm(textOf(tab.cells.get(`A${r}`))) === "sleutel");
  if (headRow === undefined) return fail("De kopregel met \"Sleutel\" in kolom A ontbreekt.");
  const items = new Map(ctx.items.map((x) => [String(x.pos), x]));
  const seen = new Map<string, number>();
  const lines: ReadLine[] = [];
  const flags: string[] = [];
  const keyRe = /^P(\d+)\.([0-9A-Z]{3})$/;
  for (const r of tab.rows) {
    if (r <= headRow) continue;
    const k = textOf(tab.cells.get(`A${r}`)).trim();
    if (!k) continue;
    if (/^(H\d+|T)$/.test(k)) continue; // subtotaal en totaal
    const m = k.match(keyRe);
    if (!m) return fail(`Rij ${r}: onbekende sleutel "${k.slice(0, 30)}". Voer de prijzen met de hand in naast de PDF.`);
    const it = items.get(m[1]);
    if (!it) return fail(`Rij ${r}: onbekende post in de sleutel "${k}".`);
    if (checkChars(inv.sheetKey, it.pos) !== m[2]) return fail(`Rij ${r}: de sleutel "${k}" is gewijzigd (controleteken klopt niet).`);
    if (seen.has(m[1])) return fail(`Rij ${r}: de post staat twee keer in de Excel (ook op rij ${seen.get(m[1])}).`);
    seen.set(m[1], r);
    const cell = (c: string) => tab.cells.get(`${c}${r}`);
    const lineFlags: LineFlag[] = [];
    let error: string | null = null;
    // Eenheid en VH: gewijzigd door de OA = markering.
    const unit = textOf(cell("F")).trim();
    const changed: string[] = [];
    if (unit && norm(unit) !== norm(it.unit) && norm(unit) !== norm(it.unitName ?? it.unit)) { changed.push("eenheid"); lineFlags.push("eenheid"); }
    let qty = it.qtyMilli;
    const qc = cell("G");
    if (qc && qc.value !== null && qc.value.trim() !== "") {
      const q = parseMilli(qc.value, qc.type !== "n");
      if (q === undefined) error = "tekst in de VH";
      else if (q !== it.qtyMilli) { qty = q; changed.push("vh"); lineFlags.push("vh"); }
    }
    // Eenheidsprijs: enkel de bewaarde waarde.
    const pc = cell("H");
    let unitCents: bigint | null = null;
    if (pc && pc.formula && (pc.value === null || pc.value === "")) lineFlags.push("formule-zonder-waarde");
    else if (pc && pc.value !== null && pc.value.trim() !== "") {
      if (pc.type === "e") error = "foutwaarde in de prijscel";
      else {
        const p = parseMilli(pc.value, pc.type !== "n");
        if (p === undefined || p < 0n) error = `tekst in een prijscel ("${pc.value.slice(0, 20)}")`;
        else unitCents = milliToCents(p);
      }
    }
    const jv = norm(textOf(cell("J")));
    const remark = textOf(cell("K")).trim();
    let included: Included = { yes: null };
    if (jv === "nee" || jv === "neen" || jv === "no" || jv === "non") included = { no: null };
    else if (jv.startsWith("alternatief") || jv === "alt") included = { alt: remark };
    else if (jv !== "" && jv !== "ja" && jv !== "yes" && jv !== "oui") error = error ?? `onbekende waarde in Inbegrepen ("${jv.slice(0, 20)}")`;
    if ("no" in included) lineFlags.push("niet-inbegrepen");
    if ("alt" in included) lineFlags.push("alternatief");
    if (unitCents === null && !("no" in included)) lineFlags.push("geen-prijs");
    if (unitCents === 0n) lineFlags.push("prijs-0");
    lines.push({ itemId: it.id, row: r, description: it.title, unit: (unit || it.unit).slice(0, 40), qtyMilli: qty, unitCents: error ? null : unitCents, amountCents: error ? null : lineAmount(unitCents, qty, included), included: "alt" in included ? { alt: included.alt.slice(0, 500) } : included, remark: remark.slice(0, 500), changed, flags: lineFlags, error });
  }
  // Posten die ontbreken (regel gewist).
  for (const it of ctx.items) {
    if (!seen.has(String(it.pos))) lines.push({ itemId: it.id, row: 0, description: it.title, unit: it.unit, qtyMilli: it.qtyMilli, unitCents: null, amountCents: null, included: { yes: null }, remark: "", changed: [], flags: ["ontbreekt"], error: null });
  }
  // 3. Eigen posten.
  if (own) {
    for (const r of own.rows) {
      if (r <= 1) continue;
      const g = (c: string) => own.cells.get(`${c}${r}`);
      const desc = textOf(g("A")).trim();
      if (!desc) continue;
      let error: string | null = null;
      const qv = textOf(g("C")).trim();
      const q = qv === "" ? 1000n : parseMilli(qv, g("C")?.type !== "n");
      if (q === undefined || q < 0n) error = "tekst in de hoeveelheid";
      const pv = g("D");
      let unitCents: bigint | null = null;
      if (pv && pv.formula && (pv.value === null || pv.value === "")) error = error ?? "formule zonder waarde";
      else if (pv && pv.value !== null && pv.value.trim() !== "") {
        const p = parseMilli(pv.value, pv.type !== "n");
        if (p === undefined || p < 0n) error = error ?? "tekst in een prijscel";
        else unitCents = milliToCents(p);
      }
      const qty = q === undefined || q < 0n ? 0n : q;
      lines.push({ itemId: null, row: r, description: desc.slice(0, 160), unit: textOf(g("B")).trim().slice(0, 40), qtyMilli: qty, unitCents: error ? null : unitCents, amountCents: error ? null : lineAmount(unitCents, qty, { yes: null }), included: { yes: null }, remark: textOf(g("E")).trim().slice(0, 500), changed: [], flags: ["eigen", ...(unitCents === null ? (["geen-prijs"] as LineFlag[]) : [])], error });
    }
  }
  // 4. De kop (vaste namen; een verschoven rij maakt niets uit).
  const kc = nameCell(wb, NAMES.discount);
  let discountBp: bigint | null = null;
  if (kc && kc.value !== null && kc.value.trim() !== "") {
    const raw = kc.value.replace("%", "").trim();
    const d = parseMilli(raw, kc.type !== "n");
    if (d === undefined || d < 0n) flags.push("korting onleesbaar");
    else {
      // Een cel met %-opmaak bewaart 0,05 voor 5 %; een getypt getal 5.
      const frac = kc.type === "n" && d > 0n && d < 1000n;
      const pct = frac ? d * 100n : d;
      discountBp = (pct + 5n) / 10n;
      if (frac) flags.push(`korting nakijken: ${kc.value} gelezen als ${Number(discountBp) / 100} %`);
    }
  }
  const rv = norm(textOf(nameCell(wb, NAMES.reverse)));
  const tc = nameCell(wb, NAMES.total);
  const totalMilli = tc && tc.value !== null && tc.value !== "" ? parseMilli(tc.value) : undefined;
  const header: SheetHeader = {
    number: textOf(nameCell(wb, NAMES.number)).trim().slice(0, 40),
    quoteDay: parseDay(nameCell(wb, NAMES.date)),
    validUntil: parseDay(nameCell(wb, NAMES.valid)),
    discountBp,
    reverse: rv !== "nee" && rv !== "neen" && rv !== "no",
    totalCents: totalMilli === undefined ? null : milliToCents(totalMilli),
  };
  const chapterOf = (id: bigint) => items.get(id.toString())?.chapter ?? "";
  const tot = totals(lines.filter((l) => !l.error).map((l) => ({ itemId: l.itemId, qtyMilli: l.qtyMilli, unitCents: l.unitCents, included: l.included })), null, chapterOf);
  // BW_TOTAAL dekt enkel de tabel (niet de eigen posten); afronding tot 1 cent per regel mag.
  const tableGross = lines.filter((l) => l.itemId !== null && !l.error).reduce((n, l) => n + (l.amountCents ?? 0n), 0n);
  if (header.totalCents !== null) {
    const diff = header.totalCents - tableGross;
    const tol = BigInt(Math.max(1, lines.length));
    if (diff > tol || diff < -tol) flags.push(`het totaal in de Excel (${fmtCents(header.totalCents)}) verschilt van de som van de regels (${fmtCents(tableGross)})`);
  }
  const net = totals(lines.filter((l) => !l.error).map((l) => ({ itemId: l.itemId, qtyMilli: l.qtyMilli, unitCents: l.unitCents, included: l.included })), discountBp, chapterOf).net;
  const counts: SheetCounts = {
    read: lines.filter((l) => l.itemId !== null && l.row > 0).length,
    noPrice: lines.filter((l) => l.flags.includes("geen-prijs")).length,
    notIncluded: lines.filter((l) => l.flags.includes("niet-inbegrepen")).length,
    changed: lines.filter((l) => l.changed.length > 0).length,
    own: lines.filter((l) => l.itemId === null).length,
    missing: lines.filter((l) => l.flags.includes("ontbreekt")).length,
    errors: lines.filter((l) => l.error).length,
  };
  return { ok: true, inviteId: inv.id, orgName: inv.orgName, header, lines, counts, flags, netCents: net };
}
