// Verkoopfacturen (stap 2c.6, ontwerp 2c §4.6, §7, §8 R42–R43, §10; ⚖1, ⚖6, ⚖7; AC-4, AC-6, AC-20, AC-21, AC-22, AC-27).
//   node tests/factuur-2c6.mjs                 A: de rekenmodule (sales/calc.ts: korting over de hoofdstukken, schijven met de rest in de
//                                                laatste, btw per tarief, verlegd, mededeling), de PDF (verplichte vermeldingen, lange
//                                                facturen), de UBL (verplichte velden, sommen) en de kwartaallijst-CSV, zonder netwerk
//   node tests/factuur-2c6.mjs <canister>      + B: door de backend: schema 50/24/26 met korting en per hoofdstuk, voorschotfactuur,
//                                                nummering zonder gaten (§7.4: teller op het laatste Excelnummer, geweigerd uitreiken
//                                                verbruikt geen nummer, gelijktijdig uitreiken, ontwerpen weggedaan, teller vast na het
//                                                eerste nummer, creditnota-reeks), btw 6/21/verlegd met de teksten, weigering bij een
//                                                ontbrekende vermelding, factuur uit een vorderingsstaat en uit de min-meerstaat (reeds
//                                                gefactureerd nooit dubbel), betalingen, rechten (werfleider, klant, andere klant, OA,
//                                                architect), .did-controle, rekentest browser = server (FACT_RONDES, standaard 200); 2c.6b: UBL uit een
//                                                uitgereikte factuur, kwartaallijst, herinnering; als LAATSTE de jaarwissel
//                                                (verzet de klok van het eigen net naar 1 januari) met de herinnering bij een
//                                                vervallen factuur.
//   node tests/factuur-2c6.mjs <canister> na-herstel   na een herstel (migratiecheck): de tellers staan op het hoogste nummer, de
//                                                volgende factuur krijgt het volgende nummer (geen gat, geen dubbel).
// Enkel VERZONNEN gegevens: firma's "Proef … 2c6", gemeente Lindegem, postcode 9993, nummers zonder betekenis.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backend, freshBackend } from "../tools/lib.mjs";
import * as SC from "../src/frontend/src/sales/calc.ts";
import { factuurPdf, verplicht } from "../src/frontend/src/pdf/factuur.ts";
import { fonts } from "./pdf-voorbeeld.mjs";

const cid = process.argv[2];
const mode = process.argv[3] ?? "";
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const S = (x) => JSON.stringify(x, big);
const tmp = mkdtempSync(join(tmpdir(), "bowaco-2c6-"));

// PyMuPDF: de tekst per bladzijde en wat buiten de marge valt (zoals tests/pdf.mjs).
const PY = `
import fitz, json, sys
d = fitz.open(sys.argv[1])
out = {"pages": []}
for p in d:
    r = p.rect
    blocks = [b for b in p.get_text("blocks") if b[6] == 0]
    out["pages"].append({"text": p.get_text(), "outside": [b[4][:40] for b in blocks if b[0] < 30 or b[2] > r.width - 30 or b[3] > r.height - 20 or b[1] < 20]})
print(json.dumps(out))
`;
const readPdf = (bytes, name) => {
  const f = join(tmp, name);
  writeFileSync(f, bytes);
  const r = spawnSync("python3", ["-c", PY, f], { encoding: "utf8", cwd: tmp });
  if (r.status !== 0) throw new Error(`PyMuPDF: ${r.stderr}`);
  return JSON.parse(r.stdout);
};
const flat = (o) => o.pages.map((p) => p.text).join("\n").replace(/\s+/g, " ");

// ── A. Rekenmodule, PDF, UBL, CSV ───────────────────────────────────────
if (mode !== "na-herstel") {
  check("(A1) afronding half weg van nul: 1,5 × € 0,03 = € 0,05; −1,5 × € 0,03 = −€ 0,05", SC.lineAmount(1500n, 3n) === 5n && SC.lineAmount(-1500n, 3n) === -5n);
  const nets = SC.netChapters([125_000n, 800_000n, 0n, 50_000n], 48_750n);
  check("(A1) korting € 487,50 naar verhouding over de hoofdstukken (op de cent), het laatste met een bedrag neemt de rest: Σ netto = bruto − korting", nets.reduce((a, b) => a + b, 0n) === 975_000n - 48_750n && nets[0] === 125_000n - 6250n && nets[2] === 0n && nets[3] === 50_000n - (48_750n - 6250n - 40_000n), S(nets));
  const am = SC.stepAmounts([100_001n, 33_333n], [[5000n, 3000n], [2400n, 4000n], [2600n, 3000n]]);
  check("(A1) schijven 50/24/26 en 30/40/30 per hoofdstuk: de laatste neemt de rest (Σ per hoofdstuk = netto)", am[0][0] === 50_001n && am[1][0] === 24_000n && am[2][0] === 100_001n - 50_001n - 24_000n && am.reduce((a, r) => a + r[1], 0n) === 33_333n, S(am));
  const t = SC.totals([{ amountCents: 10_005n, vatBp: 600n }, { amountCents: 10_005n, vatBp: 600n }, { amountCents: 1_000n, vatBp: 2100n }], false);
  check("(A1) btw per tarief op het totaal per tarief: 6 % van € 200,10 = € 12,01 (niet 2 × € 6,00); 21 % van € 10 = € 2,10", t.vatLines.length === 2 && t.vatLines[0].vatCents === 1201n && t.vatLines[1].vatCents === 210n && t.totalCents === 21_010n + 1201n + 210n, S(t));
  const r = SC.totals([{ amountCents: 50_000n, vatBp: 2100n }], true);
  check("(A1) btw verlegd: één blok aan 0 %, geen btw, totaal = netto", r.vatLines.length === 1 && r.vatLines[0].reverse && r.vatCents === 0n && r.totalCents === 50_000n);
  const cn = SC.totals([{ amountCents: -10_005n, vatBp: 600n }], false);
  check("(A1) creditnota negatief: −€ 100,05 + 6 % = −€ 106,05", cn.vatCents === -600n && cn.totalCents === -10_605n, S(cn));
  const ref = SC.paymentRef(1n, 2026n, 153n);
  check("(A1) gestructureerde mededeling +++123/4567/89012+++-vorm met een geldig controlegetal (mod 97)", /^\+\+\+\d{3}\/\d{4}\/\d{5}\+\+\+$/.test(ref) && SC.paymentRefOk(ref) && !SC.paymentRefOk(ref.replace(/\d(?=\+\+\+$)/, (d) => String((Number(d) + 1) % 10))), ref);
  check("(A1) nummer: 2026-153 en CN 2026-001", SC.number("F", 2026n, 153n) === "2026-153" && SC.number("CN", 2026n, 1n) === "CN 2026-001");
}

// Een verzonnen factuur voor de PDF en de UBL (geen echte firma, geen echt nummer).
const ISS = { name: "BOWACO (proef)", legalForm: "bv", address: { street: "Proefweg", number: "6", zip: "9993", city: "Lindegem", country: "BE" }, vat: "BE0123456789", kbo: "0123.456.789", rpr: "RPR Proefstad, afdeling Lindegem", email: "kantoor@proef.invalid", phone: "", website: "proef.invalid", iban: "BE49 9990 0000 0171", bic: "PROFBEBB" };
export function voorbeeldFactuur(o = {}) {
  const line = (i) => ({ kind: i === 30 ? "herziening" : "werk", group: `0${(i % 3) + 1} Proefhoofdstuk ${(i % 3) + 1}`, description: i === 7 ? "Proefpost met een zeer lange omschrijving ".repeat(12) : `Proefpost ${i}`, qtyMilli: i % 4 === 0 ? 1000n : BigInt(1500 * i + 1000), unit: i % 4 === 0 ? "ff" : "m2", unitCents: 12_345n, amountCents: i % 4 === 0 ? 12_345n : SC.lineAmount(BigInt(1500 * i + 1000), 12_345n), vatBp: 600n, baseCents: i % 5 === 0 ? 1_000_000n : null, pctBp: i % 5 === 0 ? 5000n : null });
  const lines = o.lines ?? Array.from({ length: 60 }, (_, i) => line(i));
  const tt = SC.totals(lines, !!o.reverse);
  return {
    number: "2026-153", kindText: "Voorschotfactuur", draft: false, issueDay: 20_758n, serviceDay: null, serviceTo: null, dueDay: 20_773n, paymentDays: 15n,
    issuer: ISS, buyer: { name: "Proef Klant Lijster 2c6", address: { street: "Proefdreef", number: "9", zip: "9993", city: "Lindegem", country: "BE" }, vat: o.reverse ? "BE0987654321" : "", kbo: "", company: !!o.reverse },
    workCode: "P-FA1", workName: "Proefwerf facturen 2c6", workAddress: { street: "Proefweg", number: "12", zip: "9993", city: "Lindegem", country: "BE" }, analyticCode: "P-FA1", quoteRefs: ["2026/412 v1"],
    title: "Voorschot 50 %", note: "", lines, previous: [{ number: "2026-150", day: 20_700n, cents: 100_000n, revisionCents: 0n }],
    vatLines: tt.vatLines, netCents: tt.netCents, vatCents: tt.vatCents, totalCents: tt.totalCents,
    mentions: o.reverse ? ["Verlegging van heffing. Proeftekst."] : ["Btw-tarief: bij gebrek aan schriftelijke betwisting (proeftekst 6 %).", "Gelieve bij de betaling de gestructureerde mededeling te gebruiken."],
    paymentRef: SC.paymentRef(1n, 2026n, 153n), creditOf: null, creditOfDay: null, hash: "ab".repeat(32), ...o,
  };
}

