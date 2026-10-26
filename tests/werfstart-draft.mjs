// Offerte → werf (stap 2.8, bouwplan §9 rij 2.8) op een canister die al in gebruik is (een draft of het eigen net).
// Zet enkel VERZONNEN testgegevens: per run een eigen proefwerf "P-WS-…" (status offerte, klant "Familie Proef"), proefposten
// "Proef … (2.8)" in de bibliotheek (importsleutel "proef-2.8:…") en proefoffertes "WS-…" (nooit een echte prijs of klant).
// Op het einde staan de proefwerven op "geannuleerd". Gebruikt de testidentiteiten van tests/rollen.mjs (of tools/draft-opbouw.mjs).
// Bewijst vooral:
//   (1) een aanvaarde offerte geeft een VOORSTEL (lijst + voorvertoning) voor admin en werfleider, niet voor calculator of externen;
//   (2) het voorstel: taken per stap van het sjabloon uit de posten (bibliotheek, titel, hoofdstuk), duur en OA uit de bibliotheek,
//       volgorde en afhankelijkheden uit het sjabloon, opties/p.m./minwerk geen taak, vergunningen met uiterste aanvraagdag, 30bis;
//       NOOIT een bedrag (ook niet voor de admin), zodat de werfleider niets ziet wat hij niet mag;
//   (3) bevestigen maakt de taken (zoals voorgesteld), afhankelijkheden, uitvoerders, vergunningsvoorstellen, de aangifte en het
//       contract (aanneemsom en getekende versie; enkel admin/calculator lezen het), de werf "gepland"; alles in de auditlog;
//   (4) idempotent: twee keer bevestigen = dezelfde start, niets dubbel;
//   (5) meerwerk (een nieuwe aanvaarde versie): enkel het verschil, bestaande stap = lijnen gekoppeld, vervallen/gewijzigd gemeld;
//   (6) afwijzen met reden; een nieuwe werf (deelwerf) als doel; de werfleider kan de werfleider niet wisselen; export.
//   node tests/werfstart-draft.mjs <canister-id>
import { backend, freshBackend } from "../tools/lib.mjs";
import { M, ensureProofClientAddress, fromRead, saveAll, unopt } from "./offerte-lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/werfstart-draft.mjs <canister-id>");
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const isOk = (r) => r && typeof r === "object" && "ok" in r;
const ok = (r) => { if (r && "err" in r) throw new Error(r.err); return r.ok; };
const errOf = (r) => (r && "err" in r ? r.err : "");
const denied = async (p) => { try { const r = await p; return !!(r && "err" in r && /^Geen toegang/.test(r.err)); } catch (e) { return /Geen toegang|trap|Reject|reject/i.test(String(e)); } };
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const flat = (x) => JSON.stringify(x, big);
const tagOf = (v) => Object.keys(v)[0];
const today = Math.floor(Date.now() / 86_400_000);
const wd = (d) => (d + 3) % 7; // 0 = maandag
const nextWd = (d) => { let x = d; while (wd(x) > 4) x++; return x; };

const [admin, wl, calc, arch, oa2, klant, vc] = await Promise.all(["proef-admin", "proef-werfleider", "proef-calculator", "proef-architect", "proef-oa2", "proef-klant", "proef-vc"].map((n) => backend(n, cid)));
const anon = await backend(null, cid);
const vreemd = await freshBackend(cid);
const me = await admin.me();
check("versie 2.8 of later op de canister", /^2\.([89]|1\d)|^(2b|[3-9])\./.test(me.version) || /^0\.0|dev/.test(me.version), me.version);
const familie = await ensureProofClientAddress(admin);
const orgs = await admin.listOrgs(false);
const dak = orgs.find((o) => o.name === "Proef Dak NV");
const elek = orgs.find((o) => o.name === "Proef Elektro BV");
const wlMe = await wl.me();
check("proefgegevens: Familie Proef, Proef Dak NV, Proef Elektro BV en de proefwerfleider bestaan", !!familie && !!dak && !!elek && "active" in wlMe.status);
const wlId = wlMe.person[0].id;

