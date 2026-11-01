// Afspraken met de gekozen OA (stap 2c.4, ontwerp 2c §4.4, §8 R40, §10; ⚖9, ⚖11, AC-15, AC-16, AC-17).
//   node tests/afspraak-2c4.mjs                A: de contract-PDF (lange tekst, veel posten, controlecode in de voet), zonder netwerk
//   node tests/afspraak-2c4.mjs <canister>     + B: door de backend: tarief per firma met datum (enkel kantoor), het regietarief van de
//                                                offerte volgt het tarief van de OA (fromRateId), Werf starten → uitvoerder = de firma van
//                                                de aankoopprijs (anders de standaard-OA) en per OA een afspraak met de tarieven van de
//                                                startdag; een werf gestart vóór het nieuwe tarief houdt € 42, een nieuwe werf neemt € 46;
//                                                een nieuw tarief "vanaf <dag> op deze werf" geldt vanaf die dag; de controle van de
//                                                OA-factuur gebruikt het tarief van de werf op die dag; contract onder een controlecode, te
//                                                tekenen, getekend, aanhangsel = versie 2; de OA ziet enkel zijn eigen contract; attesten:
//                                                de OA laadt op, kantoor keurt, melding één keer, waarschuwingen; de werfleider zonder
//                                                bedragen; export; .did-controle.
// Enkel VERZONNEN gegevens: firma's "Proef … 2c4", gemeente Merkebeke, postcode 9992.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { backend, freshBackend } from "../tools/lib.mjs";
import { M, saveAll, fromRead } from "./offerte-lib.mjs";
import { contractPdf } from "../src/frontend/src/pdf/contract.ts";
import { fonts } from "./pdf-voorbeeld.mjs";

const cid = process.argv[2];
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const S = (x) => JSON.stringify(x, big);

// ── A. De contract-PDF ──────────────────────────────────────────────────
{
  const { PDFDocument } = createRequire(join(import.meta.dirname, "../src/frontend/package.json"))("pdf-lib");
  const long = Array.from({ length: 14 }, (_, i) => `Artikel ${i + 1} – Proef. ${"Verzonnen tekst voor de proef. ".repeat(12)}`).join("\n\n") + "\n" + "x".repeat(900);
  const data = { title: "Overeenkomst van onderaanneming", version: 2, provisional: true, firm: "Proef Bouw Reiger 2c4", work: "P-AF 9992 Merkebeke", text: long, posts: Array.from({ length: 120 }, (_, i) => ({ title: i === 3 ? "y".repeat(400) : `Proefpost ${i + 1}`, unit: "st", qtyMilli: 12_500n, unitCents: i === 5 ? null : 1234n })), rates: [{ name: "Regie per persoon", unit: "uur", cents: 4200n, from: "1.1.2026" }], total: 1_851_000n, advance: "10 % (€ 1.851,00)", hash: "ab".repeat(32), madeOn: "31.10.2026", signedOn: null };
  const bytes = await contractPdf(data, fonts());
  const d = await PDFDocument.load(bytes);
  check("(A1) contract-PDF: lange tekst en 120 posten over meerdere bladzijden, geldig PDF", d.getPageCount() >= 4 && bytes.length > 10_000, `${d.getPageCount()} blz.`);
  const short = await contractPdf({ ...data, version: 1, provisional: false, posts: [], rates: [], total: null, text: "Artikel 1 – Kort." }, fonts());
  check("(A1) kort contract zonder posten: één bladzijde", (await PDFDocument.load(short)).getPageCount() === 1);
}

if (!cid) {
  console.log(`\n${pass} ✓  ${fail} ✗  (enkel A; geef een canister voor B)`);
  process.exit(fail ? 1 : 0);
}

// ── B. Door de backend ──────────────────────────────────────────────────
const ok = (r) => { if (r && typeof r === "object" && "err" in r) throw new Error(r.err); return r.ok; };
const isOk = (r) => r && typeof r === "object" && "ok" in r;
const errOf = (r) => (r && typeof r === "object" && "err" in r ? r.err : "");
const denied = async (p) => { try { const r = await p; return !!(r && "err" in r && /^Geen toegang|^Onbekende afspraak/.test(r.err)); } catch (e) { return /Geen toegang|trap|Reject/i.test(String(e)); } };
const opt = (v) => (v === null || v === undefined ? [] : [v]);
const un = (a) => (Array.isArray(a) && a.length ? a[0] : null);
const fakeBlob = (c) => new TextEncoder().encode("!caf!sha256:" + c.repeat(64));

const [admin, calc, wl, oa2, klant] = await Promise.all(["proef-admin", "proef-calculator", "proef-werfleider", "proef-oa2", "proef-klant"].map((n) => backend(n, cid)));
const oaR = await freshBackend(cid);
const oaM = await freshBackend(cid);
const vreemd = await freshBackend(cid);
const suffix = Date.now().toString(36).slice(-5).toUpperCase();
const today = BigInt(Math.floor(Date.now() / 86_400_000));
const wd = (d) => (Number(d) + 3) % 7;
const nextWd = (d) => { let x = BigInt(d); while (wd(x) > 4) x++; return x; };

