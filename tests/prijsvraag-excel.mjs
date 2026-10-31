// De prijsvraag-Excel heen en terug (stap 2c.2, ontwerp 2c §5 en §10), ZONDER netwerk: src/frontend/src/tender/sheet.ts maakt de
// .xlsx, een script vult ze in zoals Excel ze bewaart (gedeelde teksten, berekende waarden, deflate), src/frontend/src/tender/
// sheetread.ts leest ze terug = dezelfde prijzen. Plus de foutgevallen: regel gewist, sleutel gewijzigd, VH gewijzigd, tekst in een
// prijs, formule zonder waarde, Excel van een andere firma, een oud .xls, 2.001 regels; en de vorm zelf (verborgen kolom A, zeer
// verborgen tabblad _bowaco, vaste namen, keuzelijst in J, beveiligd blad, geen formule-injectie). Enkel VERZONNEN gegevens.
//   node tests/prijsvraag-excel.mjs
import { makeSheet, itemKey, checkChars, sheetFileName } from "../src/frontend/src/tender/sheet.ts";
import { readTenderSheet, parseMilli } from "../src/frontend/src/tender/sheetread.ts";
import { unzip, zipDeflate } from "../src/frontend/src/tender/zip.ts";
import { totals } from "../src/frontend/src/tender/calc.ts";

let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const dec = new TextDecoder();

// ── Een verzonnen prijsvraag ─────────────────────────────────────────────
const items = [
  { id: 41n, pos: 1, chapter: "5 Elektriciteit", subgroup: "Gelijkvloers", code: "5.01", title: "Stopcontact dubbel", text: "Inbouw, wit, met aarding.", unit: "st", qtyMilli: 12_000n },
  { id: 42n, pos: 2, chapter: "5 Elektriciteit", subgroup: "Gelijkvloers", code: "5.02", title: "Lichtpunt", text: "Plafond, met dubbelpolige schakelaar.", unit: "st", qtyMilli: 8_000n },
  { id: 43n, pos: 3, chapter: "5 Elektriciteit", subgroup: "Verdiep +1", code: "5.03", title: "=SOM(A1:A9) kabelgoot", text: "+ montage; @ werk\nTweede regel", unit: "lm", qtyMilli: 22_500n },
  { id: 44n, pos: 4, chapter: "6 Sanitair", subgroup: "", code: "6.01", title: "Aansluiting wastafel", text: "Koud en warm water, afvoer.", unit: "st", qtyMilli: 2_000n },
  { id: 45n, pos: 5, chapter: "6 Sanitair", subgroup: "", code: "6.02", title: "Leiding PE", text: "", unit: "lm", qtyMilli: 15_250n },
];
const invites = [{ id: 7n, orgName: "Elektro Reiger bv", sheetKey: "K7Q2M4XDB9TA" }, { id: 8n, orgName: "Elektro Merel bv", sheetKey: "M4XD9TAK7Q2B" }];
const base = { sentHash: "a".repeat(64), code: "PV 2026/412-1", title: "Elektriciteit & sanitair", place: "Proefstraat 12, 9999 Hoeveldam", deadline: "24.10.2026", contact: "Lien · 0470 00 00 00 · offertes@proef.invalid", items };
const forInvite = (i) => makeSheet({ ...base, sheetKey: i.sheetKey, firm: i.orgName });
const ctx = { tenderId: 17n, code: base.code, items: items.map((x) => ({ id: x.id, pos: x.pos, chapter: x.chapter, title: x.title, unit: x.unit, qtyMilli: x.qtyMilli })), invites };
const NAME = sheetFileName({ code: base.code, title: base.title, firm: invites[0].orgName });

