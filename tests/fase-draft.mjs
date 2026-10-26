// Draftproef 2b.3 (de werf als centrum): één VERZONNEN proefwerf door alle acht fases, met na elke stap de stand uit
// listWorkStages en de fase zoals de browser ze rekent (src/frontend/src/app/fase.ts, VOORLOPIGE regels van vraag 14):
// aanvraag → offerte (versie verstuurd) → akkoord → gestart (Werf starten) → in uitvoering (eerste verslag) → tussentijdse
// opmeting en vorderingsstaat (blijft in uitvoering) → eindopmeting (alle posten volledig) → opgemeten → slotstaat →
// gefactureerd → opgeleverd (met de hand) → nazorg → geannuleerd. Elke rol krijgt dezelfde fase. Enkel verzonnen gegevens;
// er gaat geen mail weg (de proefklant heeft geen echt adres en de postbode staat op de draft in testmodus).
//   node tests/fase-draft.mjs <canister-id>
import { backend } from "../tools/lib.mjs";
import { M, ensureProofClientAddress, fromRead, saveAll } from "./offerte-lib.mjs";
import { saveAs } from "./vordering-lib.mjs";
import { loadFase } from "./menu-lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/fase-draft.mjs <canister-id>");
const [admin, wl, calc, klant] = await Promise.all(["proef-admin", "proef-werfleider", "proef-calculator", "proef-klant"].map((n) => backend(n, cid)));
const F = await loadFase();
let pass = 0;
let fail = 0;
const failures = [];
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`✓ ${name}`); } else { fail++; failures.push(name); console.log(`✗ ${name}${extra ? ` · ${extra}` : ""}`); }
};
const ok = (r) => { if (r && typeof r === "object" && "err" in r) throw new Error(r.err); return r && typeof r === "object" && "ok" in r ? r.ok : r; };
const errOf = (r) => (r && "err" in r ? r.err : "");
const uid = () => crypto.randomUUID();

const familie = await ensureProofClientAddress(admin);
const wlId = (await wl.me()).person[0].id;
const klantId = (await klant.me()).person[0].id;
const stamp = Date.now().toString(36).toUpperCase();
const W = `P-FS-${stamp}`;
const cDay = BigInt(Math.floor(Number((await admin.auditLog(0n, 1n))[0].at / 1_000_000n) / 86_400_000));

const factsOf = (s, w) => ({ ...Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])), status: Object.keys(w.status)[0] });
async function faseAs(x, wid) {
  const s = (await x.listWorkStages()).find((y) => y.workId === wid);
  const w = (await x.listWorks()).find((y) => y.id === wid);
  return s && w ? { s, w, f: F.werfFase(factsOf(s, w)) } : null;
}
async function expect(stap, key, more = () => true) {
  const a = await faseAs(admin, wid);
  const all = await Promise.all([wl, calc, klant].map((x) => faseAs(x, wid)));
  const same = all.every((x) => x && x.f.index === a.f.index);
  check(`${stap}: fase ${key} (beheerder, werfleider, calculator en klant zien dezelfde fase)`, a.f.key === key && same && more(a), `${a.f.key} ${a.f.steps.join(",")} ${all.map((x) => x?.f.key).join("/")}`);
  return a;
}

// ── 0. Nieuwe aanvraag: klant + adres → werf in fase Aanvraag ──
const wid = ok(await admin.createWork({ code: W, name: "Proefwerf fases (2b.3)", address: { street: "Proefstraat", number: "23", zip: "8670", city: "Koksijde", country: "BE" }, parentId: [], clientOrgId: [familie], architectOrgId: [], leaderPersonId: [wlId], vatBp: 600n })).id;
ok(await admin.addMembership(wid, [klantId], [], { klant: null }, []));
const a0 = await expect("(0) nieuwe aanvraag", "aanvraag", (a) => "request" in a.w.status && a.f.steps.slice(1).every((x) => x === "todo"));
check("(0) in Aanvraag: Planning, Verslagen, Opmeting en Facturatie grijs met uitleg", F.werfTabs((await admin.me()).caps[0], a0.f, factsOf(a0.s, a0.w)).filter((x) => x.off).map((x) => x.key).join() === "planning,verslagen,opmeting,facturatie");