// B0. Opzet: twee OA-firma's met elk een login (zonder werf), een klant, twee werven met de werfleider.
// Een verzonnen, geldig ondernemingsnummer per run (8 cijfers + 97 − rest mod 97), zodat elke run een eigen nummer heeft.
const KBO = (() => { const n = 10_000_000 + Math.floor(Math.random() * 89_999_999); return `0${String(n).slice(-7).padStart(7, "0")}`; })();
const kboOf = (base) => { const n = Number(base.slice(0, 8)); return base.slice(0, 8) + String(97 - (n % 97)).padStart(2, "0"); };
const KBO_R = kboOf(KBO);
const orgOf = async (name, kind = "subcontractor") => ok(await admin.createOrg({ kind: { [kind]: null }, name, kbo: name.includes("Reiger") ? [KBO_R] : [], vat: [], aliases: [], trades: [], address: [{ street: "Proefdreef", number: "4", zip: "9992", city: "Merkebeke", country: "BE" }], notes: "Verzonnen proeffirma (2c.4)" })).id;
const REIGER = await orgOf(`Proef Bouw Reiger 2c4 ${suffix}`);
const MEREL = await orgOf(`Proef Elektro Merel 2c4 ${suffix}`);
const KLANTNAAM = `Proef Klant Spreeuw 2c4 ${suffix}`;
const KLANTORG = await orgOf(KLANTNAAM, "client");
ok(await admin.saveOaPerson(REIGER, { id: [], name: `Proef Rita ${suffix}`, shortCode: [], phone: [], email: ["rita@proef.invalid"], jobTitle: "zaakvoerder", note: "" }));
const login = async (who, orgId, name) => {
  const c = ok(await admin.invitePerson({ name, roles: [{ onderaannemer: null }], orgId: [orgId], shortCode: [], lang: [], phone: [], workIds: [], validDays: 0n, tag: "proef 2c4" }));
  ok(await who.redeemCode(c.code));
};
await login(oaR, REIGER, `Proef OA Reiger ${suffix}`);
await login(oaM, MEREL, `Proef OA Merel ${suffix}`);
const addr = { street: "Proefweg", number: "12", zip: "9992", city: "Merkebeke", country: "BE" };
const WLID = (await wl.me()).person[0].id;
const mkWork = async (code) => { const w = ok(await admin.createWork({ code, name: "Proef afspraken 2c4", address: addr, parentId: [], clientOrgId: [KLANTORG], architectOrgId: [], leaderPersonId: [WLID], vatBp: 2100n })).id; return w; };
const W1 = await mkWork(`P-AF1${suffix}`);
const W2 = await mkWork(`P-AF2${suffix}`);
const libChs = await calc.libraryChapters(false);
if (!libChs.length) ok(await calc.loadLibraryStartChapters());
const ch0 = (await calc.libraryChapters(false))[0];
const L2 = ok(await calc.saveLibraryItem({ id: [], chapterId: ch0.id, code: "", title: `Proef lichtpunt 2c4 ${suffix}`, text: "Verzonnen.", unit: "st", form: { vh: null }, trade: [], orgId: [MEREL], durationDays: [2n], perDayMilli: [], planStepKey: [], keywords: [], importKey: [] }, 0n));
check("(B0) opzet: twee OA-firma's met een login zonder werf, twee werven", (await oaR.me()).person.length === 1 && (await oaM.me()).caps[0].myDeals && !(await wl.me()).caps[0].deals && (await calc.me()).caps[0].deals);

// B1. Tarief per firma met datum: enkel kantoor (bedragen enkel via een update-call met auditregel).
const rateIn = (o) => ({ orgId: REIGER, kind: "regie", unit: "uur", cents: 4200n, validFrom: today - 200n, source: "offerte", ref: "proef 2c4", fileId: [], note: "", ...o });
const r42 = ok(await calc.saveOaRate(rateIn({})));
check("(B1) tarief regie € 42 vanaf 200 dagen geleden (calculator)", typeof r42 === "bigint");
check("(B1) een tarief zonder datum, met € 0 of van een onbekende soort: geweigerd", /datum/.test(errOf(await calc.saveOaRate(rateIn({ validFrom: 0n })))) && /meer dan € 0/.test(errOf(await calc.saveOaRate(rateIn({ cents: 0n })))) && /soort/.test(errOf(await calc.saveOaRate(rateIn({ kind: "x" })))));
check("(B1) werfleider, OA, klant en een onbekende login: tarieven lezen en zetten geweigerd", (await Promise.all([wl, oaR, klant, vreemd].flatMap((x) => [denied(x.listOaRates(REIGER)), denied(x.saveOaRate(rateIn({})))]))).every(Boolean));
const rl = ok(await calc.listOaRates(REIGER));
check("(B1) de lijst: één tarief, met herkomst; auditregel bekeek:tarieven", rl.length === 1 && rl[0].cents === 4200n && rl[0].kind === "regie" && (await admin.auditLog(0n, 20n)).some((a) => a.action === "bekeek:tarieven"));

// B2. Het regietarief van de offerte volgt het tarief van de OA (fromRateId).
const price = (cost, orgId = null) => ({ cost, rule: null, reason: "", orgId, source: orgId ? "oa-offerte" : "eigen", libCostId: null });
const mkQuote = async (W, follow, withMerel = true) => {
  const q = ok(await calc.createQuote({ workId: W, number: "", title: "Proef offerte 2c4" }));
  const m = fromRead(ok(await calc.readQuoteVersion(q.versionId)));
  const c1 = M.addChapter(m, { code: "01", title: "Proef ruwbouw" });
  M.addLine(m, c1.key, { title: "Proef stopcontact 2c4", qtyMilli: 12_000n, unit: "st", form: "vh", price: price(1234n, REIGER) });
  if (withMerel) M.addLine(m, c1.key, { title: "Proef lichtpunt 2c4", qtyMilli: 8_000n, unit: "st", form: "vh", libItemId: L2.id, libItemVersion: L2.version, price: price(4000n) });
  M.addLine(m, c1.key, { title: "Proef regie-uren 2c4", qtyMilli: 10_000n, unit: "u", form: "regie", price: M.emptyPrice() });
  m.form.regie = follow;
  return { q, m };
};
const regieOf = async (vid) => un(un(ok(await calc.readQuoteVersion(vid)).terms ?? [])?.regie ?? []);
{
  const t = await mkQuote(W2, { orgId: MEREL, cost: 4200n, sell: M.regieSell(4200n), follow: true });
  check("(B2) volgen zonder regietarief van die firma: geweigerd", /nog geen regietarief/.test(errOf(await saveAll(calc, t.m))));
}
const Q1 = await mkQuote(W1, { orgId: REIGER, cost: 4300n, sell: M.regieSell(4300n), follow: true });
check("(B2) volgen met een ander uurloon dan het geldende tarief: geweigerd (vernieuwen)", /intussen gewijzigd/.test(errOf(await saveAll(calc, Q1.m))));
{
  const m = fromRead(ok(await calc.readQuoteVersion(Q1.q.versionId)));
  m.form.regie = { orgId: REIGER, cost: 4200n, sell: M.regieSell(4200n), follow: true };
  const r = await saveAll(calc, m);
  check("(B2) volgen met het geldende tarief (€ 42): bewaard", isOk(r), errOf(r));
}
const g1 = await regieOf(Q1.q.versionId);
check("(B2) de offerte bewaart welk tarief ze volgt (fromRateId = het tarief van de firma), regie voor de klant € 52,50", g1 && un(g1.fromRateId) === r42 && g1.costCents === 4200n && g1.sellCents === 5250n, S(g1));
const sendAccept = async (vid) => {
  const r = ok(await calc.readQuoteVersion(vid));
  ok(await calc.sendQuoteVersion(vid, r.version.rev, r.totals.totalCents, "proef 2c4: waarschuwingen doorgezet"));
  ok(await calc.decideQuoteVersion(vid, true, "proef 2c4: akkoord"));
};
await sendAccept(Q1.q.versionId);

