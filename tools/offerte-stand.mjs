// De stand van alle offertes, vorderingsstaten, prijsvragen (2c.2), OA-offertes, keuzes en hun prijzen in de bibliotheek (2c.3), OA-facturen en afspraken met de OA (2c.4), aankoopfacturen, uren per dag en voorschotten (2c.7), de min-meerstaat (2c.5) en rechten op een canister, als JSON (migratiecheck 2c.1, ontwerp 2c §9).
//   node tools/offerte-stand.mjs <canister> <uit.json>           met de .did van DEZE map (oude kopie of nieuwe code)
//   node tools/offerte-stand.mjs vergelijk <voor.json> <na.json>   elk veld van "voor" moet in "na" gelijk zijn (nieuwe velden
//                                                                   en nieuwe offertes tellen niet); geeft de verschillen
// Enkel op een EIGEN lokaal net met de proefidentiteiten van tests/rollen.mjs (nooit live: tools/lib.mjs weigert daar).
// Leest als beheerder, calculator, werfleider, architect, OA, klant en VC; elke lezing met bedragen schrijft een auditregel
// (de auditlog telt daarom niet mee). De uitvoer bevat enkel verzonnen proefgegevens, maar blijft buiten git.
import { readFileSync, writeFileSync } from "node:fs";
import { backend } from "./lib.mjs";

const big = (_, v) => (typeof v === "bigint" ? `${v}n` : v && typeof v === "object" && typeof v.toText === "function" && v._isPrincipal ? v.toText() : v);

if (process.argv[2] === "vergelijk") {
  const voor = JSON.parse(readFileSync(process.argv[3], "utf8"));
  const na = JSON.parse(readFileSync(process.argv[4], "utf8"));
  const diffs = [];
  // Projectie: enkel wat "voor" kent. Een veld dat erbij kwam (2c.1: grossCents, form, terms …) telt niet.
  const walk = (a, b, path) => {
    if (diffs.length > 200) return;
    if (a === null || typeof a !== "object") { if (a !== b) diffs.push(`${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`); return; }
    if (b === null || typeof b !== "object") { diffs.push(`${path}: ontbreekt na de upgrade`); return; }
    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) { diffs.push(`${path}: lengte ${a.length} → ${Array.isArray(b) ? b.length : "?"}`); return; }
      a.forEach((x, i) => walk(x, b[i], `${path}[${i}]`));
      return;
    }
    for (const k of Object.keys(a)) walk(a[k], b[k], `${path}.${k}`);
  };
  const skip = new Set((process.env.VERWACHT ?? "").split(",").filter(Boolean));
  for (const k of Object.keys(voor)) if (!skip.has(k)) walk(voor[k], na[k], k);
  const expected = [...skip].map((k) => { const before = diffs.length; walk(voor[k], na[k], k); const n = diffs.length - before; diffs.length = before; return `${k}: ${n === 0 ? "gelijk" : `${n} verschil(len), verwacht`}`; });
  console.log(`vergelijking ${process.argv[3]} → ${process.argv[4]}: ${diffs.length === 0 ? "GELIJK" : `${diffs.length} VERSCHIL(LEN)`}`);
  for (const e of expected) console.log(`  · ${e}`);
  for (const d of diffs.slice(0, 60)) console.log(`  ✗ ${d}`);
  process.exit(diffs.length ? 1 : 0);
}

const [cid, out] = process.argv.slice(2);
if (!cid || !out) throw new Error("gebruik: node tools/offerte-stand.mjs <canister> <uit.json>");
const names = { admin: "proef-admin", calculator: "proef-calculator", werfleider: "proef-werfleider", architect: "proef-architect", oa: "proef-oa2", klant: "proef-klant", vc: "proef-vc" };
const who = Object.fromEntries(await Promise.all(Object.entries(names).map(async ([k, n]) => [k, await backend(n, cid)])));
const res = async (p) => { try { const r = await p; return r && typeof r === "object" && "err" in r ? { err: r.err } : r && typeof r === "object" && "ok" in r ? { ok: r.ok } : { ok: r }; } catch (e) { return { trap: /Geen toegang/.test(String(e)) ? "Geen toegang" : String(e).slice(0, 80) }; } };
const allowed = (r) => ("ok" in r ? "ja" : "err" in r ? `fout: ${String(r.err).slice(0, 40)}` : "nee");

