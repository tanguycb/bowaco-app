// OA-offertes ontvangen en vergelijken (stap 2c.3, ontwerp 2c §4.3, §5, §6, §8 R38, §10; ⚖5, AC-12, AC-13).
//   node tests/oaofferte-2c3.mjs                A: de vergelijking (tender/compare.ts) met de hand nagerekend en de PDF Vergelijking
//                                                OA-offertes, zonder netwerk
//   node tests/oaofferte-2c3.mjs <canister>     + B: door de backend: een offerte via de app (melding aan kantoor), de Excel heen en
//                                                terug via de canister (sheet.ts → invullen → sheetread.ts → registerOaQuote → readOaQuote
//                                                = dezelfde prijzen; een Excel van een andere firma geweigerd), met de hand (hoofdstuk-
//                                                totalen, enkel totaal), los zonder prijsvraag; vergelijking browser = server (laagste,
//                                                totalen op de VH van BOWACO, afwijkend, VH gewijzigd) en op willekeurige prijsvragen;
//                                                kiezen per hoofdstuk en per post; overnemen in een ontwerpversie (aankoopprijs, firma,
//                                                bron) en in de bibliotheek (één LibCost per gekozen post, idempotent, niet-gekozen
//                                                gemarkeerd en nooit de geldende prijs); een verzonden versie verandert nooit; een tweede
//                                                indiening vervangt de eerste (historiek blijft, keuze verouderd); afsluiten met het bericht
//                                                (melding · mail in de wachtrij · niets) zonder prijzen of naam van de gekozen firma; de
//                                                werfleider ziet enkel wie gekozen is; rechten en de .did-controle.
// Enkel VERZONNEN gegevens: firma's "Proef … 2c3", gemeente Lindegem, postcode 9993.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { backend, freshBackend, nepmail } from "../tools/lib.mjs";
import { M, saveAll, fromRead } from "./offerte-lib.mjs";
import { totals, roundDiv } from "../src/frontend/src/tender/calc.ts";
import { compare, median, normalize, version as cmpVersion } from "../src/frontend/src/tender/compare.ts";
import { comparePdf } from "../src/frontend/src/pdf/vergelijking.ts";
import { makeSheet } from "../src/frontend/src/tender/sheet.ts";
import { readTenderSheet } from "../src/frontend/src/tender/sheetread.ts";
import { unzip, zipStore } from "../src/frontend/src/tender/zip.ts";
import { fonts } from "./pdf-voorbeeld.mjs";

const cid = process.argv[2];
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const S = (x) => JSON.stringify(x, big);
const Y = { yes: null };

// ── A. De vergelijking met de hand nagerekend ───────────────────────────
const L = (itemId, unitCents, qtyMilli, included = Y, changed = []) => ({ itemId, qtyMilli, unitCents, amountCents: unitCents === null || "no" in included ? null : roundDiv(unitCents * qtyMilli, 1000n), included, changed });
const items = [
  { id: 1n, chapter: "05 Elek", qtyMilli: 12_000n, unit: "st", libItemId: 50n },
  { id: 2n, chapter: "05 Elek", qtyMilli: 8_000n, unit: "st", libItemId: null },
  { id: 3n, chapter: "06 San", qtyMilli: 2_000n, unit: "st", libItemId: null },
  { id: 4n, chapter: "06 San", qtyMilli: 15_250n, unit: "lm", libItemId: null },
];
const qA = { id: 10n, orgId: 100n, form: "posten", discountBp: 500n, netCents: 0n, chapterTotals: [], lines: [L(1n, 1234n, 12_000n), L(2n, 4550n, 8_000n), L(3n, null, 2_000n, { no: null }), L(4n, 700n, 15_250n, { alt: "PE 20" }), { itemId: null, qtyMilli: 1000n, unitCents: 15_000n, amountCents: 15_000n, included: Y, changed: [] }] };
const qB = { id: 11n, orgId: 101n, form: "posten", discountBp: null, netCents: 0n, chapterTotals: [], lines: [L(1n, 1500n, 12_000n), L(2n, 4000n, 8_000n), L(3n, 30_000n, 2_000n), L(4n, 650n, 20_000n, Y, ["vh"])] };
const qC = { id: 12n, orgId: 102n, form: "hoofdstukken", discountBp: 1000n, netCents: 99_000n, chapterTotals: [["05 Elek", 60_000n], ["06 San", 50_000n]], lines: [] };
const qD = { id: 13n, orgId: 103n, form: "totaal", discountBp: null, netCents: 70_000n, chapterTotals: [], lines: [] };
const hist = [{ itemId: 1n, lastByOrg: [[101n, 1000n], [100n, 1300n]], recent: [1000n, 1300n] }];
const inA = { items, quotes: [qA, qB, qC, qD], history: hist, thresholdBp: 1500n, picks: [{ itemId: 1n, oaQuoteId: 10n }, { itemId: 2n, oaQuoteId: 11n }, { itemId: 3n, oaQuoteId: 10n }] };
const rA = compare(inA);
const cell = (r, i, q) => r.cells.find((c) => c.itemId === i && c.oaQuoteId === q);
check("(A1) post × firma: prijs op de VH van BOWACO (12 × € 12,34 = € 148,08), niet inbegrepen, ontbreekt niet, geen-detail bij hoofdstuktotalen en totaal", cell(rA, 1n, 10n).amountCents === 14_808n && cell(rA, 3n, 10n).state === "niet-inbegrepen" && cell(rA, 1n, 12n).state === "geen-detail" && cell(rA, 1n, 13n).state === "geen-detail" && rA.cells.length === 16);
check("(A1) VH gewijzigd door de firma: bedrag op de VH van BOWACO (15,25 × € 6,50 = € 99,13), gemarkeerd", cell(rA, 4n, 11n).amountCents === 9913n && cell(rA, 4n, 11n).vhChanged);
check("(A2) laagste: stopcontact A (148,08 < 180,00), lichtpunt B (320,00 < 364,00); wastafel en leiding geen laagste (één vergelijkbare prijs; alternatief telt niet)", cell(rA, 1n, 10n).lowest && !cell(rA, 1n, 11n).lowest && cell(rA, 2n, 11n).lowest && !cell(rA, 3n, 11n).lowest && !cell(rA, 4n, 10n).lowest && !cell(rA, 4n, 11n).lowest && cell(rA, 4n, 10n).alt);
check("(A3) afwijkend: B € 15,00 t.o.v. zijn vorige € 10,00 = +50 % (⚑); A € 12,34 t.o.v. € 13,00 = −5,08 % en mediaan € 11,50 = +7,30 % (geen ⚑)", cell(rA, 1n, 11n).devLastBp === 5000n && cell(rA, 1n, 11n).deviates && cell(rA, 1n, 10n).devLastBp === -508n && cell(rA, 1n, 10n).devMedianBp === 730n && !cell(rA, 1n, 10n).deviates && median([1000n, 1300n]) === 1150n && median([5n, 1n, 3n]) === 3n);
const tA = rA.quotes[0], tB = rA.quotes[1], tC = rA.quotes[2], tD = rA.quotes[3];
check("(A4) totalen A: 05 = 512,08, 06 = 106,75 (alternatief telt), eigen 150,00, bruto 768,83, korting 5 % = 38,44, netto 730,39; 3 van 4 posten", S(tA.chapters) === S([["05 Elek", 51_208n], ["06 San", 10_675n]]) && tA.ownCents === 15_000n && tA.gross === 76_883n && tA.discount === 3844n && tA.net === 73_039n && tA.priced === 3n && !tA.complete, S(tA));
check("(A4) totalen B volledig (4/4); C hoofdstuktotalen − 10 % = 990,00, volledig; D enkel totaal 700,00", tB.complete && tB.priced === 4n && tB.net === 18_000n + 32_000n + 60_000n + 9913n && tC.net === 99_000n && tC.complete && tD.net === 70_000n && tD.complete);
check("(A5) laagste hoofdstuk enkel tussen firma's die het volledig prijsden: 05 → Merel 500,00 (< Reiger 512,08, < Fuut 600,00); 06 → Fuut 500,00 (Reiger niet volledig, Merel 699,13); totaal onder de volledige (B, C, D) → D 700,00", S(rA.chapters.find((c) => c.chapter === "05 Elek").lowest) === S([11n]) && S(rA.chapters.find((c) => c.chapter === "06 San").lowest) === S([12n]) && S(rA.lowestTotal) === S([13n]), S(rA.chapters) + S(rA.lowestTotal));
check("(A6) keuze: 2 posten gekozen (148,08 + 320,00), de wastafel bij A (niet inbegrepen) = verouderd/ongeldig", rA.choice.chosen === 2n && rA.choice.total === 46_808n && S(rA.choice.stale) === S([3n]) && S(rA.choice.chapters) === S([["05 Elek", 46_808n]]));
check("(A7) andere eenheid: niet vergelijkbaar (geen laagste), gemarkeerd; rekenversie 1", (() => { const r = compare({ ...inA, quotes: [qA, { ...qB, lines: [L(1n, 1000n, 12_000n, Y, ["eenheid"]), ...qB.lines.slice(1)] }] }); return cell(r, 1n, 11n).unitChanged && !cell(r, 1n, 11n).lowest && !cell(r, 1n, 10n).lowest; })() && cmpVersion === 1n);
{
  const data = {
    code: "PV 2026/412-1", title: "Proef elektriciteit & sanitair", work: "P-PV Proef werf 2c3", made: "31.10.2026 door Proef Calculator",
    firms: ["Proef Elektro Reiger 2c3", "Proef Elektro Merel 2c3", "Proef Sanitair Fuut 2c3", "Proef Dak Kievit 2c3", "Proef Vijfde Specht 2c3"].map((n) => ({ name: n, meta: "offerte 2026-0877 · 14.10.2026 · versie 1" })),
    rows: Array.from({ length: 60 }, (_, i) => ({ chapter: i < 35 ? "05 Proef elektriciteit" : "06 Proef sanitair", code: `5.${i + 1}`, title: i === 4 ? "x".repeat(500) : `Proefpost ${i + 1}`, qty: "12 st", cells: Array.from({ length: 5 }, (_, k) => ({ main: "€ 12,34", sub: "€ 148,08", lowest: k === 0, chosen: k === 1, flag: k === 1 ? "⚑ +50 % t.o.v. vorige" : "" })), choice: "Proef Elektro Merel 2c3", reason: i === 2 ? "beschikbaar in de planning (verzonnen)" : "" })),
    chapterSums: [{ chapter: "05 Proef elektriciteit", sum: { label: "05", values: Array(5).fill("€ 512,08"), lowest: [true, false, false, false, false] } }],
    totals: [{ label: "Netto", values: Array(5).fill("€ 730,39"), lowest: [false, true, false, false, false] }],
    choice: "Keuze: 2 van 4 posten · € 468,08 aankoop", legend: "Groen = laagste.",
  };
  const bytes = await comparePdf(data, fonts());
  const dir = mkdtempSync(join(tmpdir(), "bowaco-oq-"));
  const f = join(dir, "v.pdf");
  writeFileSync(f, bytes);
  const PY = `
import fitz, json, sys
d = fitz.open(sys.argv[1])
out = {"pages": 0, "text": "", "outside": 0}
for p in d:
    out["pages"] += 1
    r = p.rect
    out["text"] += p.get_text()
    out["outside"] += len([b for b in p.get_text("blocks") if b[6] == 0 and (b[0] < 20 or b[2] > r.width - 20 or b[3] > r.height - 10)])
print(json.dumps(out))
`;
  const r = spawnSync("python3", ["-c", PY, f], { encoding: "utf8", cwd: dir });
  if (r.status === 0) {
    const o = JSON.parse(r.stdout);
    check("(A8) PDF vergelijking: VERTROUWELIJK, code, firma's, keuze en reden, 5 firma's in twee blokken, liggend", o.text.includes("VERTROUWELIJK") && o.text.includes("PV 2026/412-1") && o.text.includes("Proef Vijfde Specht 2c3") && o.text.includes("beschikbaar in de planning") && o.text.includes("Firma's 5–5 van 5") && o.text.includes("Keuze: 2 van 4"), `${o.pages} bladzijden`);
    check("(A8) PDF: 60 posten over meerdere bladzijden, niets buiten de marge", o.pages >= 3 && o.outside === 0 && o.text.includes("Proefpost 60"));
  } else console.log("· (A8) PyMuPDF ontbreekt: PDF niet nagelezen");
}