if (mode !== "na-herstel") {
  const F = fonts();
  const d1 = voorbeeldFactuur();
  const r1 = readPdf(await factuurPdf(d1, F), "factuur.pdf");
  const t1 = flat(r1);
  const miss = verplicht(d1).filter((w) => !t1.includes(w));
  check("(A2) PDF: alle verplichte vermeldingen (§7.2): nummer, afzender met btw, ondernemingsnummer, RPR, rekening, klant, werfcode, mededeling", miss.length === 0, miss.join(" | "));
  check("(A2) PDF: factuurdatum, vervaldag met termijn, maatstaf van heffing en btw per tarief, te betalen, de 6 %-vermelding", t1.includes("FACTUURDATUM") && t1.includes("VERVALDAG") && t1.includes("(15 dagen)") && t1.includes("Maatstaf van heffing 6 %") && t1.includes("Btw 6 %") && t1.includes("Te betalen") && t1.includes("proeftekst 6 %"));
  check("(A2) PDF: 60 regels met een lange omschrijving over meerdere bladzijden, voet 'i / n' met de controlecode, niets buiten de marge", r1.pages.length >= 2 && r1.pages.every((p, i) => p.text.includes(`${i + 1} / ${r1.pages.length}`) && p.text.includes("abababababababab")) && r1.pages.every((p) => p.outside.length === 0), `${r1.pages.length} blz.; ${r1.pages.flatMap((p) => p.outside).join(" | ")}`);
  check("(A2) PDF: reeds gefactureerd ter info en de prijsherziening als eigen regel", t1.includes("REEDS GEFACTUREERD OP DEZE WERF") && t1.includes("2026-150"));
  const r2 = readPdf(await factuurPdf(voorbeeldFactuur({ reverse: true, lines: [{ kind: "werk", group: "01 Proef", description: "Proefpost verlegd", qtyMilli: 1000n, unit: "ff", unitCents: 50_000n, amountCents: 50_000n, vatBp: 0n, baseCents: null, pctBp: null }] }), F), "verlegd.pdf");
  const t2 = flat(r2);
  check("(A2) PDF btw verlegd: btw-nummer van de klant, 'btw verlegd (0 %)', de vermelding; één bladzijde", t2.includes("BE0987654321") && t2.includes("btw verlegd (0 %)") && t2.includes("Verlegging van heffing") && r2.pages.length === 1);
  const r3 = readPdf(await factuurPdf(voorbeeldFactuur({ draft: true, number: "", paymentRef: "", lines: [] }), F), "ontwerp.pdf");
  check("(A2) PDF ontwerp: 'ONTWERP' en 'nog geen factuur', geen nummer", flat(r3).includes("ONTWERP") && flat(r3).includes("nog geen factuur"));
  const r4 = readPdf(await factuurPdf(voorbeeldFactuur({ kindText: "Creditnota", number: "CN 2026-001", creditOf: "2026-153", creditOfDay: 20_758n, paymentRef: "", lines: [{ kind: "werk", group: "01 Proef", description: "Proefpost", qtyMilli: -1000n, unit: "ff", unitCents: 10_000n, amountCents: -10_000n, vatBp: 600n, baseCents: null, pctBp: null }] }), F), "cn.pdf");
  const t4 = flat(r4);
  check("(A2) PDF creditnota: nummer CN, 'Bij factuur 2026-153', negatief totaal, geen betaalopdracht", t4.includes("CN 2026-001") && t4.includes("BIJ FACTUUR") && t4.includes("2026-153") && t4.includes("Totaal creditnota") && !t4.includes("Te betalen uiterlijk"));
}

// A3 (2c.6b). De UBL (Peppol BIS Billing 3.0 / EN 16931): verplichte velden en kloppende sommen, gelezen met de XML-lezer van Python
// (xml.etree, enkel lezen). Geen externe validator, geen verzending.
const PYX = `
import json, sys, xml.etree.ElementTree as ET
ns = {"cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2", "cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"}
r = ET.parse(sys.argv[1]).getroot()
t = lambda p: [e.text for e in r.findall(p, ns)]
lines = r.findall("cac:InvoiceLine", ns) + r.findall("cac:CreditNoteLine", ns)
q = lambda l: (l.find("cbc:InvoicedQuantity", ns) if l.find("cbc:InvoicedQuantity", ns) is not None else l.find("cbc:CreditedQuantity", ns))
out = {"root": r.tag.split("}")[1], "customization": t("cbc:CustomizationID"), "profile": t("cbc:ProfileID"), "id": t("cbc:ID"), "issue": t("cbc:IssueDate"), "due": t("cbc:DueDate"),
  "type": t("cbc:InvoiceTypeCode") + t("cbc:CreditNoteTypeCode"), "currency": t("cbc:DocumentCurrencyCode"), "buyerRef": t("cbc:BuyerReference"), "billingRef": t("cac:BillingReference/cac:InvoiceDocumentReference/cbc:ID"),
  "sellerEndpoint": t("cac:AccountingSupplierParty/cac:Party/cbc:EndpointID"), "sellerName": t("cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName"), "sellerVat": t("cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme/cbc:CompanyID"), "sellerCountry": t("cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cac:Country/cbc:IdentificationCode"),
  "buyerEndpoint": t("cac:AccountingCustomerParty/cac:Party/cbc:EndpointID"), "buyerName": t("cac:AccountingCustomerParty/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName"), "buyerVat": t("cac:AccountingCustomerParty/cac:Party/cac:PartyTaxScheme/cbc:CompanyID"), "buyerCountry": t("cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cac:Country/cbc:IdentificationCode"),
  "payCode": t("cac:PaymentMeans/cbc:PaymentMeansCode"), "payId": t("cac:PaymentMeans/cbc:PaymentID"), "iban": t("cac:PaymentMeans/cac:PayeeFinancialAccount/cbc:ID"),
  "taxTotal": t("cac:TaxTotal/cbc:TaxAmount"), "sub": [{"base": s.find("cbc:TaxableAmount", ns).text, "tax": s.find("cbc:TaxAmount", ns).text, "cat": s.find("cac:TaxCategory/cbc:ID", ns).text, "pct": s.find("cac:TaxCategory/cbc:Percent", ns).text, "reason": [e.text for e in s.findall("cac:TaxCategory/cbc:TaxExemptionReasonCode", ns)]} for s in r.findall("cac:TaxTotal/cac:TaxSubtotal", ns)],
  "lineExt": t("cac:LegalMonetaryTotal/cbc:LineExtensionAmount"), "taxExcl": t("cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount"), "taxIncl": t("cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount"), "payable": t("cac:LegalMonetaryTotal/cbc:PayableAmount"),
  "lines": [{"qty": q(l).text, "unit": q(l).get("unitCode"), "amount": l.find("cbc:LineExtensionAmount", ns).text, "price": l.find("cac:Price/cbc:PriceAmount", ns).text, "cat": l.find("cac:Item/cac:ClassifiedTaxCategory/cbc:ID", ns).text, "pct": l.find("cac:Item/cac:ClassifiedTaxCategory/cbc:Percent", ns).text, "name": l.find("cac:Item/cbc:Name", ns).text} for l in lines]}
print(json.dumps(out))
`;
const readUbl = (xml, name) => {
  const f = join(tmp, name);
  writeFileSync(f, xml);
  const r = spawnSync("python3", ["-c", PYX, f], { encoding: "utf8", cwd: tmp });
  if (r.status !== 0) throw new Error(`XML: ${r.stderr.slice(0, 300)}`);
  return JSON.parse(r.stdout);
};
const cents = (s) => { const neg = s.startsWith("-"); const [i, d = ""] = s.replace("-", "").split("."); const v = BigInt(i) * 100n + BigInt((d + "00").slice(0, 2)); return neg ? -v : v; };
const milli = (s) => { const neg = s.startsWith("-"); const [i, d = ""] = s.replace("-", "").split("."); const v = BigInt(i) * 1000n + BigInt((d + "000").slice(0, 3)); return neg ? -v : v; };
/** De controles van EN 16931 / Peppol BIS 3.0 die de app zelf kan doen: verplichte velden en de sommen (BR-CO-10/13/15, BR-S-08/09, BR-27, R120). */
export function ublProblems(u, expect) {
  const p = [];
  const one = (k) => { if (!u[k] || u[k].length !== 1 || !String(u[k][0]).trim()) p.push(`ontbreekt: ${k}`); };
  for (const k of ["customization", "profile", "id", "issue", "type", "currency", "buyerRef", "sellerEndpoint", "sellerName", "sellerVat", "sellerCountry", "buyerEndpoint", "buyerName", "buyerCountry", "taxTotal", "lineExt", "taxExcl", "taxIncl", "payable"]) one(k);
  if (u.customization[0] !== "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0") p.push("CustomizationID");
  if (u.profile[0] !== "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0") p.push("ProfileID");
  if (u.currency[0] !== "EUR") p.push("munt");
  if (u.root === "Invoice" && (u.due.length !== 1 || u.payCode.length !== 1 || u.iban.length !== 1)) p.push("vervaldag of betaalwijze");
  if (u.root === "CreditNote" && u.billingRef.length !== 1) p.push("verwijzing naar de factuur");
  if (u.lines.length === 0) p.push("geen regels");
  const sumLines = u.lines.reduce((a, l) => a + cents(l.amount), 0n);
  if (sumLines !== cents(u.lineExt[0])) p.push(`BR-CO-10 Σ regels ${sumLines} ≠ ${u.lineExt[0]}`);
  if (cents(u.taxExcl[0]) !== cents(u.lineExt[0])) p.push("BR-CO-13");
  const sumTax = u.sub.reduce((a, s) => a + cents(s.tax), 0n);
  if (sumTax !== cents(u.taxTotal[0])) p.push("BR-CO-14 Σ btw");
  if (cents(u.taxIncl[0]) !== cents(u.taxExcl[0]) + cents(u.taxTotal[0])) p.push("BR-CO-15");
  if (cents(u.payable[0]) !== cents(u.taxIncl[0])) p.push("te betalen");
  for (const s of u.sub) {
    const base = u.lines.filter((l) => l.cat === s.cat && l.pct === s.pct).reduce((a, l) => a + cents(l.amount), 0n);
    if (base !== cents(s.base)) p.push(`BR-S-08 maatstaf ${s.cat} ${s.pct}`);
    const exp = SC.pctOf(cents(s.base), BigInt(Math.round(Number(s.pct) * 100)));
    if (exp !== cents(s.tax)) p.push(`BR-S-09 btw ${s.pct} %`);
    if (s.cat === "AE" && (s.reason.length !== 1 || u.buyerVat.length !== 1)) p.push("BR-AE: reden en btw-nummer van de klant");
  }
  for (const l of u.lines) {
    if (cents(l.price) < 0n) p.push("BR-27 negatieve prijs");
    const d = SC.lineAmount(milli(l.qty), cents(l.price)) - cents(l.amount);
    if (d > 1n || d < -1n) p.push(`R120 regel ${l.name}`);
  }
  if (expect && cents(u.payable[0]) !== expect) p.push(`te betalen ${u.payable[0]} ≠ PDF ${expect}`);
  return p;
}
if (mode !== "na-herstel") {
  const { ublXml } = await import("../src/frontend/src/sales/ubl.ts");
  const toUbl = (d, credit = false) => ({ number: d.number, credit, issueDay: d.issueDay, dueDay: d.dueDay, serviceDay: d.serviceDay, serviceTo: d.serviceTo, issuer: d.issuer, buyer: { ...d.buyer, vat: d.buyer.vat || "BE0987654321", kbo: d.buyer.kbo }, workCode: d.workCode, quoteRefs: d.quoteRefs, lines: d.lines, vatLines: d.vatLines, netCents: d.netCents, vatCents: d.vatCents, totalCents: d.totalCents, mentions: d.mentions, paymentRef: d.paymentRef, paymentDays: d.paymentDays, creditOf: d.creditOf, creditOfDay: d.creditOfDay, scheme: "0208" });
  const d1 = voorbeeldFactuur();
  const u1 = readUbl(ublXml(toUbl(d1)), "factuur.xml");
  const p1 = ublProblems(u1, d1.totalCents);
  check("(A3) UBL factuur (60 regels, 6 %): verplichte velden, Σ regels = netto, btw per tarief, totaal = PDF", p1.length === 0 && u1.root === "Invoice" && u1.lines.length === 60 && u1.payId[0] === d1.paymentRef, p1.join(" | "));
  const d2 = voorbeeldFactuur({ reverse: true, lines: [{ kind: "werk", group: "01 Proef", description: "Proefpost verlegd", qtyMilli: 2500n, unit: "m2", unitCents: 12_345n, amountCents: SC.lineAmount(2500n, 12_345n), vatBp: 0n, baseCents: null, pctBp: null }, { kind: "aftrek", group: "Reeds gefactureerd", description: "Reeds gefactureerd: proef", qtyMilli: 1000n, unit: "ff", unitCents: -10_000n, amountCents: -10_000n, vatBp: 0n, baseCents: null, pctBp: null }] });
  const u2 = readUbl(ublXml(toUbl(d2)), "verlegd.xml");
  const p2 = ublProblems(u2, d2.totalCents);
  check("(A3) UBL btw verlegd: categorie AE met de vrijstellingsreden en het btw-nummer van de klant; aftrekregel = negatieve hoeveelheid, positieve prijs", p2.length === 0 && u2.sub.length === 1 && u2.sub[0].cat === "AE" && u2.lines[1].qty.startsWith("-") && !u2.lines[1].price.startsWith("-"), p2.join(" | "));
  const d3 = voorbeeldFactuur({ kindText: "Creditnota", number: "CN 2026-001", creditOf: "2026-153", creditOfDay: 20_758n, paymentRef: "", lines: [{ kind: "werk", group: "01 Proef", description: "Proefpost", qtyMilli: -1000n, unit: "ff", unitCents: 10_000n, amountCents: -10_000n, vatBp: 600n, baseCents: null, pctBp: null }] });
  const u3 = readUbl(ublXml(toUbl(d3, true)), "cn.xml");
  const p3 = ublProblems(u3, -d3.totalCents);
  check("(A3) UBL creditnota: <CreditNote> 381 met verwijzing naar de factuur, positieve bedragen", p3.length === 0 && u3.root === "CreditNote" && u3.type[0] === "381" && u3.billingRef[0] === "2026-153" && !u3.payable[0].startsWith("-"), p3.join(" | "));
  const bad = ublProblems({ ...u1, lineExt: ["1.00"] }, null);
  check("(A3) de toets ziet een fout totaal (zelftest)", bad.some((x) => x.startsWith("BR-CO-10")));
  const { quarterCsv, CSV_HEAD } = await import("../src/frontend/src/sales/csv.ts");
  const rows = [
    { number: "2026-153", series: "F", kind: "voorschot", issueDay: 20_758n, dueDay: 20_773n, clientName: "Proef Klant; Lijster", clientVat: "", workCode: "P-FA1", analyticCode: "P-FA1", vatLines: [{ vatBp: 600n, reverse: false, baseCents: 100_005n, vatCents: 6_000n }], netCents: 100_005n, vatCents: 6_000n, totalCents: 106_005n, paidDay: 20_760n, creditOf: "" },
    { number: "2026-154", series: "F", kind: "vrij", issueDay: 20_759n, dueDay: 20_774n, clientName: "Proef Bedrijf Spreeuw", clientVat: "BE0987654321", workCode: "P-FC1", analyticCode: "P-FC1", vatLines: [{ vatBp: 0n, reverse: true, baseCents: 250_000n, vatCents: 0n }], netCents: 250_000n, vatCents: 0n, totalCents: 250_000n, paidDay: null, creditOf: "" },
    { number: "CN 2026-001", series: "CN", kind: "creditnota", issueDay: 20_760n, dueDay: 20_760n, clientName: "Proef Klant; Lijster", clientVat: "", workCode: "P-FA1", analyticCode: "P-FA1", vatLines: [{ vatBp: 2100n, reverse: false, baseCents: -10_000n, vatCents: -2_100n }], netCents: -10_000n, vatCents: -2_100n, totalCents: -12_100n, paidDay: null, creditOf: "2026-153" },
  ];
  const csv = quarterCsv(rows);
  const ls = csv.replace(/^﻿/, "").trim().split("\r\n");
  check("(A4) kwartaallijst-CSV: kop met werfcode en btw per tarief, één regel per factuur, puntkomma en decimale komma, BOM", csv.startsWith("﻿") && ls.length === 4 && ls[0] === CSV_HEAD.join(";") && ls[1].includes(";1000,05;60,00;0,00;0,00;0,00;1000,05;60,00;1060,05;2026-11-03;") && ls[1].includes('"Proef Klant; Lijster"'), ls[1]);
  check("(A4) verlegd in een eigen kolom, creditnota negatief met 'bij factuur'", ls[2].includes(";2500,00;2500,00;0,00;2500,00;;") && ls[3].endsWith(";-121,00;;2026-153") && ls[3].includes(";-100,00;-21,00;"), `${ls[2]} | ${ls[3]}`);
}
if (mode !== "na-herstel") {
  const r5 = readPdf(await factuurPdf(voorbeeldFactuur({ reminder: { level: 1, day: 20_790n, text: "Proef: kosteloze herinnering met een termijn van 14 dagen.", openCents: 50_000n, paidCents: 0n } }), fonts()), "herinnering.pdf");
  const t5 = flat(r5);
  check("(A2) PDF herinnering: 'Herinnering 1', het openstaande bedrag met de vervaldag, de tekst uit Beheer, de factuur erbij", t5.includes("HERINNERING 1") && t5.includes("Openstaand") && t5.includes("kosteloze herinnering") && t5.includes("2026-153"));
}