// B3. Werf starten (werfleider): uitvoerder = firma van de aankoopprijs, anders de standaard-OA; per OA een afspraak.
const inp = (startDay) => ({ target: { existing: null }, startDay, templateKey: "", leaderPersonId: [], lineSteps: [], options: [], groupDays: [], skipPermits: [], declaration: false });
const startJune = nextWd(today - 120n);
const pv1 = ok(await wl.workStartPreview(Q1.q.versionId, inp(startJune)));
const lineOrg = (pv, t) => pv.lines.find((l) => l.title.startsWith(t))?.orgName ?? "";
check("(B3) voorstel: stopcontact → de firma van de aankoopprijs (Reiger), lichtpunt → de standaard-OA van de bibliotheekpost (Merel)", lineOrg(pv1, "Proef stopcontact").includes("Reiger") && lineOrg(pv1, "Proef lichtpunt").includes("Merel"), `${lineOrg(pv1, "Proef stopcontact")} / ${lineOrg(pv1, "Proef lichtpunt")}`);
check("(B3) voorstel: waarschuwing voor de attesten die ontbreken (Reiger en Merel), zonder bedrag", pv1.warnings.some((w) => w.includes("Reiger") && /attest/.test(w)) && pv1.warnings.some((w) => w.includes("Merel")) && !/Cents|cost/i.test(S(pv1)));
ok(await wl.startWorkFromQuote(Q1.q.versionId, inp(startJune), pv1.planVersion));
const deals1 = await wl.listDeals(W1);
const dR = deals1.find((d) => d.orgId === REIGER);
const dM = deals1.find((d) => d.orgId === MEREL);
check("(B3) twee afspraken (Reiger, Merel), status ontwerp, startdag = de werfstart; de werfleider ziet ze zonder bedrag", deals1.length === 2 && dR && dM && dR.status === "ontwerp" && un(dR.startDay) === startJune && !/cents/i.test(S(deals1)), S(deals1.map((d) => [d.orgName, d.status, d.posts])));
check("(B3) attesten in de status: drie verplichte soorten, alle 'ontbreekt'", dR.attests.length === 3 && dR.attests.every((a) => a.state === "ontbreekt"));
check("(B3) werfleider van een andere werf, OA, klant: listDeals geweigerd", (await Promise.all([oa2, oaR, klant, vreemd].map((x) => denied(x.listDeals(W1))))).every(Boolean));
const full1 = ok(await calc.readDeal(dR.id));
check("(B3) de afspraak met Reiger: zijn post en prijs (12 × € 12,34 = € 148,08), tarief regie € 42 van de firma op de startdag", full1.prices.length === 1 && un(full1.prices[0].cents) === 1234n && un(full1.amountCents) === 14_808n && full1.rates.length === 1 && full1.rates[0].cents === 4200n && un(full1.rates[0].fromRateId) === r42, S(full1.rates));
check("(B3) readDeal: werfleider en OA geweigerd; auditregel bekeek:afspraak", (await denied(wl.readDeal(dR.id))) && (await denied(oaR.readDeal(dR.id))) && (await admin.auditLog(0n, 30n)).some((a) => a.action === "bekeek:afspraak"));

// B4. Nieuw tarief van de firma (€ 46 vanaf 60 dagen geleden): de lopende werf houdt € 42, een nieuwe werf neemt € 46 (⚖9).
const r46 = ok(await calc.saveOaRate(rateIn({ cents: 4600n, validFrom: today - 60n })));
const full1b = ok(await calc.readDeal(dR.id));
check("(B4) werf gestart vóór het nieuwe tarief houdt € 42 (de firma vraagt nu € 46: ter vergelijking)", full1b.rates.length === 1 && full1b.rates[0].cents === 4200n && full1b.firmRatesNow.some((r) => r.cents === 4600n), S(full1b.firmRatesNow));
const Q2 = await mkQuote(W2, { orgId: REIGER, cost: 4200n, sell: M.regieSell(4200n), follow: true }, false);
check("(B4) een nieuwe offerte die het tarief volgt: € 42 geweigerd (het geldende is € 46)", /intussen gewijzigd/.test(errOf(await saveAll(calc, Q2.m))));
{
  const m = fromRead(ok(await calc.readQuoteVersion(Q2.q.versionId)));
  m.form.regie = { orgId: REIGER, cost: 4600n, sell: M.regieSell(4600n), follow: true };
  ok(await saveAll(calc, m));
}
check("(B4) de nieuwe offerte volgt € 46 (fromRateId = het nieuwe tarief)", un((await regieOf(Q2.q.versionId)).fromRateId) === r46);
await sendAccept(Q2.q.versionId);
const pv2 = ok(await wl.workStartPreview(Q2.q.versionId, inp(nextWd(today))));
ok(await wl.startWorkFromQuote(Q2.q.versionId, inp(nextWd(today)), pv2.planVersion));
const dR2 = (await wl.listDeals(W2)).find((d) => d.orgId === REIGER);
const full2 = ok(await calc.readDeal(dR2.id));
check("(B4) de werf gestart na het nieuwe tarief neemt € 46", full2.rates.length === 1 && full2.rates[0].cents === 4600n && un(full2.rates[0].fromRateId) === r46, S(full2.rates));