// ── 1. Offerte: een versie verstuurd ──
const price = (cost) => ({ cost, rule: null, reason: "", orgId: null, source: "eigen", libCostId: null });
const NR = `FS-${stamp}`;
const q1 = ok(await calc.createQuote({ workId: wid, number: NR, title: "Proef offerte fases (2b.3)" }));
const v1 = q1.versionId;
{
  const m = fromRead(ok(await calc.readQuoteVersion(v1)));
  M.setHeader(m, { clientOrgId: familie });
  const c1 = M.addChapter(m, { code: "01", title: "Afbraak" });
  M.addLine(m, c1.key, { title: "Proef afbraak vloeren (2b.3)", qtyMilli: 30_000n, unit: "m2", form: "vh", price: price(2500n) });
  const c2 = M.addChapter(m, { code: "02", title: "Ruwbouw" });
  M.addLine(m, c2.key, { title: "Proef metselwerk (2b.3)", qtyMilli: 12_000n, unit: "m2", form: "vh", price: price(9000n) });
  const r = await saveAll(calc, m);
  if (r && "err" in r) throw new Error(errOf(r));
}
await expect("(1a) offerte in de maak (status offerte, nog niets verstuurd)", "aanvraag");
const rd = ok(await calc.readQuoteVersion(v1));
ok(await calc.sendQuoteVersion(v1, rd.version.rev, rd.totals.totalCents, "proef: draftproef 2b.3"));
await expect("(1b) versie verstuurd", "offerte", (a) => a.s.quoteSentAt.length === 1 && a.s.quoteWaiting && a.s.acceptedAt.length === 0);

// ── 2. Akkoord ──
ok(await calc.decideQuoteVersion(v1, true, "proef: akkoord (draftproef 2b.3)"));
await expect("(2) akkoord geregistreerd", "akkoord", (a) => a.s.acceptedAt.length === 1 && a.s.startPending && !a.s.quoteWaiting);
check("(2) volgende stap voor de werfleider: Werf starten", F.volgendeStap((await faseAs(wl, wid)).f, factsOf((await faseAs(wl, wid)).s, (await faseAs(wl, wid)).w), (await wl.me()).caps[0], true)?.key === "werfStarten");

// ── 3. Gestart: Werf starten bevestigd ──
const base = { target: { existing: null }, startDay: 0n, templateKey: "", leaderPersonId: [], lineSteps: [], options: [], groupDays: [], skipPermits: [], declaration: false };
let start = BigInt(Math.floor(Date.now() / 86_400_000));
while ((Number(start) + 3) % 7 > 4) start += 1n;
const pv = ok(await wl.workStartPreview(v1, { ...base, startDay: start }));
ok(await wl.startWorkFromQuote(v1, { ...base, startDay: start }, pv.planVersion));
await expect("(3) Werf starten bevestigd", "gestart", (a) => a.s.startedAt.length === 1 && !a.s.startPending && a.s.tasks > 0n && "planned" in a.w.status && !a.f.manual);

// ── 4. In uitvoering: het eerste werfverslag ──
const KR = uid();
await wl.reportSync([{ opId: uid(), clientKey: KR, op: { ensure: { workId: wid, day: cDay } } }]);
await expect("(4) eerste werfverslag", "uitvoering", (a) => a.s.firstReportAt.length === 1);