// ── De vorm ──────────────────────────────────────────────────────────────
const xlsx = forInvite(invites[0]);
const files = await unzip(xlsx);
const wb = dec.decode(files.get("xl/workbook.xml"));
const tab = dec.decode(files.get("xl/worksheets/sheet2.xml"));
const st = dec.decode(files.get("xl/styles.xml"));
check("bestandsnaam: PV 2026-412-1 <titel> - <firma>.xlsx (geen / in de naam)", NAME === "PV 2026-412-1 Elektriciteit & sanitair - Elektro Reiger bv.xlsx", NAME);
check("vier tabbladen: Lees mij · Prijsvraag · Eigen posten · _bowaco (zeer verborgen); Prijsvraag is het actieve", /name="Lees mij"/.test(wb) && /name="Prijsvraag"/.test(wb) && /name="Eigen posten"/.test(wb) && /name="_bowaco" sheetId="4" state="veryHidden"/.test(wb) && /activeTab="1"/.test(wb));
check("vaste namen BW_NUMMER, BW_DATUM, BW_GELDIG, BW_KORTING, BW_VERLEGD, BW_TOTAAL", ["BW_NUMMER", "BW_DATUM", "BW_GELDIG", "BW_KORTING", "BW_VERLEGD", "BW_TOTAAL"].every((n) => wb.includes(`<definedName name="${n}">`)));
check("kolom A (sleutel) verborgen; blad beveiligd zonder wachtwoord", /<col min="1" max="1" width="18" customWidth="1" hidden="1"\/>/.test(tab) && /<sheetProtection sheet="1"/.test(tab) && !/password/i.test(tab));
check("keuzelijst ja · nee · alternatief in kolom J", /<dataValidation type="list"[^>]*sqref="J11:J\d+"><formula1>"ja,nee,alternatief"<\/formula1>/.test(tab));
check("enkel H, J, K en de kop zijn open (gele stijl met locked=0)", (st.match(/<protection locked="0"\/>/g) ?? []).length === 6 && /<c r="H13" s="6"\/>/.test(tab));
check("sleutel per post met het controleteken van DEZE firma (verschilt per firma)", tab.includes(itemKey(2, invites[0].sheetKey)) && checkChars(invites[0].sheetKey, 2) !== checkChars(invites[1].sheetKey, 2));
check("geen formule-injectie: tekst die met = + - @ of een tab begint, krijgt een stijl met quotePrefix (elke tekststijl heeft zo een tweeling), nooit een <f>", (() => { const m = tab.match(/<c r="D\d+" s="(\d+)" t="inlineStr"><is><t xml:space="preserve">=SOM\(A1:A9\) kabelgoot/); const xfs = [...st.matchAll(/<xf [^>]*>/g)].map((x) => x[0]).slice(1); return !!m && /quotePrefix="1"/.test(xfs[Number(m[1])]) && !/quotePrefix/.test(xfs[0]) && xfs.length === 32 && !/<f>SOM/.test(tab); })());
const meta = dec.decode(files.get("xl/worksheets/sheet4.xml"));
check("_bowaco: vorm prijsvraag-1, sleutel van de firma, aantal posten, controlecode; GEEN id of volgnummer van de app (R37)", meta.includes(">prijsvraag-1<") && meta.includes(invites[0].sheetKey) && /<c r="B3" s="0"><v>5<\/v>/.test(meta) && meta.includes("a".repeat(64)) && !/B5|B6/.test(meta) && !/>(prijsvraag|uitnodiging)</.test(meta));
check("sleutels in kolom A: P<positie>.<teken>, H<n> en T; nergens een id (PV17, 41 …)", /P1\.[0-9A-Z]{3}</.test(tab) && />H1</.test(tab) && />T</.test(tab) && !/PV\d/.test(tab));
check("tekst met & < > en een nieuwe regel blijft geldige XML", tab.includes("Elektriciteit &amp; sanitair") && tab.includes("Tweede regel"));