// ── B. Door de backend ──────────────────────────────────────────────────
if (!cid) { console.log(`\n${pass} ✓  ${fail} ✗  (enkel A: geef een canister voor B)`); process.exit(fail ? 1 : 0); }
const { M, saveAll, fromRead, ensureProofClientAddress } = await import("./offerte-lib.mjs");
const { proefVordering, saveAs } = await import("./vordering-lib.mjs");
const MC = await import("../src/frontend/src/minmeer/calc.ts");
const ok = (r) => { if (r && typeof r === "object" && "err" in r) throw new Error(r.err); return r.ok; };
const isOk = (r) => r && typeof r === "object" && "ok" in r;
const errOf = (r) => (r && typeof r === "object" && "err" in r ? r.err : "");
const denied = async (p) => { try { const r = await p; return !!(r && typeof r === "object" && "err" in r && /^Geen toegang/.test(r.err)); } catch (e) { return /Geen toegang|trap|Reject|reject/i.test(String(e)); } };
const opt = (v) => (v === null || v === undefined ? [] : [v]);
const un = (a) => (Array.isArray(a) && a.length ? a[0] : null);
const keysOf = (x, out = new Set()) => { if (Array.isArray(x)) x.forEach((y) => keysOf(y, out)); else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { out.add(k); keysOf(v, out); } return out; };
const MONEY = /cents|price|cost|margin|amount|euro|total/i;
const noMoney = (x) => ![...keysOf(x)].some((k) => MONEY.test(k));
const kindOf = (v) => Object.keys(v)[0];

const [admin, calc, wl, oa2, klant, arch] = await Promise.all(["proef-admin", "proef-calculator", "proef-werfleider", "proef-oa2", "proef-klant", "proef-architect"].map((n) => backend(n, cid)));
const vreemd = await freshBackend(cid);
const suffix = Date.now().toString(36).slice(-5).toUpperCase().replace(/[0-9]/g, (d) => "QWERTYUIOP"[Number(d)]);
const settingsNow = async () => await admin.salesSettings();
const cDay = (await settingsNow()).today;
const YEAR = BigInt(new Date(Number(cDay) * 86_400_000).getUTCFullYear());
const issuerIn = { name: ISS.name, legalForm: ISS.legalForm, address: ISS.address, vat: ISS.vat, kbo: ISS.kbo, rpr: ISS.rpr, email: ISS.email, phone: ISS.phone, website: ISS.website, iban: ISS.iban, bic: ISS.bic };
const setIn = (o = {}) => ({ issuer: issuerIn, paymentDays: 15n, vat6Text: "", reverseText: "", paymentText: "", footerText: "Proef: algemene voorwaarden op aanvraag.", reminderText: "", reminderDays: 0n, issuerOnly: false, firstSeqF: 100n, firstSeqCN: 1n, planBp: [5000n, 2400n, 2600n], peppolScheme: "0208", ...o });
const seqOf = (nr) => BigInt(nr.split("-").pop());
const counterOf = async (series, year = YEAR) => (await settingsNow()).counters.find((c) => c.series === series && c.year === year);
// Hoe de browser een ontwerp bewaart: hij rekent het totaal met sales/calc.ts.
const vatKey = (v) => kindOf(v);
const linesIn = (ls) => ls.map((l) => ({ kind: l.kind ?? { work: null }, group: l.group ?? "01 Proef", description: l.description, ref: l.ref ?? "", qtyMilli: l.qtyMilli ?? 1000n, unit: l.unit ?? "ff", unitCents: l.unitCents, vatBp: l.vatBp ?? 2100n }));
const browserTotal = (lines, vat) => {
  const ls = lines.map((l) => ({ amountCents: SC.lineAmount(l.qtyMilli, l.unitCents), vatBp: vatKey(vat) === "rate" ? vat.rate : vatKey(vat) === "reverse" ? 0n : l.vatBp }));
  return SC.totals(ls, vatKey(vat) === "reverse").totalCents;
};
const draftIn = (full, o = {}) => {
  const vat = o.vat ?? full.vat;
  const lines = o.lines ?? null;
  const cur = lines ?? full.lines.map((l) => ({ qtyMilli: l.qtyMilli, unitCents: l.unitCents, vatBp: l.vatBp }));
  return { title: o.title ?? full.brief.title, note: o.note ?? full.note, serviceDay: opt(o.serviceDay ?? un(full.serviceDay)), serviceTo: opt(o.serviceTo ?? un(full.serviceTo)), paymentDays: o.paymentDays ?? full.paymentDays, vat, lines: lines ? [lines] : [], expectTotalCents: o.expect ?? browserTotal(cur, vat) };
};
const read = async (id, who = calc) => ok(await who.readSalesInvoice(id));
const issue = async (id, who = calc) => { const f = await read(id, who); return await who.issueSalesInvoice(id, f.brief.rev, f.totals.totalCents); };
const freeDraft = async (workId, lines, vat = { rate: 2100n }, who = calc) => {
  const id = ok(await who.newSalesInvoice(workId, { free: null }));
  const f = await read(id, who);
  ok(await who.saveSalesDraft(id, f.brief.rev, draftIn(f, { title: "Proef vrije factuur 2c6", lines: linesIn(lines), vat })));
  return id;
};

if (mode === "na-herstel") {
  // Na een herstel (migratiecheck): elke teller staat minstens op het hoogste uitgereikte nummer; de volgende factuur = + 1.
  const st = await settingsNow();
  const list = (await admin.salesWorklist()).ok;
  check("(H) na het herstel: instellingen en werklijst leesbaar", !!st && !!list);
  const all = [];
  for (let from = 0n; ; from += 200n) { const r = ok(await admin.exportChunk("salesInvoices", from, 200n)); const xs = r.salesInvoices ?? []; all.push(...xs); if (xs.length < 200) break; }
  const issued = all.filter((i) => "issued" in i.status);
  const nrs = issued.map((i) => i.number);
  check(`(H) ${issued.length} uitgereikte facturen en creditnota's hersteld; elk nummer één keer`, issued.length > 0 && new Set(nrs).size === nrs.length, `${issued.length}`);
  const maxOf = (series, year) => issued.filter((i) => i.series === series && i.year === year).reduce((a, i) => (i.seq > a ? i.seq : a), 0n);
  for (const c of st.counters) {
    const m = maxOf(c.series, c.year);
    if (m > 0n) check(`(H) teller ${c.series} ${c.year}: ${c.last} = het hoogste uitgereikte nummer ${m}; vast`, c.last === m && c.locked, S(c));
  }
  const bad = [];
  for (const i of issued.slice(-30)) { const f = await read(i.id, admin); if (!f.intact) bad.push(i.number); }
  check("(H) de controlecode van de herstelde facturen klopt (intact)", bad.length === 0, bad.join(", "));
  const any = issued.find((i) => i.series === "F" && i.year === YEAR && un(i.clientOrgId) !== null);
  if (any) {
    const before = (await counterOf("F")).last;
    const id = await freeDraft(any.workId, [{ description: "Proef na het herstel 2c6", unitCents: 1_000n }], { rate: 2100n }, admin);
    const r = await issue(id, admin);
    check(`(H) de volgende factuur na het herstel: ${YEAR}-${String(Number(before) + 1).padStart(3, "0")} (geen gat, geen dubbel)`, isOk(r) && seqOf(r.ok) === before + 1n && !nrs.includes(r.ok), errOf(r) || r.ok);
  } else check("(H) een uitgereikte factuur van dit jaar om op verder te nummeren", false);
  console.log(`\n${pass} ✓  ${fail} ✗`);
  process.exit(fail ? 1 : 0);
}