const stand = { rechten: {}, offertes: {}, versies: {}, perRol: {}, klant: {}, vorderingen: {}, regels: null, controle: {}, telling: {} };
for (const [k, b] of Object.entries(who)) {
  const me = await b.me();
  stand.rechten[k] = { status: me.status, rollen: me.person[0]?.roles ?? null, caps: me.caps[0] ?? null };
}
const quotes = await who.admin.listQuotes([], true);
for (const q of quotes) {
  stand.offertes[String(q.id)] = { number: q.number, title: q.title, workId: q.workId, archived: q.archived, versies: q.versions.map((v) => ({ id: v.id, version: v.version, status: v.status, lines: v.lines })) };
  for (const v of q.versions) {
    const r = await res(who.admin.readQuoteVersion(v.id));
    if (r.ok) {
      const x = r.ok;
      // De velden van vóór 2c.1 (een nieuw veld telt bij de vergelijking toch niet; dit houdt het bestand klein).
      stand.versies[String(v.id)] = { scope: x.scope, version: x.version, chapters: x.chapters, lines: x.lines, totals: x.totals, sell: x.sell, costs: x.costs, margins: x.margins, check: x.check, vatNote: x.vatNote, doc: x.doc };
    } else stand.versies[String(v.id)] = r;
    const per = {};
    for (const rol of ["calculator", "werfleider", "architect", "oa", "klant", "vc"]) {
      const y = await res(who[rol].readQuoteVersion(v.id));
      per[rol] = y.ok ? { scope: y.ok.scope, totals: y.ok.totals, sell: y.ok.sell, costs: y.ok.costs.length } : allowed(y);
    }
    stand.perRol[String(v.id)] = per;
    if ("draft" in v.status) stand.controle[String(v.id)] = await res(who.admin.checkQuoteVersion(v.id));
  }
}
const mine = await res(who.klant.listMyQuotes());
if (mine.ok) for (const x of mine.ok) stand.klant[String(x.versionId)] = { kort: x, lezen: await res(who.klant.readMyQuote(x.versionId)) };
else stand.klant.fout = mine;
stand.regels = await res(who.admin.getQuoteRules());
for (const w of await who.admin.listWorks()) {
  const list = await res(who.admin.listProgress(w.id));
  if (!list.ok || list.ok.length === 0) continue;
  stand.vorderingen[String(w.id)] = list.ok;
  for (const p of list.ok) stand.vorderingen[`staat-${p.id}`] = await res(who.admin.readProgressStatement(p.id));
}
// 2c.2: de prijsvragen (enkel als de code ze kent): de prijsvraag zelf (kantoor), de stand per rol, wat de OA van zijn eigen
// uitnodiging ziet en de bedragen van elke OA-offerte (update-call met auditregel). Een oudere code kent geen prijsvragen: dan
// staat de sleutel er niet, en telt hij bij de vergelijking niet mee.
if (typeof who.admin.listTenders === "function") {
  stand.prijsvragen = {};
  stand.prijsvraagRechten = {};
  stand.oaOffertes = {};
  stand.mijnPrijsvragen = {};
  for (const w of await who.admin.listWorks()) {
    const list = await res(who.admin.listTenders([w.id]));
    if (!list.ok || list.ok.length === 0) continue;
    const per = {};
    for (const rol of ["calculator", "werfleider", "architect", "oa", "klant", "vc"]) per[rol] = allowed(await res(who[rol].listTenders([w.id])));
    stand.prijsvraagRechten[String(w.id)] = per;
    for (const t of list.ok) {
      const full = await res(who.admin.readTender(t.id));
      stand.prijsvragen[String(t.id)] = { status: t, full, werfleider: allowed(await res(who.werfleider.readTender(t.id))) };
      if (full.ok) for (const i of full.ok.invites) for (const q of i.oaQuotes) stand.oaOffertes[String(q.id)] = await res(who.admin.readOaQuote(q.id));
    }
  }
  const mine = await res(who.oa.listMyTenders());
  stand.mijnPrijsvragen.lijst = mine;
  if (mine.ok) for (const b of mine.ok) stand.mijnPrijsvragen[b.ref] = await res(who.oa.readMyTender(b.ref));
}
// 2c.3: de vergelijking, de keuzes en het prijsgeheugen (enkel als de code ze kent): per prijsvraag de vergelijking (update-call met
// auditregel) en wie ze mag lezen, de OA-offertes per werf (ook de losse), alle keuzes (vertrouwelijke export) en de aankoopprijzen
// uit OA-offertes in de bibliotheek (bron "oa-offerte", gekozen en niet gekozen), de instellingen van de prijsvragen.
if (typeof who.admin.compareTender === "function") {
  stand.vergelijkingen = {};
  stand.vergelijkingRechten = {};
  stand.oaOffertesPerWerf = {};
  for (const w of await who.admin.listWorks()) {
    const l = await res(who.admin.listOaQuotes(w.id));
    if (l.ok && l.ok.length) stand.oaOffertesPerWerf[String(w.id)] = l.ok;
    const ts = await res(who.admin.listTenders([w.id]));
    if (!ts.ok) continue;
    for (const t of ts.ok) {
      stand.vergelijkingen[String(t.id)] = await res(who.admin.compareTender(t.id));
      const per = {};
      for (const rol of ["calculator", "werfleider", "architect", "oa", "klant", "vc"]) per[rol] = allowed(await res(who[rol].compareTender(t.id)));
      stand.vergelijkingRechten[String(t.id)] = per;
    }
  }
  const chunk = async (kind) => { const out = []; for (let from = 0n; ; from += 500n) { const r = await res(who.admin.exportChunk(kind, from, 500n)); const xs = r.ok ? Object.values(r.ok)[0] : []; out.push(...xs); if (xs.length < 500) return out; } };
  // Als object per id: nieuwe keuzes en prijzen tellen bij de vergelijking niet, gewijzigde wel.
  stand.keuzes = Object.fromEntries((await chunk("tenderChoices")).map(([k, v]) => [String(k), v]));
  stand.oaPrijzen = Object.fromEntries((await chunk("libCosts")).filter((c) => c.source === "oa-offerte").map((c) => [String(c.id), c]));
  stand.prijsvraagInstellingen = await res(who.admin.tenderSettings());
}
const chunkOf = async (kind) => { const out = []; for (let from = 0n; ; from += 500n) { const r = await res(who.admin.exportChunk(kind, from, 500n)); const xs = r.ok ? Object.values(r.ok)[0] : []; out.push(...xs); if (xs.length < 500) return out; } };
// 2c.4 (ook voor oudere code): de OA-facturen met hun controle (de afgesproken prijs per regel en de markeringen). Een nieuwe
// afspraak op een werf mag de controle van een bestaande factuur op een andere werf nooit veranderen.
if (typeof who.admin.readOaInvoice === "function") {
  stand.oaFacturen = {};
  for (const i of (await res(who.admin.listOaInvoices([], []))).ok ?? []) {
    const r = await res(who.admin.readOaInvoice(i.id));
    stand.oaFacturen[String(i.id)] = r.ok ? { brief: r.ok.brief, lines: r.ok.lines, headerFlags: r.ok.headerFlags, flagCount: r.ok.flagCount, decision: r.ok.decision } : r;
  }
}
// 2c.4: de afspraken met de gekozen OA (enkel als de code ze kent): per werf de stand (kantoor en werfleider) en de afspraak met
// bedragen (update-call met auditregel), wie wat mag lezen, per firma de tarieven en attesten, Mijn contracten/attesten van de OA,
// de vastgelegde contractversies en het sjabloon.
if (typeof who.admin.listDeals === "function") {
  stand.afspraken = {};
  stand.afspraakRechten = {};
  for (const w of await who.admin.listWorks()) {
    const l = await res(who.admin.listDeals(w.id));
    if (!l.ok || l.ok.length === 0) continue;
    stand.afspraken[`werf-${w.id}`] = { kantoor: l.ok, werfleider: await res(who.werfleider.listDeals(w.id)) };
    for (const d of l.ok) {
      stand.afspraken[String(d.id)] = await res(who.admin.readDeal(d.id));
      const per = {};
      for (const rol of ["calculator", "werfleider", "architect", "oa", "klant", "vc"]) per[rol] = { lijst: allowed(await res(who[rol].listDeals(w.id))), bedragen: allowed(await res(who[rol].readDeal(d.id))) };
      stand.afspraakRechten[String(d.id)] = per;
    }
  }
  stand.tarieven = {};
  stand.attesten = {};
  for (const o of await who.admin.listOrgs(true)) {
    const r = await res(who.admin.listOaRates(o.id));
    if (r.ok && r.ok.length) stand.tarieven[String(o.id)] = r.ok;
    const a = await res(who.admin.listOrgDocs(o.id));
    if (a.ok && a.ok.docs.length) stand.attesten[String(o.id)] = a.ok;
  }
  stand.mijnContracten = await res(who.oa.listMyContracts());
  stand.mijnAttesten = await res(who.oa.listMyAttests());
  stand.contracten = Object.fromEntries((await chunkOf("agreementFrozen")).map(([k, v]) => [String(k), v]));
  stand.contractSjablonen = await res(who.admin.listContractTemplates());
}
// 2c.7: de aankoopfacturen (enkel als de code ze kent): elke aankoop met bedragen en controle (update-call met auditregel), wie de
// lijst en de aankoop mag lezen, de uren per dag per werf (werfleider en beheerder), te betalen, de doorrekenbare kosten per werf, de
// stand van de OA (Mijn facturen) en de vertrouwelijke regels en voorschotten.
if (typeof who.admin.listPurchases === "function") {
  stand.aankopen = {};
  stand.aankoopRechten = {};
  stand.uren = {};
  stand.doorrekenen = {};
  for (const b of (await res(who.admin.listPurchases([], [{ withdrawn: null }]))).ok ?? []) stand.aankopen[`ingetrokken-${b.id}`] = b;
  for (const b of (await res(who.admin.listPurchases([], []))).ok ?? []) {
    stand.aankopen[String(b.id)] = await res(who.admin.readPurchase(b.id));
    const per = {};
    for (const rol of ["calculator", "werfleider", "architect", "oa", "klant", "vc"]) per[rol] = allowed(await res(who[rol].readPurchase(b.id)));
    stand.aankoopRechten[String(b.id)] = per;
  }
  const lijst = {};
  for (const rol of ["calculator", "werfleider", "architect", "oa", "klant", "vc"]) lijst[rol] = allowed(await res(who[rol].listPurchases([], [])));
  stand.aankoopRechten.lijst = lijst;
  for (const w of await who.admin.listWorks()) {
    const u = await res(who.admin.listHourClaims([w.id]));
    if (u.ok && u.ok.length) stand.uren[String(w.id)] = { beheerder: u.ok, werfleider: await res(who.werfleider.listHourClaims([w.id])) };
    const c = await res(who.admin.purchaseCosts(w.id));
    if (c.ok && c.ok.length) stand.doorrekenen[String(w.id)] = c.ok;
  }
  // Als object per id: nieuwe aankopen en dagen tellen bij de vergelijking niet, gewijzigde wel.
  const byId = (r, f) => (r.ok ? Object.fromEntries(r.ok.map((x) => [String(f(x)), x])) : r);
  stand.urenWerfleider = byId(await res(who.werfleider.listHourClaims([])), (c) => c.id);
  stand.teBetalen = byId(await res(who.admin.listPurchasesToPay()), (r) => r.brief.id);
  stand.mijnAankopen = byId(await res(who.oa.myPurchases()), (x) => x.number);
  stand.aankoopInstellingen = await res(who.admin.purchaseSettings());
  stand.aankoopBedragen = Object.fromEntries((await chunkOf("purchaseAmounts")).map(([k, v]) => [String(k), v]));
  stand.oaVoorschotten = Object.fromEntries((await chunkOf("oaAdvances")).map(([k, v]) => [String(k), v]));
}
// 2c.5: de min-meerstaat (enkel als de code ze kent): per werf de levende staat met bedragen (kantoor, update-call met auditregel:
// regels, totalen, versies), wie wat mag lezen (hoeveelheden, bedragen), elke vastgelegde versie (inhoud, controlecode, intact,
// akkoord), wat de klant van de gedeelde versies ziet, de vertrouwelijke export (prijzen, regietarief, inhoud) en de instellingen.
if (typeof who.admin.readMinMeer === "function") {
  stand.minMeer = {};
  stand.minMeerRechten = {};
  stand.minMeerVersies = {};
  for (const w of await who.admin.listWorks()) {
    const r = await res(who.admin.readMinMeer(w.id));
    if (!r.ok) { stand.minMeer[String(w.id)] = r; continue; }
    if (r.ok.rows.length === 0 && r.ok.versions.length === 0 && r.ok.entries.length === 0) continue;
    stand.minMeer[String(w.id)] = { rows: r.ok.rows, discs: r.ok.discs, invoiced: r.ok.invoiced, entries: r.ok.entries, totals: r.ok.totals, chapters: r.ok.chapters, regieRates: r.ok.regieRates, versions: r.ok.versions, baseQuote: r.ok.baseQuote };
    const per = {};
    for (const rol of ["calculator", "werfleider", "architect", "oa", "klant", "vc"]) per[rol] = { hoeveelheden: allowed(await res(who[rol].minMeerQty(w.id))), bedragen: allowed(await res(who[rol].readMinMeer(w.id))) };
    stand.minMeerRechten[String(w.id)] = per;
    for (const v of r.ok.versions) stand.minMeerVersies[String(v.id)] = await res(who.admin.readMinMeerVersion(v.id));
  }
  const mm = await res(who.klant.listMyMinMeer());
  // Per id (een nieuwe gedeelde versie telt bij de vergelijking niet, een gewijzigde wel).
  stand.mijnMinMeer = mm.ok ? Object.fromEntries(mm.ok.map((b) => [`lijst-${b.id}`, b])) : { lijst: mm };
  if (mm.ok) for (const b of mm.ok) stand.mijnMinMeer[String(b.id)] = await res(who.klant.readMyMinMeer(b.id));
  stand.minMeerPrijzen = Object.fromEntries((await chunkOf("mmPrices")).map(([k, v]) => [String(k), v]));
  stand.minMeerTarieven = Object.fromEntries((await chunkOf("mmRegieRates")).map(([k, v]) => [String(k), v]));
  stand.minMeerInhoud = Object.fromEntries((await chunkOf("mmFrozen")).map(([k, v]) => [String(k), v]));
  stand.minMeerInstellingen = await res(who.admin.minMeerSettings());
}
// 2c.8: de werfadministratie (enkel als de code ze kent): per werf verzekeringen, werfvergaderingen, opleveringen, de fichekeuze en
// de klantweergave, wie ze mag lezen, werfwaarde en premie (update-call met auditregel), de bibliotheek van fiches en de instellingen.
if (typeof who.admin.listInsurances === "function") {
  stand.werfadmin = {};
  stand.werfadminRechten = {};
  for (const w of await who.admin.listWorks()) {
    const rec = {
      verzekeringen: await res(who.admin.listInsurances([w.id], true)),
      vergaderingen: await res(who.admin.listMeetings(w.id)),
      opleveringen: await res(who.admin.listHandovers(w.id)),
      fiches: await res(who.admin.workTechSheets(w.id)),
    };
    const ids = (rec.verzekeringen.ok ?? []).map((x) => x.id);
    rec.premies = {};
    for (const id of ids) rec.premies[String(id)] = await res(who.admin.readInsuranceConf(id));
    if (ids.length || rec.vergaderingen.ok?.length || rec.opleveringen.ok?.length || rec.fiches.ok?.length) stand.werfadmin[String(w.id)] = rec;
    if (ids.length) {
      const per = {};
      for (const rol of ["calculator", "werfleider", "architect", "oa", "klant", "vc"]) per[rol] = { lijst: allowed(await res(who[rol].listInsurances([w.id], false))), premie: allowed(await res(who[rol].readInsuranceConf(ids[0]))), vergaderingen: allowed(await res(who[rol].listMeetings(w.id))), klant: allowed(await res(who[rol].clientSiteAdmin(w.id))) };
      stand.werfadminRechten[String(w.id)] = per;
    }
  }
  stand.klantWeergave = await res(who.klant.clientSiteAdmin((await who.admin.listWorks())[0]?.id ?? 0n));
  // Als object per id: een nieuwe jaarpolis of fiche telt bij de vergelijking niet, een gewijzigde wel.
  const perId = (r) => (r.ok ? Object.fromEntries(r.ok.map((x) => [String(x.id), x])) : r);
  stand.jaarpolissen = perId(await res(who.admin.listInsurances([], true)));
  stand.ficheBibliotheek = perId(await res(who.admin.listTechSheets(true)));
  // Zonder nextCode: de volgende werfcode verandert zodra er een werf bijkomt (geen wijziging van wat bestond).
  const wi = await res(who.admin.siteAdminSettings());
  stand.werfadminInstellingen = wi.ok ? { ok: { codeP: wi.ok.codeP, rates: wi.ok.rates } } : wi;
  stand.werfadminExport = {};
  for (const k of ["insurances", "siteMeetings", "handovers", "techSheets", "workSheets", "siteNotices", "insuranceConf"]) stand.werfadminExport[k] = Object.fromEntries((await chunkOf(k)).map((x, i) => [String(Array.isArray(x) ? x[0] : x.id ?? i), x]));
}
// 2c.6: de verkoopfacturen per werf (lijst, schema met bedragen, elke factuur met haar vastgelegde inhoud en betalingen), de rechten
// erop, wat de klant ziet, de vertrouwelijke export en de instellingen met de tellers. Zonder de dag van vandaag (die verschuift).
if (typeof who.admin.readSalesPlan === "function") {
  const noToday = (x) => { if (x && x.ok && typeof x.ok === "object") { const { today: _t, ...rest } = x.ok; return { ok: rest }; } if (x && typeof x === "object" && "today" in x) { const { today: _t, ...rest } = x; return rest; } return x; };
  stand.facturen = {};
  stand.factuurSchema = {};
  stand.factuurRechten = {};
  for (const w of await who.admin.listWorks()) {
    const list = await res(who.admin.listSales(w.id));
    const plan = await res(who.admin.readSalesPlan(w.id));
    if (plan.ok) stand.factuurSchema[String(w.id)] = plan;
    for (const b of list.ok ?? []) {
      const r = noToday(await res(who.admin.readSalesInvoice(b.id)));
      // Een ontwerp toont hoe het er VANDAAG uit zou zien (datum, vervaldag): zonder die voorvertoning.
      if (b.status === "ontwerp" && r.ok) delete r.ok.doc;
      stand.facturen[String(b.id)] = { brief: b, inhoud: r };
    }
    if (!plan.ok && (list.ok ?? []).length === 0) continue;
    const per = {};
    for (const rol of ["calculator", "werfleider", "architect", "oa", "klant", "vc"]) per[rol] = { schema: allowed(await res(who[rol].readSalesPlan(w.id))), lijst: allowed(await res(who[rol].listSales(w.id))), voorschot: allowed(await res(who[rol].salesFacts(w.id))) };
    stand.factuurRechten[String(w.id)] = per;
  }
  const ms = await res(who.klant.listMySales());
  stand.mijnFacturen = ms.ok ? Object.fromEntries(ms.ok.invoices.map((r) => [String(r.id), r])) : { lijst: ms };
  if (ms.ok) for (const r of ms.ok.invoices) stand.mijnFacturen[`inhoud-${r.id}`] = await res(who.klant.readMySalesInvoice(r.id));
  stand.factuurInhoud = Object.fromEntries((await chunkOf("salesFrozen")).map(([k, v]) => [String(k), v]));
  stand.factuurBetalingen = Object.fromEntries((await chunkOf("salesPayments")).map(([k, v]) => [String(k), v]));
  stand.factuurOntwerpen = Object.fromEntries((await chunkOf("salesDrafts")).map(([k, v]) => [String(k), v]));
  stand.factuurInstellingen = noToday(await res(who.admin.salesSettings()));
}
const ex = await who.admin.exportIntern();
for (const [k, v] of Object.entries(ex)) if (Array.isArray(v)) stand.telling[k] = v.length;
delete stand.telling.notifications; // leesacties kunnen meldingen maken
writeFileSync(out, JSON.stringify(stand, big, 1), { mode: 0o600 });
console.log(`stand van ${cid} → ${out}: ${quotes.length} offertes, ${Object.keys(stand.versies).length} versies, ${Object.keys(stand.vorderingen).filter((k) => !k.startsWith("staat-")).length} werven met vorderingsstaten`);