// ── Proefposten in de bibliotheek (verzonnen; idempotent via de importsleutel) ──
const chs = await calc.libraryChapters(false);
if (chs.length === 0) ok(await calc.loadLibraryStartChapters());
const ch0 = (await calc.libraryChapters(false))[0];
const filter = { text: "Proef", chapterId: [], trade: [], unit: [], form: [], orgId: [], includeArchived: true, offset: 0n, limit: 200n };
const have = new Map();
for (const it of (await calc.listLibrary(filter)).items) if (it.importKey.length) have.set(it.importKey[0], it);
const lib = async (key, x) => {
  if (have.has(key)) return have.get(key);
  const r = await calc.saveLibraryItem({ id: [], chapterId: ch0.id, code: x.code, title: x.title, text: "Verzonnen proefpost (draftproef 2.8).", unit: x.unit, form: { vh: null }, trade: x.trade ?? [], orgId: x.orgId ?? [], durationDays: x.days ?? [], perDayMilli: x.perDay ?? [], planStepKey: x.step ?? [], keywords: ["proef"], importKey: [key] }, 0n);
  return ok(r);
};
const iAfbraak = await lib("proef-2.8:afbraak", { code: "P2.8-01", title: "Proef afbraak binnenmuren (2.8)", unit: "m2", trade: ["afbraak"], days: [4n], step: ["afbraak"] });
const iDak = await lib("proef-2.8:dak", { code: "P2.8-02", title: "Proef dakgoot vervangen (2.8)", unit: "lm", trade: ["dak"], orgId: [dak.id], days: [2n] });
const iElek = await lib("proef-2.8:elek", { code: "P2.8-03", title: "Proef stopcontacten (2.8)", unit: "st", trade: ["elektriciteit"], orgId: [elek.id], perDay: [8_000n], step: ["elektriciteit"] });
check("proefposten 2.8 in de bibliotheek (stap, duur, vakgebied, standaard-OA)", !!iAfbraak && !!iDak && !!iElek && unopt(iElek.planStepKey) === "elektriciteit");

// ── Een eigen proefwerf voor deze run ──
const stamp = Date.now().toString(36).toUpperCase();
const W = `P-WS-${stamp}`;
const addr = { street: "Proefstraat", number: "28", zip: "8670", city: "Koksijde", country: "BE" };
const wNew = ok(await admin.createWork({ code: W, name: "Proefwerf werfstart (2.8)", address: addr, parentId: [], clientOrgId: [familie], architectOrgId: [], leaderPersonId: [wlId], vatBp: 2100n }));
ok(await admin.setWorkStatus(wNew.id, { quoting: null }));
const wid = wNew.id;

// ── Offertes maken, invullen, versturen en aanvaarden (zoals kantoor) ──
const price = (cost) => ({ cost, rule: null, reason: "", orgId: null, source: "eigen", libCostId: null });
const fromLib = (it) => ({ libItemId: it.id, libItemVersion: it.version });
const mkQuote = async (nr, title) => ok(await calc.createQuote({ workId: wid, number: nr, title }));
const fill = async (vid, build) => {
  const m = fromRead(ok(await calc.readQuoteVersion(vid)));
  build(m);
  const r = await saveAll(calc, m);
  if (r && "err" in r) throw new Error(errOf(r));
};
const sendAccept = async (vid) => {
  const r = ok(await calc.readQuoteVersion(vid));
  ok(await calc.sendQuoteVersion(vid, r.version.rev, r.totals.totalCents, "proef: draftproef 2.8"));
  ok(await calc.decideQuoteVersion(vid, true, "proef: akkoord (draftproef 2.8)"));
  return ok(await calc.readQuoteVersion(vid));
};
const NR1 = `WS-${stamp}`;
const q1 = await mkQuote(NR1, "Proef offerte werfstart (2.8)");
const v1 = q1.versionId;
await fill(v1, (m) => {
  M.setHeader(m, { clientOrgId: familie });
  const c1 = M.addChapter(m, { code: "01", title: "Afbraak" });
  M.addLine(m, c1.key, { title: iAfbraak.title, qtyMilli: 40_000n, unit: "m2", form: "vh", price: price(2500n), ...fromLib(iAfbraak) });
  M.addLine(m, c1.key, { title: "Proef container 10 m³ puin", qtyMilli: 2_000n, unit: "st", form: "fixed", price: price(32_000n) });
  M.addLine(m, c1.key, { kind: "text", title: "Proef: alle afbraak volgens lastenboek (tekstregel)", unit: "" });
  const c2 = M.addChapter(m, { code: "02", title: "Dak" });
  M.addLine(m, c2.key, { title: iDak.title, qtyMilli: 12_000n, unit: "lm", form: "vh", price: price(4500n), ...fromLib(iDak) });
  M.addLine(m, c2.key, { title: "Proef minwerk bestaande goot", qtyMilli: -2_000n, unit: "lm", form: "vh", price: price(4500n) });
  const c3 = M.addChapter(m, { code: "03", title: "Elektriciteit" });
  M.addLine(m, c3.key, { title: iElek.title, qtyMilli: 24_000n, unit: "st", form: "vh", price: price(6000n), ...fromLib(iElek) });
  M.addLine(m, c3.key, { title: "Proef p.m. verlichting", qtyMilli: 0n, unit: "st", form: "vh", price: price(9000n) });
  M.addLine(m, c3.key, { kind: "option", title: "Proef optie buitenstopcontact", qtyMilli: 1_000n, unit: "st", form: "fixed", price: price(15_000n) });
  const c4 = M.addChapter(m, { code: "04", title: "Gevel" });
  M.addLine(m, c4.key, { title: "Proef stelling voorgevel", qtyMilli: 1_000n, unit: "sog", form: "fixed", price: price(1_200_000n) });
  M.addLine(m, c4.key, { title: "Proef gevelreiniging", qtyMilli: 80_000n, unit: "m2", form: "vh", price: price(2_000n) });
});
const r1 = await sendAccept(v1);
check("proefofferte v1 verstuurd en aanvaard door kantoor", "accepted" in r1.version.status);
const subtotal1 = r1.totals.subtotalCents;
const lineId = (r, title) => r.lines.find((l) => l.title === title)?.id;