// B0. Opzet: de gegevens van BOWACO (verzonnen) in Beheer, een werf met de klant (de firma van proef-klant) en een getekende offerte
// met 5 % korting over drie hoofdstukken; een tweede klant (bedrijf, met btw-nummer) voor btw verlegd.
await ensureProofClientAddress(admin);
const KLANT = (await klant.me()).person[0];
const KLANTORG = un(KLANT.orgId);
{
  const o = (await admin.listOrgs(true)).find((x) => x.id === KLANTORG);
  if (!(o.address.length === 1 && o.address[0].street && o.address[0].zip && o.address[0].city)) ok(await admin.updateOrg(o.id, { kind: o.kind, name: o.name, kbo: o.kbo, vat: o.vat, aliases: o.aliases, trades: o.trades, address: [{ street: "Proefdreef", number: "9", zip: "9993", city: "Lindegem", country: "BE" }], notes: o.notes }));
}
const WLID = (await wl.me()).person[0].id;
const addr = { street: "Proefweg", number: "12", zip: "9993", city: "Lindegem", country: "BE" };
check("(B0) instellingen: een ongeldig IBAN geweigerd; de verzonnen gegevens van BOWACO bewaard (enkel de beheerder)", /IBAN/.test(errOf(await admin.saveSalesSettings(setIn({ issuer: { ...issuerIn, iban: "BE00 1234 5678 9012" } })))) && isOk(await admin.saveSalesSettings(setIn())) && (await denied(calc.saveSalesSettings(setIn()))));
const newWork = async (code, clientOrgId, vatBp = 2100n) => {
  const W = ok(await admin.createWork({ code, name: `Proefwerf facturen 2c6 ${code}`, address: addr, parentId: [], clientOrgId: opt(clientOrgId), architectOrgId: [], leaderPersonId: [WLID], vatBp })).id;
  ok(await admin.setWorkStatus(W, { quoting: null }));
  return W;
};
const price = (cost) => ({ cost, rule: null, reason: "", orgId: null, source: "eigen", libCostId: null });
const signedQuote = async (W, number, chapters, discount, clientOrgId) => {
  const q = ok(await calc.createQuote({ workId: W, number, title: `Proef offerte facturen 2c6 ${number}` }));
  const m = fromRead(ok(await calc.readQuoteVersion(q.versionId)));
  M.setHeader(m, { clientOrgId });
  chapters.forEach(([code, title, lines]) => { const c = M.addChapter(m, { code, title }); for (const [t, qty, unit, cost] of lines) M.addLine(m, c.key, { title: t, qtyMilli: qty, unit, form: "fixed", price: price(cost) }); });
  if (discount) m.form.discount = discount;
  const r = await saveAll(calc, m);
  if (!isOk(r) && r && "err" in r) throw new Error(errOf(r));
  const rd = ok(await calc.readQuoteVersion(q.versionId));
  ok(await calc.sendQuoteVersion(q.versionId, rd.version.rev, rd.totals.totalCents, "proef 2c6: waarschuwingen doorgezet"));
  ok(await calc.decideQuoteVersion(q.versionId, true, "proef 2c6: akkoord"));
  return ok(await calc.readQuoteVersion(q.versionId));
};
const W1 = await newWork(`P-FA${suffix}`, KLANTORG);
ok(await admin.addMembership(W1, [KLANT.id], [], { klant: null }, []));
const RD1 = await signedQuote(W1, `FA-${suffix}`, [["01", "Afbraak", [["Proef afbraak 2c6", 40_000n, "m2", 2500n], ["Proef container 2c6", 2_000n, "st", 32_000n]]], ["02", "Ruwbouw", [["Proef metselwerk 2c6", 1_000n, "sog", 800_000n]]], ["03", "Afwerking", [["Proef pleisterwerk 2c6", 30_000n, "m2", 1_700n]]]], { percent: 500n }, KLANTORG);
check("(B0) werf met de klant en een getekende offerte met 5 % korting", RD1.totals.discountCents > 0n && RD1.totals.subtotalCents === RD1.totals.grossCents - RD1.totals.discountCents, S(RD1.totals));

// B1. Het facturatieschema: standaard 50/24/26 op de aanneemsom; de korting zit in de schijven (naar verhouding over de hoofdstukken).
const planRecheck = (pv) => {
  const nets = SC.netChapters(pv.chapters.map((c) => c.sellCents), pv.discountCents);
  const am = SC.stepAmounts(nets, pv.steps.map((s) => pv.chapters.map((c) => (s.chapterPct.find((x) => x.chapter === c.chapter)?.pctBp ?? s.pctBp))));
  return nets.every((n, i) => n === pv.chapters[i].netCents) && am.every((r, i) => r.every((a, j) => a === pv.steps[i].amounts[j]));
};
let P1;
{
  P1 = ok(await calc.readSalesPlan(W1));
  const sumSteps = P1.steps.reduce((a, s) => a + s.stepCents, 0n);
  check("(B1) standaardschema: Voorschot 50 % vóór de start · Tussentijds 24 % · Slot 26 % (laatste)", P1.steps.map((s) => `${s.title}:${s.pctBp}:${kindOf(s.when)}`).join(",") === "Voorschot:5000:beforeStart,Tussentijds:2400:byHand,Slot:2600:final" && !P1.stored);
  check("(B1) de korting zit in de schijven: Σ netto per hoofdstuk = Σ schijven = aanneemsom (subtotaal na korting)", P1.chapters.reduce((a, c) => a + c.netCents, 0n) === RD1.totals.subtotalCents && sumSteps === RD1.totals.subtotalCents && P1.contractCents === RD1.totals.subtotalCents, S([sumSteps, RD1.totals.subtotalCents]));
  check("(B1) browser = server (sales/calc.ts rekent het schema na)", planRecheck(P1));
  check("(B1) auditregel bekeek:facturatieschema; werfleider, klant, OA en onbekende login lezen het schema niet", (await admin.auditLog(0n, 30n)).some((a) => a.action === "bekeek:facturatieschema") && (await Promise.all([wl, klant, oa2, arch, vreemd].map((x) => denied(x.readSalesPlan(W1))))).every(Boolean));
  const st = (key, title, pctBp, when, chapterPct = []) => ({ key, title, pctBp, when, chapterPct });
  check("(B1) samen 90 %: geweigerd", /samen 90 %/.test(errOf(await calc.saveSalesPlan(W1, 0n, [st("voorschot", "Voorschot", 5000n, { beforeStart: null }), st("slot", "Slot", 4000n, { final: null })]))));
  check("(B1) slotschijf niet als laatste: geweigerd", /laatste/.test(errOf(await calc.saveSalesPlan(W1, 0n, [st("slot", "Slot", 5000n, { final: null }), st("rest", "Rest", 5000n, { byHand: null })]))));
  const ch2 = P1.chapters[1].chapter;
  check("(B1) per hoofdstuk samen geen 100 %: geweigerd", /Hoofdstuk/.test(errOf(await calc.saveSalesPlan(W1, 0n, [st("voorschot", "Voorschot", 5000n, { beforeStart: null }, [{ chapter: ch2, pctBp: 3000n }]), st("tussentijds", "Tussentijds", 2400n, { byHand: null }), st("slot", "Slot", 2600n, { final: null })]))));
  const P1b = await calc.saveSalesPlan(W1, 0n, [st("voorschot", "Voorschot", 5000n, { beforeStart: null }, [{ chapter: ch2, pctBp: 3000n }]), st("tussentijds", "Tussentijds", 2400n, { byHand: null }, [{ chapter: ch2, pctBp: 4000n }]), st("slot", "Slot", 2600n, { final: null }, [{ chapter: ch2, pctBp: 3000n }])]);
  check("(B1) per hoofdstuk een ander %: 02 = 30/40/30, de rest 50/24/26; browser = server, Σ = aanneemsom", isOk(P1b) && planRecheck(P1b.ok) && P1b.ok.version === 1n && P1b.ok.steps.reduce((a, s) => a + s.stepCents, 0n) === RD1.totals.subtotalCents && P1b.ok.steps[0].amounts[1] === SC.pctOf(P1b.ok.chapters[1].netCents, 3000n), errOf(P1b));
  check("(B1) een oude versie van het schema bewaren: geweigerd", /intussen/.test(errOf(await calc.saveSalesPlan(W1, 0n, P1b.ok.steps.map((s) => st(s.key, s.title, s.pctBp, s.when, s.chapterPct))))));
  P1 = P1b.ok;
}

// B2. Teller op het laatste Excelnummer (AC-20), dan de voorschotfactuur: het nummer komt pas bij het uitreiken.
const C0 = await counterOf("F");
let firstNr;
if (!C0.locked) {
  check("(B2) de calculator zet de teller niet (enkel de beheerder, R43)", await denied(calc.setSalesCounter("F", YEAR, 152n)));
  ok(await admin.setSalesCounter("F", YEAR, 152n));
  const c = await counterOf("F");
  check("(B2) teller op het laatste Excelnummer 152: volgende = 153", c.last === 152n && c.next === 153n && c.set && !c.locked);
  firstNr = `${YEAR}-153`;
} else firstNr = `${YEAR}-${String(Number(C0.next)).padStart(3, "0")}`;
const ADV = ok(await calc.newSalesInvoice(W1, { step: { key: "voorschot", minMeerVersionId: [] } }));
{
  const f = await read(ADV);
  check("(B2) ontwerp uit de schijf Voorschot: geen nummer, regels per hoofdstuk met basis en %, totaal = schijf + 21 %", f.brief.number === "" && f.brief.status === "ontwerp" && f.lines.length === 3 && f.lines.every((l) => l.pctBp.length === 1 && l.baseCents.length === 1) && f.totals.netCents === P1.steps[0].stepCents && f.totals.vatCents === SC.pctOf(P1.steps[0].stepCents, 2100n), S(f.totals));
  check("(B2) controle vóór het uitreiken: geen blokkering (afzender, klant, werf, btw volledig)", f.findings.filter((x) => x.block).length === 0, S(f.findings));
  check("(B2) tweede ontwerp voor dezelfde schijf: geweigerd", /bestaat al een factuur/.test(errOf(await calc.newSalesInvoice(W1, { step: { key: "voorschot", minMeerVersionId: [] } }))));
  const before = (await counterOf("F")).last;
  check("(B2) uitreiken met een ander totaal dan de server: geweigerd, geen nummer verbruikt", /veranderd/.test(errOf(await calc.issueSalesInvoice(ADV, f.brief.rev, f.totals.totalCents + 1n))) && (await counterOf("F")).last === before);
  const r = await issue(ADV);
  const g = await read(ADV);
  check(`(B2) uitgereikt: nummer ${firstNr}, controlecode, vervaldag = vandaag + 15, open`, isOk(r) && r.ok === firstNr && g.brief.status === "uitgereikt" && g.intact && g.hash.length === 64 && un(g.brief.dueDay) === cDay + 15n && g.brief.pay === "open" && SC.paymentRefOk(g.doc.paymentRef), `${errOf(r)} ${S(g.brief)}`);
  check("(B2) teller vast na het eerste nummer (ook niet hoger): geweigerd", /ligt vast/.test(errOf(await admin.setSalesCounter("F", YEAR, 500n))) && (await counterOf("F")).locked);
  check("(B2) een uitgereikte factuur niet bewerken, niet wegdoen, niet opnieuw uitreiken", /Enkel een ontwerp/.test(errOf(await calc.saveSalesDraft(ADV, g.brief.rev, draftIn(g)))) && /Enkel een ontwerp/.test(errOf(await calc.cancelSalesDraft(ADV, "proef wegdoen"))) && /al uitgereikt/.test(errOf(await calc.issueSalesInvoice(ADV, g.brief.rev, g.totals.totalCents))));
}

