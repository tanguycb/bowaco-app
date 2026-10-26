// Offerte-editor (2.4) op een canister die al in gebruik is (een draft). Zet enkel VERZONNEN testgegevens: een offerte
// "Proef offerte (draftproef 2.4)" op de proefwerf P-A met proefposten en proefprijzen (nooit een echte prijs of klant),
// en archiveert ze op het einde. Gebruikt de testidentiteiten en P-A van tests/rollen.mjs (of tools/draft-opbouw.mjs) en
// de proefpost "proef-2.2:goot" van tests/posten-draft.mjs.
// Bewijst vooral: aankoopprijzen en marges gaan NOOIT naar werfleider, OA, architect, klant of veiligheidscoördinator; de
// werfleider ziet hoeveelheden en hoofdstuktotalen, geen prijs per lijn; de browser en de backend rekenen hetzelfde; een
// verkeerd totaal wordt geweigerd zonder iets te bewaren; een verzonden versie is onwijzigbaar.
//   node tests/offerte-draft.mjs <canister-id>
import { backend } from "../tools/lib.mjs";
import { C, M, batchArgs, ensureProofClientAddress, expectRaw, fromRead, opt, sameTotals, saveAll, tag, unopt } from "./offerte-lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/offerte-draft.mjs <canister-id>");
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const rejects = async (p) => { try { await p; return false; } catch { return true; } };
const denied = async (p) => { try { const r = await p; return !!(r && "err" in r && /^Geen toegang/.test(r.err)); } catch { return true; } };
const isOk = (r) => r && typeof r === "object" && "ok" in r;
const ok = (r) => { if (r && "err" in r) throw new Error(r.err); return r.ok; };
const errOf = (r) => (r && "err" in r ? r.err : "");
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
// Enkel de teksten en de getallen als tekst (om te zoeken naar een bedrag dat er niet mag staan).
const flat = (x) => JSON.stringify(x, (k, v) => (typeof v === "bigint" ? v.toString() : v));

const [admin, wl, calc, arch, oa2, klant, vc] = await Promise.all(["proef-admin", "proef-werfleider", "proef-calculator", "proef-architect", "proef-oa2", "proef-klant", "proef-vc"].map((n) => backend(n, cid)));
const me = await admin.me();
await ensureProofClientAddress(admin); // 2.6
check("versie 2.4 of later op de canister", /^2\.([4-9]|1\d)|^(2b|[3-9])\./.test(me.version), me.version);
const works = await admin.listWorks();
const A = works.find((w) => w.code === "P-A");
if (!A) throw new Error("werf P-A ontbreekt: eerst tests/rollen.mjs (lokaal) of tools/draft-opbouw.mjs (draft)");
const lib = await calc.listLibrary({ text: "Proef", chapterId: [], trade: [], unit: [], form: [], orgId: [], includeArchived: false, offset: 0n, limit: 200n });
const goot = lib.items.find((x) => x.importKey[0] === "proef-2.2:goot");
if (!goot) throw new Error("proefpost proef-2.2:goot ontbreekt: eerst tests/posten-draft.mjs");
const gootPrice = ok(await calc.readLibraryPrices([goot.id])).prices[0];
const dak = (await admin.listOrgs(false)).find((o) => o.name === "Proef Dak NV");

// ── Maken ─────────────────────────────────────────────────────────────
const created = await calc.createQuote({ workId: A.id, number: "", title: "Proef offerte (draftproef 2.4)" });
check("calculator maakt een offerte op P-A (nummer van dit jaar)", isOk(created) && /^\d{4}\/\d{3,}$/.test(created.ok.number), errOf(created) || created.ok.number);
const { quoteId, versionId } = created.ok;
check("werfleider kan geen offerte maken", await denied(wl.createQuote({ workId: A.id, number: "", title: "x" })));
const r0 = ok(await calc.readQuoteVersion(versionId));
check("versie 1 is een ontwerp met het btw-tarief en de klant van de werf", "full" in r0.scope && "draft" in r0.version.status && r0.version.editable && r0.version.vatBp === A.vatBp && r0.version.clientName === "Familie Proef", JSON.stringify({ vat: r0.version.vatBp, client: r0.version.clientName }, big));
check("standaardmarge van de versie = die van de bibliotheek (20 %)", unopt(r0.margins)?.standardMarginBp === 2000n);