// ── 5. Tussentijds: een opmeting met één post en een vorderingsstaat laten de werf In uitvoering ──
const KM1 = uid();
const meas = (key, op) => wl.measureSync([{ opId: uid(), clientKey: key, op }]);
await meas(KM1, { open: { workId: wid } });
const posts = (await wl.measureSummary(wid)).posts;
check("(5) de opmeting kent de twee posten van de offerte", posts.length === 2, String(posts.length));
await expect("(5a) opmeting open", "uitvoering", (a) => a.s.surveyOpen);
await meas(KM1, { entry: { lineId: posts[0].lineId, qtyMilli: 10_000n, day: cDay, complete: false, note: "proef 2b.3 deel", files: [], corrects: [], reason: "" } });
await meas(KM1, { close: { note: "proef 2b.3: tussentijds" } });
await expect("(5b) tussentijdse opmeting afgesloten (niet alle posten volledig)", "uitvoering", (a) => !a.s.surveyOpen && a.s.measuredAt.length === 0);
const cur = ok(await calc.readContract(wid));
ok(await calc.setContract(wid, { contract: { estimatedAmountCents: [], priceRevision: { none: null }, guarantee: { none: null }, guaranteeBp: 0n, paymentTermDays: 30n, invoicingRhythm: { perProgress: null }, signedQuoteVersionId: [], note: "proef 2b.3" }, clientContact: [], notes: "Proef" }, cur.version));
const sendVs = async (note) => {
  const id = ok(await calc.newProgress(wid));
  await expect(`(${note}) vorderingsstaat in ontwerp`, note === "5c" ? "uitvoering" : "opgemeten", (a) => a.s.progressDraft);
  const g = await saveAs(calc, id, new Map(), { note: `Proef staat (2b.3, ${note})` });
  if ("err" in g.r) throw new Error(g.r.err);
  const v = ok(await calc.readProgressStatement(id));
  const s = await calc.sendProgress(id, v.brief.rev, v.totals.totalCents, "proef: draftproef 2b.3");
  check(`(${note}) vorderingsstaat verstuurd`, "ok" in s, errOf(s));
};
await sendVs("5c");
await expect("(5d) tussentijdse vorderingsstaat verstuurd", "uitvoering", (a) => a.s.progressSent === 1n && a.s.invoicedAt.length === 0 && !a.s.progressDraft);

// ── 6. Opgemeten: een afgesloten opmeting waarin elke post volledig opgemeten is ──
const KM2 = uid();
await meas(KM2, { open: { workId: wid } });
for (const p of posts) await meas(KM2, { entry: { lineId: p.lineId, qtyMilli: p.vhMilli, day: cDay, complete: true, note: "proef 2b.3 eind", files: [], corrects: [], reason: "" } });
await meas(KM2, { close: { note: "proef 2b.3: eindopmeting" } });
await expect("(6) eindopmeting afgesloten", "opgemeten", (a) => a.s.measuredAt.length === 1 && a.s.invoicedAt.length === 0);

// ── 7. Gefactureerd: de slotstaat (eerste staat verstuurd na de eindopmeting) ──
await sendVs("7");
await expect("(7) slotstaat verstuurd", "gefactureerd", (a) => a.s.invoicedAt.length === 1 && a.s.progressSent === 2n);

// ── 8. Opgeleverd (met de hand), nazorg, en de fase met de hand terug kan niet ──
check("(8) de calculator kan de fase niet overschrijven (Rights.mo: enkel beheerder en werfleider)", await calc.setWorkStatus(wid, { delivered: null }).then((r) => !!r && "err" in r, () => true));
ok(await wl.setWorkStatus(wid, { delivered: null }));
await expect("(8a) opgeleverd met de hand", "opgeleverd", (a) => a.f.steps.slice(0, 7).every((x) => x === "done"));
ok(await admin.setWorkStatus(wid, { aftercare: null }));
const a8 = await expect("(8b) nazorg", "opgeleverd", (a) => a.f.aftercare && F.faseNaam(a.f) === "Nazorg");
ok(await admin.setWorkStatus(wid, { request: null }));
await expect("(8c) met de hand terug naar aanvraag: de fase volgt wat er gebeurde (gefactureerd)", "gefactureerd", (a) => !a.f.manual);
ok(await admin.setWorkStatus(wid, { cancelled: null }));
await expect("(8d) geannuleerd: label Geannuleerd, de werf blijft onder Afgerond", "gefactureerd", (a) => a.f.cancelled && F.werfGroep(a.f) === "afgerond");
check("(8) de klant ziet de stappenbalk in zijn eigen woorden", F.faseNaam(a8.f, true) === "Nazorg" && F.faseNaam(F.werfFase({ status: "running" }), true) === "Werken bezig");