// B3. Een geweigerd uitreiken verbruikt geen nummer: een ontbrekende wettelijke vermelding (RPR) blokkeert met een duidelijke reden.
let lastNr = firstNr;
{
  const id = await freeDraft(W1, [{ description: "Proef losse prestatie 2c6", unitCents: 25_000n }]);
  ok(await admin.saveSalesSettings(setIn({ issuer: { ...issuerIn, rpr: "" } })));
  const before = (await counterOf("F")).last;
  const r = await issue(id);
  const f = await read(id);
  check("(B3) RPR ontbreekt: uitreiken geweigerd met de reden, het ontwerp toont de blokkering", /Niet uitgereikt: .*RPR/.test(errOf(r)) && f.findings.some((x) => x.block && x.key === "afzender-rpr"), errOf(r));
  check("(B3) de teller bleef staan (geen nummer verbruikt), het ontwerp heeft geen nummer", (await counterOf("F")).last === before && f.brief.number === "");
  ok(await admin.saveSalesSettings(setIn()));
  const r2 = await issue(id);
  check("(B3) na het aanvullen: het volgende nummer, zonder gat", isOk(r2) && seqOf(r2.ok) === seqOf(lastNr) + 1n, `${lastNr} → ${errOf(r2) || r2.ok}`);
  lastNr = r2.ok ?? lastNr;
  // De klant zonder adres en de werf zonder klant blokkeren ook.
  const W0 = await newWork(`P-FB${suffix}`, null);
  const id0 = await freeDraft(W0, [{ description: "Proef zonder klant 2c6", unitCents: 10_000n }]);
  check("(B3) werf zonder klant: geweigerd ('De werf heeft geen klant')", /geen klant/.test(errOf(await issue(id0))) && (await counterOf("F")).last === seqOf(lastNr));
  ok(await calc.cancelSalesDraft(id0, "proef 2c6: werf zonder klant"));
  check("(B3) een ontwerp wegdoen vraagt een reden; daarna 'weggedaan', niet meer in de lijst", (await read(id0)).brief.status === "weggedaan" && !(await calc.listSales(W0)).some((b) => b.id === id0));
}

// B4. Gelijktijdig uitreiken vanuit twee identiteiten (beheerder en calculator): elk een ander nummer, aansluitend, geen dubbel.
{
  const ids = [];
  for (let i = 0; i < 8; i++) ids.push(await freeDraft(W1, [{ description: `Proef gelijktijdig ${i} 2c6`, unitCents: 1_000n + BigInt(i) }]));
  const rs = await Promise.all(ids.map((id, i) => issue(id, i % 2 ? admin : calc)));
  const nrs = rs.map((r) => r.ok).filter(Boolean);
  const seqs = nrs.map(seqOf).sort((a, b) => (a < b ? -1 : 1));
  check("(B4) 8 tegelijk (beheerder en calculator door elkaar): 8 verschillende nummers, aansluitend op het vorige", nrs.length === 8 && new Set(nrs).size === 8 && seqs[0] === seqOf(lastNr) + 1n && seqs.every((x, i) => x === seqs[0] + BigInt(i)), S(rs.map((r) => r.ok ?? r.err)));
  lastNr = `${YEAR}-${String(seqs[seqs.length - 1]).padStart(3, "0")}`;
}

// B5. Na elkaar uitreiken met ontwerpen tussendoor die weggedaan worden: 1 … n zonder gat (§7.4; FACT_NUMMERS, standaard 40).
{
  const n = Number(process.env.FACT_NUMMERS ?? 40);
  const got = [];
  for (let i = 0; i < n; i++) {
    const id = await freeDraft(W1, [{ description: `Proef reeks ${i} 2c6`, unitCents: 500n + BigInt(i) }]);
    if (i % 3 === 0) { const x = await freeDraft(W1, [{ description: `Proef weg ${i} 2c6`, unitCents: 700n }]); ok(await calc.cancelSalesDraft(x, "proef 2c6: ontwerp weg")); }
    const r = await issue(id, i % 2 ? admin : calc);
    if (isOk(r)) got.push(seqOf(r.ok));
  }
  const s0 = seqOf(lastNr);
  check(`(B5) ${n} uitreikingen met weggedane ontwerpen ertussen: ${s0 + 1n} … ${s0 + BigInt(n)} zonder gat`, got.length === n && got.every((x, i) => x === s0 + 1n + BigInt(i)), S(got.slice(0, 5)));
  lastNr = `${YEAR}-${String(s0 + BigInt(n)).padStart(3, "0")}`;
  check("(B5) de teller staat op het laatste nummer", (await counterOf("F")).last === seqOf(lastNr));
}

// B6. Btw: 6 % met de vaste tekst (uit Beheer), 21 %, 0 % verlegd enkel bij een klant met btw-nummer, gemengd per regel.
const SPREEUW = (await admin.listOrgs(false)).find((o) => o.name.startsWith("Proef Bedrijf Spreeuw 2c6"))?.id ?? ok(await admin.createOrg({ kind: { client: null }, name: `Proef Bedrijf Spreeuw 2c6 ${suffix}`, kbo: ["0987654321"], vat: ["BE0987654321"], aliases: [], trades: [], address: [{ street: "Proefdreef", number: "21", zip: "9993", city: "Lindegem", country: "BE" }], notes: "Verzonnen proefbedrijf (2c.6)" })).id;
const W2 = await newWork(`P-FC${suffix}`, SPREEUW, 2100n);
{
  ok(await admin.saveSalesSettings(setIn({ vat6Text: "Proef: vaste vermelding bij 6 % (2c6)." })));
  const i6 = await freeDraft(W1, [{ description: "Proef renovatie 6 % 2c6", unitCents: 100_000n, vatBp: 600n }], { rate: 600n });
  const f6 = await read(i6);
  check("(B6) 6 %: maatstaf en btw aan 6 %, de vaste vermelding uit Beheer; waarschuwing 'ander tarief dan de werf' (21 %)", f6.doc.vatLines.length === 1 && f6.doc.vatLines[0].vatBp === 600n && f6.doc.vatLines[0].vatCents === 6_000n && f6.doc.mentions.some((m) => m.includes("vaste vermelding bij 6 %")) && f6.findings.some((x) => x.key === "btw-werf" && !x.block), S(f6.doc.mentions));
  check("(B6) 6 % uitgereikt; de vermelding ligt vast in de factuur", isOk(await issue(i6)) && (await read(i6)).doc.mentions.some((m) => m.includes("vaste vermelding bij 6 %")));
  ok(await admin.saveSalesSettings(setIn()));
  const i21 = await freeDraft(W1, [{ description: "Proef 21 % 2c6", unitCents: 100_000n }]);
  const f21 = await read(i21);
  check("(B6) 21 %: btw € 210, geen 6 %-vermelding; standaardtekst bij 6 % staat weer in Beheer", f21.doc.vatLines[0].vatCents === 21_000n && !f21.doc.mentions.some((m) => /6 %|ten minste tien jaar/.test(m)) && (await settingsNow()).vat6Text.includes("ten minste tien jaar"));
  ok(await calc.cancelSalesDraft(i21, "proef 2c6: enkel gelezen"));
  const iR = await freeDraft(W1, [{ description: "Proef verlegd particulier 2c6", unitCents: 100_000n }], { reverse: null });
  check("(B6) btw verlegd bij een particulier (geen btw-nummer): geweigerd", /btw-nummer van de klant/.test(errOf(await issue(iR))));
  ok(await calc.cancelSalesDraft(iR, "proef 2c6: verlegd geweigerd"));
  const iB = await freeDraft(W2, [{ description: "Proef verlegd bedrijf 2c6", unitCents: 250_000n }], { reverse: null });
  const rB = await issue(iB);
  const fB = await read(iB);
  check("(B6) btw verlegd bij een bedrijf: 0 %, geen btw, totaal = netto, de vermelding 'Verlegging van heffing', btw-nummer van de klant", isOk(rB) && fB.doc.vatLines.length === 1 && fB.doc.vatLines[0].reverse && fB.doc.vatCents === 0n && fB.doc.totalCents === 250_000n && fB.doc.mentions.some((m) => m.startsWith("Verlegging van heffing")) && un(fB.doc.buyer.vat) === "BE0987654321" && fB.brief.company, errOf(rB));
  const iM = await freeDraft(W1, [{ description: "Proef deel 6 % 2c6", unitCents: 10_005n, vatBp: 600n }, { description: "Proef deel 21 % 2c6", unitCents: 20_000n, vatBp: 2100n }], { mixed: null });
  const fM = await read(iM);
  check("(B6) gemengd: twee btw-blokken (6 % en 21 %), btw op het totaal per tarief", fM.doc.vatLines.length === 2 && fM.doc.vatLines[0].vatCents === 600n && fM.doc.vatLines[1].vatCents === 4_200n && fM.totals.totalCents === 30_005n + 4_800n, S(fM.doc.vatLines));
  check("(B6) een ander tarief (12 %): geweigerd bij het bewaren", /6 % of 21 %/.test(errOf(await calc.saveSalesDraft(iM, fM.brief.rev, draftIn(fM, { vat: { rate: 1200n } })))));
  ok(await calc.cancelSalesDraft(iM, "proef 2c6: enkel gelezen"));
  lastNr = (await read(iB)).brief.number;
}