// ── (1) Het voorstel en wie het ziet ──
const pend = await admin.pendingWorkStarts([wid]);
check("(1) admin: het voorstel 'Werf starten' staat in de lijst (aanvaard door kantoor)", pend.some((x) => x.versionId === v1 && x.quoteNumber === NR1 && !x.meerwerk && /kantoor/.test(x.acceptedHow)), flat(pend).slice(0, 200));
check("(1) werfleider: ook in zijn lijst (alle werven en per werf)", (await wl.pendingWorkStarts([])).some((x) => x.versionId === v1) && (await wl.pendingWorkStarts([wid])).some((x) => x.versionId === v1));
const notes = await wl.myNotifications(true);
check("(1) melding aan de werfleider: voorstel staat klaar", notes.some((n) => n.kind === "werfstart" && n.text.includes(NR1)), flat(notes.slice(0, 2)).slice(0, 160));
const base = { target: { existing: null }, startDay: 0n, templateKey: "", leaderPersonId: [], lineSteps: [], options: [], groupDays: [], skipPermits: [], declaration: true };
for (const [n, x] of [["calculator", calc], ["architect", arch], ["OA", oa2], ["klant", klant], ["veiligheidscoördinator", vc], ["anoniem", anon], ["onbekende login", vreemd]]) {
  const rs = await Promise.all([x.pendingWorkStarts([]), x.pendingWorkStarts([wid]), x.workStartPreview(v1, base), x.startWorkFromQuote(v1, base, 0n), x.dismissWorkStart(v1, "proef: geen toegang")].map(denied));
  check(`(1) ${n}: geen enkele functie van de werfstart (5 oproepen geweigerd)`, rs.every(Boolean), rs.map((r) => (r ? "·" : "✗")).join(""));
}
check("(1) een onbekende versie: 'Onbekende versie' (werfleider), geweigerd (calculator: geen id-orakel)", /Onbekende versie/.test(errOf(await wl.workStartPreview(999_999_999n, base))) && (await denied(calc.workStartPreview(999_999_999n, base))));

