// OA-facturen zoals ze binnenkomen (stap 2c.7, ontwerp 2c §4.7, §8 R44, §10; AC-23, AC-24) op een canister die al in gebruik is
// (het eigen net, na tests/rollen.mjs). Bewijst:
//   (1) één factuur over twee werven = twee werfdelen (OA-facturen van 2.11) met elk hun controle; goedkeuren per deel, de aankoop
//       is goedgekeurd als alle delen goedgekeurd zijn; geen dubbele registratie (ook niet tegenover 2.11);
//   (2) ploeguren (personen × uren × tarief per persoon), manuren, het tarief van de werf PER DAG over een tariefwissel (2c.4);
//   (3) kostensoorten (transport per uur, diesel per km, kilometerheffing, container per ton, materiaal) met het tarief van de afspraak;
//   (4) uren per dag als vraag aan de werfleider naast het werfverslag, met het verschil, ZONDER bedrag; klopt / klopt niet met reden;
//       een werfleider van een andere werf en een gearchiveerde persoon zien niets;
//   (5) OA-voorschot uit de afspraak (max.), aftrek, restvoorschot op de laatste factuur;
//   (6) betaalkorting en de lijst Te betalen; betaald markeren; leveranciersfactuur zonder OA-controle; doorrekenen (voor 2c.5);
//   (7) de OA ziet enkel de stand van zijn eigen facturen (per factuur) met de betwiste dagen; .did zonder bedragen; export; audit.
// Enkel VERZONNEN gegevens: firma's "Proef … 2c7", gemeente Lindegem, postcode 9993.
//   node tests/aankoop-2c7.mjs <canister-id>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { backend, freshBackend } from "../tools/lib.mjs";
import { M, saveAll, fromRead } from "./offerte-lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/aankoop-2c7.mjs <canister-id>");
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const S = (x) => JSON.stringify(x, big);
const ok = (r) => { if (r && typeof r === "object" && "err" in r) throw new Error(r.err); return r && typeof r === "object" && "ok" in r ? r.ok : r; };
const isOk = (r) => r && typeof r === "object" && "ok" in r;
const errOf = (r) => (r && typeof r === "object" && "err" in r ? r.err : "");
const denied = async (p) => { try { const r = await p; return !!(r && "err" in r && /^Geen toegang/.test(r.err)); } catch (e) { return /Geen toegang|trap|Reject/i.test(String(e)); } };
const un = (a) => (Array.isArray(a) && a.length ? a[0] : null);
const keysOf = (x, out = new Set()) => { if (Array.isArray(x)) x.forEach((y) => keysOf(y, out)); else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { out.add(k); keysOf(v, out); } return out; };
const MONEY = /cents|price|cost|margin|amount|euro|total|agreed|rate/i;
const noMoney = (x) => ![...keysOf(x)].some((k) => MONEY.test(k));
const fakeBlob = (c) => new TextEncoder().encode("!caf!sha256:" + c.repeat(64));
const EXC = { exception: "Proef 2c7: verzonnen uitzondering voor de test" };