// B7. Creditnota's in een eigen reeks (⚖7): volledig en deels; een uitgereikte factuur wordt nooit gewist.
const CN0 = await counterOf("CN");
const fSeq = async () => (await counterOf("F")).last;
let ADV2;
{
  const fBefore = await fSeq();
  const advF = await read(ADV);
  const cn = ok(await calc.newSalesInvoice(W1, { credit: { invoiceId: ADV, full: true } }));
  const c = await read(cn);
  check("(B7) volledige creditnota (ontwerp): de regels van de factuur met het omgekeerde teken, zelfde btw, reeks CN", c.lines.length === advF.lines.length && c.totals.totalCents === -advF.totals.totalCents && c.brief.kind === "creditnota" && c.brief.creditOf === advF.brief.number, S(c.totals));
  const r = await issue(cn);
  const expCN = `CN ${YEAR}-${String(Number(CN0.next)).padStart(3, "0")}`;
  check(`(B7) uitgereikt als ${expCN}: eigen reeks, de factuurteller bleef staan`, isOk(r) && r.ok === expCN && (await fSeq()) === fBefore && (await counterOf("CN")).last === CN0.next, `${errOf(r) || r.ok}`);
  const a2 = await read(ADV);
  const cnF = await read(cn);
  check("(B7) de factuur blijft (gecrediteerd, met verwijzing); de creditnota vermeldt 'Creditnota bij factuur …' en geen betaalopdracht", a2.brief.pay === "gecrediteerd" && a2.brief.credits.includes(expCN) && a2.openCents === 0n && cnF.doc.mentions[0].startsWith(`Creditnota bij factuur ${advF.brief.number}`) && un(cnF.doc.creditOf) === advF.brief.number && cnF.doc.paymentRef === "", S(a2.brief));
  check("(B7) nog eens volledig crediteren: geweigerd", /al volledig gecrediteerd/.test(errOf(await calc.newSalesInvoice(W1, { credit: { invoiceId: ADV, full: true } }))));
  check("(B7) de schijf Voorschot is weer open (de factuur is gecrediteerd)", ok(await calc.readSalesPlan(W1)).steps[0].status === "open");
  ADV2 = ok(await calc.newSalesInvoice(W1, { step: { key: "voorschot", minMeerVersionId: [] } }));
  const r2 = await issue(ADV2);
  check("(B7) een nieuwe voorschotfactuur: het volgende factuurnummer", isOk(r2) && seqOf(r2.ok) === fBefore + 1n, errOf(r2));
  lastNr = r2.ok ?? lastNr;
  const pc = ok(await calc.newSalesInvoice(W1, { credit: { invoiceId: ADV2, full: false } }));
  const p0 = await read(pc);
  check("(B7) een regel van een creditnota die positief is: geweigerd", /negatief/.test(errOf(await calc.saveSalesDraft(pc, p0.brief.rev, draftIn(p0, { title: "Proef deelcreditnota 2c6", lines: linesIn([{ description: "Proef terug", unitCents: 10_000n }]) })))));
  ok(await calc.saveSalesDraft(pc, p0.brief.rev, draftIn(p0, { title: "Proef deelcreditnota 2c6", lines: linesIn([{ description: "Proef korting achteraf 2c6", unitCents: -10_000n }]) })));
  check("(B7) deelcreditnota € 100 + 21 % uitgereikt; de factuur is deels open", isOk(await issue(pc)) && (await read(ADV2)).brief.pay === "deels" && (await read(ADV2)).creditedCents === 12_100n);
  const big = ok(await calc.newSalesInvoice(W1, { credit: { invoiceId: ADV2, full: false } }));
  const b0 = await read(big);
  ok(await calc.saveSalesDraft(big, b0.brief.rev, draftIn(b0, { title: "Proef te veel 2c6", lines: linesIn([{ description: "Proef te veel terug 2c6", unitCents: -10_000_000n }]) })));
  check("(B7) samen meer crediteren dan de factuur: geweigerd", /meer gecrediteerd/.test(errOf(await issue(big))));
  ok(await calc.cancelSalesDraft(big, "proef 2c6: te veel"));
}

// B8. Betalingen: deels, het rest, nooit meer dan wat openstaat, ongedaan maken met reden. De werfleider ziet enkel "voorschot betaald".
{
  const f = await read(ADV2);
  const open = f.openCents;
  check("(B8) open = totaal − gecrediteerd", open === f.totals.totalCents - 12_100n);
  const p1 = await calc.addSalesPayment(ADV2, cDay, 100_000n, "overschrijving", "proef 2c6");
  check("(B8) een deel betaald: 'deels'; de werfleider ziet 'deels' en GEEN bedrag", isOk(p1) && (await read(ADV2)).brief.pay === "deels" && (await wl.salesFacts(W1)).advance === "deels" && noMoney(await wl.salesFacts(W1)));
  check("(B8) meer dan wat openstaat: geweigerd; een dag in de toekomst: geweigerd", /Meer dan wat openstaat/.test(errOf(await calc.addSalesPayment(ADV2, cDay, open, "x", ""))) && /toekomst/.test(errOf(await calc.addSalesPayment(ADV2, cDay + 2n, 1n, "x", ""))));
  const p2 = await calc.addSalesPayment(ADV2, cDay, open - 100_000n, "overschrijving", "proef 2c6 rest");
  check("(B8) het rest betaald: 'betaald', open 0; de werfleider ziet 'betaald'", isOk(p2) && (await read(ADV2)).brief.pay === "betaald" && (await read(ADV2)).openCents === 0n && (await wl.salesFacts(W1)).advance === "betaald");
  check("(B8) een betaling ongedaan maken vraagt een reden; daarna weer 'deels'", /reden/.test(errOf(await calc.archiveSalesPayment(p2.ok, ""))) && isOk(await calc.archiveSalesPayment(p2.ok, "proef 2c6: verkeerd ingeboekt")) && (await read(ADV2)).brief.pay === "deels");
  check("(B8) geen betaling op een creditnota of een ontwerp", /uitgereikte factuur/.test(errOf(await calc.addSalesPayment(ok(await calc.newSalesInvoice(W1, { free: null })), cDay, 1n, "x", ""))));
}

// B9. Factuur uit een vorderingsstaat (2.10): enkel "klaar voor factuur"; werk (periodCents) en prijsherziening apart; in de
// min-meerstaat telt het bedrag één keer (via de factuur, niet ook via de staat); de staat staat daarna op "gefactureerd".
const PV = await proefVordering({ admin, calc, wl }, { prefix: `P-FV${suffix}`, titleSuffix: " 2c6" });
let VS;
{
  const n = ok(await calc.newProgress(PV.wid));
  const view = ok(await calc.readProgressStatement(n));
  const met = view.lines.find((l) => l.q.title === "Proef metselwerk binnenmuur (2.10)");
  ok(await saveAs(calc, n, new Map([[String(met.q.root), { cumPctBp: 5_000n }]]), { sIndex: 105_000n, iIndex: 210_000n }));
  const f = ok(await calc.readProgressStatement(n));
  ok(await calc.sendProgress(n, f.brief.rev, f.totals.totalCents, "proef 2c6: waarschuwingen doorgezet"));
  VS = ok(await calc.readProgressStatement(n));
  check("(B9) een verzonden staat die nog niet 'klaar voor factuur' is: geweigerd", /klaar voor factuur/.test(errOf(await calc.newSalesInvoice(PV.wid, { progress: n }))));
  ok(await calc.setProgressReady(n));
  const id = ok(await calc.newSalesInvoice(PV.wid, { progress: n }));
  const d = await read(id);
  const rev = d.lines.filter((l) => "revision" in l.kind);
  check("(B9) ontwerp uit de staat: werk = het bedrag van de periode, de prijsherziening als eigen regel, netto = subtotaal van de staat, periode = datum van de dienst", d.totals.netCents === VS.totals.subtotalCents && rev.length === 1 && rev[0].amountCents === VS.totals.revisionCents && d.lines.filter((l) => "work" in l.kind).reduce((a, l) => a + l.amountCents, 0n) === VS.totals.periodCents && un(d.serviceDay) !== null, S([d.totals.netCents, VS.totals.subtotalCents, VS.totals.revisionCents]));
  check("(B9) een tweede factuur voor dezelfde staat: geweigerd", /bestaat al een factuur/.test(errOf(await calc.newSalesInvoice(PV.wid, { progress: n }))));
  const r = await issue(id);
  check("(B9) uitgereikt; de staat staat op 'gefactureerd' met het factuurnummer", isOk(r) && ok(await calc.progressInvoiceData(n)).billing === "gefactureerd", errOf(r));
  const mm = ok(await calc.readMinMeer(PV.wid));
  const invs = mm.invoiced;
  check("(B9) min-meerstaat: reeds gefactureerd = de factuur (werk = periode, herziening apart); de staat telt niet nog eens", invs.length === 1 && invs[0].title === `factuur ${r.ok}` && invs[0].cents === VS.totals.periodCents && invs[0].revisionCents === VS.totals.revisionCents && mm.totals.invoicedCents === VS.totals.periodCents && MC.recheck(mm).ok, S(invs));
  check("(B9) de staat crediteren als vorderingsstaat: geweigerd (eerst een creditnota van de factuur)", /creditnota van de factuur/.test(errOf(await calc.creditProgress(n, "proef 2c6: verkeerd"))));
  const cn = ok(await calc.newSalesInvoice(PV.wid, { credit: { invoiceId: id, full: true } }));
  ok(await issue(cn));
  const mm2 = ok(await calc.readMinMeer(PV.wid));
  check("(B9) na een volledige creditnota: de staat is weer 'klaar voor factuur' en telt zelf; factuur + creditnota = 0 (nooit dubbel, nooit 0)", ok(await calc.progressInvoiceData(n)).billing === "klaar" && mm2.totals.invoicedCents === VS.totals.periodCents && mm2.invoiced.length === 3, S(mm2.invoiced));
  const again = ok(await calc.newSalesInvoice(PV.wid, { progress: n }));
  check("(B9) opnieuw factureren uit dezelfde staat kan dan", isOk(await issue(again)) && ok(await calc.readMinMeer(PV.wid)).totals.invoicedCents === VS.totals.periodCents);
}

// B10. De slotfactuur uit een min-meerversie: offerte + saldo − reeds gefactureerd; na het uitreiken is er niets meer te factureren.
// Een versie van vóór een latere factuur wordt geweigerd (anders dubbel).
{
  const v = ok(await calc.readMinMeer(PV.wid));
  const V1 = ok(await calc.makeMinMeerVersion(PV.wid, "proef 2c6", { balanceCents: v.totals.balanceCents, toInvoiceCents: v.totals.toInvoiceCents }));
  const s1 = ok(await calc.newSalesInvoice(PV.wid, { step: { key: "slot", minMeerVersionId: [V1] } }));
  const d1 = await read(s1);
  check("(B10) slot uit de min-meerversie: netto = nog te factureren van de versie; aftrekregels 'Reeds gefactureerd'", d1.totals.netCents === v.totals.toInvoiceCents && d1.lines.some((l) => "deduct" in l.kind && l.description.startsWith("Reeds gefactureerd")) && d1.brief.planStepKey[0] === "slot", S([d1.totals.netCents, v.totals.toInvoiceCents]));
  const tiny = await freeDraft(PV.wid, [{ description: "Proef tussendoor 2c6", unitCents: 5_000n }]);
  ok(await issue(tiny));
  check("(B10) intussen een andere factuur: de slot uit de oude versie wordt geweigerd ('maak eerst een nieuwe versie')", /nieuwe versie van de min-meerstaat/.test(errOf(await issue(s1))));
  ok(await calc.cancelSalesDraft(s1, "proef 2c6: versie verouderd"));
  const v2 = ok(await calc.readMinMeer(PV.wid));
  const V2 = ok(await calc.makeMinMeerVersion(PV.wid, "proef 2c6 bis", { balanceCents: v2.totals.balanceCents, toInvoiceCents: v2.totals.toInvoiceCents }));
  const s2 = ok(await calc.newSalesInvoice(PV.wid, { minMeer: V2 }));
  const r2 = await issue(s2);
  const v3 = ok(await calc.readMinMeer(PV.wid));
  check("(B10) slot uit de nieuwe versie uitgereikt (de slotschijf); daarna nog te factureren € 0 (reeds gefactureerd = aanneemsom + saldo)", isOk(r2) && v3.totals.toInvoiceCents === 0n && v3.totals.invoicedCents === v3.totals.contractCents && (await read(s2)).brief.planStepKey[0] === "slot", `${errOf(r2)} ${S(v3.totals)}`);
  check("(B10) de slotschijf staat in het schema op 'uitgereikt'", ok(await calc.readSalesPlan(PV.wid)).steps.find((s) => s.key === "slot").status === "uitgereikt");
}

