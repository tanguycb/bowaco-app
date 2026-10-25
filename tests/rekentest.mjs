// Rekentests van de offerte (stap 2.5, bouwplan §9 rij 2.5): de rekenmodule van de browser (src/frontend/src/quote/calc.ts)
// en dezelfde regels in de backend (src/backend/lib/QuoteCalc.mo) naast elkaar.
//   node tests/rekentest.mjs                 A: de rekenmodule zelf (subtotalen, totaal, btw 6/21 %, marges, afronding op de
//                                            cent, opties, negatieve en nul-hoeveelheden) + de vier fouten van offerte 2026/231,
//                                            nagebouwd met VERZONNEN posten en bedragen (nooit echte prijzen in git)
//   node tests/rekentest.mjs <canister>      + B: dezelfde gevallen en N willekeurige offertes door de backend (bewaren met de
//                                            totalen van de browser: de server rekent na en moet hetzelfde vinden, per lijn en
//                                            per hoofdstuk). REKEN_N=<aantal> (standaard lokaal 200, op een draft 25).
// Het echte bestand 2026/231 wordt NOOIT hier gelezen: enkel lokaal met tools/rekentest-echt.py + tests/rekentest-echt.mjs
// (rapport buiten git).
import { C, M, batchArgs, expectRaw, fromRead, saveAll } from "./offerte-lib.mjs";
import { SELF_CASES, runSelfTest } from "../src/frontend/src/quote/selftest.ts";

const cid = process.argv[2];
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const eq = (a, b) => a === b;
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const S = (x) => JSON.stringify(x, big);
const L = (chapter, qtyMilli, cost, rule = null, kind = "item") => ({ chapter, kind, qtyMilli, cost, rule });
const STD = 2000n;

// ── A1. Afronden op de cent: half weg van nul, zoals Motoko (Int deelt afkappend naar nul) ──
check("(A1) roundDiv: 5/10 → 1, 4/10 → 0, 15/10 → 2 (half naar boven)", eq(C.roundDiv(5n, 10n), 1n) && eq(C.roundDiv(4n, 10n), 0n) && eq(C.roundDiv(15n, 10n), 2n));
check("(A1) roundDiv negatief: −5/10 → −1, −4/10 → 0, −15/10 → −2 (half weg van nul, symmetrisch)", eq(C.roundDiv(-5n, 10n), -1n) && eq(C.roundDiv(-4n, 10n), 0n) && eq(C.roundDiv(-15n, 10n), -2n));
check("(A1) roundDiv met een deler ≤ 0: fout", (() => { try { C.roundDiv(1n, 0n); return false; } catch { return true; } })());

// ── A2. Verkoopprijs per eenheid: marge op de VERKOOPprijs (20 % = aankoop / 0,8) ──
check("(A2) 45,00 aan 20 % → 56,25 (exact)", eq(C.unitSell(4500n, null, STD), 5625n));
check("(A2) 47,50 aan 20 % → 59,375 → 59,38 (op de cent)", eq(C.unitSell(4750n, null, STD), 5938n));
check("(A2) 12,34 aan 20 % → 15,425 → 15,43", eq(C.unitSell(1234n, null, STD), 1543n));
check("(A2) eigen marge 25 % → aankoop / 0,75 (18,00 → 24,00); 0 % → de aankoopprijs; 90 % → × 10", eq(C.unitSell(1800n, { margin: 2500n }, STD), 2400n) && eq(C.unitSell(1800n, { margin: 0n }, STD), 1800n) && eq(C.unitSell(1800n, { margin: 9000n }, STD), 18_000n));
check("(A2) marge van 100 %: geen prijs (geen deling door nul)", C.unitSell(1800n, { margin: 10_000n }, STD) === null);
check("(A2) vaste verkoopprijs: die prijs, met of zonder aankoopprijs", eq(C.unitSell(null, { price: 90_000n }, STD), 90_000n) && eq(C.unitSell(70_000n, { price: 90_000n }, STD), 90_000n));
check("(A2) marge zonder aankoopprijs: geen prijs (en dus gemarkeerd)", C.unitSell(null, null, STD) === null && C.calcLine(L("a", 1000n, null), STD).noPrice);