// ── Invullen zoals de browser: hoofdstukken, posten uit de bibliotheek en vrij, tekst, opties, minwerk, VH 0 ──
const m = fromRead(r0);
const h1 = M.addChapter(m, { code: "01", title: "Proef werfinrichting" });
const h7 = M.addChapter(m, { code: "07", title: "Proef dakwerken" });
const price = (cost, rule = null, reason = "", extra = {}) => ({ cost, rule, reason, orgId: null, source: cost === null ? "" : "eigen", libCostId: null, ...extra });
M.addLine(m, h1.key, { title: "Proef werfinrichting", text: "Verzonnen (draftproef 2.4)", qtyMilli: 1000n, unit: "sog", form: "fixed", price: price(null, { price: 90_000n }, "proef: eigen prestatie") });
M.addLine(m, h1.key, { kind: "text", title: "Proef: alle werken volgens lastenboek (tekstregel)", unit: "" });
const lGoot = M.addLine(m, h7.key, { title: goot.title, text: goot.text, qtyMilli: 12_500n, unit: goot.unit, form: tag(goot.form), libItemId: goot.id, libItemVersion: goot.version, price: { cost: unopt(gootPrice.cost)?.costCents[0] ?? null, rule: null, reason: "", orgId: unopt(gootPrice.cost)?.orgId[0] ?? null, source: "bibliotheek", libCostId: unopt(gootPrice.cost)?.id ?? null } });
M.addLine(m, h7.key, { title: "Proef chape (eigen marge)", qtyMilli: 30_000n, unit: "m2", form: "vh", price: price(1800n, { margin: 2500n }, "proef: kleine oppervlakte") });
M.addLine(m, h7.key, { title: "Proef minwerk: bestaande goot hergebruiken", qtyMilli: -2_000n, unit: "lm", form: "vh", price: price(4500n) });
M.addLine(m, h7.key, { title: "Proef pro memorie (VH 0)", qtyMilli: 0n, unit: "st", form: "vh", price: price(12_345n) });
M.addLine(m, h7.key, { kind: "option", title: "Proef optie: zinken kraal (meerprijs)", qtyMilli: 12_500n, unit: "lm", form: "fixed", price: price(800n) });
M.addLine(m, h7.key, { kind: "option", title: "Proef optie: geen bakgoot achteraan (minprijs)", qtyMilli: -4_000n, unit: "lm", form: "fixed", price: price(4500n) });
const before = M.totals(m);
check("model: opties tellen niet mee, minwerk wel", before.optionsPlus > 0n && before.optionsMinus < 0n && before.subtotal === before.chapters.reduce((a, c) => a + c.sell, 0n));

// Een verkeerd totaal (1 cent): de backend weigert en bewaart niets.
const b0 = M.nextBatch(m);
const wrong = batchArgs(m, b0);
wrong[5] = expectRaw({ ...b0.expect, subtotal: b0.expect.subtotal + 1n, total: b0.expect.total + 1n });
const rw = await calc.saveQuoteDraft(...wrong);
check("verkeerd subtotaal (1 cent) van de browser: geweigerd", /verschillen/.test(errOf(rw)), errOf(rw).slice(0, 160));
const rAfterWrong = ok(await calc.readQuoteVersion(versionId));
check("… en er is niets bewaard (geen lijnen, stand 0)", rAfterWrong.lines.length === 0 && rAfterWrong.version.rev === 0n);
const tooMany = batchArgs(m, b0);
tooMany[5] = expectRaw({ ...b0.expect, chapters: b0.expect.chapters.slice(1) });
check("een hoofdstuk te weinig in de verwachte totalen: geweigerd", /verschillen/.test(errOf(await calc.saveQuoteDraft(...tooMany))));

const s1 = await saveAll(calc, m);
check("bewaren in stukken: de backend vindt dezelfde totalen", isOk(s1) && sameTotals(m, s1.ok.totals, s1.ok.margins), errOf(s1).slice(0, 200));
const r1 = ok(await calc.readQuoteVersion(versionId));
const m1 = fromRead(r1);
check("opnieuw gelezen: 2 hoofdstukken, 8 lijnen, zelfde totalen in browser en backend", r1.chapters.length === 2 && r1.lines.length === 8 && sameTotals(m1, r1.totals, unopt(r1.margins)), JSON.stringify(r1.totals, big).slice(0, 200));
const sellOf = (r, title) => r.sell.find((s) => s.lineId === r.lines.find((l) => l.title === title)?.id);
const costOf = (r, title) => r.costs.find((s) => s.lineId === r.lines.find((l) => l.title === title)?.id);
check("goot uit de bibliotheek: 45,00 + 20 % = 56,25 × 12,5 lm = 703,13", unopt(sellOf(r1, goot.title)?.unitSellCents) === 5625n && sellOf(r1, goot.title)?.lineSellCents === 70_313n, flat(sellOf(r1, goot.title)));
check("eigen marge 25 % gemarkeerd (afwijkend), vaste prijs ook", costOf(r1, "Proef chape (eigen marge)")?.deviates === true && costOf(r1, "Proef werfinrichting")?.deviates === true && costOf(r1, goot.title)?.deviates === false);
check("minwerk telt negatief, VH 0 telt 0, tekstregel zonder bedrag", sellOf(r1, "Proef minwerk: bestaande goot hergebruiken")?.lineSellCents === -11_250n && sellOf(r1, "Proef pro memorie (VH 0)")?.lineSellCents === 0n && sellOf(r1, "Proef: alle werken volgens lastenboek (tekstregel)")?.lineSellCents === 0n);
check("btw = subtotaal × tarief van de werf, afgerond op de cent", r1.totals.vatCents === C.roundDiv(r1.totals.subtotalCents * A.vatBp, 10_000n));