if (!cid) {
  console.log(`\n${pass} ✓  ${fail} ✗  (enkel A; geef een canister voor B)`);
  process.exit(fail ? 1 : 0);
}

// ── B. Door de backend ──────────────────────────────────────────────────
const ok = (r) => { if (r && typeof r === "object" && "err" in r) throw new Error(r.err); return r.ok; };
const isOk = (r) => r && typeof r === "object" && "ok" in r;
const errOf = (r) => (r && typeof r === "object" && "err" in r ? r.err : "");
const denied = async (p) => { try { const r = await p; return !!(r && "err" in r && /^Geen toegang/.test(r.err)); } catch (e) { return /Geen toegang|trap|Reject/i.test(String(e)); } };
const opt = (v) => (v === null || v === undefined ? [] : [v]);
const host = process.env.ICP_HOST || "";
const local = host.includes("localhost") || host.includes("127.0.0.1");
const un = (a) => (Array.isArray(a) && a.length ? a[0] : null);
// De invoer en de uitkomst van de server in de vorm van compare.ts (opties [] / [x] → null / x).
const inFrom = (i) => ({
  items: i.items.map((x) => ({ ...x, libItemId: un(x.libItemId) })),
  quotes: i.quotes.map((q) => ({ ...q, discountBp: un(q.discountBp), lines: q.lines.map((l) => ({ itemId: un(l.itemId), qtyMilli: l.qtyMilli, unitCents: un(l.unitCents), amountCents: un(l.amountCents), included: l.included, changed: l.changed })) })),
  history: i.history, thresholdBp: i.thresholdBp, picks: i.picks,
});
const resFrom = (r) => ({ ...r, cells: r.cells.map((c) => ({ ...c, unitCents: un(c.unitCents), amountCents: un(c.amountCents), devLastBp: un(c.devLastBp), devMedianBp: un(c.devMedianBp) })) });
const sameCalc = (view) => S(normalize(compare(inFrom(view.input)))) === S(normalize(resFrom(view.calc)));

const [admin, calc, wl, oaDak, arch, klant, vc] = await Promise.all(["proef-admin", "proef-calculator", "proef-werfleider", "proef-oa2", "proef-architect", "proef-klant", "proef-vc"].map((n) => backend(n, cid)));
const vreemd = await freshBackend(cid);
const oaA = await freshBackend(cid); // Reiger (via de app)
const oaC = await freshBackend(cid); // Fuut (krijgt het bericht "bedankt")
const suffix = Date.now().toString(36).slice(-5).toUpperCase();