// ── A3. Lijnen: hoeveelheid × eenheidsprijs, op de cent; negatief = minwerk; 0 = pro memorie ──
const l1 = C.calcLine(L("a", 12_500n, 4500n), STD);
check("(A3) 12,5 lm × 56,25 = 703,125 → 703,13", eq(l1.lineSell, 70_313n) && eq(l1.unitSell, 5625n), S(l1));
check("(A3) aankoop van de lijn 12,5 × 45,00 = 562,50; marge 20 %", eq(l1.lineCost, 56_250n) && eq(l1.marginBp, 2000n));
const l2 = C.calcLine(L("a", -2_000n, 4500n), STD);
check("(A3) minwerk −2 lm × 56,25 = −112,50 (negatief, telt mee)", eq(l2.lineSell, -11_250n) && eq(l2.lineCost, -9000n));
check("(A3) −0,5 × 0,01 = −0,005 → −0,01 en +0,5 × 0,01 → +0,01 (symmetrisch)", eq(C.calcLine(L("a", -500n, null, { price: 1n }), STD).lineSell, -1n) && eq(C.calcLine(L("a", 500n, null, { price: 1n }), STD).lineSell, 1n));
check("(A3) hoeveelheid 0: bedrag 0, maar de prijs blijft zichtbaar", eq(C.calcLine(L("a", 0n, 12_345n), STD).lineSell, 0n) && eq(C.calcLine(L("a", 0n, 12_345n), STD).unitSell, 15_431n));
check("(A3) 0,001 eenheid × 0,01 → 0,00 (afronding, geen kommagetal in de data)", eq(C.calcLine(L("a", 1n, null, { price: 1n }), STD).lineSell, 0n));
check("(A3) tekstregel: nooit een bedrag, ook niet met een prijs", eq(C.calcLine(L("a", 5000n, 4500n, null, "text"), STD).lineSell, 0n) && !C.calcLine(L("a", 5000n, null, null, "text"), STD).noPrice);
const neg = C.calcLine(L("a", 1000n, 100_000n, { price: 90_000n }), STD);
check("(A3) vaste prijs onder de aankoopprijs: gemarkeerd, marge −11,11 %", neg.negative && neg.deviates && eq(neg.marginBp, -1111n), S(neg));
check("(A3) afwijkend: een andere marge of een vaste prijs; de standaard niet", C.calcLine(L("a", 1000n, 100n, { margin: 2500n }), STD).deviates && !C.calcLine(L("a", 1000n, 100n, { margin: 2000n }), STD).deviates && !C.calcLine(L("a", 1000n, 100n), STD).deviates);

