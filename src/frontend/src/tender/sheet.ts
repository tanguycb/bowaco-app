// De prijsvraag-Excel MAKEN (stap 2c.2, ontwerp 2c §5): één .xlsx per firma, in de browser opgebouwd als SpreadsheetML in een kleine
// eigen zip (tender/zip.ts, geen bibliotheek). Tabbladen: Lees mij · Prijsvraag · Eigen posten · _bowaco (zeer verborgen).
// Prijsvraag: kop met vaste namen (BW_NUMMER, BW_DATUM, BW_GELDIG, BW_KORTING, BW_VERLEGD, BW_TOTAAL), tabel vanaf rij 10 met een
// VERBORGEN sleutelkolom A ("P3.K3F": positie van de post binnen de prijsvraag + controleteken uit de sleutel van de firma; nooit
// een id of volgnummer van de app, R37), gele invulcellen (H, J, K),
// een keuzelijst in J, formules enkel ter info (I, subtotalen, totaal) en een beveiligd blad zonder wachtwoord. Tekst die met
// = + - @ of een tab begint, krijgt in elke tekststijl het teken "tekst" (quotePrefix): geen formule bij de OA. Het inlezen staat in tender/sheetread.ts.
// Zonder React en zonder backend-imports: Node draait dit bestand rechtstreeks (tests/prijsvraag-excel.mjs).
import { zipStore } from "./zip.ts";