// ── Invullen zoals Excel het bewaart ─────────────────────────────────────
// Elke inlineStr wordt een gedeelde tekst, formules krijgen hun berekende waarde, het geheel wordt met deflate gezipt.
async function fill(bytes, edit) {
  const f = await unzip(bytes);
  const out = new Map([...f.entries()].map(([k, v]) => [k, dec.decode(v)]));
  let sheet = out.get("xl/worksheets/sheet2.xml");
  let own = out.get("xl/worksheets/sheet3.xml");
  const setCell = (xml, ref, inner, t) => {
    const re = new RegExp(`<c r="${ref}"( s="\\d+")?( t="\\w+")?(/>|>[\\s\\S]*?</c>)`);
    const cell = `<c r="${ref}"$1${t ? ` t="${t}"` : ""}>${inner}</c>`;
    if (re.test(xml)) return xml.replace(re, cell);
    // Nieuwe cel in de juiste rij (achteraan; de lezer kijkt enkel naar r=).
    const row = ref.replace(/^[A-Z]+/, "");
    return xml.replace(new RegExp(`(<row r="${row}"[^>]*>)([\\s\\S]*?)(</row>)`), `$1$2<c r="${ref}"${t ? ` t="${t}"` : ""}>${inner}</c>$3`);
  };
  const api = {
    set: (ref, v) => { sheet = setCell(sheet, ref, `<v>${v}</v>`); },
    setText: (ref, v) => { sheet = setCell(sheet, ref, `<is><t>${v}</t></is>`, "inlineStr"); },
    setOwn: (ref, v, text = false) => { own = setCell(own, ref, text ? `<is><t>${v}</t></is>` : `<v>${v}</v>`, text ? "inlineStr" : null); },
    raw: (fn) => { sheet = fn(sheet); },
    post: null, // na het rekenen (zoals een OA die de som overschrijft)
  };
  edit(api);
  // Berekende waarden voor de formules (I = G × H, subtotalen, totaal) zoals Excel ze na het rekenen bewaart.
  const val = (ref) => { const m = sheet.match(new RegExp(`<c r="${ref}"[^>]*>(?:<f>[^<]*</f>)?<v>([^<]*)</v>`)); return m ? Number(m[1]) : null; };
  // Zoals Excel: een prijs als tekst telt niet mee in de formule (ISNUMBER).
  sheet = sheet.replace(/<c r="I(\d+)" s="(\d+)"><f>IF\(ISNUMBER\(H\d+\),G\d+\*H\d+,(?:""|&quot;&quot;)\)<\/f><\/c>/g, (all, r, s) => {
    const g = val(`G${r}`), h = val(`H${r}`);
    return h === null || Number.isNaN(h) ? `<c r="I${r}" s="${s}" t="str"><f>IF(ISNUMBER(H${r}),G${r}*H${r},"")</f><v></v></c>` : `<c r="I${r}" s="${s}"><f>IF(ISNUMBER(H${r}),G${r}*H${r},"")</f><v>${Math.round(g * h * 100) / 100}</v></c>`;
  });
  const sums = [];
  sheet = sheet.replace(/<c r="I(\d+)" s="(\d+)"><f>SUM\(I(\d+):I(\d+)\)<\/f><\/c>/g, (all, r, s, a, b) => {
    let t = 0;
    for (let k = Number(a); k <= Number(b); k++) t += val(`I${k}`) ?? 0;
    sums.push(t);
    return `<c r="I${r}" s="${s}"><f>SUM(I${a}:I${b})</f><v>${Math.round(t * 100) / 100}</v></c>`;
  });
  sheet = sheet.replace(/<c r="I(\d+)" s="(\d+)"><f>([^<]*\+[^<]*|I\d+)<\/f><\/c>/g, (all, r, s, f) => `<c r="I${r}" s="${s}"><f>${f}</f><v>${Math.round(sums.reduce((a, b) => a + b, 0) * 100) / 100}</v></c>`);
  if (api.post) sheet = api.post(sheet);
  // inlineStr → gedeelde teksten (sharedStrings.xml), zoals Excel.
  const shared = [];
  const toShared = (xml) => xml.replace(/<c r="([A-Z]+\d+)"( s="\d+")? t="inlineStr"><is><t[^>]*>([\s\S]*?)<\/t><\/is><\/c>/g, (all, ref, s, text) => { shared.push(text); return `<c r="${ref}"${s ?? ""} t="s"><v>${shared.length - 1}</v></c>`; });
  for (const k of [...out.keys()].filter((k) => k.startsWith("xl/worksheets/"))) out.set(k, toShared(k === "xl/worksheets/sheet2.xml" ? sheet : k === "xl/worksheets/sheet3.xml" ? own : out.get(k)));
  out.set("xl/sharedStrings.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared.map((t) => `<si><t xml:space="preserve">${t}</t></si>`).join("")}</sst>`);
  out.set("xl/_rels/workbook.xml.rels", out.get("xl/_rels/workbook.xml.rels").replace("</Relationships>", `<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`));
  return zipDeflate([...out.entries()].map(([name, data]) => ({ name, data })));
}
const rowOfKey = (tabXml, key) => { const m = tabXml.match(new RegExp(`<c r="A(\\d+)" s="\\d+" t="inlineStr"><is><t xml:space="preserve">${key.replace(/\./g, "\\.")}</t>`)); return m ? Number(m[1]) : null; };
const R = Object.fromEntries(items.map((x) => [String(x.id), rowOfKey(tab, itemKey(x.pos, invites[0].sheetKey))]));
check("de rijen van de posten gevonden (5)", Object.values(R).every((r) => r !== null), JSON.stringify(R));

// De prijzen van de OA: 41 → 12,34 · 42 → 1.234,5 als tekst · 43 niet inbegrepen · 44 alternatief · 45 → 7
const filled = await fill(xlsx, (x) => {
  x.set(`H${R["41"]}`, "12.34");
  x.set(`H${R["42"]}`, "1234.5");
  x.setText(`J${R["43"]}`, "nee");
  x.set(`H${R["44"]}`, "99");
  x.setText(`J${R["44"]}`, "alternatief");
  x.setText(`K${R["44"]}`, "Wastafel met zuil");
  x.set(`H${R["45"]}`, "7");
  x.setText("D7", "ER-2026-118");
  x.set("H7", String(20385 + 25569)); // datum als getal van Excel
  x.setText("D8", "13.11.2026");
  x.set("H8", "5");
  x.setText("K8", "ja");
  x.setOwn("A2", "Aarding meten", true);
  x.setOwn("B2", "pst", true);
  x.setOwn("C2", "1");
  x.setOwn("D2", "150");
});
const r1 = await readTenderSheet(filled, NAME, { ...ctx, expectInviteId: 7n });
check("heen en terug: gelezen voor Elektro Reiger (uitnodiging 7)", r1.ok && r1.inviteId === 7n && r1.orgName === "Elektro Reiger bv", r1.ok ? "" : r1.error);
if (r1.ok) {
  const L = (id) => r1.lines.find((l) => l.itemId === id);
  check("dezelfde prijzen: 12,34 · 1.234,50 · geen · 99 · 7", L(41n).unitCents === 1234n && L(42n).unitCents === 123450n && L(43n).unitCents === null && L(44n).unitCents === 9900n && L(45n).unitCents === 700n, JSON.stringify(r1.lines.map((l) => String(l.unitCents)), null, 0));
  check("inbegrepen: nee bij 43 (geen bedrag, markering), alternatief bij 44 met de opmerking", "no" in L(43n).included && L(43n).amountCents === null && L(43n).flags.includes("niet-inbegrepen") && L(44n).included.alt === "Wastafel met zuil");
  check("bedragen per regel = eenheidsprijs × VH van BOWACO (12 × 12,34 = 148,08; 15,25 × 7 = 106,75)", L(41n).amountCents === 14_808n && L(45n).amountCents === 10_675n);
  check("eigen post: Aarding meten, 1 pst à 150,00", r1.lines.some((l) => l.itemId === null && l.description === "Aarding meten" && l.unit === "pst" && l.qtyMilli === 1000n && l.unitCents === 15_000n));
  check("kop: offertenummer, datum (getal van Excel), geldig tot (tekst), korting 5 %, btw verlegd", r1.header.number === "ER-2026-118" && r1.header.quoteDay === 20385n && r1.header.validUntil === BigInt(Date.UTC(2026, 10, 13) / 86_400_000) && r1.header.discountBp === 500n && r1.header.reverse === true, JSON.stringify(r1.header, (_, v) => (typeof v === "bigint" ? String(v) : v)));
  const t = totals(r1.lines.map((l) => ({ itemId: l.itemId, qtyMilli: l.qtyMilli, unitCents: l.unitCents, included: l.included })), 500n, (id) => items.find((x) => x.id === id).chapter);
  check("netto = som − 5 % (dezelfde rekenregels als de server)", r1.netCents === t.net && t.gross === 14_808n + 987_600n + 19_800n + 10_675n + 15_000n, `${r1.netCents} / ${t.gross}`);
  check("totaal van de Excel (BW_TOTAAL) = som van de regels: geen markering", !r1.flags.some((f) => f.includes("totaal")), r1.flags.join("; "));
  check("tellingen: 5 gelezen, 0 ontbrekend, 1 niet inbegrepen, 1 eigen, 0 fouten", r1.counts.read === 5 && r1.counts.missing === 0 && r1.counts.notIncluded === 1 && r1.counts.own === 1 && r1.counts.errors === 0, JSON.stringify(r1.counts));
}
check("deflate + gedeelde teksten (zoals Excel) en stored + inline (zoals de app) worden allebei gelezen", r1.ok && (await readTenderSheet(xlsx, NAME, ctx)).ok);
const blank = await readTenderSheet(xlsx, NAME, ctx);
check("een lege Excel: alle posten zonder prijs, geen fout", blank.ok && blank.counts.noPrice === 5 && blank.counts.errors === 0);

// ── Foutgevallen ─────────────────────────────────────────────────────────
const del = await fill(xlsx, (x) => x.raw((s) => s.replace(new RegExp(`<row r="${R["42"]}"[^>]*>[\\s\\S]*?</row>`), "")));
const rd = await readTenderSheet(del, NAME, ctx);
check("regel gewist: de post staat als 'ontbreekt' (geen fout, wel een markering)", rd.ok && rd.lines.find((l) => l.itemId === 42n).flags.includes("ontbreekt") && rd.counts.missing === 1);
const chg = await fill(xlsx, (x) => x.raw((s) => s.replace(itemKey(3, invites[0].sheetKey), `P3.${checkChars(invites[0].sheetKey, 3) === "AAA" ? "BBB" : "AAA"}`)));
const rc = await readTenderSheet(chg, NAME, ctx);
check("sleutel gewijzigd (controleteken): geweigerd met uitleg", !rc.ok && /gewijzigd \(controleteken/.test(rc.error), rc.ok ? "" : rc.error);
const vh = await fill(xlsx, (x) => { x.set(`G${R["41"]}`, "14"); x.setText(`F${R["45"]}`, "m"); x.set(`H${R["41"]}`, "10"); });
const rv = await readTenderSheet(vh, NAME, ctx);
check("VH gewijzigd door de OA: markering 'vh', zijn hoeveelheid bewaard (14); eenheid gewijzigd: markering 'eenheid'", rv.ok && rv.lines.find((l) => l.itemId === 41n).changed.includes("vh") && rv.lines.find((l) => l.itemId === 41n).qtyMilli === 14_000n && rv.lines.find((l) => l.itemId === 45n).changed.includes("eenheid") && rv.counts.changed === 2);
const txt = await fill(xlsx, (x) => x.setText(`H${R["41"]}`, "op aanvraag"));
const rt = await readTenderSheet(txt, NAME, ctx);
check("tekst in een prijscel: fout op die regel (de rest wordt gelezen)", rt.ok && /tekst in een prijscel/.test(rt.lines.find((l) => l.itemId === 41n).error ?? "") && rt.counts.errors === 1 && rt.counts.read === 5);
const fz = await fill(xlsx, (x) => x.raw((s) => s.replace(new RegExp(`<c r="H${R["42"]}" s="6"/>`), `<c r="H${R["42"]}" s="6"><f>G${R["42"]}*2</f></c>`)));
const rf = await readTenderSheet(fz, NAME, ctx);
check("formule zonder bewaarde waarde: leeg + markering (nooit uitgevoerd)", rf.ok && rf.lines.find((l) => l.itemId === 42n).flags.includes("formule-zonder-waarde") && rf.lines.find((l) => l.itemId === 42n).unitCents === null);
const other = await fill(forInvite(invites[1]), () => {});
const ro = await readTenderSheet(other, NAME, { ...ctx, expectInviteId: 7n });
check("Excel van een andere firma: geweigerd ('hoort bij Elektro Merel bv, niet bij Elektro Reiger bv')", !ro.ok && ro.error === "Deze Excel hoort bij Elektro Merel bv, niet bij Elektro Reiger bv.", ro.ok ? "" : ro.error);
const rx = await readTenderSheet(other, NAME, { ...ctx, code: "PV 2026/412-2", invites: [{ id: 9n, orgName: "Elektro Merel bv", sheetKey: "QQQQQQQQQQQQ" }] });
check("Excel van een andere prijsvraag: geweigerd", !rx.ok && /andere prijsvraag/.test(rx.error));
const ole = new Uint8Array(2048); ole.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const rold = await readTenderSheet(ole, "prijsvraag.xls", ctx);
check("een oud .xls: geweigerd met de weg 'met de hand naast de PDF'", !rold.ok && /oud Excel-bestand \(\.xls\)/.test(rold.error) && /met de hand/.test(rold.error));
const many = await fill(xlsx, (x) => x.raw((s) => s.replace("</sheetData>", `<row r="2001"><c r="B2001" t="inlineStr"><is><t>x</t></is></c></row></sheetData>`)));
const rm = await readTenderSheet(many, NAME, ctx);
check("2.001 regels: geweigerd", !rm.ok && /Meer dan 2000 regels/.test(rm.error), rm.ok ? "" : rm.error);
const dup = await fill(xlsx, (x) => x.raw((s) => s.replace(new RegExp(`(<row r="${R["45"]}"[^>]*>)<c r="A${R["45"]}" s="13" t="inlineStr"><is><t xml:space="preserve">[^<]*`), `$1<c r="A${R["45"]}" s="13" t="inlineStr"><is><t xml:space="preserve">${itemKey(4, invites[0].sheetKey)}`)));
const rdup = await readTenderSheet(dup, NAME, ctx);
check("dubbele sleutel: geweigerd", !rdup.ok && /twee keer/.test(rdup.error), rdup.ok ? "" : rdup.error);
const unk = await fill(xlsx, (x) => x.raw((s) => s.replace(itemKey(5, invites[0].sheetKey), "P99.ABC")));
const ru = await readTenderSheet(unk, NAME, ctx);
check("onbekende post in de sleutel: geweigerd", !ru.ok && /onbekende post/.test(ru.error));
const nometa = await fill(xlsx, (x) => {});
const f2 = await unzip(nometa);
const noMetaZip = await zipDeflate([...f2.entries()].filter(([k]) => k !== "xl/worksheets/sheet4.xml").map(([name, data]) => ({ name, data: dec.decode(data).replace(/<sheet name="_bowaco"[^>]*\/>/, "") })));
const rnm = await readTenderSheet(noMetaZip, NAME, ctx);
check("zonder het verborgen tabblad (een eigen Excel van de OA): geweigerd, met de weg 'met de hand'", !rnm.ok && /verborgen tabblad ontbreekt/.test(rnm.error) && /met de hand/.test(rnm.error));
check("geen .xlsx (csv, pdf): geweigerd", !(await readTenderSheet(xlsx, "x.csv", ctx)).ok && !(await readTenderSheet(xlsx, "x.xlsm", ctx)).ok);
const big = new Uint8Array(5 * 1024 * 1024 + 1); big.set([0x50, 0x4b, 3, 4]);
check("groter dan 5 MB: geweigerd", !(await readTenderSheet(big, NAME, ctx)).ok);
const tot = await fill(xlsx, (x) => { x.set(`H${R["41"]}`, "12.34"); x.post = (s) => s.replace(/(<c r="I\d+" s="11"><f>I\d+(\+I\d+)*<\/f><v>)[^<]*/, "$1999"); });
const rtot = await readTenderSheet(tot, NAME, ctx);
check("totaal van de OA (BW_TOTAAL) ≠ som van de regels: markering", rtot.ok && rtot.flags.some((f) => f.includes("totaal")), rtot.ok ? rtot.flags.join("; ") : rtot.error);

const tp = await fill(xlsx, (x) => { x.set(`H${R["41"]}`, "12.34"); x.setText(`H${R["42"]}`, "1.234,5"); });
const rtp = await readTenderSheet(tp, NAME, ctx);
check("prijs als tekst ('1.234,5'): toch gelezen (1.234,50); Excel telde ze niet mee in zijn totaal → markering", rtp.ok && rtp.lines.find((l) => l.itemId === 42n).unitCents === 123_450n && rtp.flags.some((f) => f.includes("totaal")), rtp.ok ? rtp.flags.join("; ") : rtp.error);

const th = await fill(xlsx, (x) => { x.setText(`H${R["41"]}`, "1.234"); x.set(`H${R["42"]}`, "1.234"); });
const rth = await readTenderSheet(th, NAME, ctx);
check("'1.234' als tekst = duizendtal (€ 1.234,00); als getal van Excel = 1,234 (€ 1,23)", rth.ok && rth.lines.find((l) => l.itemId === 41n).unitCents === 123_400n && rth.lines.find((l) => l.itemId === 42n).unitCents === 123n);
const k1 = await readTenderSheet(await fill(xlsx, (x) => x.setText("H8", "0,5")), NAME, ctx);
const k2 = await readTenderSheet(await fill(xlsx, (x) => x.set("H8", "0.5")), NAME, ctx);
check("korting: '0,5' als tekst = 0,5 %; het getal 0,5 = 50 % (cel met %-opmaak) met markering 'korting nakijken'", k1.ok && k1.header.discountBp === 50n && !k1.flags.some((f) => f.includes("korting")) && k2.ok && k2.header.discountBp === 5000n && k2.flags.some((f) => f.includes("korting nakijken")));
const meta3 = await fill(xlsx, (x) => {});
const f3 = await unzip(meta3);
const badMeta = await zipDeflate([...f3.entries()].map(([name, data]) => ({ name, data: name === "xl/worksheets/sheet4.xml" ? dec.decode(data).replace(/<v>5<\/v>/, "<v>6</v>") : data })));
const rbm = await readTenderSheet(badMeta, NAME, ctx);
check("het verborgen tabblad gewijzigd (aantal posten): geweigerd", !rbm.ok && /verborgen tabblad is gewijzigd/.test(rbm.error), rbm.ok ? "" : rbm.error);

// Getallen verdraagzaam lezen.
check("getallen: 1.234,56 · 1234,56 · 1234.56 · € 12 · 1,234.5 · 12 € → duizendsten; 'abc' en '1,2,3' ongeldig", parseMilli("1.234,56") === 1_234_560n && parseMilli("1234,56") === 1_234_560n && parseMilli("1234.56") === 1_234_560n && parseMilli("€ 12") === 12_000n && parseMilli("1,234.5") === 1_234_500n && parseMilli("12 €") === 12_000n && parseMilli("abc") === undefined && parseMilli("1,2,3") === undefined);

console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