// B11. Rechten (R42): de werfleider enkel "voorschot betaald" (geen bedrag); de klant enkel zijn UITGEREIKTE facturen (geen ontwerpen),
// een klant van een andere firma op dezelfde werf niets; OA, architect, onbekende login niets; "enkel de beheerder reikt uit" (⚖6).
{
  const draft = ok(await calc.newSalesInvoice(W1, { free: null }));
  const fns = (x) => [x.listSales(W1), x.readSalesInvoice(ADV2), x.newSalesInvoice(W1, { free: null }), x.saveSalesPlan(W1, 1n, []), x.issueSalesInvoice(draft, 0n, 0n), x.addSalesPayment(ADV2, cDay, 1n, "x", ""), x.markSalesSent(ADV2, "mail"), x.salesWorklist(), x.cancelSalesDraft(draft, "proef weg"), x.archiveSalesPayment(1n, "proef weg")];
  for (const [n, x] of [["werfleider", wl], ["OA", oa2], ["klant", klant], ["architect", arch], ["onbekende login", vreemd]]) {
    const rs = await Promise.all(fns(x).map(denied));
    check(`(B11) ${n}: lijst, lezen, ontwerp, schema, uitreiken, betaling, verstuurd, werklijst, wegdoen geweigerd`, rs.every(Boolean), rs.map((r) => (r ? "·" : "✗")).join(""));
  }
  check("(B11) OA, klant, architect en onbekende login: ook 'voorschot betaald' niet", (await Promise.all([oa2, klant, arch, vreemd].map((x) => denied(x.salesFacts(W1))))).every(Boolean));
  const W3 = ok(await admin.createWork({ code: `P-FD${suffix}`, name: "Proef andere werf 2c6", address: addr, parentId: [], clientOrgId: [], architectOrgId: [], leaderPersonId: [], vatBp: 2100n })).id;
  const s0 = await admin.getSettings();
  const setS = (z) => ({ werfleiderZietAlles: z, inviteDays: s0.inviteDays, threshold30bisCents: s0.threshold30bisCents, thresholdCheckinatworkCents: s0.thresholdCheckinatworkCents });
  try {
    ok(await admin.setSettings(setS(false)));
    check("(B11) werfleider van een andere werf ('werfleider ziet alles' uit): ook 'voorschot betaald' geweigerd; op zijn eigen werf wel", (await denied(wl.salesFacts(W3))) && (await wl.salesFacts(W1)).advance === "deels");
  } finally { ok(await admin.setSettings(setS(s0.werfleiderZietAlles))); }
  const my = ok(await klant.listMySales());
  const mine = my.invoices.filter((r) => r.workId === W1);
  check("(B11) de klant: enkel de uitgereikte facturen van zijn werf (geen ontwerp), met vervaldag en betaalstatus, en het schema", mine.length > 0 && !mine.some((r) => r.id === draft) && mine.some((r) => r.id === ADV2 && r.pay === "deels") && my.schedule.some((s) => s.workId === W1 && s.title === "Voorschot"), S(mine.slice(0, 2)));
  check("(B11) de klant ziet het bedrijf Spreeuw (andere klant) niet; leest een ontwerp niet", !my.invoices.some((r) => r.workId === W2) && /Onbekende factuur/.test(errOf(await klant.readMySalesInvoice(draft))));
  const doc = ok(await klant.readMySalesInvoice(ADV2));
  check("(B11) de klant leest zijn factuur (voor de PDF): geen kostprijs, marge of OA-naam in de velden", !!doc.doc && ![...keysOf(doc)].some((k) => /cost|margin|purchase/i.test(k)), [...keysOf(doc)].filter((k) => /cost|margin/i.test(k)).join(","));
  const KLANT2 = ok(await admin.createOrg({ kind: { client: null }, name: `Proef Klant Merel 2c6 ${suffix}`, kbo: [], vat: [], aliases: [], trades: [], address: [{ street: "Proefdreef", number: "9", zip: "9993", city: "Lindegem", country: "BE" }], notes: "Verzonnen proefklant (2c.6)" })).id;
  const k2 = await freshBackend(cid);
  const inv = ok(await admin.invitePerson({ name: `Proef Klant Twee ${suffix}`, roles: [{ klant: null }], orgId: [KLANT2], shortCode: [], lang: [], phone: [], workIds: [W1], validDays: 1n, tag: "proef 2c6" }));
  ok(await k2.redeemCode(inv.code));
  check("(B11) een klant van een andere firma op dezelfde werf: geen facturen, lezen geweigerd", ok(await k2.listMySales()).invoices.length === 0 && /Onbekende factuur/.test(errOf(await k2.readMySalesInvoice(ADV2))));
  ok(await admin.saveSalesSettings(setIn({ issuerOnly: true })));
  try {
    const d2 = await freeDraft(W1, [{ description: "Proef enkel beheerder 2c6", unitCents: 1_000n }]);
    const r1 = await issue(d2, calc);
    const r2 = await issue(d2, admin);
    check("(B11) ⚖6 'enkel de beheerder reikt uit': de calculator geweigerd (geen nummer), de beheerder wel", /enkel de beheerder/.test(errOf(r1)) && isOk(r2) && seqOf(r2.ok) === (await counterOf("F")).last, `${errOf(r1)} ${errOf(r2)}`);
  } finally { ok(await admin.saveSalesSettings(setIn())); }
  ok(await calc.cancelSalesDraft(draft, "proef 2c6: rechtenproef"));
}

// B12. .did-controle: wat de werfleider krijgt (SalesFactView) en de lijst als query (SalesBrief) dragen geen enkel bedragveld.
{
  const did = readFileSync(join(import.meta.dirname, "../src/backend/dist/backend.did"), "utf8");
  const typeBody = (name) => { const m = did.match(new RegExp(`^type ${name} =\\s*(record \\{[\\s\\S]*?\\n \\});`, "m")); return m ? m[1] : null; };
  const bad = ["SalesFactView", "SalesBrief", "BillingStep", "SalesReminder"].filter((n) => { const b = typeBody(n); return b === null || /cents|cost|price|margin|amount/i.test(b); });
  check("(B12) .did: SalesFactView, SalesBrief, BillingStep, SalesReminder zonder bedragveld", bad.length === 0, bad.join(", "));
  check("(B12) listSales (query) zonder bedragen; salesFacts zonder bedragen", noMoney(await calc.listSales(W1)) && noMoney(await calc.salesFacts(W1)));
}

// B13. Rekentest browser = server (FACT_RONDES, standaard 200): willekeurige schema's (1–4 schijven, per hoofdstuk een ander %) op
// offertes met een korting in %, in bedrag en zonder; willekeurige vrije regels (± hoeveelheid, 6/21 %, gemengd, verlegd).
{
  const rounds = Number(process.env.FACT_RONDES ?? 200);
  const chs = [["01", "Proef A", [["Proef a1 2c6", 3_333n, "m2", 1_234n], ["Proef a2 2c6", 1_000n, "st", 99_999n]]], ["02", "Proef B", [["Proef b1 2c6", 7_777n, "lm", 777n]]], ["03", "Proef C", [["Proef c1 2c6", 1_000n, "sog", 1n]]]];
  const WR = [];
  for (const [i, disc] of [[1, { amount: 12_345n }], [2, null], [3, { percent: 333n }]]) {
    const w = await newWork(`P-FR${i}${suffix}`, KLANTORG);
    await signedQuote(w, `FR${i}-${suffix}`, chs, disc, KLANTORG);
    WR.push(w);
  }
  let seed = 2026_11_01;
  const rnd = (n) => { seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648; return seed % n; };
  const split = (k) => { const cut = Array.from({ length: k - 1 }, () => rnd(10_001)).sort((a, b) => a - b); const xs = []; let prev = 0; for (const c of [...cut, 10_000]) { xs.push(BigInt(c - prev)); prev = c; } return xs; };
  const ver = new Map();
  const drafts = new Map();
  let okPlan = 0;
  let okDraft = 0;
  const bad = [];
  for (let r = 0; r < rounds; r++) {
    const w = WR[r % WR.length];
    const k = 1 + rnd(4);
    const base = split(k);
    const per = split(k);
    const pv0 = ver.get(w) ?? ok(await calc.readSalesPlan(w));
    const steps = base.map((bp, i) => ({ key: `s${i}`, title: `Proef schijf ${i}`, pctBp: bp, when: i === k - 1 && rnd(2) ? { final: null } : { byHand: null }, chapterPct: rnd(2) ? [{ chapter: pv0.chapters[1].chapter, pctBp: per[i] }] : [] }));
    const sv = await calc.saveSalesPlan(w, pv0.version, steps);
    if (isOk(sv) && planRecheck(sv.ok) && sv.ok.steps.reduce((a, s) => a + s.stepCents, 0n) === sv.ok.contractCents) okPlan++; else bad.push(`schema ${r}: ${errOf(sv)}`);
    if (isOk(sv)) ver.set(w, sv.ok);
    const vats = [{ rate: 600n }, { rate: 2100n }, { mixed: null }];
    const vat = vats[rnd(3)];
    const lines = Array.from({ length: 1 + rnd(6) }, (_, i) => ({ description: `Proef regel ${r}.${i} 2c6`, qtyMilli: BigInt(rnd(20_000) + 1) * (rnd(5) === 0 ? -1n : 1n), unitCents: BigInt(rnd(1_000_000) + 1), vatBp: rnd(2) ? 600n : 2100n }));
    if (lines.reduce((a, l) => a + SC.lineAmount(l.qtyMilli, l.unitCents), 0n) === 0n) lines[0].unitCents += 1n;
    if (!drafts.has(w)) drafts.set(w, ok(await calc.newSalesInvoice(w, { free: null })));
    const id = drafts.get(w);
    const f = await read(id);
    const exp = browserTotal(lines, vat);
    const sd = await calc.saveSalesDraft(id, f.brief.rev, draftIn(f, { title: "Proef rekentest 2c6", lines: linesIn(lines), vat, expect: exp }));
    if (isOk(sd) && sd.ok.totals.totalCents === exp) okDraft++; else bad.push(`regels ${r}: ${errOf(sd)}`);
  }
  check(`(B13) rekentest schema browser = server: ${okPlan}/${rounds} (Σ schijven = aanneemsom per ronde)`, okPlan === rounds, bad.slice(0, 3).join(" | "));
  check(`(B13) rekentest regels en btw browser = server: ${okDraft}/${rounds}`, okDraft === rounds, bad.slice(0, 3).join(" | "));
  for (const id of drafts.values()) ok(await calc.cancelSalesDraft(id, "proef 2c6: rekentest"));
}