// B5. De controle van een OA-factuur gebruikt het tarief van die werf op die dag; een nieuw tarief "vanaf <dag> op deze werf".
const invIn = (n, periodTo, unit) => { const amt = 10n * unit; return { id: [], orgId: REIGER, workId: W1, number: `PF-${suffix}-${n}`, invoiceDay: today, dueDay: [], periodFrom: [], periodTo: [periodTo], vatRegime: { reverse: null }, reverseMention: true, fileId: [], note: "proef 2c4", netCents: amt, vatCents: 0n, totalCents: amt, lines: [{ kind: { regie: null }, root: [], description: "Proef regie 10 u", qtyMilli: 10_000n, unitCents: unit, amountCents: amt }] }; };
const I1 = ok(await calc.saveOaInvoice(invIn("1", today - 30n, 4600n), 0n));
const v1 = ok(await calc.readOaInvoice(I1));
check("(B5) factuur aan € 46 over een periode vóór het nieuwe werftarief: afspraak € 42 op deze werf, gemarkeerd als hoger", un(v1.lines[0].m.agreedCents) === 4200n && v1.lines[0].m.flags.includes("prijs-hoger") && /42,00/.test(v1.dealRate), `${S(v1.lines[0].m)} ${v1.dealRate}`);
check("(B5) waarschuwing bij goedkeuren: de attesten van Reiger zijn niet in orde", v1.attestWarnings.length === 3 && v1.attestWarnings.every((w) => w.includes("Reiger")));
const fromDay = today - 10n;
check("(B5) nieuw tarief op de werf met een verouderde versie (rev): geweigerd", /intussen gewijzigd/.test(errOf(await calc.addDealRate(dR.id, { kind: "regie", unit: "uur", cents: 4600n, validFrom: fromDay, fromRateId: [r46], note: "" }, 99n))));
const rv = ok(await calc.readDeal(dR.id)).deal.rev;
ok(await calc.addDealRate(dR.id, { kind: "regie", unit: "uur", cents: 4600n, validFrom: fromDay, fromRateId: [r46], note: "proef: vanaf deze dag op deze werf" }, rv));
check("(B5) werfleider en OA zetten geen tarief op de werf", (await denied(wl.addDealRate(dR.id, { kind: "regie", unit: "uur", cents: 1n, validFrom: fromDay, fromRateId: [], note: "" }, rv + 1n))) && (await denied(oaR.addDealRate(dR.id, { kind: "regie", unit: "uur", cents: 1n, validFrom: fromDay, fromRateId: [], note: "" }, rv + 1n))));
const I2 = ok(await calc.saveOaInvoice(invIn("2", today, 4600n), 0n));
const v2 = ok(await calc.readOaInvoice(I2));
const v1b = ok(await calc.readOaInvoice(I1));
const I3 = ok(await calc.saveOaInvoice(invIn("3", fromDay - 1n, 4200n), 0n));
const v3 = ok(await calc.readOaInvoice(I3));
check("(B5) vanaf die dag geldt € 46 op deze werf (geen markering); de dag ervoor en de vorige factuur blijven € 42", un(v2.lines[0].m.agreedCents) === 4600n && !v2.lines[0].m.flags.includes("prijs-hoger") && un(v1b.lines[0].m.agreedCents) === 4200n && un(v3.lines[0].m.agreedCents) === 4200n && !v3.lines[0].m.flags.includes("prijs-lager"), `${un(v2.lines[0].m.agreedCents)} ${un(v1b.lines[0].m.agreedCents)} ${un(v3.lines[0].m.agreedCents)}`);
check("(B5) de werfleider ziet de hoeveelheden van de factuur, geen tarief", !/agreed|dealRate|Cents/i.test(S(ok(await wl.oaInvoiceQty(I2)))));

// B6. Het contract: voorschot (max. 20 %), contract onder een controlecode, te tekenen, getekend; aanhangsel = versie 2.
let rev = ok(await calc.readDeal(dR.id)).deal.rev;
check("(B6) voorschot boven 20 %: geweigerd", /hoogstens 20/.test(errOf(await calc.saveDealTerms(dR.id, { advanceBp: 2500n, paymentDays: 30n, endOfMonth: true }, rev))));
ok(await calc.saveDealTerms(dR.id, { advanceBp: 1000n, paymentDays: 30n, endOfMonth: true }, rev));
rev = ok(await calc.readDeal(dR.id)).deal.rev;
check("(B6) contract maken: werfleider en OA geweigerd", (await denied(wl.makeOaContract(dR.id, rev))) && (await denied(oaR.makeOaContract(dR.id, rev))));
const c1 = ok(await calc.makeOaContract(dR.id, rev));
const fld = Object.fromEntries(c1.fields);
check("(B6) contract v1: controlecode (64 tekens), velden ingevuld (firma, ondernemingsnummer, werfadres, werken, voorschot 10 % = € 14,81), geen open veld", c1.version === 1n && /^[0-9a-f]{64}$/.test(c1.hash) && fld.firma.includes("Reiger") && fld["firma.kbo"].replace(/\D/g, "") === KBO_R && fld["werf.adres"].includes("Merkebeke") && fld.werken.includes("Proef stopcontact") && /10 % \(€ 14,81\)/.test(fld.voorschot) && !c1.text.includes("{{") && c1.provisional, S(fld.voorschot));
check("(B6) het contract noemt nooit de klant en geen prijs van een andere firma", !S(c1).includes(KLANTNAAM) && !S(c1).includes("Merel") && c1.posts.length === 1);
const st1 = (await wl.listDeals(W1)).find((d) => d.id === dR.id);
check("(B6) status te tekenen, versie 1, zelfde controlecode (werfleider ziet de status)", st1.status === "te tekenen" && st1.contractVersion === 1n && st1.contractHash === c1.hash);
const rc = ok(await calc.readOaContract(dR.id, 1n));
check("(B6) contract opnieuw lezen: dezelfde inhoud en controlecode", rc.hash === c1.hash && rc.text === c1.text);
const pdf = await contractPdf({ title: rc.title, version: Number(rc.version), provisional: rc.provisional, firm: fld.firma, work: fld["werf.adres"], text: rc.text, posts: rc.posts.map((p) => ({ title: p.title, unit: p.unit, qtyMilli: p.qtyMilli, unitCents: un(p.unitCents) })), rates: rc.rates.map((r) => ({ name: r.kindName, unit: r.unit, cents: r.cents, from: String(r.validFrom) })), total: un(rc.totalCents), advance: fld.voorschot, hash: rc.hash, madeOn: "31.10.2026", signedOn: null }, fonts());
check("(B6) de contract-PDF uit wat vastligt", pdf.length > 5000 && new TextDecoder().decode(pdf.slice(0, 5)) === "%PDF-");