// ── A4. Hoofdstukken, totaal, btw 6/21 %, opties, marges ──
const lines4 = [L("h1", 1000n, null, { price: 90_000n }), L("h2", 12_500n, 4500n), L("h2", 4000n, 6250n, { margin: 2500n }), L("h2", -2000n, 4500n), L("h2", 12_500n, 800n, null, "option"), L("h2", -4000n, 4500n, null, "option"), L("h3", 50_000n, 1800n), L("h3", 0n, 310n), L("h1", 0n, null, null, "text")];
const t6 = C.calcTotals(["h1", "h2", "h3"], lines4, 600n, STD);
check("(A4) subtotaal per hoofdstuk: 900,00 · 923,95 · 1.125,00", eq(t6.chapters[0].sell, 90_000n) && eq(t6.chapters[1].sell, 92_395n) && eq(t6.chapters[2].sell, 112_500n), S(t6.chapters.map((c) => c.sell)));
check("(A4) subtotaal = som van de hoofdstukken = 2.948,95", eq(t6.subtotal, 294_895n) && eq(t6.subtotal, t6.chapters.reduce((a, c) => a + c.sell, 0n)));
check("(A4) btw 6 %: 2.948,95 × 0,06 = 176,937 → 176,94; totaal 3.125,89", eq(t6.vat, 17_694n) && eq(t6.total, 312_589n));
const t21 = C.calcTotals(["h1", "h2", "h3"], lines4, 2100n, STD);
check("(A4) btw 21 %: 2.948,95 × 0,21 = 619,2795 → 619,28; totaal 3.568,23", eq(t21.vat, 61_928n) && eq(t21.total, 356_823n));
check("(A4) opties NIET in het totaal: meerprijs +125,00 en minprijs −225,00 apart", eq(t6.optionsPlus, 12_500n) && eq(t6.optionsMinus, -22_500n) && eq(t6.subtotal, 294_895n));
check("(A4) marge: aankoop 1.622,50 tegenover 2.048,95 verkoop van de posten met een aankoopprijs …", eq(t6.cost, 56_250n + 25_000n - 9000n + 90_000n + 0n) && eq(t6.sellWithCost, 70_313n + 33_332n - 11_250n + 112_500n + 0n), `${t6.cost} / ${t6.sellWithCost}`);
check("(A4) … marge = verkoop − aankoop, % op de verkoopprijs; de vaste prijs zonder aankoop apart (900,00)", eq(t6.margin, t6.sellWithCost - t6.cost) && eq(t6.marginBp, C.roundDiv(t6.margin * 10_000n, t6.sellWithCost)) && eq(t6.sellWithoutCost, 90_000n));
check("(A4) tellers: geen lijn zonder prijs, 2 afwijkend, 0 onder aankoop", t6.noPrice === 0 && t6.deviating === 2 && t6.negative === 0, `${t6.noPrice}/${t6.deviating}/${t6.negative}`);
check("(A4) een lijn in een onbekend hoofdstuk valt NIET stil buiten het totaal: fout", (() => { try { C.calcTotals(["h1"], [L("h9", 1000n, 100n)], 600n, STD); return false; } catch { return true; } })());
check("(A4) lege offerte: alles 0, geen marge-%", (() => { const t = C.calcTotals([], [], 2100n, STD); return t.total === 0n && t.marginBp === null; })());
const tNeg = C.calcTotals(["h"], [L("h", -1000n, null, { price: 33_333n })], 2100n, STD);
check("(A4) negatief subtotaal (creditnota-achtig): btw ook negatief en symmetrisch afgerond", eq(tNeg.subtotal, -33_333n) && eq(tNeg.vat, -7000n) && eq(tNeg.total, -40_333n), S([tNeg.subtotal, tNeg.vat]));