// B0. Opzet.
const orgOf = async (name, kind = "subcontractor") => ok(await admin.createOrg({ kind: { [kind]: null }, name, kbo: [], vat: [], aliases: [], trades: [], address: [], notes: "Verzonnen proeffirma (2c.3)" })).id;
const REIGER = await orgOf(`Proef Elektro Reiger 2c3 ${suffix}`);
const MEREL = await orgOf(`Proef Elektro Merel 2c3 ${suffix}`);
const FUUT = await orgOf(`Proef Sanitair Fuut 2c3 ${suffix}`);
const KIEVIT = await orgOf(`Proef Dak Kievit 2c3 ${suffix}`);
const KLANTORG = ok(await admin.createOrg({ kind: { client: null }, name: `Proef Klant Spreeuw 2c3 ${suffix}`, kbo: [], vat: [], aliases: [], trades: [], address: [{ street: "Klantweg", number: "8", zip: "9993", city: "Lindegem", country: "BE" }], notes: "Verzonnen proefklant (2c.3)" })).id;
const personOf = async (orgId, name) => ok(await admin.saveOaPerson(orgId, { id: [], name, shortCode: [], phone: [], email: [`${name.toLowerCase().replace(/[^a-z]+/g, ".")}@proef.invalid`], jobTitle: "zaakvoerder", note: "" })).id;
await personOf(REIGER, `Proef Rita ${suffix}`);
await personOf(MEREL, `Proef Mo ${suffix}`);
await personOf(FUUT, `Proef Fien ${suffix}`);
await personOf(KIEVIT, `Proef Kees ${suffix}`);
const addr = { street: "Proefweg", number: "3", zip: "9993", city: "Lindegem", country: "BE" };
const W1 = ok(await admin.createWork({ code: `P-OQ${suffix}`, name: "Proef OA-offertes 2c3", address: addr, parentId: [], clientOrgId: [KLANTORG], architectOrgId: [], leaderPersonId: [], vatBp: 600n })).id;
const WL = (await wl.me()).person[0].id;
ok(await admin.addMembership(W1, [WL], [], { werfleider: null }, []));
const libChs = await calc.libraryChapters(false);
if (!libChs.length) throw new Error("geen hoofdstukken in de bibliotheek: eerst tests/posten-draft.mjs");
const libIn = (title, orgId) => ({ id: [], chapterId: libChs[0].id, code: "", title, text: "Verzonnen.", unit: "st", form: { vh: null }, trade: [], orgId: opt(orgId), durationDays: [], perDayMilli: [], planStepKey: [], keywords: [], importKey: [] });
const L1 = ok(await calc.saveLibraryItem(libIn(`Proef stopcontact 2c3 ${suffix}`, MEREL), 0n)).id;
const L2 = ok(await calc.saveLibraryItem(libIn(`Proef lichtpunt 2c3 ${suffix}`, null), 0n)).id;
const today = BigInt(Math.floor(Date.now() / 86_400_000));
const cost = (itemId, orgId, cents, ago) => calc.addLibraryCost(itemId, { orgId: opt(orgId), day: today - BigInt(ago), costCents: cents, source: "offerte", ref: "proef 2c3", note: "" });
ok(await cost(L1, MEREL, 1000n, 30));
ok(await cost(L1, REIGER, 1300n, 60));
async function mkQuote(title) {
  const q = ok(await calc.createQuote({ workId: W1, number: "", title }));
  const m = fromRead(ok(await calc.readQuoteVersion(q.versionId)));
  const c1 = M.addChapter(m, { code: "05", title: "Proef elektriciteit" });
  const c2 = M.addChapter(m, { code: "06", title: "Proef sanitair" });
  M.addLine(m, c1.key, { title: "Proef stopcontact", qtyMilli: 12_000n, unit: "st", form: "vh", libItemId: L1, libItemVersion: 1n, price: M.emptyPrice() });
  M.addLine(m, c1.key, { title: "Proef lichtpunt", qtyMilli: 8_000n, unit: "st", form: "vh", libItemId: L2, libItemVersion: 1n, price: M.emptyPrice() });
  M.addLine(m, c2.key, { title: "Proef wastafel", qtyMilli: 2_000n, unit: "st", form: "fixed", price: M.emptyPrice() });
  M.addLine(m, c2.key, { title: "Proef leiding", qtyMilli: 15_250n, unit: "lm", form: "vh", price: M.emptyPrice() });
  const r = await saveAll(calc, m);
  if (r && "err" in r) throw new Error(r.err);
  const rd = ok(await calc.readQuoteVersion(q.versionId));
  return { q, rd, posts: rd.lines.filter((l) => !("text" in l.kind)) };
}
const { q, rd: R1, posts } = await mkQuote("Proef 2c3 offerte");
const sug = ok(await calc.tenderSuggestions(R1.version.id, posts.map((l) => l.id)));
const tIn = (over = {}) => ({ versionId: R1.version.id, lineIds: posts.map((l) => l.id), title: "Proef elektriciteit & sanitair 2c3", noteForOa: "", internalNote: "", deadlineDay: sug.deadlineDay, remindDays: 3n, fileIds: [], addressMode: { city: null }, firms: [REIGER, MEREL, FUUT].map((o) => ({ orgId: o, contactPersonId: [] })), ...over });
const T1 = ok(await calc.createTender(tIn()));
let tv = ok(await calc.readTender(T1));
const invA = tv.invites.find((i) => i.orgId === REIGER);
const invB = tv.invites.find((i) => i.orgId === MEREL);
const invC = tv.invites.find((i) => i.orgId === FUUT);
const it = Object.fromEntries(tv.items.map((x) => [x.title, x]));
check("(B0) opzet: werf, offerte met 4 posten (2 uit de bibliotheek), prijsvraag aan 3 firma's", tv.items.length === 4 && tv.invites.length === 3);

// B1. Via de app: de OA dient in; kantoor krijgt een melding.
ok(await oaA.redeemCode(ok(await calc.tenderAccess(invA.id, 0n)).code[0]));
ok(await oaC.redeemCode(ok(await calc.tenderAccess(invC.id, 0n)).code[0]));
for (const i of [invA, invB, invC]) ok(await calc.updateTenderInvite(i.id, { markSent: ["pdf", "excel"] }));
const my0 = ok(await oaA.readMyTender(invA.ref));
const posOf = Object.fromEntries(my0.items.map((x) => [x.title, x.pos]));
const lineIn = (x, unitCents, included = Y) => ({ pos: [posOf[x.title]], description: "", unit: "", qtyMilli: 0n, unitCents: opt(unitCents), included, remark: "" });
const draftA = { number: "PROEF-R-1", quoteDay: [], validUntil: [], discountBp: [500n], reverse: true, remark: "", lines: [lineIn(it["Proef stopcontact"], 1234n), lineIn(it["Proef lichtpunt"], 4550n), lineIn(it["Proef wastafel"], null, { no: null }), lineIn(it["Proef leiding"], 700n, { alt: "PE 20 mm" }), { pos: [], description: "Proef aarding meten", unit: "pst", qtyMilli: 1000n, unitCents: [15_000n], included: Y, remark: "" }] };
const svA = ok(await oaA.saveMyTender(invA.ref, draftA, false, 0n));
const subA = ok(await oaA.saveMyTender(invA.ref, draftA, true, svA.netCents));
const quoteIdOf = async (inv, version) => ok(await calc.readTender(T1)).invites.find((i) => i.id === inv.id).oaQuotes.find((x) => x.version === version).id;
subA.oaQuoteId = [await quoteIdOf(invA, 1n)];
check("(B1) via de app ingediend (versie 1); kantoor krijgt een melding", subA.version[0] === 1n && (await calc.myNotifications(true)).some((n) => n.kind === "prijsvraag-ingediend" && n.text.includes("Reiger")));