// B7. De OA ziet enkel zijn eigen contract (verwijzing, geen id); een andere firma niets.
const myR = await oaR.listMyContracts();
const refR = myR[0]?.ref ?? "";
check("(B7) Mijn contracten (Reiger): één contract met het werfadres, zonder id of klant", myR.length === 1 && refR.length === 16 && myR[0].workAddress.includes("Merkebeke") && !S(myR).includes(KLANTNAAM) && !("id" in myR[0]), S(myR));
const mc = ok(await oaR.readMyContract(refR, 1n));
check("(B7) de OA leest zijn contract: dezelfde controlecode (nagerekend: intact), zijn eigen prijzen, geen id van de app (geen post-oorsprong, geen tarief-id)", mc.hash === c1.hash && mc.intact && mc.posts.length === 1 && un(mc.posts[0].unitCents) === 1234n && !("root" in mc.posts[0]) && mc.rates.every((r) => !("fromRateId" in r)) && !/"(id|root|fromRateId|agreementId)"/.test(S(mc)));
check("(B7) Merel ziet het contract van Reiger niet (lijst leeg, lezen geweigerd); een ontwerp zonder contract ziet niemand", (await oaM.listMyContracts()).length === 0 && /Onbekend contract/.test(errOf(await oaM.readMyContract(refR, 1n))) && /Onbekend contract/.test(errOf(await oaR.readMyContract("0".repeat(16), 1n))));
check("(B7) werfleider, klant, onbekende login: Mijn contracten geweigerd", (await Promise.all([wl, klant, vreemd].map((x) => denied(x.listMyContracts())))).every(Boolean));
check("(B7) het getekende bewijs vóór het tekenen: niet beschikbaar", /Nog niet getekend/.test(errOf(await oaR.readMyContractFile(refR, 1n))));
rev = ok(await calc.readDeal(dR.id)).deal.rev;
const fSigned = ok(await calc.addDealFile("proef-getekend.pdf", "application/pdf", 40_000n, fakeBlob("c"), { signed: dR.id }));
const fOther = ok(await calc.addDealFile("proef-andere-afspraak.pdf", "application/pdf", 40_000n, fakeBlob("d"), { signed: dR2.id }));
const fAttest = ok(await calc.addDealFile("proef-attest.pdf", "application/pdf", 40_000n, fakeBlob("e"), { orgDoc: MEREL }));
check("(B7) getekend registreren met een verkeerde versie, het bewijs van een andere afspraak of een attestbestand: geweigerd", /laatste versie/.test(errOf(await calc.markOaContractSigned(dR.id, 2n, fSigned, "", rev))) && /Onbekend bestand/.test(errOf(await calc.markOaContractSigned(dR.id, 1n, fOther, "", rev))) && /Onbekend bestand/.test(errOf(await calc.markOaContractSigned(dR.id, 1n, fAttest, "", rev))));
ok(await calc.markOaContractSigned(dR.id, 1n, fSigned, "proef: getekend terug", rev));
const st2 = (await wl.listDeals(W1)).find((d) => d.id === dR.id);
const sf = ok(await oaR.readMyContractFile(refR, 1n));
check("(B7) getekend: status getekend; de OA opent het getekende bewijs (zonder bestands-id); het bestand is niet los te archiveren", st2.status === "getekend" && sf.name === "proef-getekend.pdf" && !("id" in sf) && /hoort bij/.test(errOf(await calc.archiveFile(fSigned))));
rev = ok(await calc.readDeal(dR.id)).deal.rev;
ok(await calc.saveDealTerms(dR.id, { advanceBp: 2000n, paymentDays: 45n, endOfMonth: false }, rev));
check("(B7) een wijziging na het tekenen zet de afspraak terug op ontwerp (aanhangsel nodig)", (await wl.listDeals(W1)).find((d) => d.id === dR.id).status === "ontwerp");
rev = ok(await calc.readDeal(dR.id)).deal.rev;
const c2 = ok(await calc.makeOaContract(dR.id, rev));
const full3 = ok(await calc.readDeal(dR.id));
check("(B7) aanhangsel = versie 2 met een andere controlecode; versie 1 blijft (getekend)", c2.version === 2n && c2.hash !== c1.hash && full3.versions.length === 2 && full3.versions[0].signedAt.length === 1 && full3.versions[1].signedAt.length === 0 && ok(await calc.readOaContract(dR.id, 1n)).hash === c1.hash);
check("(B7) de OA ziet beide versies", (await oaR.listMyContracts())[0].versions.length === 2 && ok(await oaR.readMyContract(refR, 2n)).hash === c2.hash);