export const FORM_ID = "prijsvraag-1";
export const SHEET_TABLE = "Prijsvraag";
export const SHEET_OWN = "Eigen posten";
export const SHEET_META = "_bowaco";
export const SHEET_README = "Lees mij";
export const HEADER_ROW = 10;
export const OWN_ROWS = 100;
export const COLS = { key: "A", chapter: "B", code: "C", title: "D", text: "E", unit: "F", qty: "G", price: "H", total: "I", included: "J", remark: "K" } as const;
export const NAMES = { number: "BW_NUMMER", date: "BW_DATUM", valid: "BW_GELDIG", discount: "BW_KORTING", reverse: "BW_VERLEGD", total: "BW_TOTAAL" } as const;

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Het controleteken (3 tekens) van een post voor één firma: FNV-1a over "sleutel:positie", 15 bits in Crockford base32. */
export function checkChars(sheetKey: string, pos: number): string {
  let h = 0x811c9dc5;
  const s = `${sheetKey}:${pos}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return CROCKFORD[(h >>> 10) & 31] + CROCKFORD[(h >>> 5) & 31] + CROCKFORD[h & 31];
}
export function itemKey(pos: number, sheetKey: string): string {
  return `P${pos}.${checkChars(sheetKey, pos)}`;
}

export type SheetItem = { pos: number; chapter: string; subgroup: string; code: string; title: string; text: string; unit: string; qtyMilli: bigint };
export type SheetInput = {
  sheetKey: string;
  sentHash: string;
  code: string; // "PV 2026/412-1"
  title: string;
  firm: string;
  place: string; // werfadres of enkel de gemeente (⚖4)
  deadline: string; // "24.10.2026"
  contact: string; // "Lien · 0470 00 00 00 · offertes@…"
  items: SheetItem[];
};

/** "PV 2026-412-1 Elektriciteit - Elektro Reiger.xlsx" (geen tekens die een bestandssysteem weigert). */
export function sheetFileName(d: { code: string; title: string; firm: string }): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
  return `${clean(d.code.replace(/\//g, "-"))} ${clean(d.title)} - ${clean(d.firm)}.xlsx`.slice(0, 180);
}

// ── XML ───────────────────────────────────────────────────────────────────
// Enkel tekens die XML 1.0 toelaat (geen stuurtekens buiten tab, nieuwe regel, terugloop).
export function xmlText(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const risky = (s: string) => /^[=+\-@\t\r]/.test(s);

// Stijlen (cellXfs): zie styles() hieronder.
const S = { plain: 0, bold: 1, head: 2, wrap: 3, text: 4, inText: 5, inNum: 6, qty: 7, calc: 8, chapter: 9, sub: 10, total: 11, inDate: 12, mono: 13, title: 14, small: 15 } as const;
// Elke stijl heeft een tweeling met quotePrefix (index + Q): daar komt tekst die met = + - @ of een tab begint.
const Q = 16;

type Cell = { col: string; s: number } & ({ t: "s"; v: string } | { t: "n"; v: string } | { t: "f"; v: string } | { t: "e" });
const str = (col: string, v: string, s: number = S.text): Cell => ({ col, s: risky(v) ? s + Q : s, t: "s", v });
const num = (col: string, v: string, s: number): Cell => ({ col, s, t: "n", v });
const fml = (col: string, v: string, s: number): Cell => ({ col, s, t: "f", v });
const empty = (col: string, s: number): Cell => ({ col, s, t: "e" });

function cellXml(r: number, c: Cell): string {
  const ref = `${c.col}${r}`;
  if (c.t === "e") return `<c r="${ref}" s="${c.s}"/>`;
  if (c.t === "n") return `<c r="${ref}" s="${c.s}"><v>${c.v}</v></c>`;
  if (c.t === "f") return `<c r="${ref}" s="${c.s}"><f>${xmlText(c.v)}</f></c>`;
  return `<c r="${ref}" s="${c.s}" t="inlineStr"><is><t xml:space="preserve">${xmlText(c.v)}</t></is></c>`;
}
type Row = { r: number; cells: Cell[]; ht?: number };
function rowsXml(rows: Row[]): string {
  return rows.map((x) => `<row r="${x.r}"${x.ht ? ` ht="${x.ht}" customHeight="1"` : ""}>${x.cells.map((c) => cellXml(x.r, c)).join("")}</row>`).join("");
}
const milliText = (m: bigint): string => {
  const neg = m < 0n;
  const a = neg ? -m : m;
  const int = a / 1000n;
  const frac = (a % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${int}${frac ? "." + frac : ""}`;
};

function sheetXml(o: { rows: Row[]; cols: string; frozen?: number; protect: boolean; validations?: string; hiddenTab?: boolean }): string {
  const pane = o.frozen ? `<pane ySplit="${o.frozen}" topLeftCell="A${o.frozen + 1}" activePane="bottomLeft" state="frozen"/>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + `<sheetViews><sheetView workbookViewId="0"${o.hiddenTab ? "" : ""}>${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>`
    + (o.cols ? `<cols>${o.cols}</cols>` : "")
    + `<sheetData>${rowsXml(o.rows)}</sheetData>`
    + (o.protect ? `<sheetProtection sheet="1" objects="1" scenarios="1" formatColumns="0" formatRows="0"/>` : "")
    + (o.validations ?? "")
    + `<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/></worksheet>`;
}

function styles(): string {
  const fonts = [
    `<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>`,
    `<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>`,
    `<font><i/><sz val="11"/><name val="Calibri"/><family val="2"/></font>`,
    `<font><sz val="10"/><name val="Courier New"/><family val="3"/></font>`,
    `<font><b/><sz val="16"/><name val="Calibri"/><family val="2"/></font>`,
    `<font><sz val="9"/><color rgb="FF535B69"/><name val="Calibri"/><family val="2"/></font>`,
  ];
  const fills = [`<fill><patternFill patternType="none"/></fill>`, `<fill><patternFill patternType="gray125"/></fill>`, `<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2B3"/><bgColor indexed="64"/></patternFill></fill>`, `<fill><patternFill patternType="solid"><fgColor rgb="FFECEEF1"/><bgColor indexed="64"/></patternFill></fill>`];
  const thin = `<left style="thin"><color rgb="FFC3C8D1"/></left><right style="thin"><color rgb="FFC3C8D1"/></right><top style="thin"><color rgb="FFC3C8D1"/></top><bottom style="thin"><color rgb="FFC3C8D1"/></bottom><diagonal/>`;
  const borders = [`<border><left/><right/><top/><bottom/><diagonal/></border>`, `<border>${thin}</border>`];
  const lock = (l: boolean) => (l ? "" : `<protection locked="0"/>`);
  const xf = (o: { font?: number; fill?: number; border?: number; numFmt?: number; wrap?: boolean; locked?: boolean; vtop?: boolean }) => {
    const locked = o.locked ?? true;
    const align = o.wrap || o.vtop ? `<alignment${o.vtop ? ` vertical="top"` : ""}${o.wrap ? ` wrapText="1"` : ""}/>` : "";
    return `<xf numFmtId="${o.numFmt ?? 0}" fontId="${o.font ?? 0}" fillId="${o.fill ?? 0}" borderId="${o.border ?? 0}" xfId="0"${o.numFmt ? ` applyNumberFormat="1"` : ""}${o.font ? ` applyFont="1"` : ""}${o.fill ? ` applyFill="1"` : ""}${o.border ? ` applyBorder="1"` : ""}${align ? ` applyAlignment="1"` : ""}${locked ? "" : ` applyProtection="1"`}>${align}${lock(locked)}</xf>`;
  };
  const xfs = [
    xf({}), // plain
    xf({ font: 1 }), // bold
    xf({ font: 1, fill: 3, border: 1, wrap: true, vtop: true }), // head
    xf({ wrap: true, vtop: true, border: 1 }), // wrap
    xf({ border: 1, vtop: true }), // text
    xf({ fill: 2, border: 1, locked: false, vtop: true }), // inText
    xf({ fill: 2, border: 1, locked: false, numFmt: 4, vtop: true }), // inNum
    xf({ border: 1, vtop: true }), // qty
    xf({ border: 1, numFmt: 4, vtop: true }), // calc
    xf({ font: 1, fill: 3, border: 1 }), // chapter
    xf({ font: 2, border: 1 }), // sub
    xf({ font: 1, border: 1, numFmt: 4 }), // total
    xf({ fill: 2, border: 1, locked: false, numFmt: 14 }), // inDate
    xf({ font: 3, border: 1, vtop: true }), // mono
    xf({ font: 4 }), // title
    xf({ font: 5, wrap: true }), // small
  ];
  // De tweelingen met quotePrefix (zelfde volgorde, index + Q).
  const quoted = xfs.map((x) => x.replace("<xf ", "<xf quotePrefix=\"1\" "));
  xfs.push(...quoted);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<fonts count="${fonts.length}">${fonts.join("")}</fonts><fills count="${fills.length}">${fills.join("")}</fills><borders count="${borders.length}">${borders.join("")}</borders>`
    + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs>`
    + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

const col = (min: number, max: number, width: number, hidden = false) => `<col min="${min}" max="${max}" width="${width}" customWidth="1"${hidden ? ` hidden="1"` : ""}/>`;

/** De .xlsx van één firma (bytes). */
export function makeSheet(d: SheetInput): Uint8Array {
  const C = COLS;
  // ── Prijsvraag ──
  const rows: Row[] = [];
  rows.push({ r: 1, cells: [str("B", "BOWACO", S.title)], ht: 22 });
  rows.push({ r: 2, cells: [str("B", `Prijsvraag ${d.code} · ${d.title}`, S.bold)] });
  rows.push({ r: 3, cells: [str("B", `Werf: ${d.place}`, S.plain)] });
  rows.push({ r: 4, cells: [str("B", `Voor: ${d.firm}`, S.plain)] });
  rows.push({ r: 5, cells: [str("B", `Antwoord vóór: ${d.deadline}`, S.bold), str("D", `Contact BOWACO: ${d.contact}`, S.plain)] });
  rows.push({ r: 7, cells: [str("B", "Uw offertenummer", S.plain), empty("D", S.inText), str("F", "Datum", S.plain), empty("H", S.inDate)] });
  rows.push({ r: 8, cells: [str("B", "Geldig tot", S.plain), empty("D", S.inDate), str("F", "Korting (%)", S.plain), empty("H", S.inNum), str("J", "Btw verlegd", S.plain), str("K", "ja", S.inText)] });
  const head: [string, string][] = [[C.key, "Sleutel"], [C.chapter, "Hoofdstuk"], [C.code, "Nr"], [C.title, "Omschrijving"], [C.text, "Lastenboektekst"], [C.unit, "Eenheid"], [C.qty, "VH"], [C.price, "Eenheidsprijs excl. btw"], [C.total, "Totaal excl. btw"], [C.included, "Inbegrepen?"], [C.remark, "Opmerking"]];
  rows.push({ r: HEADER_ROW, cells: head.map(([c, v]) => str(c, v, S.head)), ht: 30 });
  let r = HEADER_ROW + 1;
  const subtotals: string[] = [];
  const itemRows: number[] = [];
  // Per hoofdstuk: een kop, de posten (met een kop per subgroep), een subtotaal met de sleutel PV<id>.H<n>.
  const chapters: string[] = [];
  for (const it of d.items) if (!chapters.includes(it.chapter)) chapters.push(it.chapter);
  chapters.forEach((ch, ci) => {
    rows.push({ r, cells: [str(C.chapter, ch || "—", S.chapter), ...["C", "D", "E", "F", "G", "H", "I", "J", "K"].map((c) => empty(c, S.chapter))] });
    r++;
    const first = r;
    let sub = "";
    for (const it of d.items.filter((x) => x.chapter === ch)) {
      if (it.subgroup !== sub) {
        sub = it.subgroup;
        if (sub) { rows.push({ r, cells: [str(C.title, sub, S.sub)] }); r++; }
      }
      itemRows.push(r);
      rows.push({
        r,
        cells: [
          str(C.key, itemKey(it.pos, d.sheetKey), S.mono),
          str(C.chapter, ch, S.text),
          str(C.code, it.code, S.mono),
          str(C.title, it.title, S.wrap),
          str(C.text, it.text, S.wrap),
          str(C.unit, it.unit, S.text),
          num(C.qty, milliText(it.qtyMilli), S.qty),
          empty(C.price, S.inNum),
          fml(C.total, `IF(ISNUMBER(${C.price}${r}),${C.qty}${r}*${C.price}${r},"")`, S.calc),
          str(C.included, "ja", S.inText),
          empty(C.remark, S.inText),
        ],
      });
      r++;
    }
    const last = r - 1;
    rows.push({ r, cells: [str(C.key, `H${ci + 1}`, S.mono), str(C.chapter, `Subtotaal ${ch}`, S.total), ...["C", "D", "E", "F", "G", "H"].map((c) => empty(c, S.total)), fml(C.total, last >= first ? `SUM(${C.total}${first}:${C.total}${last})` : "0", S.total), empty("J", S.total), empty("K", S.total)] });
    subtotals.push(`${C.total}${r}`);
    r += 2;
  });
  const totalRow = r;
  rows.push({ r, cells: [str(C.key, "T", S.mono), str(C.chapter, "Totaal excl. btw (ter info)", S.total), ...["C", "D", "E", "F", "G", "H"].map((c) => empty(c, S.total)), fml(C.total, subtotals.length ? subtotals.join("+") : "0", S.total), empty("J", S.total), empty("K", S.total)] });
  const lastItem = itemRows.length ? itemRows[itemRows.length - 1] : HEADER_ROW + 1;
  const dv = `<dataValidations count="2"><dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="Inbegrepen?" error="Kies ja, nee of alternatief" sqref="J${HEADER_ROW + 1}:J${lastItem}"><formula1>"ja,nee,alternatief"</formula1></dataValidation>`
    + `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="K8"><formula1>"ja,nee"</formula1></dataValidation></dataValidations>`;
  const tableCols = [col(1, 1, 18, true), col(2, 2, 22), col(3, 3, 9), col(4, 4, 38), col(5, 5, 60), col(6, 6, 9), col(7, 7, 10), col(8, 8, 16), col(9, 9, 16), col(10, 10, 13), col(11, 11, 32)].join("");
  const table = sheetXml({ rows, cols: tableCols, frozen: HEADER_ROW, protect: true, validations: dv });

  // ── Eigen posten ──
  const own: Row[] = [{ r: 1, cells: [str("A", "Omschrijving", S.head), str("B", "Eenheid", S.head), str("C", "Hoeveelheid", S.head), str("D", "Eenheidsprijs excl. btw", S.head), str("E", "Opmerking", S.head)] }];
  for (let i = 0; i < OWN_ROWS; i++) own.push({ r: i + 2, cells: [empty("A", S.inText), empty("B", S.inText), empty("C", S.inNum), empty("D", S.inNum), empty("E", S.inText)] });
  const ownXml = sheetXml({ rows: own, cols: [col(1, 1, 48), col(2, 2, 10), col(3, 3, 12), col(4, 4, 18), col(5, 5, 40)].join(""), frozen: 1, protect: true });

  // ── Lees mij ──
  const lines = [
    `Prijsvraag ${d.code} · ${d.title} van BOWACO`,
    "1. Vul enkel de gele cellen in: eenheidsprijs excl. btw, inbegrepen (ja · nee · alternatief) en een opmerking; bovenaan uw offertenummer, datum, geldig tot, korting en btw verlegd.",
    "2. Voeg in de tabel geen regels in en haal er geen weg. Eigen posten zet u op het tabblad Eigen posten.",
    "3. Bij \"alternatief\": schrijf in de opmerking wat u voorstelt.",
    "4. Bewaar het bestand als .xlsx (niet als .xls of .csv).",
    "5. Stuur het terug naar BOWACO of laad het op in de app van BOWACO (Mijn prijsvragen).",
    `6. Vragen: ${d.contact}.`,
  ];
  const readme = sheetXml({ rows: lines.map((t, i) => ({ r: i + 1, cells: [str("A", t, i === 0 ? S.bold : S.small)] })), cols: col(1, 1, 120), protect: true });

  // ── _bowaco (zeer verborgen) ──
  // Geen id of volgnummer van de app (R37): de sleutel van de firma herkent de uitnodiging bij het inlezen.
  const meta: [string, string | bigint][] = [["vorm", FORM_ID], ["sleutel", d.sheetKey], ["posten", BigInt(d.items.length)], ["controlecode", d.sentHash]];
  const metaXml = sheetXml({ rows: meta.map(([k, v], i) => ({ r: i + 1, cells: [str("A", k, S.plain), typeof v === "bigint" ? num("B", v.toString(), S.plain) : str("B", v, S.plain)] })), cols: col(1, 2, 20), protect: true });

  const q = (n: string) => `'${n.replace(/'/g, "''")}'`;
  const names = [
    [NAMES.number, `${SHEET_TABLE}!$D$7`],
    [NAMES.date, `${SHEET_TABLE}!$H$7`],
    [NAMES.valid, `${SHEET_TABLE}!$D$8`],
    [NAMES.discount, `${SHEET_TABLE}!$H$8`],
    [NAMES.reverse, `${SHEET_TABLE}!$K$8`],
    [NAMES.total, `${SHEET_TABLE}!$I$${totalRow}`],
  ];
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + `<workbookPr/><bookViews><workbookView activeTab="1"/></bookViews><sheets>`
    + `<sheet name="${SHEET_README}" sheetId="1" r:id="rId1"/><sheet name="${SHEET_TABLE}" sheetId="2" r:id="rId2"/><sheet name="${SHEET_OWN}" sheetId="3" r:id="rId3"/><sheet name="${SHEET_META}" sheetId="4" state="veryHidden" r:id="rId4"/>`
    + `</sheets><definedNames>${names.map(([n, ref]) => `<definedName name="${n}">${xmlText(ref)}</definedName>`).join("")}<definedName name="BW_EIGEN">${xmlText(`${q(SHEET_OWN)}!$A$2:$E$${OWN_ROWS + 1}`)}</definedName></definedNames>`
    + `<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`;
  const rels = (items: [string, string, string][]) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join("")}</Relationships>`;
  const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
    + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
    + [1, 2, 3, 4].map((i) => `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")
    + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
  return zipStore([
    { name: "[Content_Types].xml", data: ct },
    { name: "_rels/.rels", data: rels([["rId1", `${R}/officeDocument`, "xl/workbook.xml"]]) },
    { name: "xl/workbook.xml", data: workbook },
    { name: "xl/_rels/workbook.xml.rels", data: rels([["rId1", `${R}/worksheet`, "worksheets/sheet1.xml"], ["rId2", `${R}/worksheet`, "worksheets/sheet2.xml"], ["rId3", `${R}/worksheet`, "worksheets/sheet3.xml"], ["rId4", `${R}/worksheet`, "worksheets/sheet4.xml"], ["rId5", `${R}/styles`, "styles.xml"]]) },
    { name: "xl/styles.xml", data: styles() },
    { name: "xl/worksheets/sheet1.xml", data: readme },
    { name: "xl/worksheets/sheet2.xml", data: table },
    { name: "xl/worksheets/sheet3.xml", data: ownXml },
    { name: "xl/worksheets/sheet4.xml", data: metaXml },
  ]);
}