const [admin, calc, wl, arch, klant, vc] = await Promise.all(["proef-admin", "proef-calculator", "proef-werfleider", "proef-architect", "proef-klant", "proef-vc"].map((n) => backend(n, cid)));
const anon = await backend(null, cid);
const oaR = await freshBackend(cid);
const oaM = await freshBackend(cid);
const sfx = Date.now().toString(36).slice(-5).toUpperCase();
const cDay = BigInt(Math.floor(Number((await admin.auditLog(0n, 1n))[0].at / 1_000_000n) / 86_400_000));
const wd = (d) => (Number(d) + 3) % 7;
const nextWd = (d) => { let x = BigInt(d); while (wd(x) > 4) x++; return x; };
const s0 = await admin.getSettings();
const setIn = (z) => ({ werfleiderZietAlles: z, inviteDays: s0.inviteDays, threshold30bisCents: s0.threshold30bisCents, thresholdCheckinatworkCents: s0.thresholdCheckinatworkCents });
const oi0 = await admin.oaInvoiceSettings();
const ps0 = await admin.purchaseSettings();
ok(await admin.setSettings(setIn(false)));
ok(await admin.saveOaInvoiceSettings({ thresholdBp: 200n, thresholdCents: 1_000n, oaView: false, disputeNotice: "melding" }));
ok(await admin.savePurchaseSettings({ askHours: "verschil", passOn: true }));
try {

// ── B0. Opzet: twee OA-firma's met een login, een leverancier, drie werven (W3 zonder de werfleider) ──
const addr = { street: "Proefweg", number: "7", zip: "9993", city: "Lindegem", country: "BE" };
const orgOf = async (name, kind = "subcontractor") => ok(await admin.createOrg({ kind: { [kind]: null }, name, kbo: [], vat: [], aliases: [], trades: [], address: [addr], notes: "Verzonnen proeffirma (2c.7)" })).id;
const REIGER = await orgOf(`Proef Bouw Reiger 2c7 ${sfx}`);
const MEREL = await orgOf(`Proef Elektro Merel 2c7 ${sfx}`);
const KWARTEL = await orgOf(`Proef Bouwstoffen Kwartel 2c7 ${sfx}`, "supplier");
const KLANTORG = await orgOf(`Proef Klant Vink 2c7 ${sfx}`, "client");
const login = async (who, orgId, name) => { const c = ok(await admin.invitePerson({ name, roles: [{ onderaannemer: null }], orgId: [orgId], shortCode: [], lang: [], phone: [], workIds: [], validDays: 0n, tag: "proef 2c7" })); ok(await who.redeemCode(c.code)); };
await login(oaR, REIGER, `Proef OA Reiger ${sfx}`);
await login(oaM, MEREL, `Proef OA Merel ${sfx}`);
// Reiger is OA op W1 (Mijn facturen vraagt een OA die ergens actief is, R31).
const WLID = (await wl.me()).person[0].id;
const mkWork = async (code, leader = true) => ok(await admin.createWork({ code, name: "Proef aankoop 2c7", address: addr, parentId: [], clientOrgId: [KLANTORG], architectOrgId: [], leaderPersonId: leader ? [WLID] : [], vatBp: 2100n })).id;
const W1 = await mkWork(`P-AK1${sfx}`);
const W2 = await mkWork(`P-AK2${sfx}`);
const W3 = await mkWork(`P-AK3${sfx}`, false);
ok(await admin.addMembership(W1, [(await oaR.me()).person[0].id], [], { onderaannemer: null }, []));

// Tarieven van Reiger (vanaf 200 dagen geleden): regie € 42, transport € 55/u, diesel € 0,45/km, container € 95/ton.
for (const [k, u, c] of [["regie", "uur", 4200n], ["transport", "uur", 5500n], ["diesel", "km", 45n], ["container", "ton", 9500n]]) ok(await calc.saveOaRate({ orgId: REIGER, kind: k, unit: u, cents: c, validFrom: cDay - 200n, source: "prijslijst", ref: "proef 2c7", fileId: [], note: "" }));
// W1: offerte met een post van Reiger (100 st × € 12,34), aanvaard en gestart → afspraak met de tarieven.
const price = (cost, orgId = null) => ({ cost, rule: null, reason: "", orgId, source: orgId ? "oa-offerte" : "eigen", libCostId: null });
const q = ok(await calc.createQuote({ workId: W1, number: "", title: "Proef offerte 2c7" }));
{
  const m = fromRead(ok(await calc.readQuoteVersion(q.versionId)));
  const c1 = M.addChapter(m, { code: "01", title: "Proef ruwbouw 2c7" });
  M.addLine(m, c1.key, { title: "Proef stopcontact 2c7", qtyMilli: 100_000n, unit: "st", form: "vh", price: price(1234n, REIGER) });
  ok(await saveAll(calc, m));
  const r = ok(await calc.readQuoteVersion(q.versionId));
  ok(await calc.sendQuoteVersion(q.versionId, r.version.rev, r.totals.totalCents, "proef 2c7: waarschuwingen doorgezet"));
  ok(await calc.decideQuoteVersion(q.versionId, true, "proef 2c7: akkoord"));
}
const inp = (startDay) => ({ target: { existing: null }, startDay, templateKey: "", leaderPersonId: [], lineSteps: [], options: [], groupDays: [], skipPermits: [], declaration: false });
const startDay = nextWd(cDay - 40n);
const pv = ok(await wl.workStartPreview(q.versionId, inp(startDay)));
ok(await wl.startWorkFromQuote(q.versionId, inp(startDay), pv.planVersion));
const dR = (await calc.listDeals(W1)).find((d) => d.orgId === REIGER);
let dRev = ok(await calc.readDeal(dR.id)).deal.rev;
ok(await calc.saveDealTerms(dR.id, { advanceBp: 1000n, paymentDays: 30n, endOfMonth: true }, dRev));
dRev = ok(await calc.readDeal(dR.id)).deal.rev;
const WISSEL = cDay - 10n;
ok(await calc.addDealRate(dR.id, { kind: "regie", unit: "uur", cents: 4600n, validFrom: WISSEL, fromRateId: [], note: "proef 2c7: nieuw tarief op deze werf" }, dRev));
const full1 = ok(await calc.readDeal(dR.id));
check("(B0) afspraak met Reiger op W1: tarieven van de startdag (regie € 42, transport, diesel, container), regie € 46 vanaf de wisseldag, voorschot 10 % = € 123,40", full1.rates.some((r) => r.kind === "regie" && r.cents === 4200n) && full1.rates.some((r) => r.kind === "regie" && r.cents === 4600n && r.validFrom === WISSEL) && full1.rates.some((r) => r.kind === "transport") && un(full1.advanceCents) === 12_340n, S([full1.rates.map((r) => [r.kind, r.cents, r.validFrom]), full1.advanceCents]));
// W2: afspraak met de hand, regie € 45 (ploeg van 2 = € 90 per ploeguur).
const dR2 = ok(await calc.createDeal(W2, REIGER)).id;
ok(await calc.addDealRate(dR2, { kind: "regie", unit: "uur", cents: 4500n, validFrom: cDay - 60n, fromRateId: [], note: "proef 2c7" }, ok(await calc.readDeal(dR2)).deal.rev));
// Werfverslagen (de werfleider): Reiger op W1 en W2.
const report = async (workId, day, headcount, slots) => {
  const KR = crypto.randomUUID(); // een eigen toestel per verslag (dag en werf)
  const rsync = (op) => wl.reportSync([{ opId: crypto.randomUUID(), clientKey: KR, op }]);
  await rsync({ ensure: { workId, day } });
  await rsync({ attendance: { orgId: [REIGER], personId: [], names: "Proefploeg Reiger 2c7", headcount, slots, regie: true, taskId: [], note: "", replaces: [] } });
  await rsync({ finalize: null });
};
const S8 = [{ fromMin: 450n, toMin: 720n }, { fromMin: 750n, toMin: 960n }]; // 07:30–12:00 en 12:30–16:00 = 8 u
const D1 = cDay - 12n; // vóór de wisseldag (€ 42)
const D2 = cDay - 8n; // na de wisseldag (€ 46)
const D3 = cDay - 5n;
const D4 = cDay - 3n;
const D5 = cDay - 2n;
await report(W1, D1, 2n, S8);
await report(W1, D2, 2n, S8);
await report(W2, D3, 2n, [{ fromMin: 420n, toMin: 720n }, { fromMin: 750n, toMin: 930n }]); // 07:00–12:00, 12:30–15:30 = 8 u
await report(W1, D4, 1n, [{ fromMin: 450n, toMin: 960n }]); // 1 persoon 07:30–16:00 = 8,5 u
const fileW1 = ok(await calc.addFile("proef-aankoop-2c7.pdf", "application/pdf", 40_000n, fakeBlob("a"), [W1], true));
const fileStat = ok(await calc.addFile("proef-vorderingsstaat-oa-2c7.pdf", "application/pdf", 40_000n, fakeBlob("b"), [], true));
const fileOpen = ok(await calc.addFile("proef-open-2c7.pdf", "application/pdf", 40_000n, fakeBlob("c"), [W1], false));
check("(B0) opzet: firma's, logins, drie werven, werfverslagen, bijlagen", typeof fileW1 === "bigint" && typeof fileStat === "bigint");

// ── Hulp: een aankoop en een regel ──
const L = (workId, kind, description, qty, unit, o = {}) => ({ workId: workId === null ? [] : [workId], kind, root: [], description, persons: [], qtyMilli: qty, unit: o.u ?? "", unitCents: unit, amountCents: o.amount ?? (qty * unit >= 0n ? (qty * unit + 500n) / 1000n : -((-qty * unit + 500n) / 1000n)), passOn: o.passOn ?? false, days: o.days ?? [], ...(o.persons ? { persons: [o.persons] } : {}) });
const day = (d, persons, slots, pauseMin = 0n) => ({ day: d, persons, slots, pauseMin });
const P = (n, lines, o = {}) => {
  const net = lines.reduce((a, l) => a + l.amountCents, 0n);
  return { id: [], orgId: REIGER, kind: { oa: null }, number: `PA-${sfx}-${n}`, invoiceDay: cDay, dueDay: [cDay + 30n], discountUntil: [], discountBp: [], periodFrom: [], periodTo: [], vatRegime: { reverse: null }, reverseMention: true, fileId: [fileW1], oaStatementFileId: [], oaStatementRef: "", note: "proef 2c7", netCents: net, vatCents: 0n, totalCents: net, lines, finalWorkIds: [], ...o };
};
const read = async (id) => ok(await calc.readPurchase(id));
const partOf = (v, w) => v.brief.works.find((x) => x.workId === w);
const partView = async (v, w) => ok(await calc.readOaInvoice(un(partOf(v, w).partId)));

// ── B1. Rechten: enkel kantoor registreert en ziet bedragen ──
for (const [n, x] of [["werfleider", wl], ["architect", arch], ["OA", oaR], ["klant", klant], ["veiligheidscoördinator", vc], ["anoniem", anon]]) {
  const rs = await Promise.all([x.listPurchases([], []), x.readPurchase(1n), x.savePurchase(P("X", []), 0n), x.approvePurchase(1n, 0n, "proef"), x.listPurchasesToPay(), x.purchaseCosts(W1)].map(denied));
  check(`(B1) ${n}: lijst, lezen, registreren, goedkeuren, te betalen en doorrekenen geweigerd`, rs.every(Boolean), rs.map((r) => (r ? "·" : "✗")).join(""));
}

// ── B2. Voorschot van de OA (afspraak: 10 % = € 123,40) ──
const P0 = ok(await calc.savePurchase(P("V1", [L(W1, "voorschot", "Proef voorschot 10 %", 1_000n, 12_340n)]), 0n));
let v0 = await read(P0);
const adv0 = v0.advances.find((a) => a.workId === W1);
check("(B2) voorschotfactuur: één werfdeel op W1; toegelaten € 123,40, gefactureerd € 123,40, geen markering op de regel", v0.brief.works.length === 1 && adv0 && un(adv0.allowedCents) === 12_340n && adv0.advancedCents === 12_340n && v0.lines[0].moneyFlags.length === 0 && v0.lines[0].qtyFlags.length === 0, S(v0.advances));
const P0b = ok(await calc.savePurchase(P("V2", [L(W1, "voorschot", "Proef voorschot bijkomend", 1_000n, 5_000n)]), 0n));
const v0b = await read(P0b);
check("(B2) een tweede voorschot boven de afspraak: gemarkeerd (voorschot hoger dan de afspraak)", v0b.lines[0].moneyFlags.some((f) => f.key === "voorschot-boven-afspraak"), S(v0b.lines[0].moneyFlags));
check("(B2) voorschot op een werf zonder afspraak (W3): geweigerd", /afspraak/.test(errOf(await calc.savePurchase(P("V3", [L(W3, "voorschot", "x", 1_000n, 100n)]), 0n))));
check("(B2) aftrek voorschot met een positief bedrag: geweigerd", /negatief/.test(errOf(await calc.savePurchase(P("V4", [L(W1, "aftrek-voorschot", "x", 1_000n, 100n)]), 0n))));
check("(B2) intrekken zonder reden: geweigerd; met reden: ingetrokken (ook het werfdeel)", /reden/.test(errOf(await calc.withdrawPurchase(P0b, v0b.brief.rev, ""))) && isOk(await calc.withdrawPurchase(P0b, v0b.brief.rev, "proef: dubbel")) && (await calc.listOaInvoices([W1], [{ withdrawn: null }])).some((i) => un(i.purchaseId) === P0b));

// ── B3. Eén factuur over twee werven: manuren met een tariefwissel, kosten, ploeguren, algemene kost ──
const regieDays = [day(D1, 2n, S8), day(D2, 2n, S8)];
const P1lines = [
  L(W1, "regie", "Proef regie 32 u", 32_000n, 4400n, { u: "u", amount: 140_800n, days: regieDays }), // 16 × 42 + 16 × 46
  L(W1, "transport", "Proef transport", 3_000n, 5500n, { u: "uur" }),
  L(W1, "diesel", "Proef diesel", 400_000n, 50n, { u: "km" }),
  L(W1, "kmheffing", "Proef kilometerheffing", 120_000n, 15n, { u: "km" }),
  L(W1, "container", "Proef container puin", 2_500n, 9500n, { u: "ton", passOn: true }),
  L(W1, "materiaal", "Proef lijm", 1_000n, 12_000n, { u: "st", passOn: true }),
  L(W1, "aftrek-voorschot", "Proef aftrek voorschot", 1_000n, -6_000n),
  L(W2, "ploeg", "Proef ploeg 2 personen", 8_000n, 9000n, { u: "u", persons: 2n, days: [day(D3, 2n, [{ fromMin: 420n, toMin: 930n }], 30n)] }),
  L(null, "materiaal", "Proef administratiekost", 1_000n, 2_500n, { u: "st", passOn: true }),
];
const P1in = P("1", P1lines, { discountUntil: [cDay + 5n], discountBp: [150n], oaStatementFileId: [fileStat], oaStatementRef: "Proef vorderingsstaat 3" });
const r1 = await calc.savePurchase(P1in, 0n);
check("(B3) factuur over W1 en W2 met 9 regels geregistreerd", isOk(r1), errOf(r1));
const P1 = r1.ok;
let v1 = await read(P1);
check("(B3) twee werfdelen (W1, W2), een algemene kost, de vorderingsstaat als tweede bijlage", v1.brief.works.length === 2 && v1.brief.works.every((w) => un(w.partId) !== null) && v1.brief.general && v1.brief.hasStatement && v1.statement.length === 1 && v1.oaStatementRef.includes("vorderingsstaat"), S(v1.brief.works));
check("(B3) dezelfde firma en hetzelfde nummer nog eens: geweigerd; ook als OA-factuur van 2.11", /al geregistreerd/.test(errOf(await calc.savePurchase(P1in, 0n))) && /al geregistreerd/.test(errOf(await calc.saveOaInvoice({ id: [], orgId: REIGER, workId: W1, number: P1in.number, invoiceDay: cDay, dueDay: [], periodFrom: [], periodTo: [], vatRegime: { reverse: null }, reverseMention: true, fileId: [], note: "", netCents: 0n, vatCents: 0n, totalCents: 0n, lines: [] }, 0n))));
const p1w1 = await partView(v1, W1);
const p1w2 = await partView(v1, W2);
check("(B3) werfdeel W1 = OA-factuur van 2.11 met het nummer van de factuur, 7 regels, bedrag = som van de W1-regels; W2: 1 regel", p1w1.brief.number === P1in.number && p1w1.lines.length === 7 && p1w1.netCents === P1lines.slice(0, 7).reduce((a, l) => a + l.amountCents, 0n) && p1w2.lines.length === 1 && un(p1w1.brief.purchaseId) === P1 && !p1w1.canEdit, `${p1w1.lines.length} ${p1w1.netCents}`);
const ln = (v, i) => v.lines[i];
check("(B3) regie over de wisseldag: per dag 16 u × € 42 + 16 u × € 46 = € 1.408,00 = de factuur (geen prijs- of tariefwisselmarkering)", ln(v1, 0).days.length === 2 && un(ln(v1, 0).days[0].rateCents) === 4200n && un(ln(v1, 0).days[1].rateCents) === 4600n && un(ln(v1, 0).dayCents) === 140_800n && !ln(v1, 0).moneyFlags.some((f) => /prijs|tariefwissel|per-dag/.test(f.key)), S([ln(v1, 0).days.map((d) => [d.rateCents, d.cents]), ln(v1, 0).moneyFlags]));
check("(B3) de uren van de dagen = het werfverslag (2 × 8 u): geen vraag aan de werfleider", ln(v1, 0).days.every((d) => d.state === "geen-vraag" && d.diffMilli === 0n), S(ln(v1, 0).days.map((d) => [d.state, d.diffMilli])));
check("(B3) transport € 55/u = de afspraak: geen markering; diesel € 0,50 i.p.v. € 0,45 op 400 km: prijs hoger", un(ln(v1, 1).agreedCents) === 5500n && ln(v1, 1).moneyFlags.length === 0 && un(ln(v1, 2).agreedCents) === 45n && ln(v1, 2).moneyFlags.some((f) => f.key === "prijs-hoger"), S([ln(v1, 1).moneyFlags, ln(v1, 2).moneyFlags]));
check("(B3) kilometerheffing zonder tarief in de afspraak: gemarkeerd; container = de afspraak; materiaal zonder markering (geen 'niet gekoppeld')", ln(v1, 3).moneyFlags.some((f) => f.key === "geen-tarief") && ln(v1, 4).moneyFlags.length === 0 && ln(v1, 5).qtyFlags.length === 0 && ln(v1, 5).moneyFlags.length === 0, S([ln(v1, 3).moneyFlags, ln(v1, 4).moneyFlags, ln(v1, 5)]));
check("(B3) aftrek voorschot € 60 (≤ € 123,40): geen markering; voorschot nu € 123,40, afgetrokken € 60, rest € 63,40", ln(v1, 6).moneyFlags.length === 0 && v1.advances.some((a) => a.workId === W1 && a.deductedCents === 6_000n && a.restCents === 6_340n), S(v1.advances));
check("(B3) ploeguren: 2 personen × 8 u à € 90 = € 720; in het werfdeel 16 manuren à € 45 (= het regietarief van W2), per dag € 720, geen prijsmarkering", p1w2.lines[0].q.qtyMilli === 16_000n && p1w2.lines[0].m.unitCents === 4500n && un(ln(v1, 7).dayCents) === 72_000n && !p1w2.lines[0].m.flags.some((f) => /prijs|rekenfout|per-dag/.test(f)), S([p1w2.lines[0].q, p1w2.lines[0].m]));
check("(B3) de algemene kost hoort bij geen werfdeel; de aankoop zelf: som = excl. btw, verlegd met vermelding, bijlage (geen kopmarkering)", ln(v1, 8).workId.length === 0 && v1.headerFlags.length === 0 && v1.sumLinesCents === v1.netCents, S(v1.headerFlags));
check("(B3) betaalkorting: 1,5 % tot over 5 dagen = € " + (Number(v1.netCents * 150n / 10000n) / 100).toFixed(2), un(v1.discountBp) === 150n && un(v1.discountCents) === (v1.netCents * 150n + 5000n) / 10_000n, S(v1.discountCents));

// ── B4. Uren bevestigen: de werfleider ziet de dagen met een verschil, zonder bedrag ──
const P2lines = [
  L(W1, "regie", "Proef regie 24 u", 24_000n, 4600n, { u: "u", days: [day(D4, 2n, [{ fromMin: 450n, toMin: 960n }], 30n), day(D5, 1n, [{ fromMin: 480n, toMin: 990n }], 30n)] }),
  L(W3, "regie", "Proef regie W3", 8_000n, 4200n, { u: "u", days: [day(D4, 1n, [{ fromMin: 480n, toMin: 990n }], 30n)] }),
];
const P2 = ok(await calc.savePurchase(P("2", P2lines), 0n));
let v2 = await read(P2);
const hc = await wl.listHourClaims([W1]);
const c4 = hc.find((c) => c.number === `PA-${sfx}-2` && c.day === D4);
const c5 = hc.find((c) => c.number === `PA-${sfx}-2` && c.day === D5);
check("(B4) de werfleider van W1 ziet D4 (factuur 2 × 8 u = 16 u, werfverslag 1 persoon 8,5 u, verschil 7,5 u) en D5 (geen werfverslag)", !!c4 && c4.hoursMilli === 16_000n && c4.reportMilli === 8_500n && c4.reportPersons === 1n && c4.diffMilli === 7_500n && c4.state === "te-bevestigen" && c4.canReview && !!c5 && c5.reportMilli === 0n && c5.diffMilli === 8_000n, S([c4, c5]));
check("(B4) de dagen zonder verschil (factuur 1, D1 en D2) staan niet in de vraag (AC-24: enkel bij een verschil)", !hc.some((c) => c.number === `PA-${sfx}-1`));
check("(B4) de vraag aan de werfleider draagt geen bedrag (sleutels en factuurregel)", noMoney(hc), [...keysOf(hc)].filter((k) => MONEY.test(k)).join());
check("(B4) het werfdeel W1 van factuur 2: 'uren nog niet bevestigd door de werfleider'", ln(v2, 0).qtyFlags.some((f) => f.key === "uren-niet-bevestigd"), S(ln(v2, 0).qtyFlags));
// Werfleider van een andere werf (W3 zonder hem, 'werfleider ziet alles' uit)
check("(B4) werfleider van een andere werf: de dagen van W3 niet (lijst van W3 geweigerd, niet in zijn totale lijst, bevestigen geweigerd)", (await denied(wl.listHourClaims([W3]))) && !(await wl.listHourClaims([])).some((c) => c.workId === W3) && (await denied(wl.reviewHourClaim(ok(await calc.readPurchase(P2)).lines[1].days[0].claimId, true, ""))));
check("(B4) architect, OA, klant, VC, calculator: geen uren van OA-facturen", (await Promise.all([arch, oaR, klant, vc, calc].map((x) => denied(x.listHourClaims([W1]))))).every(Boolean));
check("(B4) klopt niet zonder reden: geweigerd", /reden/.test(errOf(await wl.reviewHourClaim(c4.id, false, ""))));
ok(await wl.reviewHourClaim(c4.id, false, "Proef: maar één persoon aanwezig volgens het verslag"));
ok(await wl.reviewHourClaim(c5.id, true, ""));
v2 = await read(P2);
const st = (await wl.listHourClaims([W1])).filter((c) => c.number === `PA-${sfx}-2`);
check("(B4) na het antwoord: D4 klopt niet (met reden en naam), D5 klopt; het werfdeel: 'de uren kloppen niet', niet meer 'niet bevestigd'", st.find((c) => c.day === D4)?.state === "klopt-niet" && st.find((c) => c.day === D4)?.reviewByName.length > 0 && st.find((c) => c.day === D5)?.state === "klopt" && ln(v2, 0).qtyFlags.some((f) => f.key === "uren-klopt-niet") && !ln(v2, 0).qtyFlags.some((f) => f.key === "uren-niet-bevestigd"), S(ln(v2, 0).qtyFlags));
check("(B4) kantoor krijgt een melding 'uren kloppen niet' (zonder bedrag)", (await admin.myNotifications(false)).some((n) => /kloppen niet/.test(n.text) && n.text.includes(`PA-${sfx}-2`) && !/€/.test(n.text)));
check("(B4) de werfleider ziet het werfdeel zonder bedrag (oaInvoiceQty)", noMoney(ok(await wl.oaInvoiceQty(un(partOf(v2, W1).partId)))));
// Een gearchiveerde werfleider
{
  const gone = await freshBackend(cid);
  const inv = ok(await admin.invitePerson({ name: `Proef Werfleider Weg ${sfx}`, roles: [{ werfleider: null }], orgId: [], shortCode: [], lang: [], phone: [], workIds: [W1], validDays: 1n, tag: "proef 2c7" }));
  const me = ok(await gone.redeemCode(inv.code));
  if (!("active" in me.status)) ok(await admin.confirmLink(me.principal));
  const before = await gone.listHourClaims([W1]).catch(() => null);
  ok(await admin.archivePerson(me.person[0].id));
  check("(B4) een tweede werfleider van W1 ziet de dagen; gearchiveerd: lijst en bevestigen geweigerd", Array.isArray(before) && before.some((c) => c.number === `PA-${sfx}-2`) && (await denied(gone.listHourClaims([W1]))) && (await denied(gone.reviewHourClaim(c5.id, true, ""))), S(before?.length));
}

// ── B5. Goedkeuren per werfdeel; de aankoop volgt ──
check("(B5) een werfdeel verbeteren of intrekken als OA-factuur van 2.11: geweigerd (verbeter de aankoopfactuur)", /werfdeel/.test(errOf(await calc.saveOaInvoice({ id: [un(partOf(v1, W1).partId)], orgId: REIGER, workId: W1, number: P1in.number, invoiceDay: cDay, dueDay: [], periodFrom: [], periodTo: [], vatRegime: { reverse: null }, reverseMention: true, fileId: [], note: "", netCents: 0n, vatCents: 0n, totalCents: 0n, lines: [] }, p1w1.brief.rev))) && /werfdeel/.test(errOf(await calc.withdrawOaInvoice(un(partOf(v1, W1).partId), p1w1.brief.rev, "proef intrekken"))));
check("(B5) approvePurchase op een aankoop met werfdelen: geweigerd (per werfdeel)", /werfdeel/.test(errOf(await calc.approvePurchase(P1, v1.brief.rev, "proef"))));
check("(B5) waarschuwing bij goedkeuren behouden: de attesten van Reiger zijn niet in orde (deel en aankoop)", p1w1.attestWarnings.length >= 1 && v1.attestWarnings.length >= 1);
ok(await calc.approveOaInvoice(un(partOf(v1, W1).partId), p1w1.brief.rev, EXC, "proef 2c7: markeringen gezien"));
v1 = await read(P1);
check("(B5) één deel goedgekeurd: de aankoop staat 'in controle'; verbeteren kan niet meer; intrekken ook niet", "checking" in v1.brief.status && !v1.canEdit && /beslist|geregistreerd/.test(errOf(await calc.savePurchase({ ...P1in, id: [P1] }, v1.brief.rev))) && /in-controle/.test(errOf(await calc.withdrawPurchase(P1, v1.brief.rev, "proef intrekken"))), S(v1.brief.status));
ok(await calc.approveOaInvoice(un(partOf(v1, W2).partId), p1w2.brief.rev, EXC, "proef 2c7: OA niet op de werf (afspraak met de hand)"));
v1 = await read(P1);
check("(B5) alle delen goedgekeurd: de aankoop is goedgekeurd; auditregel aankoop-stand", "approved" in v1.brief.status && v1.canPay && (await admin.auditLog(0n, 30n)).some((a) => a.action === "aankoop-stand" && a.detail.includes(P1in.number)), S(v1.brief.status));

// ── B6. De laatste factuur trekt het restvoorschot af ──
const P3in = (deduct) => P("3", [L(W1, "transport", "Proef transport slot", 1_000n, 5500n, { u: "uur" }), ...(deduct ? [L(W1, "aftrek-voorschot", "Proef aftrek rest", 1_000n, deduct)] : [])], { finalWorkIds: [W1] });
const P3 = ok(await calc.savePurchase(P3in(null), 0n));
let v3 = await read(P3);
check("(B6) laatste factuur zonder aftrek van de rest (€ 63,40): werfdeel gemarkeerd 'restvoorschot'", (await partView(v3, W1)).headerFlags.some((f) => f.key === "restvoorschot") && v3.finalWorkIds.includes(W1), S((await partView(v3, W1)).headerFlags));
ok(await calc.savePurchase({ ...P3in(-7_000n), id: [P3] }, v3.brief.rev));
v3 = await read(P3);
check("(B6) meer afgetrokken dan het voorschot (€ 60 + € 70 > € 123,40): gemarkeerd", ln(v3, 1).moneyFlags.some((f) => f.key === "aftrek-boven-voorschot"), S(ln(v3, 1).moneyFlags));
ok(await calc.savePurchase({ ...P3in(-6_340n), id: [P3] }, v3.brief.rev));
v3 = await read(P3);
const pv3 = await partView(v3, W1);
check("(B6) met de aftrek van de rest: geen markering meer; rest € 0", !pv3.headerFlags.some((f) => f.key === "restvoorschot") && !ln(v3, 1).moneyFlags.length && v3.advances.find((a) => a.workId === W1)?.restCents === 0n, S(v3.advances));
const advs = ok(await admin.exportChunk("oaAdvances", 0n, 500n)).oaAdvances;
const myAdv = advs.map(([k, c]) => [k, c.plain]).find(([, a]) => a.purchaseId === P0);
check("(B6) het voorschot (vertrouwelijk) kent zijn aftrekken: € 60 (factuur 1) en € 63,40 (factuur 3)", !!myAdv && myAdv[1].cents === 12_340n && myAdv[1].deducted.length === 2 && myAdv[1].deducted.reduce((a, [, x]) => a + x, 0n) === 12_340n, S(myAdv));

// ── B7. Leveranciersfactuur per werf (geen OA-controle, geen werfdelen) ──
const P5in = { ...P("L1", [L(W1, "container", "Proef container 10 m³", 3_000n, 8000n, { u: "ton", passOn: true }), L(W2, "machine", "Proef minigraver", 1_000n, 15_000n, { u: "dag" })], { dueDay: [cDay + 20n] }), orgId: KWARTEL, kind: { supplier: null }, vatRegime: { normal: 2100n }, reverseMention: false };
P5in.vatCents = (P5in.netCents * 2100n + 5000n) / 10_000n;
P5in.totalCents = P5in.netCents + P5in.vatCents;
check("(B7) leverancier met een regieregel: geweigerd (enkel op een OA-factuur)", /enkel op een OA-factuur/.test(errOf(await calc.savePurchase({ ...P5in, lines: [L(W1, "regie", "x", 1_000n, 1n)] }, 0n))));
check("(B7) een leverancier als OA-factuur: geweigerd", /onderaannemer/.test(errOf(await calc.savePurchase({ ...P5in, kind: { oa: null } }, 0n))));
const P5 = ok(await calc.savePurchase(P5in, 0n));
let v5 = await read(P5);
check("(B7) leveranciersfactuur op W1 en W2: geen werfdelen, niet bij de OA-facturen, geen markering (btw 21 % juist)", v5.brief.works.every((w) => w.partId.length === 0) && !(await calc.listOaInvoices([W1], [])).some((i) => i.number === P5in.number) && v5.flagCount === 0n && v5.canDecide, S([v5.headerFlags, v5.flagCount]));
ok(await calc.approvePurchase(P5, v5.brief.rev, ""));
v5 = await read(P5);
check("(B7) goedgekeurd zonder reden (geen markering), met beslissing", "approved" in v5.brief.status && un(v5.decision)?.approved === true);

// ── B8. Te betalen: eerst wat korting geeft, dan de vervaldag; betaald markeren ──
const pay = ok(await calc.listPurchasesToPay());
const i1 = pay.findIndex((r) => r.brief.id === P1);
const i5 = pay.findIndex((r) => r.brief.id === P5);
check("(B8) te betalen: factuur 1 (korting 1,5 %) vóór de leveranciersfactuur (enkel vervaldag); de tekst noemt de dag en het bedrag", i1 >= 0 && i5 >= 0 && i1 < i5 && /1,5 %/.test(pay[i1].text) && /uiterlijk op/.test(pay[i1].text) && pay[i1].payCents === pay[i1].totalCents - un(pay[i1].discountCents), S(pay[i1]));
check("(B8) te betalen: auditregel bekeek:te-betalen; werfleider geweigerd", (await admin.auditLog(0n, 10n)).some((a) => a.action === "bekeek:te-betalen") && (await denied(wl.listPurchasesToPay())));
check("(B8) betaald markeren in de toekomst: geweigerd; vandaag: uit de lijst", /Betaaldag/.test(errOf(await calc.markPurchasePaid(P1, v1.brief.rev, [cDay + 10n]))) && isOk(await calc.markPurchasePaid(P1, v1.brief.rev, [cDay])) && !ok(await calc.listPurchasesToPay()).some((r) => r.brief.id === P1));
check("(B8) een niet-goedgekeurde factuur betaald markeren: geweigerd", /goedgekeurde/.test(errOf(await calc.markPurchasePaid(P2, v2.brief.rev, [cDay]))));

// ── B9. Doorrekenen aan de klant (voor de min-meerstaat van 2c.5) ──
const costs = ok(await calc.purchaseCosts(W1));
const keyOk = costs.every((c) => new RegExp(`^kost:${c.purchaseId}:\\d+$`).test(c.key));
check("(B9) doorrekenbare kosten van W1: container en lijm van factuur 1, container van de leverancier; niet de regie, het transport, het voorschot of de algemene kost", costs.some((c) => c.purchaseId === P1 && c.kind === "container" && c.costCents === 23_750n) && costs.some((c) => c.purchaseId === P1 && c.kind === "materiaal" && c.costCents === 12_000n) && costs.some((c) => c.purchaseId === P5 && c.costCents === 24_000n) && !costs.some((c) => ["regie", "transport", "voorschot", "aftrek-voorschot"].includes(c.kind)) && !costs.some((c) => c.description === "Proef administratiekost") && keyOk, S(costs.map((c) => [c.key, c.kind, c.costCents])));
check("(B9) doorrekenen: auditregel; de werfleider geweigerd", (await admin.auditLog(0n, 10n)).some((a) => a.action === "bekeek:doorrekenen") && (await denied(wl.purchaseCosts(W1))));

// ── B10. De OA: enkel de stand van zijn eigen facturen (per factuur), met de betwiste dagen ──
check("(B10) zonder de schakelaar van de beheerder: Mijn facturen geweigerd", await denied(oaR.myPurchases()));
ok(await admin.saveOaInvoiceSettings({ thresholdBp: 200n, thresholdCents: 1_000n, oaView: true, disputeNotice: "melding" }));
try {
  const mine = await oaR.myPurchases();
  const m1 = mine.find((x) => x.number === P1in.number);
  const m2 = mine.find((x) => x.number === `PA-${sfx}-2`);
  check("(B10) Reiger ziet zijn facturen per factuur (factuur 1 over twee werven = één regel, goedgekeurd), zonder bedrag", !!m1 && m1.works.length === 2 && "approved" in m1.status && noMoney(mine) && !mine.some((x) => x.number === P5in.number), S(m1));
  check("(B10) factuur 2: de dag waarvan de werfleider zegt dat de uren niet kloppen (D4, 16 u) met de reden", !!m2 && m2.disputedDays.length === 1 && m2.disputedDays[0].day === D4 && m2.disputedDays[0].hoursMilli === 16_000n && /één persoon/.test(m2.disputedDays[0].note), S(m2));
  check("(B10) Mijn facturen van 2.11 toont de werfdelen niet nog eens", !(await oaR.myOaInvoices()).some((x) => x.number === P1in.number));
  const none = async (p) => { try { const r = await p; return Array.isArray(r) && !r.some((x) => x.number.startsWith(`PA-${sfx}`)); } catch (e) { return /Geen toegang/.test(String(e)); } };
  check("(B10) een andere OA (Merel, nergens actief) ziet niets van Reiger", (await none(oaM.myPurchases())) && (await none(oaM.myOaInvoices())));
} finally {
  ok(await admin.saveOaInvoiceSettings({ ...oi0 }));
}

// ── B11. .did zonder bedragen, export, auditlog ──
const did = readFileSync(join(import.meta.dirname, "../src/backend/dist/backend.did"), "utf8");
const didTypes = new Map([...did.matchAll(/^type (\w+) =([\s\S]*?);\n(?=type |service|$)/gm)].map((m) => [m[1], m[2]]));
const typeBody = (name) => didTypes.get(name) ?? null;
for (const t of ["HourClaimView", "MyPurchaseView", "MyDisputedDay", "PurchaseBrief", "PurchaseWorkRef"]) {
  const b = typeBody(t);
  check(`(B11) .did: ${t} zonder veld met een bedrag`, b !== null && !/cents|price|cost|amount|total|agreed/i.test(b), b === null ? "type niet gevonden" : "");
}
check("(B11) listHourClaims en myPurchases zijn queries zonder bedrag; readPurchase is een update-call", /listHourClaims: \(workId: opt nat\) -> \(vec HourClaimView\) query/.test(did) && /myPurchases: \(\) -> \(vec MyPurchaseView\) query/.test(did) && /readPurchase: \(id: nat\) -> \([A-Za-z_0-9]+\);/.test(did));
const exI = await admin.exportIntern();
const exC = await admin.exportConfidential();
check("(B11) export: intern de aankopen en de uren per dag (zonder bedragen), vertrouwelijk de regels en de voorschotten", exI.purchases.some((x) => x.id === P1) && exI.hourClaims.some((c) => c.purchaseId === P2) && noMoney(exI.purchases.filter((x) => x.id === P1).map(({ decision, ...r }) => r)) && exC.purchaseAmounts.some(([k]) => k === P1) && exC.oaAdvances.length >= 1);
check("(B11) werfleider: geen export van de bedragen", await denied(wl.exportChunk("purchaseAmounts", 0n, 1n)));
const log = await admin.auditLog(0n, 400n);
const mineLog = log.filter((a) => a.action.startsWith("aankoop-") || a.action.startsWith("uren-klopt"));
check("(B11) auditlog: registreren, verbeteren, intrekken, goedkeuren, betaald, uren; zonder bedragen", ["aankoop-geregistreerd", "aankoop-verbeterd", "aankoop-ingetrokken", "aankoop-goedgekeurd", "aankoop-betaald", "uren-klopt-niet", "uren-klopt"].every((k) => mineLog.some((a) => a.action === k)) && !mineLog.some((a) => /€/.test(a.detail)), mineLog.map((a) => a.action).join(","));
check("(B11) de bijlage van een aankoop kan niet los gearchiveerd worden", /aankoopfactuur/.test(errOf(await admin.archiveFile(fileStat))));
check("(B11) een open bestand als bijlage: geweigerd", /vertrouwelijk/.test(errOf(await calc.savePurchase({ ...P("B1", [L(W1, "materiaal", "x", 1_000n, 100n)]), fileId: [fileOpen] }, 0n))));

} catch (e) {
  check("geen onverwachte fout", false, String(e?.message ?? e).slice(0, 300));
} finally {
  // Opruimen: instellingen terug (ook na een fout, anders botsen de proeven erna).
  ok(await admin.setSettings(setIn(s0.werfleiderZietAlles)));
  ok(await admin.savePurchaseSettings(ps0));
  ok(await admin.saveOaInvoiceSettings({ ...oi0 }));
}
console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