// B8. Attesten: de OA laadt op, kantoor keurt (⚖11); melding 30 dagen vooraf, één keer; waarschuwingen.
const att = ok(await oaR.addMyAttest("ba", "", [today - 300n], [today + 10n], "proef-ba.pdf", "application/pdf", 1000n, fakeBlob("a")));
const mine = await oaR.listMyAttests();
check("(B8) de OA laadt zijn BA-attest op: te keuren (telt nog niet); zonder id", att.status.received === null && mine.states.find((s) => s.kind === "ba").state === "te-keuren" && att.ref.length === 16 && !("id" in att));
check("(B8) zonder geldig-tot of een onbekende soort: geweigerd", /geldig/.test(errOf(await oaR.addMyAttest("ba", "", [], [], "x.pdf", "application/pdf", 10n, fakeBlob("b")))) && /soort/.test(errOf(await oaR.addMyAttest("rsz-x", "", [], [today], "x.pdf", "application/pdf", 10n, fakeBlob("b")))));
check("(B8) Merel ziet de attesten van Reiger niet; Mijn attesten van de werfleider: geweigerd", (await oaM.listMyAttests()).docs.length === 0 && /Onbekend attest/.test(errOf(await oaM.readMyAttestFile(att.ref))) && (await denied(wl.listMyAttests())));
check("(B8) kantoor kreeg een melding om na te kijken", (await calc.myNotifications(true)).some((n) => n.kind === "attest" && n.text.includes("Reiger") && /na te kijken/.test(n.text)));
const od = await wl.listOrgDocs(REIGER);
check("(B8) de werfleider ziet de attesten op de firmafiche (stand, geldig tot), mag niet keuren", od.docs.length === 1 && !od.mayReview && (await denied(wl.reviewOrgDoc(od.docs[0].id, true, ""))));
check("(B8) afkeuren zonder reden: geweigerd", /reden/.test(errOf(await calc.reviewOrgDoc(od.docs[0].id, false, ""))));
ok(await calc.reviewOrgDoc(od.docs[0].id, true, ""));
check("(B8) goedgekeurd: BA vervalt binnenkort (binnen 30 dagen); de OA kreeg de uitkomst", (await oaR.listMyAttests()).states.find((s) => s.kind === "ba").state === "vervalt" && (await oaR.myNotifications(true)).some((n) => n.text.includes("goedgekeurd")));
const n1 = await admin.scanOrgDocs();
const countNotes = async (x) => (await x.myNotifications(false)).filter((n) => n.kind === "attest" && n.text.includes(`Reiger 2c4 ${suffix}`) && /vervalt op/.test(n.text)).length;
const k1 = await countNotes(calc);
const n2 = await admin.scanOrgDocs();
check("(B8) de ronde meldt het vervallen 30 dagen vooraf, één keer (kantoor en de OA); een tweede ronde meldt niets meer", k1 === 1 && (await countNotes(calc)) === 1 && (await countNotes(oaR)) === 1 && n2 === 0n, `${n1} ${k1} ${n2}`);
ok(await calc.saveOrgDoc({ orgId: REIGER, kind: "tienjarige", title: "", fileId: [], validFrom: [], validUntil: [today - 1n], note: "proef: vervallen" }));
const w2 = ok(await calc.readDeal(dR.id)).warnings;
check("(B8) een vervallen attest (tienjarige) en een ontbrekend (personeel): waarschuwing in de afspraak en bij de OA-factuur", w2.some((w) => /tienjarige/i.test(w) && /vervallen/.test(w)) && w2.some((w) => /Personeel/i.test(w) && /ontbreekt/.test(w)) && !w2.some((w) => /BA/.test(w)) && ok(await calc.readOaInvoice(I2)).attestWarnings.length === 2, S(w2));
check("(B8) de OA opent zijn eigen attest", ok(await oaR.readMyAttestFile(att.ref)).name === "proef-ba.pdf");

// B10. Wijziging terwijl het contract klaarstaat (#toSign): terug op ontwerp, melding aan kantoor, tekenen geweigerd (review M1).
{
  const r0 = ok(await calc.readDeal(dR.id)).deal;
  check("(B10) versie 2 staat klaar om te tekenen", r0.status === "te tekenen" && r0.contractVersion === 2n);
  ok(await calc.addDealRate(dR.id, { kind: "transport", unit: "uur", cents: 5500n, validFrom: today, fromRateId: [], note: "proef: tijdens te tekenen" }, r0.rev));
  const r1 = ok(await calc.readDeal(dR.id)).deal;
  const fS2 = ok(await calc.addDealFile("proef-getekend-v2.pdf", "application/pdf", 40_000n, fakeBlob("f"), { signed: dR.id }));
  check("(B10) een tarief erbij tijdens 'te tekenen': terug op ontwerp, kantoor krijgt 'aanhangsel nodig', versie 2 tekenen geweigerd", r1.status === "ontwerp" && (await calc.myNotifications(true)).some((n) => n.kind === "afspraak" && /aanhangsel nodig/.test(n.text) && n.text.includes("Reiger")) && /laatste versie/.test(errOf(await calc.markOaContractSigned(dR.id, 2n, fS2, "", r1.rev))));
}

// B11. Tweede werfstart op W1 (meerwerk): een extra post en een gewijzigde prijs (review H1).
{
  const nv = ok(await calc.newQuoteVersion(Q1.q.quoteId, [Q1.q.versionId]));
  const m = fromRead(ok(await calc.readQuoteVersion(nv)));
  const st = m.lines.find((l) => l.title === "Proef stopcontact 2c4");
  M.updateLine(m, st.key, { price: { ...st.price, cost: 1300n } });
  M.addLine(m, st.chapter, { title: "Proef extra post 2c4", qtyMilli: 2_000n, unit: "st", form: "vh", price: price(500n, REIGER) });
  ok(await saveAll(calc, m));
  await sendAccept(nv);
  const pvm = ok(await wl.workStartPreview(nv, inp(nextWd(today))));
  ok(await wl.startWorkFromQuote(nv, inp(nextWd(today)), pvm.planVersion));
  const f = ok(await calc.readDeal(dR.id));
  const p13 = f.prices.find((x) => x.title.includes("Proef stopcontact"));
  const pex = f.prices.find((x) => x.title.includes("Proef extra post"));
  check("(B11) de afspraak na het meerwerk: nieuwste prijs (€ 13,00), extra post, totaal opnieuw (12 × 13,00 + 2 × 5,00 = € 166,00, niet opgeteld), voorschot 20 % herrekend (€ 33,20)", f.prices.length === 2 && un(p13?.cents) === 1300n && un(pex?.cents) === 500n && un(f.amountCents) === 16_600n && un(f.advanceCents) === 3320n, S([f.prices, f.amountCents, f.advanceCents]));
  check("(B11) de tarieven blijven (⚖9): regie € 42 en € 46 vanaf de werfdag, transport", f.rates.filter((r) => r.kind === "regie").map((r) => r.cents).join(",") === "4200,4600");
  const c3 = ok(await calc.makeOaContract(dR.id, f.deal.rev));
  check("(B11) aanhangsel v3: totaal uit de vastgelegde posten (Σ op de cent) = € 166,00", c3.version === 3n && un(c3.totalCents) === 16_600n && c3.intact);
}