// ── A5. De fouten van offerte 2026/231 (architectuur §1.3), nagebouwd met VERZONNEN posten en bedragen ──
// Een "spreadsheet" zoals de Excel: rijen met hoeveelheid, eenheidsprijs en een kolom F met het totaal (meestal = qty ×
// prijs, één keer GETYPT); hoofdstuksommen en het subtotaal als SUM over een rijbereik. Alles hieronder is verzonnen.
const sheet = (() => {
  const chapters = [["00", "Proef algemeen"], ["01", "Proef werfinrichting"], ["02", "Proef afbraak"], ["03", "Proef grondwerk"], ["04", "Proef riolering"], ["05", "Proef bovenbouw"], ["06", "Proef stabiliteit"], ["07", "Proef dak"], ["08", "Proef buitenschrijnwerk"], ["09", "Proef elektriciteit"], ["09", "Proef sanitair"], ["09", "Proef ventilatie"], ["10", "Proef pleister"], ["10", "Proef vloerisolatie"], ["10", "Proef chape"], ["10", "Proef parket"], ["10", "Proef tegels"], ["10", "Proef binnenschrijnwerk"], ["11", "Proef buitenaanleg"]];
  let row = 22;
  const out = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed; };
  for (const [i, [code, title]] of chapters.entries()) {
    const head = row++;
    const rows = [];
    const n = 3 + (i % 4);
    for (let k = 0; k < n; k++) {
      const qty = BigInt(1000 + (rnd() % 40) * 500); // 1 tot 20,5
      const price = BigInt(1000 + (rnd() % 900) * 100); // € 10 tot € 909 per eenheid (verkoop, vaste prijs)
      rows.push({ row: row++, qty, price, typed: null });
    }
    out.push({ code, title, head, rows });
  }
  // Fout 4 (rij 58 in de echte offerte): 1 × € 450 met een GETYPT totaal van € 350, in het hoofdstuk werfinrichting.
  out[1].rows[0] = { ...out[1].rows[0], qty: 1000n, price: 45_000n, typed: 35_000n };
  return out;
})();
const F = (r) => (r.typed ?? (r.qty * r.price) / 1000n); // de Excel: F = qty × prijs, tenzij getypt
const rowsAll = sheet.flatMap((c) => c.rows);
const sumRange = (a, b) => rowsAll.filter((r) => r.row >= a && r.row <= b).reduce((s, r) => s + F(r), 0n);
const ch = (code, titlePart) => sheet.find((c) => c.code === code && c.title.includes(titlePart));
const c02 = ch("02", "afbraak");
const c03 = ch("03", "grondwerk");
const c10b = ch("10", "binnenschrijnwerk");
const c11 = ch("11", "buitenaanleg");
// Fout 1: het subtotaal =SUM(F22:F<eerste post van 11>) stopt te vroeg: hoofdstuk 11 ontbreekt op één post na.
const sheetSubtotal = sumRange(22, c11.rows[0].row);
// Fout 2: de som van hoofdstuk 02 loopt door tot het einde van 03.
const sheet02 = sumRange(c02.rows[0].row, c03.rows.at(-1).row);
// Fout 3: de som van 10-binnenschrijnwerk telt de eerste post van 11 (een tuinpost) mee.
const sheet10b = sumRange(c10b.rows[0].row, c11.rows[0].row);
// Dezelfde posten in de app: hoeveelheid + (vaste) prijs per eenheid; het totaal wordt NOOIT getypt.
const keyOf = (c) => `${c.code}-${c.head}`;
const appLines = sheet.flatMap((c) => c.rows.map((r) => L(keyOf(c), r.qty, null, { price: r.price })));
const tApp = C.calcTotals(sheet.map(keyOf), appLines, 600n, STD);
const own = (c) => c.rows.reduce((s, r) => s + (r.qty * r.price) / 1000n, 0n);
const missing11 = c11.rows.slice(1).reduce((s, r) => s + (r.qty * r.price) / 1000n, 0n);
check("(A5) 2026/231 fout 1 — het subtotaal stopt bij een rij: de app telt ALLE hoofdstukken (ook 11)", eq(tApp.subtotal, sheet.reduce((s, c) => s + own(c), 0n)) && tApp.subtotal !== sheetSubtotal && eq(tApp.chapters.at(-1).sell, own(c11)));
check("(A5) … het verschil is precies hoofdstuk 11 zonder zijn eerste post + de getypte € 100 te weinig", eq(tApp.subtotal - sheetSubtotal, missing11 + 10_000n), `${tApp.subtotal - sheetSubtotal} = ${missing11} + 10000`);
check("(A5) 2026/231 fout 2 — de som van 02 telt 03 mee: de app geeft 02 en 03 elk hun eigen posten", eq(tApp.chapters[sheet.indexOf(c02)].sell, own(c02)) && eq(tApp.chapters[sheet.indexOf(c03)].sell, own(c03)) && sheet02 === own(c02) + own(c03) && sheet02 !== own(c02));
check("(A5) 2026/231 fout 3 — 10-binnenschrijnwerk telt een tuinpost mee: in de app hoort die bij 11", eq(tApp.chapters[sheet.indexOf(c10b)].sell, own(c10b)) && sheet10b === own(c10b) + (c11.rows[0].qty * c11.rows[0].price) / 1000n);
const r58 = C.calcLine(L("x", 1000n, null, { price: 45_000n }), STD);
check("(A5) 2026/231 fout 4 — 1 × € 450 met een getypt totaal € 350: de app rekent 450,00; een lijn HEEFT geen totaalveld", eq(r58.lineSell, 45_000n) && !Object.keys(M.addLine(M.load({ versionId: 0n, rev: 0n, header: { title: "", vatBp: 600n, clientOrgId: null, validDays: 30n, intro: "", note: "", standardMarginBp: STD }, chapters: [], lines: [] }), "x", {})).some((k) => /total|totaal|amount|bedrag/i.test(k)));
check("(A5) subtotaal van de app = som van de hoofdstukken (nooit een apart bereik)", eq(tApp.subtotal, tApp.chapters.reduce((s, c) => s + c.sell, 0n)));

// ── A6. De rekentest die de editor in de browser draait (quote/selftest.ts), hier in Node ──
const self = runSelfTest();
check(`(A6) de zelftest van de browser: ${SELF_CASES.length} vaste gevallen slagen`, self.failed.length === 0 && self.passed === SELF_CASES.length, self.failed.join(" | "));