// Stand: geen stil overschrijven
const stale = M.nextBatch((() => { const x = fromRead(r0); M.addChapter(x, { title: "Proef laat" }); return x; })());
check("bewaren met een oude stand: geweigerd", /intussen/.test(errOf(await calc.saveQuoteDraft(...batchArgs({ ...m1, rev: 0n }, stale)))));

// ── Wie ziet wat (R20, R21, V7) ─────────────────────────────────────
const rWl = await wl.readQuoteVersion(versionId);
check("werfleider leest de offerte: scope 'totals'", isOk(rWl) && "totals" in rWl.ok.scope, errOf(rWl));
if (isOk(rWl)) {
  const w = rWl.ok;
  check("werfleider: hoeveelheden en hoofdstuktotalen, totaal", w.lines.length === 8 && w.lines.some((l) => l.qtyMilli === 12_500n) && w.totals.chapters.length === 2 && w.totals.totalCents === r1.totals.totalCents);
  check("werfleider: GEEN prijs per lijn, GEEN aankoopprijs, GEEN marge", w.sell.length === 0 && w.costs.length === 0 && w.margins.length === 0);
  const txt = flat({ lines: w.lines, chapters: w.chapters, version: w.version });
  check("werfleider: geen aankoopprijs of eenheidsprijs in de tekst (4500, 1800, 5625, 2250, 90000)", !/\b(4500|1800|5625|2250|90000|12345)\b/.test(txt));
}
const archA = await arch.readQuoteVersion(versionId).catch((e) => ({ trap: String(e) }));
check("architect: zonder de grant geen toegang; met de grant enkel verkoopprijzen (nooit aankoop of marge)", isOk(archA) ? "sell" in archA.ok.scope && archA.ok.costs.length === 0 && archA.ok.margins.length === 0 : "trap" in archA && /Geen toegang/.test(archA.trap), isOk(archA) ? "met grant" : "zonder grant: geweigerd");
for (const [n, x] of [["OA", oa2], ["klant", klant], ["veiligheidscoördinator", vc]]) {
  const rs = await Promise.all([x.readQuoteVersion(versionId), x.listQuotes([A.id], false), x.listQuotes([], false), x.saveQuoteDraft(...batchArgs(m1, stale)), x.sendQuoteVersion(versionId, 0n, 0n, "proef: regels"), x.exportChunk("quotePrices", 0n, 1n)].map(denied));
  check(`${n}: geen enkele offertefunctie (6 oproepen geweigerd)`, rs.every(Boolean), rs.map((r) => (r ? "·" : "✗")).join(""));
}
const wlList = await wl.listQuotes([A.id], false);
check("werfleider ziet de offerte in de lijst van de werf, zonder bedrag", wlList.some((q) => q.id === quoteId) && !/subtotal|Cents|cost|marg/i.test(Object.keys(wlList[0]).join() + Object.keys(wlList[0].versions[0]).join()));
check("werfleider: bewaren, versturen, nieuwe versie, archiveren geweigerd", (await Promise.all([wl.saveQuoteDraft(...batchArgs(m1, stale)), wl.sendQuoteVersion(versionId, 0n, 0n, "proef: regels"), wl.newQuoteVersion(quoteId, []), wl.setQuoteArchived(quoteId, true, "x"), wl.exportChunk("quotePrices", 0n, 1n)].map(denied))).every(Boolean));
check("caps: werfleider ziet offertes maar geen prijzen; calculator wel", (await wl.me()).caps[0].quotes && !(await wl.me()).caps[0].quotePrices && (await calc.me()).caps[0].quotePrices && (await calc.me()).caps[0].editQuotes);

// ── Versturen: onwijzigbaar (bouwplan §4) ───────────────────────────
const sent = await calc.sendQuoteVersion(versionId, r1.version.rev, r1.totals.totalCents, "proef: regels");
check("versturen: hash van de inhoud", isOk(sent) && /^[0-9a-f]{64}$/.test(sent.ok), errOf(sent));
const rS = ok(await calc.readQuoteVersion(versionId));
check("verzonden versie: status verstuurd, niet te bewerken, hash klopt (intact)", "sent" in rS.version.status && !rS.version.editable && rS.version.intact && rS.version.hash === sent.ok);
const mS = fromRead(rS);
M.updateLine(mS, mS.lines[0].key, { qtyMilli: 2000n });
const late = await calc.saveQuoteDraft(...batchArgs(mS, M.nextBatch(mS)));
check("verzonden versie bewerken: geweigerd", /kan niet meer veranderen/.test(errOf(late)), errOf(late));
check("tweede keer versturen: geweigerd", "err" in (await calc.sendQuoteVersion(versionId, rS.version.rev, rS.totals.totalCents, "proef: regels")));
const rS2 = ok(await calc.readQuoteVersion(versionId));
check("… en de inhoud is ongewijzigd (zelfde totaal en hash)", rS2.totals.totalCents === r1.totals.totalCents && rS2.version.hash === sent.ok);