// B15 (2c.6b). UBL uit een echte uitgereikte factuur (bedrijf, btw verlegd): verplichte velden, sommen, bedragen = de vastgelegde factuur;
// stand "UBL gemaakt"; een particulier krijgt geen UBL (PDF volstaat).
const { ublXml } = await import("../src/frontend/src/sales/ubl.ts");
const ublOf = (f, credit = false) => {
  const a = (x) => (x ? { street: x.street, number: x.number, zip: x.zip, city: x.city, country: x.country } : null);
  return { number: f.number, credit, issueDay: f.issueDay, dueDay: f.dueDay, serviceDay: un(f.serviceDay), serviceTo: un(f.serviceTo), issuer: { ...f.issuer, address: a(f.issuer.address) }, buyer: { name: f.buyer.name, address: a(un(f.buyer.address)), vat: un(f.buyer.vat) ?? "", kbo: un(f.buyer.kbo) ?? "" }, workCode: f.workCode, quoteRefs: f.quoteRefs, lines: f.lines, vatLines: f.vatLines, netCents: f.netCents, vatCents: f.vatCents, totalCents: f.totalCents, mentions: f.mentions, paymentRef: f.paymentRef, paymentDays: f.paymentDays, creditOf: un(f.creditOf), creditOfDay: un(f.creditOfDay), scheme: "0208" };
};
{
  const ids = (await calc.listSales(W2)).filter((b) => b.status === "uitgereikt").map((b) => b.id);
  const f = await read(ids[0]);
  const u = readUbl(ublXml(ublOf(f.doc)), "echt.xml");
  const p = ublProblems(u, f.doc.totalCents);
  check("(B15) UBL van een uitgereikte factuur aan een bedrijf (verlegd): verplichte velden, sommen kloppen, bedrag = de vastgelegde factuur", p.length === 0 && u.id[0] === f.brief.number && u.buyerVat[0] === "BE0987654321" && u.sub[0].cat === "AE", p.join(" | "));
  check("(B15) stand 'UBL gemaakt' (geen verzending); bij een particulier geweigerd", isOk(await calc.markSalesUbl(ids[0])) && (await read(ids[0])).brief.peppol === "ubl-gemaakt" && /btw-nummer/.test(errOf(await calc.markSalesUbl(ADV2))));
  const fa = await read(ADV2);
  const ua = readUbl(ublXml(ublOf({ ...fa.doc, buyer: { ...fa.doc.buyer, vat: ["BE0123456789"] } })), "adv.xml");
  check("(B15) UBL van de voorschotfactuur (regels per hoofdstuk, 21 %): sommen kloppen, mededeling en IBAN", ublProblems(ua, fa.doc.totalCents).length === 0 && ua.payId[0] === fa.doc.paymentRef && ua.iban[0] === ISS.iban.replace(/\s/g, ""), ublProblems(ua, fa.doc.totalCents).join(" | "));
}

// B16. De kwartaallijst voor de boekhouder: elke uitgereikte factuur en creditnota van het kwartaal, met werfcode en btw per tarief,
// de dag van de betaling; de CSV komt eruit zoals de browser ze maakt. Enkel kantoor (auditregel).
{
  const { quarterCsv } = await import("../src/frontend/src/sales/csv.ts");
  const dt = new Date(Number(cDay) * 86_400_000);
  const Q = BigInt(Math.floor(dt.getUTCMonth() / 3) + 1);
  const rows = ok(await calc.salesQuarter(YEAR, Q));
  const mine = rows.filter((r) => r.workCode === `P-FA${suffix}` || r.workCode === `P-FC${suffix}`);
  const adv = rows.find((r) => r.invoiceId === ADV2);
  check("(B16) kwartaallijst: de facturen en creditnota's van deze proef, met werfcode, klant en btw per tarief", mine.length >= 10 && mine.some((r) => r.series === "CN" && r.creditOf !== "") && mine.some((r) => r.vatLines.some((v) => v.reverse)) && adv && adv.analyticCode === `P-FA${suffix}`, `${mine.length}`);
  const csv = quarterCsv(rows.map((r) => ({ ...r, paidDay: un(r.paidDay) })));
  check("(B16) de CSV: één regel per factuur + de kop", csv.trim().split("\r\n").length === rows.length + 1);
  check("(B16) werfleider, klant en OA: geen kwartaallijst; een ongeldig kwartaal geweigerd", (await denied(wl.salesQuarter(YEAR, Q))) && (await denied(klant.salesQuarter(YEAR, Q))) && (await denied(oa2.salesQuarter(YEAR, Q))) && /Kwartaal/.test(errOf(await calc.salesQuarter(YEAR, 5n))) && (await admin.auditLog(0n, 30n)).some((a) => a.action === "bekeek:kwartaallijst"));
}

// B17. Herinnering: niet vóór de vervaldag, niet bij een betaalde factuur of een creditnota (na de jaarwissel: wel bij een vervallen factuur).
check("(B17) herinnering vóór de vervaldag: geweigerd ('Nog niet vervallen'); bij een creditnota geweigerd", /Nog niet vervallen/.test(errOf(await calc.remindSalesInvoice(ADV2, false, ""))) && /uitgereikte factuur/.test(errOf(await calc.remindSalesInvoice((await calc.listSales(W1)).find((b) => b.kind === "creditnota" && b.status === "uitgereikt").id, false, ""))));

// B14 (als LAATSTE: verzet de klok van het EIGEN net). De jaarwissel: op 1 januari begint de reeks van het nieuwe jaar bij de teller die
// de beheerder vooraf zette (of bij het startnummer); de creditnota's ook; de teller van het nieuwe jaar ligt dan vast.
const local = /localhost|127\.0\.0\.1/.test(process.env.ICP_HOST ?? "");
if (local && !process.env.ZONDER_KLOK) {
  const Y1 = YEAR + 1n;
  const pre = await counterOf("F", Y1);
  if (!pre.locked) ok(await admin.setSalesCounter("F", Y1, 40n));
  const expF = pre.locked ? null : `${Y1}-041`;
  const cnNext = (await counterOf("CN", Y1)).next;
  const lastOld = (await counterOf("F")).last;
  const netDir = process.env.BOWACO_NET || join(process.env.HOME, ".bowaco/net");
  const d = JSON.parse(readFileSync(join(netDir, ".icp/cache/networks/local/descriptor.json"), "utf8"));
  if (d["project-dir"] !== netDir) throw new Error("niet ons eigen net");
  const base = `http://127.0.0.1:${d["pocketic-config-port"]}/instances/${d["pocketic-instance-id"]}`;
  let t = null;
  for (let i = 0; i < 6 && t === null; i++) { const j = await (await fetch(`${base}/read/get_time`)).json().catch(() => ({})); if (j && j.nanos_since_epoch !== undefined) t = BigInt(j.nanos_since_epoch); else await new Promise((res) => setTimeout(res, 5000)); }
  if (t === null) throw new Error("PocketIC gaf geen tijd terug");
  const target = BigInt(Date.UTC(Number(Y1), 0, 1, 9, 0, 0)) * 1_000_000n; // 1 januari 10:00 Belgische tijd
  if (target > t) {
    let r = null;
    for (let i = 0; i < 10; i++) { r = await fetch(`${base}/update/set_time`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nanos_since_epoch: Number(target) }) }); if (r.status !== 409) break; await new Promise((res) => setTimeout(res, 2000)); }
    if (!r.ok) throw new Error(`set_time: ${r.status}`);
    await new Promise((res) => setTimeout(res, 1500));
    const { resync } = await import("../tools/lib.mjs");
    await resync(admin, calc, wl, oa2, klant, arch);
  }
  const today1 = (await settingsNow()).today;
  check(`(B14) de klok van het eigen net staat op 1 januari ${Y1}`, new Date(Number(today1) * 86_400_000).getUTCFullYear() === Number(Y1) && Number(today1) * 86_400_000 === Date.UTC(Number(Y1), 0, 1), String(today1));
  const j1 = await freeDraft(W1, [{ description: "Proef eerste factuur nieuw jaar 2c6", unitCents: 10_000n }]);
  const rj = await issue(j1);
  check(`(B14) eerste factuur van ${Y1}: ${expF ?? "het volgende nummer"} (teller vooraf gezet op 40), de reeks van ${YEAR} blijft op ${lastOld}`, isOk(rj) && (expF === null || rj.ok === expF) && (await counterOf("F", YEAR)).last === lastOld, errOf(rj) || rj.ok);
  const cj = ok(await calc.newSalesInvoice(W1, { credit: { invoiceId: j1, full: true } }));
  const rc = await issue(cj);
  check(`(B14) eerste creditnota van ${Y1}: CN ${Y1}-${String(Number(cnNext)).padStart(3, "0")} (eigen reeks, eigen jaar)`, isOk(rc) && rc.ok === `CN ${Y1}-${String(Number(cnNext)).padStart(3, "0")}`, errOf(rc) || rc.ok);
  check(`(B14) de teller van ${Y1} ligt nu vast`, /ligt vast/.test(errOf(await admin.setSalesCounter("F", Y1, 100n))));
  // B17 (na de jaarwissel): de voorschotfactuur is vervallen → herinnering 1 (met mail in de wachtrij, testmodus) en 2; een betaalde of
  // volledig gecrediteerde factuur krijgt er geen.
  const cur = ok(await calc.readContract(W1));
  const k = { estimatedAmountCents: [], priceRevision: { none: null }, guarantee: { none: null }, guaranteeBp: 0n, paymentTermDays: 15n, invoicingRhythm: { perPhase: null }, signedQuoteVersionId: [], note: "proef 2c6" };
  ok(await calc.setContract(W1, { contract: k, clientContact: [{ name: "Proef Klant Lijster", phone: [], email: ["klant-2c6@proef.invalid"], address: [] }], notes: "Proef 2c6" }, cur.version));
  const r1 = await calc.remindSalesInvoice(ADV2, true, "proef 2c6");
  const r2 = await calc.remindSalesInvoice(ADV2, false, "");
  const fa = await read(ADV2);
  check("(B17) vervallen voorschotfactuur: herinnering 1 (mail in de wachtrij) en 2; het nummer van de herinnering loopt op", isOk(r1) && isOk(r2) && fa.reminders.length === 2 && fa.reminders[0].mailed && fa.reminders[1].level === 2n && fa.brief.reminders === 2n && fa.brief.overdue, `${errOf(r1)} ${errOf(r2)}`);
  check("(B17) de werklijst toont de vervallen factuur met het aantal dagen te laat", ok(await calc.salesWorklist()).open.some((o) => o.brief.id === ADV2 && o.daysLate > 0n));
  check("(B17) een volledig gecrediteerde factuur: geen herinnering", /betaald/.test(errOf(await calc.remindSalesInvoice(ADV, false, ""))));
  check("(B17) werfleider en klant: geen herinnering", (await denied(wl.remindSalesInvoice(ADV2, false, ""))) && (await denied(klant.remindSalesInvoice(ADV2, false, ""))));
} else console.log("· (B14) jaarwissel overgeslagen (geen eigen net of ZONDER_KLOK)");

console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