// ── B. Dezelfde regels in de backend ────────────────────────────────
if (cid) {
  const { backend } = await import("../tools/lib.mjs");
  const host = process.env.ICP_HOST || "https://icp-api.io";
  const local = host.includes("localhost") || host.includes("127.0.0.1");
  const N = Number(process.env.REKEN_N || (local ? 200 : 25));
  const calc = await backend("proef-calculator", cid);
  const admin = await backend("proef-admin", cid);
  const ok = (r) => { if (r && "err" in r) throw new Error(r.err); return r.ok; };
  const A = (await admin.listWorks()).find((w) => w.code === "P-A");
  if (!A) throw new Error("werf P-A ontbreekt: eerst tests/rollen.mjs (lokaal) of tools/draft-opbouw.mjs (draft)");
  // Eén vaste proefofferte (verzonnen), telkens een nieuw ontwerp als het vorige verstuurd is.
  const NR = "PROEF-REKENTEST";
  let q = (await calc.listQuotes([A.id], true)).find((x) => x.number === NR);
  if (!q) { ok(await calc.createQuote({ workId: A.id, number: NR, title: "Proef rekentest 2.5 (verzonnen)" })); q = (await calc.listQuotes([A.id], true)).find((x) => x.number === NR); }
  if (q.archived) ok(await calc.setQuoteArchived(q.id, false, ""));
  let d = q.versions.find((v) => "draft" in v.status);
  if (!d) { ok(await calc.newQuoteVersion(q.id, [])); d = (await calc.listQuotes([A.id], true)).find((x) => x.number === NR).versions[0]; }
  const vid = d.id;
  const units = ["st", "m2", "lm", "m3", "sog", "u"];
  // Een versie volledig vervangen door een gegeven inhoud (zoals de browser), bewaren, en terug inlezen.
  const replace = async (chapters, lines, vatBp, std) => {
    const m = fromRead(ok(await calc.readQuoteVersion(vid)));
    for (const l of [...m.lines]) M.removeLine(m, l.key);
    for (const c of [...m.chapters]) M.removeChapter(m, c.key);
    M.setHeader(m, { vatBp, standardMarginBp: std });
    const keys = new Map();
    for (const [i, c] of chapters.entries()) keys.set(c, M.addChapter(m, { code: String(i).padStart(2, "0"), title: `Proef ${c}` }).key);
    for (const [i, l] of lines.entries()) M.addLine(m, keys.get(l.chapter), { kind: l.kind, title: `Proef lijn ${i}`, qtyMilli: l.qtyMilli, unit: l.kind === "text" ? "" : units[i % units.length], form: "vh", price: { cost: l.kind === "text" ? null : l.cost, rule: l.kind === "text" ? null : l.rule, reason: l.rule ? "proef" : "", orgId: null, source: l.cost === null ? "" : "eigen", libCostId: null } });
    const r = await saveAll(calc, m);
    return { m, r };
  };
  const sameLines = (read, m) => {
    const std = m.header.standardMarginBp;
    const sells = new Map(read.sell.map((s) => [s.lineId, s]));
    const costs = new Map(read.costs.map((s) => [s.lineId, s]));
    return M.activeLines(m).every((l) => {
      const o = M.lineOut(m, l);
      const s = sells.get(l.id);
      const c = costs.get(l.id);
      return s && c && (s.unitSellCents[0] ?? null) === o.unitSell && s.lineSellCents === o.lineSell && (c.lineCostCents[0] ?? null) === o.lineCost && (c.marginBp[0] ?? null) === o.marginBp && c.noPrice === o.noPrice && c.deviates === o.deviates && c.negative === o.negative;
    }) && std === std;
  };
  const sameTot = (read, m) => {
    const t = M.totals(m);
    const byKey = new Map(M.activeChapters(m).map((c, i) => [c.id, t.chapters[i].sell]));
    return read.totals.subtotalCents === t.subtotal && read.totals.vatCents === t.vat && read.totals.totalCents === t.total && read.totals.optionsPlusCents === t.optionsPlus && read.totals.optionsMinusCents === t.optionsMinus && read.margins[0].costCents === t.cost && read.margins[0].marginCents === t.margin && (read.margins[0].marginBp[0] ?? null) === t.marginBp && read.totals.chapters.every((c) => byKey.get(c.chapterId) === c.sellCents);
  };
  // B1. De vaste gevallen van A4 door de backend
  {
    const { m, r } = await replace(["h1", "h2", "h3"], lines4, 600n, STD);
    const read = ok(await calc.readQuoteVersion(vid));
    check("(B1) de gevallen van A4 door de backend: zelfde totalen (btw 6 %), zelfde lijnen", "ok" in r && sameTot(read, m) && sameLines(read, m) && read.totals.totalCents === 312_589n, "err" in r ? r.err : "");
  }
  // B2. De nagebouwde offerte 2026/231 (verzonnen) door de backend, en het getypte totaal van "rij 58"
  {
    const { m, r } = await replace(sheet.map(keyOf), appLines, 600n, STD);
    const read = ok(await calc.readQuoteVersion(vid));
    check("(B2) nagebouwde 2026/231: de server vindt het juiste subtotaal (alle hoofdstukken, geen dubbels)", "ok" in r && read.totals.subtotalCents === tApp.subtotal && sameTot(read, m), `${read.totals.subtotalCents} / ${tApp.subtotal}`);
    const x = fromRead(read);
    const l58 = x.lines.find((l) => l.price.rule && "price" in l.price.rule && l.price.rule.price === 45_000n && l.qtyMilli === 1000n);
    M.updateLine(x, l58.key, { qtyMilli: 2000n });
    const b = M.nextBatch(x);
    const args = batchArgs(x, b);
    const typed = b.expect.subtotal - 2n * 45_000n + 35_000n + 45_000n; // de browser "zou" 350 typen i.p.v. 450 te rekenen
    args[5] = expectRaw({ ...b.expect, subtotal: typed, vat: C.roundDiv(typed * 600n, 10_000n), total: typed + C.roundDiv(typed * 600n, 10_000n) });
    const rr = await calc.saveQuoteDraft(...args);
    check("(B2) een getypt totaal (€ 350 voor 1 × € 450): de server weigert en bewaart niets", "err" in rr && /verschillen/.test(rr.err) && ok(await calc.readQuoteVersion(vid)).totals.subtotalCents === tApp.subtotal);
  }
  // B3. Willekeurige offertes: browser en server moeten tot op de cent hetzelfde vinden.
  let seed = Number(process.env.REKEN_SEED || 20261025);
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const pick = (xs) => xs[rnd(xs.length)];
  let bad = 0;
  let firstBad = "";
  const t0 = Date.now();
  for (let k = 0; k < N; k++) {
    const nch = 1 + rnd(6);
    const chs = Array.from({ length: nch }, (_, i) => `c${i}`);
    const nl = rnd(30);
    const lines = Array.from({ length: nl }, () => {
      const kind = pick(["item", "item", "item", "item", "option", "text"]);
      const qty = BigInt(pick([0, 1, 500, 1000, 1250, 3333, 7260, 18600, 100000, -1000, -2500, rnd(2_000_000) - 200_000]));
      const cost = pick([null, 0n, 1n, 99n, 1234n, 4500n, 4750n, 33_333n, BigInt(rnd(500_000))]);
      const rule = pick([null, null, null, { margin: BigInt(pick([0, 1500, 2000, 2500, 3333, 9000])) }, { price: BigInt(pick([1, 4500, 90_000, rnd(1_000_000)])) }]);
      return { chapter: pick(chs), kind, qtyMilli: qty, cost, rule };
    });
    const vat = BigInt(pick([600, 2100]));
    const std = BigInt(pick([2000, 2000, 1500, 0, 3500]));
    const { m, r } = await replace(chs, lines, vat, std);
    let good = "ok" in r;
    if (good) {
      const read = ok(await calc.readQuoteVersion(vid));
      good = sameTot(read, m) && sameLines(read, m);
    }
    if (!good) { bad++; if (!firstBad) firstBad = `geval ${k}: ${"err" in r ? r.err : "verschil bij het teruglezen"}`; }
  }
  check(`(B3) ${N} willekeurige offertes (hoofdstukken, posten, opties, tekst, minwerk, VH 0, marges, vaste prijzen, btw 6/21 %): browser = server tot op de cent`, bad === 0, bad ? `${bad} verschillen; ${firstBad}` : `${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