// ── Verder werken = nieuwe versie ───────────────────────────────────
const v2 = await calc.newQuoteVersion(quoteId, []);
check("nieuwe versie (v2) als kopie", isOk(v2), errOf(v2));
check("tweede ontwerp naast v2: geweigerd", /al een ontwerp/.test(errOf(await calc.newQuoteVersion(quoteId, []))));
const r2 = ok(await calc.readQuoteVersion(v2.ok));
check("v2: ontwerp, zelfde lijnen en prijzen, gebaseerd op v1", "draft" in r2.version.status && r2.version.version === 2n && unopt(r2.version.basedOnVersion) === 1n && r2.lines.length === 8 && r2.totals.totalCents === r1.totals.totalCents && r2.lines.every((l) => l.copiedFrom.length === 1));
const m2 = fromRead(r2);
const g2 = m2.lines.find((l) => l.title === goot.title);
M.updateLine(m2, g2.key, { qtyMilli: 15_000n });
M.removeLine(m2, m2.lines.find((l) => l.title === "Proef pro memorie (VH 0)").key);
const s2 = await saveAll(calc, m2);
check("v2 aanpassen (VH goot 15 lm, één lijn weg): totalen gelijk in browser en backend", isOk(s2) && sameTotals(m2, s2.ok.totals, s2.ok.margins), errOf(s2).slice(0, 200));
const r1b = ok(await calc.readQuoteVersion(versionId));
check("v1 blijft zoals verstuurd", r1b.lines.length === 8 && r1b.totals.totalCents === r1.totals.totalCents && r1b.version.intact);
const r2b = ok(await calc.readQuoteVersion(v2.ok));
check("v2 versturen → v1 'vervangen'; v2 aanvaarden", isOk(await calc.sendQuoteVersion(v2.ok, r2b.version.rev, r2b.totals.totalCents, "proef: regels")) && "superseded" in ok(await calc.readQuoteVersion(versionId)).version.status && isOk(await calc.decideQuoteVersion(v2.ok, true, "proef: akkoord per mail")) && "accepted" in ok(await calc.readQuoteVersion(v2.ok)).version.status);
check("een aanvaarde versie kan niet opnieuw beslist of bewerkt worden", "err" in (await calc.decideQuoteVersion(v2.ok, false, "")) && /kan niet meer veranderen/.test(errOf(await calc.saveQuoteDraft(...batchArgs({ ...fromRead(r2b), versionId: v2.ok }, stale)))));

// 2.8 (P-08): een proefofferte wordt geen werf: het voorstel "Werf starten" meteen afwijzen (anders staat het bij elke run open).
if ("dismissWorkStart" in admin) await admin.dismissWorkStart(v2.ok, "draftproef 2.4: proefofferte, geen werf").catch(() => {});

// ── Auditlog: wie bekeek, nooit een bedrag ──────────────────────────
const log = await admin.auditLog(0n, 300n);
const mine = log.filter((e) => /offerte/.test(e.action) && (e.detail.includes(created.ok.number) || e.detail.startsWith(`offerte #${quoteId} `)));
check("auditlog: 'bekeek:offerteprijzen' (calculator) en 'bekeek:offerte' (werfleider)", mine.some((e) => e.action === "bekeek:offerteprijzen") && mine.some((e) => e.action === "bekeek:offerte"));
check("auditlog: gemaakt, bewaard, verstuurd, nieuwe versie, aanvaard; nooit een bedrag", ["offerte-gemaakt", "offerte-bewaard", "offerte-verstuurd", "offerte-nieuwe-versie", "offerte-aanvaard"].every((a) => log.some((e) => e.action === a)) && !mine.some((e) => /\b(4500|1800|5625|70313|90000)\b|€/.test(e.detail)));

// ── Opruimen ────────────────────────────────────────────────────────
// Sinds 2.7 kan een offerte met een aanvaarde versie niet meer gearchiveerd worden (de proefofferte blijft dus staan).
check("een offerte met een aanvaarde versie archiveren: geweigerd (2.7)", /aanvaarde versie/.test(errOf(await calc.setQuoteArchived(quoteId, true, "draftproef 2.4"))));
console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