// B2. De Excel heen en terug via de canister.
tv = ok(await calc.readTender(T1));
const unitOf = (u) => (u === "m2" ? "m²" : u === "m3" ? "m³" : u);
const sheetFor = (inv) => makeSheet({ sheetKey: inv.sheetKey, sentHash: tv.sentHash, code: tv.code, title: tv.title, firm: inv.orgName, place: "9993 Lindegem", deadline: "1.1.2027", contact: "Proef", items: tv.items.map((x) => ({ pos: Number(x.pos), chapter: x.chapter, subgroup: x.subgroup, code: x.code, title: x.title, text: x.text, unit: unitOf(x.unit), qtyMilli: x.qtyMilli })) });
// Invullen zoals een OA: per rij van de tabel (kolom D = omschrijving) de prijs in H, VH in G, inbegrepen in J (enkel de kolommen
// van ontwerp §5; de sleutels zelf raakt het script niet).
async function fillSheet(bytes, byTitle) {
  const f = await unzip(bytes);
  const dec = new TextDecoder();
  const files = new Map([...f.entries()]);
  let xml = dec.decode(files.get("xl/worksheets/sheet2.xml"));
  const setCell = (ref, inner, t) => {
    const re = new RegExp(`<c r="${ref}"( s="\\d+")?( t="\\w+")?(/>|>[\\s\\S]*?</c>)`);
    const c = `<c r="${ref}"$1${t ? ` t="${t}"` : ""}>${inner}</c>`;
    if (re.test(xml)) xml = xml.replace(re, c);
    else { const row = ref.replace(/^[A-Z]+/, ""); xml = xml.replace(new RegExp(`(<row r="${row}"[^>]*>)([\\s\\S]*?)(</row>)`), `$1$2<c r="${ref}"${t ? ` t="${t}"` : ""}>${inner}</c>$3`); }
  };
  for (const m of xml.matchAll(/<c r="D(\d+)"[^>]*t="inlineStr"><is><t[^>]*>([^<]*)<\/t><\/is><\/c>/g)) {
    const w = byTitle[m[2]];
    if (!w) continue;
    const r = m[1];
    if (w.price !== undefined) setCell(`H${r}`, `<v>${w.price}</v>`);
    if (w.qty !== undefined) setCell(`G${r}`, `<v>${w.qty}</v>`);
    if (w.incl) setCell(`J${r}`, `<is><t>${w.incl}</t></is>`, "inlineStr");
  }
  files.set("xl/worksheets/sheet2.xml", new TextEncoder().encode(xml));
  return zipStore([...files.entries()].map(([name, data]) => ({ name, data })));
}
const xB = await fillSheet(sheetFor(invB), { "Proef stopcontact": { price: 15 }, "Proef lichtpunt": { price: 40 }, "Proef wastafel": { price: 300 }, "Proef leiding": { price: 6.5, qty: 20 } });
const ctxRead = (expect) => ({ tenderId: tv.id, code: tv.code, items: tv.items.map((x) => ({ id: x.id, pos: Number(x.pos), chapter: x.chapter, title: x.title, unit: unitOf(x.unit), unitName: x.unit, qtyMilli: x.qtyMilli })), invites: tv.invites.map((i) => ({ id: i.id, orgName: i.orgName, sheetKey: i.sheetKey })), expectInviteId: expect });
const rdB = await readTenderSheet(xB, "PV Merel.xlsx", ctxRead(invB.id));
check("(B2) Excel van Merel ingelezen: 4 posten, VH van de leiding gewijzigd (markering), geen fouten", rdB.ok && rdB.counts.read === 4 && rdB.counts.changed === 1 && rdB.counts.errors === 0, rdB.ok ? S(rdB.counts) : rdB.error);
const wrong = await readTenderSheet(xB, "PV Merel.xlsx", ctxRead(invC.id));
check("(B2) dezelfde Excel bij Fuut inlezen: geweigerd in de browser met de naam van de juiste firma", !wrong.ok && /hoort bij .*Merel.*niet bij .*Fuut/.test(wrong.error), wrong.ok ? "" : wrong.error);
const regLines = (res) => res.lines.filter((l) => l.row > 0 && !l.error).map((l) => ({ itemId: opt(l.itemId), description: l.description, unit: l.unit, qtyMilli: l.qtyMilli, unitCents: opt(l.unitCents), included: l.included, remark: l.remark }));
const xlsxFile = (bytes) => [{ name: "PV Merel (proef).xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: BigInt(bytes.length), blob: new TextEncoder().encode("!caf!sha256:" + "5".repeat(64)) }];
const regIn = (inv, over = {}) => ({ inviteId: [inv.id], workId: W1, orgId: inv.orgId, source: { sheet: null }, sheetKey: inv.sheetKey, number: "PROEF-M-0877", quoteDay: today, validUntil: [today + 30n], discountBp: [], reverse: true, prices: { lines: regLines(rdB) }, remark: "", note: "", file: xlsxFile(xB), ...over });
{
  const e = errOf(await calc.registerOaQuote(regIn(invC, { sheetKey: invB.sheetKey }), rdB.netCents));
  check("(B2) server: de sleutel van een andere firma geweigerd (\"hoort bij Merel, niet bij Fuut\")", /hoort bij .*Merel.*niet bij .*Fuut/.test(e), e);
}
check("(B2) server: een ander totaal dan de server rekent → niets bewaard", /totaal klopt niet/.test(errOf(await calc.registerOaQuote(regIn(invB), rdB.netCents + 1n))));
check("(B2) registreren: werfleider, OA, architect, klant geweigerd", (await Promise.all([wl, oaA, arch, klant].map((x) => denied(x.registerOaQuote(regIn(invB), rdB.netCents))))).every(Boolean));
const savB = ok(await calc.registerOaQuote(regIn(invB), rdB.netCents));
const fullB = ok(await calc.readOaQuote(savB.oaQuoteId));
const pB = Object.fromEntries(fullB.lines.map((l) => [l.description, l]));
check("(B2) heen en terug via de canister: dezelfde prijzen (15,00 · 40,00 · 300,00 · 6,50), VH van de firma 20 met markering, bron Excel, Excel vertrouwelijk", un(pB["Proef stopcontact"].unitCents) === 1500n && un(pB["Proef lichtpunt"].unitCents) === 4000n && un(pB["Proef wastafel"].unitCents) === 30_000n && un(pB["Proef leiding"].unitCents) === 650n && pB["Proef leiding"].qtyMilli === 20_000n && S(pB["Proef leiding"].changed) === S(["vh"]) && "sheet" in fullB.quote.source && fullB.netCents === rdB.netCents && fullB.file.length === 1);
check("(B2) de Excel staat niet bij de losse bestanden van de werf (enkel bij de OA-offerte)", !(await calc.listFiles([W1])).some((f) => f.name === "PV Merel (proef).xlsx"));

// B3. Met de hand: enkel hoofdstuktotalen (Fuut); los zonder prijsvraag (Kievit).
const chIn = { inviteId: [invC.id], workId: W1, orgId: FUUT, source: { hand: null }, sheetKey: "", number: "F-12", quoteDay: today, validUntil: [], discountBp: [1000n], reverse: false, prices: { chapters: [["05 Proef elektriciteit", 60_000n], ["06 Proef sanitair", 50_000n]] }, remark: "", note: "", file: [] };
check("(B3) hoofdstuktotalen: een onbekend hoofdstuk geweigerd", /Onbekend hoofdstuk/.test(errOf(await calc.registerOaQuote({ ...chIn, prices: { chapters: [["99 Iets", 1n]] } }, 1n))));
const savC = ok(await calc.registerOaQuote(chIn, 99_000n));
check("(B3) met de hand, enkel hoofdstuktotalen − 10 % = € 990,00", savC.netCents === 99_000n && "hand" in ok(await calc.readOaQuote(savC.oaQuoteId)).quote.source);
const looseIn = { inviteId: [], workId: W1, orgId: KIEVIT, source: { hand: null }, sheetKey: "", number: "K-1", quoteDay: today, validUntil: [], discountBp: [], reverse: true, prices: { lines: [{ itemId: [], description: "Proef dakgoot", unit: "lm", qtyMilli: 10_000n, unitCents: [2500n], included: Y, remark: "" }] }, remark: "", note: "", file: [] };
check("(B3) los: een post van een prijsvraag of een Excel geweigerd", /geen posten van een prijsvraag/.test(errOf(await calc.registerOaQuote({ ...looseIn, prices: { lines: [{ ...looseIn.prices.lines[0], itemId: [it["Proef wastafel"].id] }] } }, 0n))) && /met de hand/.test(errOf(await calc.registerOaQuote({ ...looseIn, source: { sheet: null } }, 25_000n))));
const savL = ok(await calc.registerOaQuote(looseIn, 25_000n));
const lst = await calc.listOaQuotes(W1);
check("(B3) los geregistreerd (firma, nummer, regels); de lijst van de werf toont alle 4 OA-offertes; werfleider geweigerd", savL.netCents === 25_000n && lst.length === 4 && lst.some((x) => x.id === savL.oaQuoteId && x.tenderId.length === 0) && (await denied(wl.listOaQuotes(W1))));

check("(B3) enkel een totaal mét een korting: geweigerd (het totaal is na korting)", /geen korting/.test(errOf(await calc.registerOaQuote({ ...looseIn, prices: { total: 1000n }, discountBp: [500n] }, 950n))));

// B4. Vergelijken: browser = server, laagste, totalen op de VH van BOWACO, afwijkend.
let cv = ok(await calc.compareTender(T1));
const qid = { A: subA.oaQuoteId[0], B: savB.oaQuoteId, C: savC.oaQuoteId };
const sc = (title, k) => cv.calc.cells.find((c) => c.itemId === it[title].id && c.oaQuoteId === qid[k]);
check("(B4) drie geldende offertes; de vergelijking van de server = tender/compare.ts in Node (zelfde invoer)", cv.quotes.length === 3 && sameCalc(cv) && cv.calc.version === 1n);
check("(B4) laagste: stopcontact Reiger, lichtpunt Merel; leiding van Merel op de VH van BOWACO (15,25 × 6,50 = 99,13) met VH-markering", sc("Proef stopcontact", "A").lowest && sc("Proef lichtpunt", "B").lowest && un(sc("Proef leiding", "B").amountCents) === 9913n && sc("Proef leiding", "B").vhChanged && sc("Proef stopcontact", "C").state === "geen-detail");
check("(B4) afwijkend: Merel € 15,00 t.o.v. haar vorige € 10,00 in de bibliotheek = +50 % ⚑", un(sc("Proef stopcontact", "B").devLastBp) === 5000n && sc("Proef stopcontact", "B").deviates);
const totB = cv.calc.quotes.find((x) => x.oaQuoteId === qid.B);
check("(B4) totaal Merel op de VH van BOWACO (180 + 320 + 600 + 99,13 = 1.199,13; de firma zelf rekende 1.230,00), volledig 4/4", totB.net === 119_913n && fullB.netCents === 123_000n && totB.complete && totB.priced === 4n);
const aud = await admin.auditLog(0n, 40n);
check("(B4) auditregel per offerte: bekeek:oa-offerte:<id> (zonder bedrag)", [qid.A, qid.B, qid.C].every((id) => aud.some((e) => e.action === `bekeek:oa-offerte:${id}`)) && !aud.some((e) => /€|1500|15,00/.test(e.detail)));
check("(B4) vergelijken: werfleider, OA, architect, klant, VC en een onbekende login geweigerd", (await Promise.all([wl, oaA, arch, klant, vc, vreemd].map((x) => denied(x.compareTender(T1))))).every(Boolean));

// B5. Kiezen per hoofdstuk en per post.
const pick = (title, k, reason = "") => ({ itemId: it[title].id, oaQuoteId: opt(k ? qid[k] : null), reason });
check("(B5) kiezen: niet inbegrepen, enkel hoofdstuktotalen of een post van een andere prijsvraag geweigerd", /niet inbegrepen/.test(errOf(await calc.saveTenderChoices(T1, [pick("Proef wastafel", "A")]))) && /hoofdstuktotalen/.test(errOf(await calc.saveTenderChoices(T1, [pick("Proef wastafel", "C")]))) && /hoort niet bij/.test(errOf(await calc.saveTenderChoices(T1, [{ itemId: 999_999n, oaQuoteId: [qid.A], reason: "" }]))));
check("(B5) kiezen: werfleider, OA, klant geweigerd", (await Promise.all([wl, oaA, klant].map((x) => denied(x.saveTenderChoices(T1, [pick("Proef lichtpunt", "B")]))))).every(Boolean));
// Hoofdstuk 05 aan Merel, daarna het stopcontact (per post) aan Reiger; hoofdstuk 06 aan Merel (lichtpunt bij Merel = laagste).
ok(await calc.saveTenderChoices(T1, [pick("Proef stopcontact", "B"), pick("Proef lichtpunt", "B"), pick("Proef wastafel", "B"), pick("Proef leiding", "B", "VH nagekeken met de firma (verzonnen)")]));
ok(await calc.saveTenderChoices(T1, [pick("Proef stopcontact", "A")]));
cv = ok(await calc.compareTender(T1));
check("(B5) keuze bewaard: stopcontact Reiger, de rest Merel; reden bij de leiding; keuzetotaal = 148,08 + 320 + 600 + 99,13", cv.choices.length === 4 && cv.choices.find((c) => c.itemId === it["Proef stopcontact"].id).orgName.includes("Reiger") && cv.choices.find((c) => c.itemId === it["Proef leiding"].id).reason.includes("VH nagekeken") && cv.calc.choice.total === 14_808n + 32_000n + 60_000n + 9913n && sameCalc(cv));

// B6. Overnemen in de ontwerpversie en de bibliotheek (idempotent).
check("(B6) overnemen: werfleider, OA geweigerd; een versie van een andere offerte geweigerd", (await denied(wl.applyTenderChoices(T1, R1.version.id))) && (await denied(oaA.applyTenderChoices(T1, R1.version.id))) && /andere offerte/.test(errOf(await calc.applyTenderChoices(T1, ok(await calc.createQuote({ workId: W1, number: "", title: "Proef 2c3 andere" })).versionId))));
const libCount = async (li) => ok(await calc.readLibraryPriceHistory(li)).costs.filter((c) => !c.archived && c.source === "oa-offerte");
const ap1 = ok(await calc.applyTenderChoices(T1, R1.version.id));
const R1b = ok(await calc.readQuoteVersion(R1.version.id));
const pr = (rd, title) => { const l = rd.lines.find((x) => x.title === title); const p = rd.costs.find((c) => c.lineId === l.id); return { cost: un(p.costCents), org: un(p.orgId), src: p.source, lib: un(p.libCostId) }; };
const ps = pr(R1b, "Proef stopcontact");
const pl = pr(R1b, "Proef lichtpunt");
check("(B6) overgenomen: 4 posten; stopcontact € 12,34 van Reiger, lichtpunt € 40,00 van Merel, bron oa-offerte", ap1.lines === 4n && ps.cost === 1234n && ps.org === REIGER && ps.src === "oa-offerte" && pl.cost === 4000n && pl.org === MEREL, S([ap1, ps, pl]));
const c1 = await libCount(L1);
const c2 = await libCount(L2);
const chosen = (cs) => cs.filter((c) => c.note.endsWith("· gekozen"));
const notChosen = (cs) => cs.filter((c) => c.note.endsWith("niet gekozen"));
check("(B6) bibliotheek: per gekozen post één LibCost (bron oa-offerte, firma, datum); de niet-gekozen firma's als prijsgeheugen 'niet gekozen'", chosen(c1).length === 1 && un(chosen(c1)[0].orgId) === REIGER && chosen(c1)[0].costCents[0] === 1234n && notChosen(c1).length === 1 && un(notChosen(c1)[0].orgId) === MEREL && chosen(c2).length === 1 && un(chosen(c2)[0].orgId) === MEREL && notChosen(c2).length === 1 && ps.lib === chosen(c1)[0].id, S(c1.map((c) => [c.note, c.costCents])));
const rev1 = ok(await calc.readQuoteVersion(R1.version.id)).version.rev;
const nAud = async () => (await admin.auditLog(0n, 200n)).filter((e) => e.action === "offerte-oa-overgenomen").length;
const aud1 = await nAud();
const ap2 = ok(await calc.applyTenderChoices(T1, R1.version.id));
check("(B6) opnieuw overnemen zonder prijswijziging: geen nieuwe stand van de versie, geen auditregel (review L3)", ap2.changed === 0n && ap1.changed === 4n && ok(await calc.readQuoteVersion(R1.version.id)).version.rev === rev1 && (await nAud()) === aud1, `${ap2.changed} ${aud1}`);
check("(B6) opnieuw overnemen = idempotent: zelfde prijzen, geen nieuwe LibCost", ap2.lines === 4n && S(await libCount(L1)) === S(c1) && S(await libCount(L2)) === S(c2) && S(pr(ok(await calc.readQuoteVersion(R1.version.id)), "Proef stopcontact")) === S(ps));
const lp = ok(await calc.readLibraryPrices([L1]));
check("(B6) een 'niet gekozen' prijs is nooit de geldende prijs van de post (standaard-OA Merel: nog altijd € 10,00, niet € 15,00)", un(lp.prices[0].cost)?.costCents[0] === 1000n, S(un(lp.prices[0].cost)));
// Een verzonden versie verandert nooit; een nieuwe versie (kopie) neemt over via dezelfde post (root).
const rdS = ok(await calc.readQuoteVersion(R1.version.id));
const sent = await calc.sendQuoteVersion(R1.version.id, rdS.version.rev, rdS.totals.totalCents, "proef 2c3: waarschuwingen doorgezet");
if (isOk(sent)) {
  check("(B6) een verzonden versie: overnemen geweigerd", /verandert nooit meer/.test(errOf(await calc.applyTenderChoices(T1, R1.version.id))));
  // De klant van de werf leest de verstuurde versie: geen aankoopprijs, geen OA-firma (§10).
  const klantW = await freshBackend(cid);
  ok(await klantW.redeemCode(ok(await admin.invitePerson({ name: `Proef Klant ${suffix}`, roles: [{ klant: null }], orgId: [KLANTORG], shortCode: [], lang: [], phone: [], workIds: [W1], validDays: 1n, tag: "proef 2c3" })).code));
  const rk = ok(await klantW.readMyQuote(R1.version.id));
  const sk = S(rk);
  check("(B6) de klant ziet na het overnemen geen aankoopprijs en geen OA-firma (Reiger, Merel, kostprijs 12,34 of 40,00)", !/Reiger|Merel|costCents|"cost"|orgId|1234|4000"|oa-offerte/.test(sk), sk.slice(0, 200));
} else check("(B6) versie versturen voor de proef", false, errOf(sent));
const V2 = ok(await calc.newQuoteVersion(q.quoteId, []));

// B7. Een tweede indiening vervangt de eerste in de vergelijking; de historiek blijft; de keuze is verouderd.
const subA2 = ok(await oaA.saveMyTender(invA.ref, { ...draftA, lines: [lineIn(it["Proef stopcontact"], 1100n), ...draftA.lines.slice(1)] }, true, totals([{ itemId: 1n, qtyMilli: 12_000n, unitCents: 1100n, included: Y }, { itemId: 2n, qtyMilli: 8_000n, unitCents: 4550n, included: Y }, { itemId: 4n, qtyMilli: 15_250n, unitCents: 700n, included: { alt: "x" } }, { itemId: null, qtyMilli: 1000n, unitCents: 15_000n, included: Y }], 500n, () => "").net));
cv = ok(await calc.compareTender(T1));
subA2.oaQuoteId = [await quoteIdOf(invA, 2n)];
check("(B7) versie 2 van Reiger vervangt versie 1 in de vergelijking; versie 1 blijft in de historiek", subA2.version[0] === 2n && cv.quotes.some((x) => x.quote.id === subA2.oaQuoteId[0]) && !cv.quotes.some((x) => x.quote.id === qid.A) && cv.history.some((x) => x.id === qid.A && !x.current) && sameCalc(cv));
check("(B7) afsluiten geweigerd zolang er een verouderde keuze is (review L1)", /Kies opnieuw/.test(errOf(await calc.updateTender(T1, ok(await calc.readTender(T1)).rev, { close: [] }))));
check("(B7) de keuze op versie 1 is verouderd; overnemen geweigerd tot je opnieuw kiest", cv.choices.find((c) => c.itemId === it["Proef stopcontact"].id).stale && S(cv.calc.choice.stale) === S([it["Proef stopcontact"].id]) && /Kies opnieuw/.test(errOf(await calc.applyTenderChoices(T1, V2))));
qid.A = subA2.oaQuoteId[0];
ok(await calc.saveTenderChoices(T1, [pick("Proef stopcontact", "A")]));
const ap3 = ok(await calc.applyTenderChoices(T1, V2));
const c1b = await libCount(L1);
{
  const m = fromRead(ok(await calc.readQuoteVersion(V2)));
  const l = m.lines.find((x) => x.title === "Proef lichtpunt");
  M.updateLine(m, l.key, { unit: "lm" });
  const r = await saveAll(calc, m);
  if (r && "err" in r) throw new Error(r.err);
  const ap4 = ok(await calc.applyTenderChoices(T1, V2));
  check("(B7) de post kreeg in de doelversie een andere eenheid: overslaan en melden (review M2)", ap4.lines === 3n && ap4.skipped.some((x) => x.includes("Proef lichtpunt") && x.includes("andere eenheid")), S(ap4.skipped));
}
check("(B7) opnieuw gekozen en overgenomen in versie 2 (zelfde post via de eerste lijn): € 11,00; in de bibliotheek nog altijd één gekozen prijs per post (de oude gearchiveerd)", ap3.lines === 4n && pr(ok(await calc.readQuoteVersion(V2)), "Proef stopcontact").cost === 1100n && chosen(c1b).length === 1 && chosen(c1b)[0].costCents[0] === 1100n && ok(await calc.readLibraryPriceHistory(L1)).costs.some((c) => c.archived && c.source === "oa-offerte" && c.costCents[0] === 1234n));

// B8. Afsluiten: gekozen / bedankt met het bericht (melding), zonder prijzen of naam van de gekozen firma.
const set0 = await admin.tenderSettings();
check("(B8) instellingen: standaard melding, drempel 15 %; enkel de beheerder bewaart; ongeldige keuze geweigerd", set0.thanksMode === "melding" && set0.deviationBp === 1500n && (await denied(calc.saveTenderSettings(set0))) && /melding, mail of niets/.test(errOf(await admin.saveTenderSettings({ ...set0, thanksMode: "fax" }))));
ok(await calc.updateTender(T1, ok(await calc.readTender(T1)).rev, { close: [] }));
tv = ok(await calc.readTender(T1));
const oc = (inv) => Object.keys(tv.invites.find((i) => i.id === inv.id).outcome)[0];
check("(B8) afgesloten: Reiger en Merel gekozen (uit de keuze), Fuut bedankt", oc(invA) === "chosen" && oc(invB) === "chosen" && oc(invC) === "thanked" && tv.invites.find((i) => i.id === invC.id).outcome.thanked.notified);
const nC = (await oaC.myNotifications(true)).filter((n) => n.kind === "prijsvraag-bedankt");
check("(B8) Fuut krijgt de melding 'niet gekozen, bedankt': zonder bedrag en zonder de naam van de gekozen firma; Reiger krijgt er geen", nC.length === 1 && /niet gekozen/.test(nC[0].text) && !/Reiger|Merel|€|\d+,\d\d/.test(nC[0].text) && !(await oaA.myNotifications(true)).some((n) => n.kind === "prijsvraag-bedankt"));
const myC = ok(await oaC.readMyTender(invC.ref));
check("(B8) de OA ziet enkel zijn eigen uitkomst (bedankt), nooit wie gekozen werd", "thanked" in myC.outcome && !S(myC).includes("Reiger") && !S(myC).includes("Merel"));
const stW = (await wl.listTenders([W1])).find((x) => x.id === T1);
check("(B8) werfleider: per hoofdstuk de gekozen firma (05: Reiger en Merel; 06: Merel), geen prijs", stW.picks.length === 2 && stW.picks[0].orgNames.length === 2 && stW.picks[1].orgNames.some((n) => n.includes("Merel")) && !/Cents|€/.test(S(stW)));
check("(B8) na het afsluiten: kiezen en overnemen geweigerd, de keuze ligt vast (review M1)", /ligt vast/.test(errOf(await calc.saveTenderChoices(T1, [pick("Proef lichtpunt", "B")]))) && /ligt vast/.test(errOf(await calc.applyTenderChoices(T1, V2))));
check("(B8) na het afsluiten: registreren geweigerd", /afgesloten|registreren kan enkel/.test(errOf(await calc.registerOaQuote(regIn(invB), rdB.netCents))));
// Mail-stand: een tweede prijsvraag; het bericht gaat in de wachtrij van de postbode (testmodus); "niets" = geen bericht.
try {
  ok(await admin.saveTenderSettings({ ...set0, thanksMode: "mail" }));
  const T2 = ok(await calc.createTender(tIn({ title: "Proef mail 2c3", firms: [REIGER, KIEVIT].map((o) => ({ orgId: o, contactPersonId: [] })) })));
  const t2 = ok(await calc.readTender(T2));
  const k2 = t2.invites.find((i) => i.orgId === KIEVIT);
  ok(await calc.registerOaQuote({ ...looseIn, inviteId: [k2.id], prices: { total: 50_000n } }, 50_000n));
  ok(await calc.updateTender(T2, t2.rev, { close: [t2.invites.find((i) => i.orgId === REIGER).id] }));
  const jobs = await admin.listJobs("open", 0n, 50n);
  check("(B8) stand mail: de mail 'bedankt' staat in de wachtrij voor Kievit (testmodus); Reiger (gekozen) en een firma zonder offerte niet", jobs.some((j) => j.kind === "prijsvraag-bedankt" && j.orgId[0] === KIEVIT) && !jobs.some((j) => j.kind === "prijsvraag-bedankt" && j.orgId[0] === REIGER));
  ok(await admin.saveTenderSettings({ ...set0, thanksMode: "niets" }));
  const T3 = ok(await calc.createTender(tIn({ title: "Proef niets 2c3", firms: [FUUT].map((o) => ({ orgId: o, contactPersonId: [] })) })));
  const t3 = ok(await calc.readTender(T3));
  ok(await calc.registerOaQuote({ ...chIn, inviteId: [t3.invites[0].id] }, 99_000n));
  const before = (await oaC.myNotifications(false)).filter((n) => n.kind === "prijsvraag-bedankt").length;
  ok(await calc.updateTender(T3, t3.rev, { close: [] }));
  const t3b = ok(await calc.readTender(T3));
  check("(B8) stand niets: bedankt zonder bericht (notified = nee)", (await oaC.myNotifications(false)).filter((n) => n.kind === "prijsvraag-bedankt").length === before && !t3b.invites[0].outcome.thanked.notified);
} finally { ok(await admin.saveTenderSettings(set0)); }

// B8b. Gekozen enkel via het vinkje: haar prijzen niet als "niet gekozen"; een alternatief nooit in de bibliotheek (review L1, L2).
{
  const T4 = ok(await calc.createTender(tIn({ title: "Proef vinkje 2c3", firms: [REIGER, MEREL].map((o) => ({ orgId: o, contactPersonId: [] })) })));
  const t4 = ok(await calc.readTender(T4));
  const ln = (title, cents, inc = Y) => { const x = t4.items.find((y) => y.title === title); return { itemId: [x.id], description: x.title, unit: x.unit, qtyMilli: x.qtyMilli, unitCents: [cents], included: inc, remark: "" }; };
  for (const [org, a, b, incB] of [[REIGER, 1111n, 2222n, Y], [MEREL, 1333n, 2444n, { alt: "ander model (verzonnen)" }]]) {
    const inv = t4.invites.find((i) => i.orgId === org);
    const ls = [ln("Proef stopcontact", a), ln("Proef lichtpunt", b, incB)];
    ok(await calc.registerOaQuote({ ...looseIn, inviteId: [inv.id], orgId: org, prices: { lines: ls } }, totals(ls.map((l) => ({ itemId: 1n, qtyMilli: l.qtyMilli, unitCents: l.unitCents[0], included: l.included })), null, () => "").net));
  }
  ok(await calc.updateTender(T4, t4.rev, { close: [t4.invites.find((i) => i.orgId === REIGER).id] }));
  const mine4 = async (li) => (await libCount(li)).filter((c) => c.note.startsWith(t4.code + " "));
  const m1 = await mine4(L1);
  const m2 = await mine4(L2);
  check("(B8b) Reiger enkel via het vinkje gekozen: geen prijs van Reiger in de bibliotheek; Merel als 'niet gekozen'", !m1.some((c) => un(c.orgId) === REIGER) && m1.some((c) => un(c.orgId) === MEREL && c.note.endsWith("niet gekozen")), S(m1.map((c) => [c.note, c.costCents])));
  check("(B8b) een alternatief (Merel, lichtpunt) komt niet in de bibliotheek", m2.length === 0, S(m2.map((c) => c.note)));
}
// B8c. De tekst van de mail "bedankt" in nl, fr en en (nep-maildienst, enkel lokaal): geen bedrag, geen gekozen firma.
const nepId = process.env.NEPMAIL;
if (local && nepId) {
  const nep = await nepmail(nepId);
  const ps0 = await admin.postSettings();
  try {
    ok(await admin.setMailTest(true, "test@proef.invalid"));
    ok(await admin.saveTenderSettings({ ...set0, thanksMode: "mail" }));
    ok(await admin.setOrgMailLang(FUUT, "fr"));
    ok(await admin.setOrgMailLang(KIEVIT, "en"));
    const T5 = ok(await calc.createTender(tIn({ title: "Proef talen 2c3", firms: [REIGER, MEREL, FUUT, KIEVIT].map((o) => ({ orgId: o, contactPersonId: [] })) })));
    const t5 = ok(await calc.readTender(T5));
    for (const inv of t5.invites) ok(await calc.registerOaQuote({ ...looseIn, inviteId: [inv.id], orgId: inv.orgId, prices: { total: 12_345n } }, 12_345n));
    const from = await nep.aantal();
    ok(await calc.updateTender(T5, t5.rev, { close: [t5.invites.find((i) => i.orgId === REIGER).id] }));
    for (let k = 0; k < 30; k++) { const r = ok(await admin.sendMailNow()); if (!r.busy && (await nep.mails(from)).filter((m) => m.html.includes(t5.code)).length >= 3) break; await new Promise((r2) => setTimeout(r2, 2000)); }
    const ms = (await nep.mails(from)).filter((m) => m.html.includes(t5.code) || m.subject.includes(t5.code));
    const subj = ms.map((m) => m.subject).join(" | ");
    check("(B8c) drie mails 'bedankt' (Merel nl, Fuut fr, Kievit en); Reiger (gekozen) krijgt er geen", ms.length === 3 && /bedankt voor uw offerte/.test(subj) && /merci pour votre offre/.test(subj) && /thank you for your quote/.test(subj), subj);
    check("(B8c) de mails dragen geen bedrag en niet de naam van de gekozen firma", ms.every((m) => !/€|12[.,]?345|123,45|Reiger/.test(m.html + m.subject)), ms.map((m) => m.html.length).join(","));
  } finally {
    ok(await admin.saveTenderSettings(set0));
    ok(await admin.setMailTest(ps0.testMode, ps0.testAddress));
  }
} else console.log("· (B8c) geen nep-maildienst: mailtekst niet nagelezen");
// B8d. Werfleider van een andere werf (werfleider ziet alles uit) en een gearchiveerde persoon (§10).
{
  const W2 = ok(await admin.createWork({ code: `P-OR${suffix}`, name: "Proef andere werf 2c3", address: addr, parentId: [], clientOrgId: [], architectOrgId: [], leaderPersonId: [], vatBp: 600n })).id;
  const s0 = await admin.getSettings();
  const setIn = (z) => ({ werfleiderZietAlles: z, inviteDays: s0.inviteDays, threshold30bisCents: s0.threshold30bisCents, thresholdCheckinatworkCents: s0.thresholdCheckinatworkCents });
  try {
    ok(await admin.setSettings(setIn(false)));
    check("(B8d) werfleider van een andere werf: geen prijsvragen, geen OA-offertes, geen vergelijking", (await denied(wl.listTenders([W2]))) && (await denied(wl.listOaQuotes(W2))) && (await denied(wl.compareTender(T1))));
  } finally { ok(await admin.setSettings(setIn(s0.werfleiderZietAlles))); }
  const gone = await freshBackend(cid);
  const inv = ok(await admin.invitePerson({ name: `Proef Calculator Weg ${suffix}`, roles: [{ calculator: null }], orgId: [], shortCode: [], lang: [], phone: [], workIds: [], validDays: 1n, tag: "proef 2c3" }));
  const me = ok(await gone.redeemCode(inv.code));
  if (!("active" in me.status)) ok(await admin.confirmLink(me.principal));
  const me2 = await gone.me();
  check("(B8d) een tweede calculator (bevestigd) leest de vergelijking", "active" in me2.status && isOk(await gone.compareTender(T1)), JSON.stringify(me2.status));
  ok(await admin.archivePerson(me.person[0].id));
  check("(B8d) gearchiveerd: vergelijken, registreren, kiezen en de lijst geweigerd", (await denied(gone.compareTender(T1))) && (await denied(gone.listOaQuotes(W1))) && (await denied(gone.registerOaQuote(looseIn, 25_000n))) && (await denied(gone.saveTenderChoices(T1, []))));
}

// B9. Rekentest (§10): browser = server op 200 willekeurige prijsvragen (per post, hoofdstukken, totaal; korting, niet inbegrepen,
// alternatief, VH en eenheid gewijzigd, ontbrekende posten, eigen posten), met historiek in de bibliotheek (afwijkend) en een
// willekeurige keuze; per 50 rondes een nieuwe offerte (hoogstens 60 prijsvragen per offerte). OQ_RONDES=n voor minder.
let seed = 20261031;
// mulberry32 (gehele getallen; een LCG in Number verliest de lage bits en gaf telkens 0)
const rnd = (n) => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) % n; };
let rounds = 0;
let same = 0;
let withDev = 0;
let withPick = 0;
const N = Number(process.env.OQ_RONDES ?? 200);
let base = null;
const firmPool = [REIGER, MEREL, FUUT, KIEVIT];
for (let r = 0; r < N; r++) {
  if (r % 50 === 0) base = await mkQuote(`Proef reken ${r / 50} 2c3`);
  // Historiek: af en toe een aankoopprijs van een firma voor een van de twee bibliotheekposten (tot ruim een jaar oud).
  if (rnd(2) === 0) ok(await cost(rnd(2) ? L1 : L2, firmPool[rnd(4)], BigInt(500 + rnd(5000)), rnd(450)));
  const firms = firmPool.slice(0, 2 + rnd(3));
  const T = ok(await calc.createTender({ ...tIn(), versionId: base.rd.version.id, title: `Proef reken ${r} 2c3`, lineIds: base.posts.slice(0, 2 + rnd(3)).map((l) => l.id), firms: firms.map((o) => ({ orgId: o, contactPersonId: [] })) }));
  const tr = ok(await calc.readTender(T));
  for (const inv of tr.invites) {
    const kind = rnd(6);
    const disc = kind !== 0 && rnd(3) === 0 ? [BigInt(rnd(1500))] : [];
    let prices;
    let net;
    if (kind === 0) { const v = BigInt(rnd(5_000_000)); prices = { total: v }; net = v; }
    else if (kind === 1) {
      const chs = [...new Set(tr.items.map((x) => x.chapter))].map((c) => [c, BigInt(rnd(3_000_000))]);
      prices = { chapters: chs };
      const g = chs.reduce((acc, [, v]) => acc + v, 0n);
      net = g - (disc.length && disc[0] > 0n ? roundDiv(g * disc[0], 10_000n) : 0n);
    } else {
      const ls = [];
      for (const x of tr.items) {
        if (rnd(7) === 0) continue; // ontbreekt
        const inc = rnd(8) === 0 ? { no: null } : rnd(8) === 0 ? { alt: "anders (verzonnen)" } : Y;
        const qty = rnd(5) === 0 ? x.qtyMilli + BigInt(rnd(5000)) : x.qtyMilli;
        ls.push({ itemId: [x.id], description: x.title, unit: rnd(9) === 0 ? "pak" : x.unit, qtyMilli: qty, unitCents: rnd(9) === 0 ? [] : [BigInt(rnd(200_000))], included: inc, remark: "" });
      }
      if (rnd(3) === 0) ls.push({ itemId: [], description: "eigen post", unit: "st", qtyMilli: BigInt(1000 + rnd(9000)), unitCents: [BigInt(rnd(50_000))], included: Y, remark: "" });
      if (ls.length === 0) ls.push({ itemId: [], description: "eigen post", unit: "st", qtyMilli: 1000n, unitCents: [100n], included: Y, remark: "" });
      prices = { lines: ls };
      net = totals(ls.map((l) => ({ itemId: un(l.itemId) === null ? null : 1n, qtyMilli: l.qtyMilli, unitCents: un(l.unitCents), included: l.included })), disc.length ? disc[0] : null, () => "x").net;
    }
    const res = await calc.registerOaQuote({ inviteId: [inv.id], workId: W1, orgId: inv.orgId, source: { hand: null }, sheetKey: "", number: `R${r}`, quoteDay: today - BigInt(rnd(20)), validUntil: [], discountBp: disc, reverse: true, prices, remark: "", note: "", file: [] }, net);
    if (!isOk(res)) { check(`(B9) ronde ${r}: registreren`, false, errOf(res)); }
  }
  let v = ok(await calc.compareTender(T));
  let good = sameCalc(v);
  // Een willekeurige keuze op prijzen die je kunt kiezen; daarna rekent de vergelijking het keuzetotaal.
  const can = v.calc.cells.filter((c) => c.state === "prijs" && !c.unitChanged);
  const picks = [];
  for (const x of tr.items) { const cs = can.filter((c) => c.itemId === x.id); if (cs.length && rnd(3) > 0) picks.push({ itemId: x.id, oaQuoteId: [cs[rnd(cs.length)].oaQuoteId], reason: "" }); }
  if (picks.length) {
    ok(await calc.saveTenderChoices(T, picks));
    v = ok(await calc.compareTender(T));
    good = good && sameCalc(v) && v.calc.choice.chosen === BigInt(picks.length);
    withPick++;
  }
  if (v.calc.cells.some((c) => c.devLastBp.length || c.devMedianBp.length)) withDev++;
  rounds++;
  if (good) same++;
  else console.log("  verschil ronde", r, ":", S(compare(inFrom(v.input))).slice(0, 300), "\n  server:", S(resFrom(v.calc)).slice(0, 300));
}
check(`(B9) rekentest: browser = server op ${rounds} willekeurige prijsvragen (${withDev} met historiek/afwijking, ${withPick} met een keuze)`, rounds === N && same === N && (N < 20 || (withDev > N / 4 && withPick > N / 4)), `${same}/${rounds}`);

// B9b. Omvang (review L7): 300 posten × 30 firma's in één vergelijking, binnen de grenzen van één oproep; browser = server.
if (!process.env.ZONDER_GROOT) {
  const q300 = ok(await calc.createQuote({ workId: W1, number: "", title: "Proef groot 2c3" }));
  const m = fromRead(ok(await calc.readQuoteVersion(q300.versionId)));
  const chs = Array.from({ length: 10 }, (_, k) => M.addChapter(m, { code: String(k + 10), title: `Proef hoofdstuk ${k + 1}` }));
  for (let k = 0; k < 300; k++) M.addLine(m, chs[k % 10].key, { title: `Proef post ${k + 1}`, qtyMilli: BigInt(1000 + k * 37), unit: "st", form: "vh", libItemId: k === 0 ? L1 : null, libItemVersion: k === 0 ? 1n : null, price: M.emptyPrice() });
  const rs = await saveAll(calc, m);
  if (rs && "err" in rs) throw new Error(rs.err);
  const rd300 = ok(await calc.readQuoteVersion(q300.versionId));
  const big30 = [];
  for (let k = 0; k < 30; k++) big30.push(await orgOf(`Proef Groot ${k + 1} 2c3 ${suffix}`));
  const TB = ok(await calc.createTender({ ...tIn(), versionId: rd300.version.id, title: "Proef groot 2c3", lineIds: rd300.lines.map((l) => l.id), firms: big30.map((o) => ({ orgId: o, contactPersonId: [] })) }));
  const tb = ok(await calc.readTender(TB));
  for (const inv of tb.invites) {
    const ls = tb.items.map((x) => ({ itemId: [x.id], description: x.title, unit: x.unit, qtyMilli: x.qtyMilli, unitCents: [BigInt(100 + rnd(100_000))], included: Y, remark: "" }));
    ok(await calc.registerOaQuote({ inviteId: [inv.id], workId: W1, orgId: inv.orgId, source: { hand: null }, sheetKey: "", number: "G", quoteDay: today, validUntil: [], discountBp: [], reverse: true, prices: { lines: ls } , remark: "", note: "", file: [] }, totals(ls.map((l) => ({ itemId: 1n, qtyMilli: l.qtyMilli, unitCents: l.unitCents[0], included: Y })), null, () => "").net));
  }
  const t0 = Date.now();
  const vb = await calc.compareTender(TB);
  const ms = Date.now() - t0;
  check("(B9b) 300 posten × 30 firma's: één vergelijking (9.000 cellen) zonder grens te raken; browser = server", isOk(vb) && vb.ok.calc.cells.length === 9000 && sameCalc(vb.ok), `${ms} ms`);
} else console.log("· (B9b) ZONDER_GROOT: de grote vergelijking overgeslagen");

// B10. .did-controle: de stand van de werfleider en de OA draagt geen bedrag; bedragen enkel via update-calls.
{
  const did = readFileSync(join(import.meta.dirname, "../src/backend/dist/backend.did"), "utf8");
  const types = new Map([...did.matchAll(/^type (\w+) =([\s\S]*?);\n(?=type |service|$)/gm)].map((m) => [m[1], m[2]]));
  const fieldsOf = (n) => [...(types.get(n) ?? "").matchAll(/^\s+(\w+)\s*:/gm)].map((m) => m[1]);
  const views = ["TenderStatusView", "TenderPickView", "TenderInviteStatusView", "OaQuoteBrief", "MyTenderView", "MyTenderBrief", "TenderSettings"];
  const bad = views.flatMap((n) => fieldsOf(n).filter((f) => /cents|cost|margin|price|prijs|amount|bedrag|total|euro|discount/i.test(f)).map((f) => `${n}.${f}`));
  check("(B10) .did: TenderStatusView (met picks), TenderPickView, OaQuoteBrief, MyTender*: geen bedragveld", views.every((n) => types.has(n)) && bad.length === 0, bad.join(", ") || `${views.length} typen`);
  const svc = did.slice(did.indexOf("service"));
  const isQ = (fn) => new RegExp(`\\b${fn}\\s*:\\s*\\([^)]*\\)\\s*->\\s*\\([^)]*\\)\\s*query`).test(svc);
  check("(B10) bedragen enkel via update-calls (compareTender, registerOaQuote, saveTenderChoices, applyTenderChoices); listOaQuotes en tenderSettings zijn queries zonder bedrag", !isQ("compareTender") && !isQ("registerOaQuote") && !isQ("saveTenderChoices") && !isQ("applyTenderChoices") && isQ("listOaQuotes") && isQ("tenderSettings"));
}

// B11. Export: de keuzes zitten in de vertrouwelijke bewaarkopie.
const exC = ok(await admin.exportChunk("tenderChoices", 0n, 2000n));
check("(B11) export: de keuzes per post (vertrouwelijk) en de OA-offertes (intern)", (exC.tenderChoices ?? []).some(([k]) => k === it["Proef stopcontact"].id) && (await admin.exportIntern()).oaQuotes.some((x) => x.id === savL.oaQuoteId), Object.keys(exC).join());

console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