// ── (2) De voorvertoning ──
const start = nextWd(today + 42);
const inp = { ...base, startDay: BigInt(start) };
const pv = ok(await wl.workStartPreview(v1, inp));
const g = (k) => pv.groups.find((x) => x.key === k);
const gT = (t) => pv.groups.find((x) => x.title.startsWith(t));
check("(2) doelwerf = de werf van de offerte, sjabloon standaardrenovatie, startdatum zoals gevraagd", unopt(pv.workId) === wid && pv.templateKey === "standaardrenovatie" && Number(pv.startDay) === start && pv.bases.length === 0 && !pv.done.length);
check("(2) afbraak: stap uit de bibliotheek, duur 4 werkdagen uit de bibliotheek", g("step:afbraak")?.workdays === 4n && g("step:afbraak")?.daysFrom === "bibliotheek" && pv.lines.find((l) => l.lineId === lineId(r1, iAfbraak.title))?.how === "bibliotheek");
check("(2) container: stap gevonden op de titel van de post (mijlpaal)", g("step:container") && "milestone" in g("step:container").kind && pv.lines.find((l) => l.title.startsWith("Proef container"))?.how === "titel");
check("(2) dak: stap via het hoofdstuk, duur 2 uit de bibliotheek, standaard-OA Proef Dak NV", g("step:dak")?.workdays === 2n && unopt(g("step:dak")?.orgId) === dak.id && pv.lines.find((l) => l.lineId === lineId(r1, iDak.title))?.how === "hoofdstuk");
check("(2) elektriciteit: 24 st ÷ 8 per werkdag = 3 werkdagen, OA Proef Elektro BV", g("step:elektriciteit")?.workdays === 3n && unopt(g("step:elektriciteit")?.orgId) === elek.id);
const gevel = pv.groups.find((x) => x.key.startsWith("ch:"));
check("(2) hoofdstuk zonder stap (Gevel): één eigen taak, duur geschat (5)", !!gevel && gevel.title.includes("Gevel") && gevel.workdays === 5n && gevel.daysFrom === "geschat" && gevel.lineIds.length === 2);
check("(2) de oplevering komt mee als laatste mijlpaal en wacht op elke taak", g("step:oplevering")?.companion && g("step:oplevering").after.length >= 2 && Number(g("step:oplevering").start) >= Math.max(...pv.groups.filter((x) => !x.companion).map((x) => Number(x.end))));
const sk = (t) => pv.skipped.find((x) => x.title === t)?.why ?? "";
check("(2) geen taak: optie niet aanvaard, p.m. (hoeveelheid 0), minwerk; tekstregel niet vermeld", /optie/.test(sk("Proef optie buitenstopcontact")) && /pro memorie/.test(sk("Proef p.m. verlichting")) && /minwerk/.test(sk("Proef minwerk bestaande goot")) && !pv.lines.some((l) => /tekstregel/.test(l.title)));
check("(2) volgorde uit het sjabloon: container op de startdag, afbraak na de container, dak en elektriciteit na de afbraak", Number(g("step:container").start) === start && Number(g("step:afbraak").start) >= Number(g("step:container").end) && Number(g("step:dak").start) > Number(g("step:afbraak").end) && Number(g("step:elektriciteit").start) > Number(g("step:afbraak").end) && g("step:afbraak").after.some((a) => a.startsWith("Container")));
check("(2) alle starten vallen op een werkdag", pv.groups.every((x) => wd(Number(x.start)) < 5));
const pc = pv.permits.find((x) => x.kind === "container");
const ps = pv.permits.find((x) => x.kind === "stelling");
check("(2) vergunningen: container (taak) en stelling (post) met uiterste aanvraagdag = start − doorlooptijd", !!pc && !!ps && !pc.exists && Number(unopt(pc.deadline)) === Number(unopt(pc.from)) - Number(pc.leadDays) && /post «Proef stelling/.test(ps.reason) && Number(unopt(ps.deadline)) === Number(unopt(ps.from)) - Number(ps.leadDays), flat(pv.permits).slice(0, 300));
check("(2) 30bis: nodig, met reden (2 OA's uit de nieuwe taken = altijd; ook de aanneemsom ligt boven de drempel)", unopt(pv.art30bis) === true && pv.art30bisReason.length > 5 && pv.oaCount >= 2n, `${flat(pv.art30bis)} ${pv.art30bisReason} ${pv.oaCount}`);
const pvTxt = flat(pv);
const amounts = [String(subtotal1), "2500", "32000", "4500", "6000", "1200000", "15000", "9000"];
check("(2) NERGENS een bedrag in het voorstel (geen veld, geen waarde)", !/Cents|cost|margin|price|prijs|"amount/i.test(pvTxt) && !amounts.some((a) => new RegExp(`(?<!\\d)${a}(?!\\d)`).test(pvTxt)), amounts.find((a) => new RegExp(`(?<!\\d)${a}(?!\\d)`).test(pvTxt)) ?? (pvTxt.match(/Cents|cost|margin|price|prijs/i)?.[0] ?? ""));
check("(2) ook de voorvertoning van de admin heeft geen bedrag", !/Cents|cost|margin/i.test(flat(ok(await admin.workStartPreview(v1, inp)))));
check("(2) caps: werfleider mag starten, niet de werfleider wisselen; admin wel", pv.caps.start && !pv.caps.setLeader && ok(await admin.workStartPreview(v1, inp)).caps.setLeader);

// Aanpassen: de optie toch aanvaard, de gevelreiniging naar de stap schilder, de duur van de afbraak 6 dagen, geen stellingvergunning.
const optId = lineId(r1, "Proef optie buitenstopcontact");
const gevelId = lineId(r1, "Proef gevelreiniging");
const inp2 = { ...inp, options: [optId], lineSteps: [[gevelId, "step:schilder"]], groupDays: [["step:afbraak", 6n]] };
const pv2 = ok(await wl.workStartPreview(v1, inp2));
check("(2) aanpassen: optie aanvaard = taak, post naar een andere stap, eigen duur", pv2.lines.some((l) => l.lineId === optId && l.group === "step:elektriciteit") && pv2.lines.find((l) => l.lineId === gevelId)?.group === "step:schilder" && pv2.groups.find((x) => x.key === "step:afbraak")?.workdays === 6n && pv2.groups.find((x) => x.key === "step:afbraak")?.daysFrom === "gekozen");
check("(2) een stap die er niet was (schilder), krijgt zijn plaats in het sjabloon", pv2.groups.some((x) => x.key === "step:schilder"));

// ── (3) Bevestigen ──
check("(3) een verouderde planversie: geweigerd", /intussen gewijzigd/.test(errOf(await wl.startWorkFromQuote(v1, inp2, pv2.planVersion + 5n))));
check("(3) de werfleider kan de werfleider niet wisselen", /enkel een beheerder/.test(errOf(await wl.startWorkFromQuote(v1, { ...inp2, leaderPersonId: [me.person[0].id] }, pv2.planVersion))));
const done = await wl.startWorkFromQuote(v1, inp2, pv2.planVersion);
check("(3) bevestigd door de werfleider", isOk(done) && done.ok.status === "gestart" && !done.ok.already, errOf(done));
const d1 = done.ok;
const nNew = pv2.groups.filter((x) => !x.existingTaskId.length).length;
check("(3) uitkomst: evenveel taken als voorgesteld, afhankelijkheden, 2 vergunningsvoorstellen (container, stelling), aangifte klaargezet", d1.tasks === BigInt(nNew) && d1.dependencies > 0n && d1.permits === 2n && d1.declaration === "klaargezet", flat(d1));
const plan = await wl.getPlan(wid);
const tk = (t) => plan.tasks.find((x) => x.title.startsWith(t));
check("(3) planning: taken met dezelfde start en duur als de voorvertoning", pv2.groups.every((x) => { const t = plan.tasks.find((y) => y.title === x.title); return t && t.start === x.start && t.workdays === x.workdays; }), flat(plan.tasks.map((t) => [t.title, t.start, t.workdays])).slice(0, 300));
check("(3) taak afbraak: sjabloonstap, posten gekoppeld, notitie 'Uit offerte …'", unopt(tk("Afbraak").templateKey) === "afbraak" && tk("Afbraak").quoteLineIds.length === 1 && tk("Afbraak").note.includes(NR1));
check("(3) uitvoerders: Proef Dak NV op het dak, Proef Elektro BV op elektriciteit (open bevestiging)", tk("Dakwerken").assignments.some((a) => a.orgId === dak.id && "open" in a.confirmation) && tk("Elektriciteit").assignments.some((a) => a.orgId === elek.id));
check("(3) afhankelijkheden zoals voorgesteld (afbraak wacht op de container)", plan.dependencies.some((d) => d.fromTaskId === tk("Container").id && d.toTaskId === tk("Afbraak").id));
const perms = await wl.workPermits(wid);
check("(3) vergunningenregister: container en stelling 'nodig', met de taken en de uiterste aanvraagdag", ["container", "stelling"].every((k) => perms.permits.some((x) => x.kind === k && "needed" in x.status && x.taskIds.length > 0 && x.deadline.length === 1 && /offerte/.test(x.note))), flat(perms.permits.map((x) => [x.kind, x.status, x.deadline])));
const wa = await wl.workAdmin(wid);
check("(3) werfadministratie: 30bis nodig, aangifte 'te doen' (klaargezet)", unopt(wa.art30bis) === true && "todo" in wa.declaration.status && /werfstart/.test(wa.declaration.note));
const ctr = ok(await admin.readContract(wid));
check("(3) contract (admin): aanneemsom = subtotaal van de offerte, getekende versie = v1", unopt(ctr.contract)?.estimatedAmountCents[0] === subtotal1 && unopt(unopt(ctr.contract)?.signedQuoteVersionId) === v1, flat(ctr.contract).slice(0, 200));
check("(3) contract: de werfleider leest het niet (R27)", await denied(wl.readContract(wid)));
const work = await wl.getWork(wid);
check("(3) werffiche: status 'gepland', geplande periode uit de planning", "planned" in work.status && Number(unopt(work.plannedStart)) === start && work.plannedEnd.length === 1);
const log = await admin.auditLog(0n, 300n);
const ws = log.find((e) => e.action === "werf-gestart" && e.detail.includes(NR1));
check("(3) auditlog: werf-gestart (taken, vergunningen, 30bis), zonder bedrag", !!ws && /taken/.test(ws.detail) && !/€|\d+,\d{2}\b/.test(ws.detail) && !amounts.some((a) => ws.detail.includes(a)), ws?.detail ?? "");
check("(3) auditlog: nieuw contract (werfstart), zonder bedrag", log.some((e) => e.action === "vertrouwelijk-gewijzigd" && e.detail.includes(W) && /nieuw/.test(e.detail) && /werfstart/.test(e.detail) && !e.detail.includes(String(subtotal1))));

// ── (4) Idempotent ──
const again = await wl.startWorkFromQuote(v1, inp2, pv2.planVersion);
const again2 = await admin.startWorkFromQuote(v1, base, 0n);
const plan2 = await wl.getPlan(wid);
check("(4) twee keer bevestigen: dezelfde start terug (al gebeurd), geen extra taken of vergunningen", isOk(again) && again.ok.already && again.ok.tasks === d1.tasks && isOk(again2) && again2.ok.already && plan2.tasks.length === plan.tasks.length && (await wl.workPermits(wid)).permits.length === perms.permits.length);
check("(4) het voorstel staat niet meer in de lijst; de voorvertoning toont de start", !(await admin.pendingWorkStarts([wid])).some((x) => x.versionId === v1) && ok(await wl.workStartPreview(v1, base)).done[0]?.status === "gestart");
check("(4) afwijzen na de start: geeft de start terug, verandert niets", ok(await wl.dismissWorkStart(v1, "proef: te laat")).status === "gestart");

// ── (5) Meerwerk: een nieuwe versie met een extra post (bestaande stap), een nieuwe stap, een gewijzigde en een geschrapte post ──
const v2 = ok(await calc.newQuoteVersion(q1.quoteId, []));
await fill(v2, (m) => {
  const c3 = m.chapters.find((c) => c.title === "Elektriciteit");
  M.addLine(m, c3.key, { title: "Proef extra stopcontacten meerwerk", qtyMilli: 4_000n, unit: "st", form: "vh", price: price(6000n), ...fromLib(iElek) });
  const c5 = M.addChapter(m, { code: "05", title: "Afwerking" });
  M.addLine(m, c5.key, { title: "Proef tegelwerk badkamer meerwerk", qtyMilli: 30_000n, unit: "m2", form: "vh", price: price(1500n) });
  const dakL = m.lines.find((l) => l.title === iDak.title);
  M.updateLine(m, dakL.key, { qtyMilli: 14_000n });
  M.removeLine(m, m.lines.find((l) => l.title === "Proef container 10 m³ puin").key);
});
const r2 = await sendAccept(v2);
check("(5) v2 verstuurd en aanvaard (v1 blijft aanvaard)", "accepted" in r2.version.status);
check("(5) het voorstel van v2 is meerwerk", (await wl.pendingWorkStarts([wid])).some((x) => x.versionId === v2 && x.meerwerk));
const pm = ok(await wl.workStartPreview(v2, { ...base, startDay: BigInt(start) }));
check("(5) enkel het verschil: elektriciteit = bestaande taak (posten erbij), tegels = nieuwe taak (meerwerk), niets anders", pm.bases.length === 1 && pm.bases[0] === `${NR1} v1` && pm.groups.length === 2 && pm.groups.find((x) => x.key === "step:elektriciteit")?.existingTaskId.length === 1 && /meerwerk/.test(pm.groups.find((x) => x.key === "step:tegels")?.title ?? "") && pm.groups.find((x) => x.key === "step:tegels")?.existingTaskId.length === 0, flat(pm.groups.map((x) => [x.key, x.title, x.existingTaskId])));
check("(5) gemeld: gewijzigde hoeveelheid (dak) en geschrapte post (container)", pm.changed.some((x) => x.title === iDak.title) && pm.removed.some((x) => x.title.startsWith("Proef container")), flat({ c: pm.changed, r: pm.removed }));
check("(5) geen tweede oplevering of container bij meerwerk", !pm.groups.some((x) => x.key === "step:oplevering" || x.key === "step:container"));
const dm = ok(await wl.startWorkFromQuote(v2, { ...base, startDay: BigInt(start) }, pm.planVersion));
const plan3 = await wl.getPlan(wid);
check("(5) bevestigd: 1 nieuwe taak, 1 gekoppeld; de taak elektriciteit heeft nu ook de nieuwe post", dm.tasks === 1n && dm.linked === 1n && plan3.tasks.length === plan2.tasks.length + 1 && plan3.tasks.find((x) => unopt(x.templateKey) === "elektriciteit").quoteLineIds.length === 3, flat(dm));
const ctr2 = ok(await admin.readContract(wid));
check("(5) contract: de aanneemsom volgt de nieuwe versie (v2 vervangt v1), getekende versie = v2", unopt(ctr2.contract)?.estimatedAmountCents[0] === r2.totals.subtotalCents && unopt(unopt(ctr2.contract)?.signedQuoteVersionId) === v2);
check("(5) auditlog: contract gewijzigd met enkel de veldnamen (aanneemsom, getekende offerteversie)", (await admin.auditLog(0n, 200n)).some((e) => e.action === "vertrouwelijk-gewijzigd" && e.detail.includes(W) && /aanneemsom/.test(e.detail) && /getekende offerteversie/.test(e.detail) && !e.detail.includes(String(r2.totals.subtotalCents))));
check("(5) v2 opnieuw bevestigen: niets dubbel", ok(await wl.startWorkFromQuote(v2, base, 0n)).already && (await wl.getPlan(wid)).tasks.length === plan3.tasks.length);

// ── (6) Afwijzen, een nieuwe werf als doel, export ──
const mkAccepted = async (nr) => {
  const q = await mkQuote(nr, "Proef offerte werfstart (2.8) extra");
  await fill(q.versionId, (m) => {
    M.setHeader(m, { clientOrgId: familie });
    const c = M.addChapter(m, { code: "01", title: "Dak" });
    M.addLine(m, c.key, { title: iDak.title, qtyMilli: 5_000n, unit: "lm", form: "vh", price: price(4500n), ...fromLib(iDak) });
  });
  await sendAccept(q.versionId);
  return q;
};
const q3 = await mkAccepted(`WS-${stamp}-C`);
check("(6) afwijzen: calculator geweigerd, te korte reden geweigerd", (await denied(calc.dismissWorkStart(q3.versionId, "proef: niet nodig"))) && /Reden/.test(errOf(await wl.dismissWorkStart(q3.versionId, "kort"))));
const dis = await wl.dismissWorkStart(q3.versionId, "proef: al met de hand gepland (draftproef 2.8)");
check("(6) afgewezen met reden; niet meer in de lijst; bevestigen geeft 'afgewezen' terug zonder taken", isOk(dis) && dis.ok.status === "afgewezen" && !(await wl.pendingWorkStarts([wid])).some((x) => x.versionId === q3.versionId) && ok(await wl.startWorkFromQuote(q3.versionId, base, 0n)).status === "afgewezen" && (await wl.getPlan(wid)).tasks.length === plan3.tasks.length);
check("(6) auditlog: werfstart-afgewezen met de reden", (await admin.auditLog(0n, 100n)).some((e) => e.action === "werfstart-afgewezen" && e.detail.includes("met de hand gepland")));
const q4 = await mkAccepted(`WS-${stamp}-D`);
const W2 = `${W}-D`;
check("(6) nieuwe werf: een bestaande code geweigerd", /bestaat al/.test(errOf(await admin.workStartPreview(q4.versionId, { ...base, target: { newWork: { code: W, name: "x", asSub: true } } }).then(async (r) => (isOk(r) ? admin.startWorkFromQuote(q4.versionId, { ...base, target: { newWork: { code: W, name: "x", asSub: true } } }, 0n) : r)))));
const pn = ok(await admin.workStartPreview(q4.versionId, { ...base, target: { newWork: { code: W2, name: "Proef deelwerf (2.8)", asSub: true } } }));
check("(6) voorvertoning met een nieuwe werf: geen doelwerf-id, 1 taak dak", !pn.workId.length && pn.workCode === W2 && pn.groups.some((x) => x.key === "step:dak"));
const dn = ok(await admin.startWorkFromQuote(q4.versionId, { ...base, target: { newWork: { code: W2, name: "Proef deelwerf (2.8)", asSub: true } } }, 0n));
const nw = (await admin.listWorks()).find((x) => x.code === W2);
check("(6) nieuwe deelwerf gemaakt: hoofdwerf, klant, adres, btw, werfleider overgenomen; taak en contract op de nieuwe werf", dn.newWork && !!nw && unopt(nw.parentId) === wid && unopt(nw.clientOrgId) === familie && nw.address.street === addr.street && nw.vatBp === 2100n && unopt(nw.leaderPersonId) === wlId && (await admin.getPlan(nw.id)).tasks.length >= 1 && unopt(ok(await admin.readContract(nw.id)).contract)?.signedQuoteVersionId[0] === q4.versionId);
const ex = ok(await admin.exportChunk("workStarts", 0n, 500n));
check("(6) export: de starts (en de afwijzing) zitten in de back-up", "workStarts" in ex && [v1, v2, q3.versionId, q4.versionId].every((v) => ex.workStarts.some((s) => s.versionId === v)));
check("(6) export door de werfleider: geweigerd", await denied(wl.exportChunk("workStarts", 0n, 1n)));
check("(6) een niet-aanvaarde versie kan geen werf starten", await (async () => { const q = await mkQuote(`WS-${stamp}-E`, "Proef niet aanvaard (2.8)"); return /aanvaarde versie/.test(errOf(await wl.workStartPreview(q.versionId, base))); })());

// ── (7) Digitaal akkoord van de klant (2.7) → werfstart: de checklist "getekende offerte" is ontvangen; btw 6 % zonder grond gemeld ──
{
  const klantId = (await klant.me()).person[0].id;
  const mid = ok(await admin.addMembership(wid, [klantId], [], { klant: null }, []));
  try {
    const q5 = await mkQuote(`WS-${stamp}-F`, "Proef akkoord klant (2.8)");
    await fill(q5.versionId, (m) => {
      M.setHeader(m, { clientOrgId: familie });
      const c = M.addChapter(m, { code: "01", title: "Dak" });
      M.addLine(m, c.key, { title: iDak.title, qtyMilli: 3_000n, unit: "lm", form: "vh", price: price(4500n), ...fromLib(iDak) });
    });
    const r5 = ok(await calc.readQuoteVersion(q5.versionId));
    ok(await calc.sendQuoteVersion(q5.versionId, r5.version.rev, r5.totals.totalCents, "proef: draftproef 2.8"));
    const mine = ok(await klant.readMyQuote(q5.versionId));
    check("(7) de klant geeft digitaal akkoord", isOk(await klant.acceptMyQuote(q5.versionId, mine.hash)));
    check("(7) het voorstel: aanvaard met 'digitaal akkoord van de klant'", (await wl.pendingWorkStarts([wid])).some((x) => x.versionId === q5.versionId && /digitaal/.test(x.acceptedHow)));
    const pv7 = ok(await wl.workStartPreview(q5.versionId, base));
    ok(await wl.startWorkFromQuote(q5.versionId, base, pv7.planVersion));
    const dos = await admin.getDossier(wid);
    const doc = dos.documents.find((d) => d.kind === "contract");
    check("(7) checklist: 'Aannemingsovereenkomst / getekende offerte' ontvangen, met het digitaal akkoord en de hash in de notitie", !!doc && "received" in doc.status && /digitaal akkoord/.test(doc.note) && /hash/.test(doc.note), flat(doc ?? null).slice(0, 200));
  } finally {
    await admin.endMembership(mid).catch(() => {});
  }
  const w6 = ok(await admin.createWork({ code: `${W}-G`, name: "Proefwerf btw 6 % (2.8)", address: addr, parentId: [], clientOrgId: [familie], architectOrgId: [], leaderPersonId: [wlId], vatBp: 600n }));
  const q6 = await (async () => { const q = ok(await calc.createQuote({ workId: w6.id, number: `WS-${stamp}-G`, title: "Proef btw 6 % (2.8)" })); await fill(q.versionId, (m) => { M.setHeader(m, { clientOrgId: familie }); const c = M.addChapter(m, { code: "01", title: "Dak" }); M.addLine(m, c.key, { title: iDak.title, qtyMilli: 3_000n, unit: "lm", form: "vh", price: price(4500n), ...fromLib(iDak) }); }); await sendAccept(q.versionId); return q; })();
  check("(7) werf op 6 % zonder grond: waarschuwing in het voorstel", ok(await wl.workStartPreview(q6.versionId, base)).warnings.some((x) => /6 % zonder grond/.test(x)));
  ok(await wl.dismissWorkStart(q6.versionId, "proef: draftproef 2.8 opgeruimd"));
  await admin.setWorkStatus(w6.id, { cancelled: null });
}

// ── Opruimen: de proefwerven op "geannuleerd" (archiveren van een werf bestaat niet) ──
for (const id of [wid, nw?.id].filter(Boolean)) await admin.setWorkStatus(id, { cancelled: null });
console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