// B12. Tariefwissel binnen de periode van een factuur; een beëindigde afspraak houdt haar tarief tot het einde (review M3, L6).
{
  const inv = { ...invIn("4", today, 4600n), periodFrom: [today - 20n] };
  const v4 = ok(await calc.readOaInvoice(ok(await calc.saveOaInvoice(inv, 0n))));
  check("(B12) periode over de dag van het nieuwe werftarief: markering tariefwissel (bedrag per dag nakijken)", v4.lines[0].m.flags.includes("tariefwissel"), S(v4.lines[0].m.flags));
  const d2 = ok(await calc.readDeal(dR2.id)).deal;
  ok(await calc.endDeal(dR2.id, "proef: werk klaar", d2.rev));
  const w2in = (n, to) => ({ ...invIn(n, to, 4600n), workId: W2 });
  // De dag van het einde volgens de klok van de canister (de rollentest verzet die klok op het eigen net).
  const endAt = (await admin.auditLog(0n, 20n)).find((a) => a.action === "afspraak-beeindigd").at;
  const endDay = endAt / 86_400_000_000_000n;
  const vEnd = ok(await calc.readOaInvoice(ok(await calc.saveOaInvoice(w2in("5", endDay), 0n))));
  const vAfter = ok(await calc.readOaInvoice(ok(await calc.saveOaInvoice(w2in("6", endDay + 1n), 0n))));
  check("(B12) beëindigde afspraak: prestaties tot de dag van het einde houden € 46; daarna geen werftarief meer", un(vEnd.lines[0].m.agreedCents) === 4600n && un(vAfter.lines[0].m.agreedCents) !== 4600n, `${un(vEnd.lines[0].m.agreedCents)} / ${un(vAfter.lines[0].m.agreedCents)}`);
}

// B13. Attest met een verkeerde datum archiveren en verbeteren (review M4); gearchiveerd firmatarief telt niet.
{
  const bad = ok(await calc.saveOrgDoc({ orgId: REIGER, kind: "personeel", title: "", fileId: [], validFrom: [], validUntil: [today + 3650n], note: "proef: verkeerde datum" }));
  check("(B13) archiveren: werfleider en OA geweigerd; zonder reden geweigerd", (await denied(wl.archiveOrgDoc(bad, "x"))) && (await denied(oaR.archiveOrgDoc(bad, "x"))) && /reden/.test(errOf(await calc.archiveOrgDoc(bad, ""))));
  ok(await calc.archiveOrgDoc(bad, "verkeerde datum ingegeven"));
  ok(await calc.saveOrgDoc({ orgId: REIGER, kind: "personeel", title: "", fileId: [], validFrom: [], validUntil: [today + 100n], note: "" }));
  const st = (await wl.listOrgDocs(REIGER)).states.find((x) => x.kind === "personeel");
  check("(B13) na archiveren en opnieuw zetten: personeel geldig tot de juiste datum", st.state === "geldig" && un(st.validUntil) === today + 100n, S(st));
  const rT = ok(await calc.saveOaRate(rateIn({ kind: "transport", cents: 9900n, validFrom: today - 5n })));
  ok(await calc.archiveOaRate(rT, "proef: fout ingevoerd"));
  const W3 = await mkWork(`P-AF3${suffix}`);
  const d3 = ok(await calc.createDeal(W3, REIGER));
  const f3 = ok(await calc.readDeal(d3.id));
  check("(B13) een gearchiveerd firmatarief komt niet in een nieuwe afspraak; het geldende regietarief (€ 46) wel", !f3.rates.some((r) => r.cents === 9900n) && f3.rates.some((r) => r.kind === "regie" && r.cents === 4600n), S(f3.rates));
  // Alle attesten die nu binnen 30 dagen vervallen, zijn gemeld (de migratiecheck kijkt na een herstel dat er niets opnieuw komt).
  await admin.scanOrgDocs();
}

let SPECHTID = -1n;
// B14. Rechten zoals in het echt: werfleider van een ANDERE werf, gearchiveerde persoon, de opslagpoort (review M5, L1).
{
  const set0 = await admin.getSettings();
  const setIn = (x) => ({ werfleiderZietAlles: x, inviteDays: set0.inviteDays, threshold30bisCents: set0.threshold30bisCents, thresholdCheckinatworkCents: set0.thresholdCheckinatworkCents });
  const W4 = ok(await admin.createWork({ code: `P-AF4${suffix}`, name: "Proef andere werf 2c4", address: addr, parentId: [], clientOrgId: [KLANTORG], architectOrgId: [], leaderPersonId: [], vatBp: 2100n })).id;
  ok(await calc.createDeal(W4, MEREL));
  ok(await admin.setSettings(setIn(false)));
  const other = await denied(wl.listDeals(W4));
  const own = !(await denied(wl.listDeals(W1)));
  ok(await admin.setSettings(setIn(set0.werfleiderZietAlles)));
  check("(B14) werfleider van een andere werf ('werfleider ziet alles' uit): geen afspraken van die werf; van zijn eigen werf wel", other && own);
  const oaR2 = await freshBackend(cid);
  await login(oaR2, REIGER, `Proef OA Reiger twee ${suffix}`);
  const before = (await oaR2.listMyContracts()).length === 1;
  const id2 = (await oaR2.me()).person[0].id;
  ok(await admin.archivePerson(id2));
  check("(B14) een tweede login van Reiger ziet het contract; na afzetten niets meer (lijst, lezen, opslagpoort)", before && (await denied(oaR2.listMyContracts())) && (await denied(oaR2.readMyContract(refR, 1n))) && (await denied(oaR2._immutableObjectStorageCreateCertificate("sha256:" + "0".repeat(64)))));
  const cert = async (x) => { try { await x._immutableObjectStorageCreateCertificate("sha256:" + "1".repeat(64)); return true; } catch { return false; } };
  const oaS = await freshBackend(cid);
  const SPECHT = await orgOf(`Proef Dak Specht 2c4 ${suffix}`);
  SPECHTID = SPECHT;
  await login(oaS, SPECHT, `Proef OA Specht ${suffix}`);
  check("(B14) opslagpoort: een OA met een afspraak, en een OA van een firma zonder afspraak (eigen attesten) krijgen een certificaat; een onbekende login niet", (await cert(oaR)) && (await cert(oaS)) && !(await cert(vreemd)));
  const sa = ok(await oaS.addMyAttest("ba", "", [], [today + 200n], "proef-specht.pdf", "application/pdf", 900n, fakeBlob("9")));
  check("(B14) de OA zonder afspraak laadt het attest van zijn eigen firma op; Reiger ziet het niet", sa.ref.length === 16 && !(await oaR.listMyAttests()).docs.some((d) => d.ref === sa.ref) && (await oaS.listMyContracts()).length === 0);
}