// ── 9. Een offerte als NIEUWE werf gestart (deelwerf): de bronwerf is gestart, de nieuwe werf kreeg offerte en akkoord ──
const widS = ok(await admin.createWork({ code: `${W}-B`, name: "Proefwerf fases bron (2b.3)", address: { street: "Proefstraat", number: "24", zip: "8670", city: "Koksijde", country: "BE" }, parentId: [], clientOrgId: [familie], architectOrgId: [], leaderPersonId: [wlId], vatBp: 600n })).id;
const qS = ok(await calc.createQuote({ workId: widS, number: `${NR}-B`, title: "Proef offerte bron (2b.3)" }));
{
  const m = fromRead(ok(await calc.readQuoteVersion(qS.versionId)));
  M.setHeader(m, { clientOrgId: familie });
  const c1 = M.addChapter(m, { code: "01", title: "Afbraak" });
  M.addLine(m, c1.key, { title: "Proef afbraak (2b.3 bron)", qtyMilli: 10_000n, unit: "m2", form: "vh", price: price(2500n) });
  const r = await saveAll(calc, m);
  if (r && "err" in r) throw new Error(errOf(r));
}
const rS = ok(await calc.readQuoteVersion(qS.versionId));
ok(await calc.sendQuoteVersion(qS.versionId, rS.version.rev, rS.totals.totalCents, "proef: draftproef 2b.3"));
ok(await calc.decideQuoteVersion(qS.versionId, true, "proef: akkoord (draftproef 2b.3)"));
const tgt = { ...base, startDay: start, target: { newWork: { code: `${W}-B1`, name: "Proef deelwerf fases (2b.3)", asSub: true } } };
const pS = ok(await admin.workStartPreview(qS.versionId, tgt));
const dS = ok(await admin.startWorkFromQuote(qS.versionId, tgt, pS.planVersion));
const nS = (await admin.listWorks()).find((x) => x.code === `${W}-B1`);
const fS = await faseAs(admin, widS);
const fN = nS ? await faseAs(admin, nS.id) : null;
check("(9) offerte gestart als nieuwe deelwerf: de bronwerf staat op Gestart (niet eeuwig op Akkoord)", dS.newWork && fS.f.key === "gestart" && !fS.s.startPending, `${fS.f.key}`);
check("(9) de nieuwe deelwerf: offerte en akkoord gebeurd (niet overgeslagen), fase Gestart", !!fN && fN.f.key === "gestart" && fN.f.steps[1] === "done" && fN.f.steps[2] === "done", fN ? fN.f.steps.join(",") : "geen werf");
check("(9) een deelwerf van een lopende werf begint als gepland (niet als aanvraag)", !!nS && "planned" in nS.status);
for (const id of [widS, nS?.id].filter((x) => x !== undefined)) ok(await admin.setWorkStatus(id, { cancelled: null }));

// ── 10. Externen: de klant krijgt geen interne vlaggen, een OA of architect een lege stand ──
const klantStand = (await klant.listWorkStages()).find((x) => x.workId === wid);
check("(10) de klant ziet geen interne vlaggen (ontwerp, open opmeting, aantal taken)", !!klantStand && klantStand.tasks === 0n && !klantStand.progressDraft && !klantStand.surveyOpen && klantStand.invoicedAt.length === 1);

console.log(`\nProefwerf ${W} (werf #${wid}, offerte ${NR}): alle fases doorlopen, nu geannuleerd.`);
console.log(`${pass} ✓  ${fail} ✗`);
if (fail) console.log("Rood:\n  " + failures.join("\n  "));
process.exit(fail ? 1 : 0);