// B9. .did-controle, export en een afspraak met de hand.
{
  const did = readFileSync(join(import.meta.dirname, "../src/backend/dist/backend.did"), "utf8");
  const types = new Map([...did.matchAll(/^type (\w+) =([\s\S]*?);\n(?=type |service|$)/gm)].map((m) => [m[1], m[2]]));
  const fieldsOf = (n) => [...(types.get(n) ?? "").matchAll(/^\s+(\w+)\s*:/gm)].map((m) => m[1]);
  const views = ["DealStatusView", "AttestStateView", "OrgDocView", "OrgDocsView", "MyContractBrief", "MyAttestView", "MyAttestsView", "OrgDocKindView", "DealSetup", "MyFileOpen"];
  const bad = views.flatMap((n) => fieldsOf(n).filter((f) => /cents|cost|margin|price|prijs|amount|bedrag|total|euro|^rates?$/i.test(f)).map((f) => `${n}.${f}`));
  const money = ["OaRateView", "AgreedRateView", "DealFullView", "DealPriceView", "OaContractView", "AgreementTerms", "OaRate"];
  const refs = views.filter((n) => money.some((t) => new RegExp(`\\b${t}\\b`).test(types.get(n) ?? "")));
  check("(B9) .did: de views van werfleider en OA (status, attesten, Mijn contracten/attesten) hebben geen bedragveld en geen bedragtype", views.every((n) => types.has(n)) && bad.length === 0 && refs.length === 0, bad.concat(refs).join(", ") || `${views.length} typen`);
  const svc = did.slice(did.indexOf("service"));
  const q = (fn) => new RegExp(`\\b${fn}\\s*:\\s*\\([^)]*\\)\\s*->\\s*\\([^)]*\\)\\s*query`).test(svc);
  check("(B9) bedragen enkel via update-calls (listOaRates, readDeal, readOaContract, readMyContract); de lijsten zijn queries", !q("listOaRates") && !q("readDeal") && !q("readOaContract") && !q("readMyContract") && q("listDeals") && q("listMyContracts") && q("listOrgDocs"));
}
const ex = await admin.exportIntern();
const exc = await admin.exportConfidential();
// Review L8: elke waarde van de interne records doorlopen (ook extra en notities), tijdstempels, ids, versies en dagen overgeslagen:
// geen enkel proefbedrag mag er als getal in staan.
const AMOUNTS = new Set(["1234", "14808", "1300", "16600", "3320", "4200", "4600", "5500", "9900", "1481", "500", "4000"]);
const skipKey = (k) => /At$|^at$|Id$|Ids$|^id$|^rev$|Day$|By$|^by$|[Hh]ash$|^roots$|^version|Version$|^validFrom$|^validUntil$|^advanceBp$|^paymentDays$/.test(k);
const leaks = [];
const walkRec = (x, path) => {
  if (x === null || x === undefined) return;
  if (typeof x === "bigint" || typeof x === "number") { if (AMOUNTS.has(String(x))) leaks.push(path); return; }
  if (typeof x === "string") { for (const tok of x.match(/\d+/g) ?? []) if (AMOUNTS.has(tok) && !/^ref|\.ref$/.test(path)) leaks.push(`${path}=${x.slice(0, 40)}`); return; }
  if (Array.isArray(x)) {
    if (x.length === 2 && typeof x[0] === "string" && typeof x[1] === "string") { if (x[0] !== "ref" && x[0] !== "bewijs" && x[0] !== "contractRev") walkRec(x[1], `${path}.${x[0]}`); return; }
    x.forEach((y, i) => walkRec(y, `${path}[${i}]`));
    return;
  }
  if (typeof x === "object") for (const [k, v] of Object.entries(x)) if (!skipKey(k)) walkRec(v, `${path}.${k}`);
};
walkRec(ex.agreements.filter((a) => [REIGER, MEREL, SPECHTID].includes(a.orgId)), "agreements");
walkRec(ex.orgDocs.filter((d) => [REIGER, MEREL, SPECHTID].includes(d.orgId)), "orgDocs");
check("(B9) export: afspraken en attesten intern zonder enig proefbedrag (ook niet in extra of notities); tarieven, prijzen en contractversies vertrouwelijk", leaks.length === 0 && ex.agreements.some((a) => a.id === dR.id) && ex.orgDocs.length >= 2 && exc.oaRates.length >= 2 && exc.agreementTerms.some(([id]) => id === dR.id) && exc.agreementFrozen.length >= 2, leaks.slice(0, 5).join(" · "));
check("(B9) een afspraak met de hand: een tweede keer met dezelfde firma geweigerd; een leverancier of de werfleider: geweigerd", /al een afspraak/.test(errOf(await calc.createDeal(W1, REIGER))) && /onderaannemer/.test(errOf(await calc.createDeal(W1, KLANTORG))) && (await denied(wl.createDeal(W2, MEREL))));
const cd = ok(await calc.createDeal(W2, MEREL));
check("(B9) afspraak met de hand (Merel op werf 2): waarschuwing voor de ontbrekende attesten", cd.warnings.length === 3 && (await wl.listDeals(W2)).length === 2);

console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
