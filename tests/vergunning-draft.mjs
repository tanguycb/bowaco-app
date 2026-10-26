// Vergunningen (1b.1) op een canister die al in gebruik is (een draft). Gebruikt de testidentiteiten, P-A/P-B en
// "Proef Dak NV". Laat enkel testdata achter: de gemeente "Proefgemeente (draftproef)" met één procedure, op P-B de
// taak "Container plaatsen (proef 1b)" met een toegekende vergunning (en een proefbestand zonder echte inhoud), een
// gearchiveerde werfbord-vergunning, en op P-A een werfzone (gearchiveerd op het einde). Opnieuw draaien mag: wat er
// al staat, wordt hergebruikt. Meldingen gaan naar de werfleider van P-B (Proef Werfleider), niet naar de eigenaar.
//   node tests/vergunning-draft.mjs <canister-id>
import { backend } from "../tools/lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/vergunning-draft.mjs <canister-id>");
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const rejects = async (p) => { try { await p; return false; } catch { return true; } };
const denied = async (p) => { try { const r = await p; return !!(r && "err" in r && /^Geen toegang/.test(r.err)); } catch { return true; } };
const isOk = (r) => r && typeof r === "object" && "ok" in r;
const errOf = (r) => (r && "err" in r ? r.err : "");
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const opt = (v) => (v === undefined || v === null ? [] : [v]);
const today = BigInt(Math.floor(Date.now() / 86_400_000));
const wd = (d) => (Number(d) + 3) % 7;

const [admin, wl, calc, arch, oa2, klant] = await Promise.all(["proef-admin", "proef-werfleider", "proef-calculator", "proef-architect", "proef-oa2", "proef-klant"].map((n) => backend(n, cid)));
const me = await admin.me();
check("versie 1b.1 of later op de canister", /^1b\.|^[2-9]b?\./.test(me.version), me.version);
const works = await admin.listWorks();
const A = works.find((w) => w.code === "P-A")?.id;
const B = works.find((w) => w.code === "P-B")?.id;
const orgDak = (await admin.listOrgs(false)).find((o) => o.name === "Proef Dak NV");
if (A === undefined || B === undefined || !orgDak) throw new Error("P-A/P-B of Proef Dak NV ontbreken");
const wlId = (await wl.me()).person[0].id;

// P-B: werfleider = Proef Werfleider (zo gaan de meldingen niet naar de eigenaar); postcode voor de kennisbank.
let wB = await admin.getWork(B);
const zipB = wB.address.zip || "9999";
if (wB.leaderPersonId[0] !== wlId || !wB.address.zip) {
  const r = await admin.updateWork(B, { code: wB.code, name: wB.name, address: { ...wB.address, zip: zipB, city: wB.address.city || "Proefstad" }, parentId: wB.parentId, clientOrgId: wB.clientOrgId, architectOrgId: wB.architectOrgId, leaderPersonId: [wlId], vatBp: wB.vatBp, plannedStart: wB.plannedStart, plannedEnd: wB.plannedEnd, analyticCode: wB.analyticCode, vatNote: wB.vatNote });
  check("P-B: werfleider Proef Werfleider, postcode ingevuld", isOk(r), errOf(r));
  wB = await admin.getWork(B);
}
if (!("running" in wB.status) && !("planned" in wB.status)) check("P-B op 'bezig'", isOk(await admin.setWorkStatus(B, { running: null })));

// Kennisbank
const kinds = await calc.listPermitKinds(false);
check("soorten: de voorlopige lijst (container …)", kinds.some((k) => k.key === "container"));
check("soorten: OA en klant geweigerd", (await rejects(oa2.listPermitKinds(false))) && (await rejects(klant.listPermitKinds(false))));
let muni = (await admin.listMunicipalities(true)).find((m) => m.name === "Proefgemeente (draftproef)");
if (!muni) {
  const r = await wl.saveMunicipality({ id: [], name: "Proefgemeente (draftproef)", zips: [zipB], portal: ["https://proef.example/loket"], email: [], phone: [], contact: "dienst mobiliteit (proef)", notes: "testdata", archived: false });
  check("werfleider maakt de proefgemeente met de postcode van P-B", isOk(r), errOf(r));
  muni = r.ok;
}
const pr = await wl.saveProcedure({ municipalityId: muni.id, kind: "container", how: "portaal", portal: ["https://proef.example/inname"], email: [], leadDays: 10n, cost: "€ 25 (proef)", attachments: ["situatieschets"], contact: "", notes: "", archived: false });
check("procedure container: portaal, 10 dagen", isOk(pr) && pr.ok.procedures.some((p) => p.kind === "container" && p.leadDays === 10n), errOf(pr));
check("calculator vult de kennisbank niet aan", await rejects(calc.saveMunicipality({ id: [muni.id], name: muni.name, zips: muni.zips, portal: [], email: [], phone: [], contact: "", notes: "", archived: false })));

// Taak "container" binnen ± 12 werkdagen op P-B
let plan = await admin.getPlan(B);
let task = plan.tasks.find((t) => t.title === "Container plaatsen (proef 1b)");
let start = today + 12n;
while (wd(start) >= 5) start += 1n;
const tIn = { id: opt(task?.id), title: "Container plaatsen (proef 1b)", note: "", kind: { work: null }, trade: [], responsibleOrgId: [orgDak.id], status: { planned: null }, percent: 0n, start, workdays: 3n, leadDays: 0n, orderDay: [], reason: "draftproef 1b.1" };
const st = await admin.saveTask(B, tIn, plan.version);
check("taak 'Container plaatsen (proef 1b)' op P-B over ± 12 dagen", isOk(st), errOf(st));
plan = await admin.getPlan(B);
task = plan.tasks.find((t) => t.title === "Container plaatsen (proef 1b)");
let wp = await wl.workPermits(B);
// Op een draft die de huidige rollentest opbouwde, heeft P-B al de "Proefgemeente" van de rollentest (zelfde postcode).
check("de gemeente van P-B gevonden", /^Proefgemeente/.test(wp.municipality[0]?.name ?? ""), wp.municipality[0]?.name);
let pm = wp.permits.find((p) => p.taskIds.includes(task.id) && p.kind === "container");
if (!pm) {
  const sug = wp.suggestions.find((s) => s.taskId === task.id && s.kind === "container");
  check("suggestie uit de planning: deadline = start − 10", !!sug && sug.deadline === start - 10n, JSON.stringify(wp.suggestions, big));
  const r = await wl.savePermit(B, { id: [], kind: "container", title: "Container voor de deur (proef)", municipalityId: [], status: { needed: null }, location: "voor de deur, 2 plaatsen", taskIds: [task.id], neededFrom: [], neededTo: [], leadDays: [], requestedOn: [], validFrom: [], validTo: [], reference: "", costCents: [2500n], note: "proef" });
  check("werfleider maakt de vergunning", isOk(r), errOf(r));
  pm = r.ok;
}
// Bij een tweede run is de vergunning al toegekend (geen deadline-waarschuwing meer): enkel de deadline nakijken.
check("deadline = start − 10 (en 'aanvragen binnen' zolang ze nodig is)", pm.deadline[0] === start - 10n && ("needed" in pm.status ? pm.warnings.some((w) => "deadlineSoon" in w || "deadlinePassed" in w) : true), JSON.stringify(pm.warnings, big));
check("calculator, OA en klant wijzigen niets", (await denied(calc.archivePermit(pm.id, ""))) && (await denied(oa2.archivePermit(pm.id, ""))) && (await denied(klant.archivePermit(pm.id, ""))));
check("meldronde: enkel admin; de admin start ze", (await rejects(wl.scanPermits())) && (await admin.scanPermits()) >= 0n);
check("Proef Werfleider kreeg een melding 'vergunning' voor P-B", (await wl.myNotifications(false)).some((n) => n.kind === "vergunning" && n.text.includes("P-B")));
// Toegekend + bestand
const end = pm.neededTo[0];
const g = await wl.savePermit(B, { id: [pm.id], kind: "container", title: pm.title, municipalityId: [], status: { granted: null }, location: pm.location, taskIds: [task.id], neededFrom: [], neededTo: [], leadDays: [], requestedOn: [today], validFrom: [start], validTo: [end], reference: "PROEF/2026/1", costCents: [2500n], note: "proef" });
check("toegekend, geldig = de taak", isOk(g) && g.ok.validFrom[0] === start, errOf(g));
if (isOk(g) && g.ok.files.length === 0) {
  const f = await admin.addFile("vergunning-proef.pdf", "application/pdf", 1234n, new TextEncoder().encode("!caf!sha256:" + "e".repeat(64)), [B], false);
  check("proefbestand (zonder echte inhoud) bij P-B", isOk(f), errOf(f));
  const a = await wl.attachPermitFile(pm.id, f.ok);
  check("de vergunning zelf hangt eraan", isOk(a) && a.ok.files.length === 1, errOf(a));
}
const oaV = (await oa2.workPermits(B)).permits.find((p) => p.id === pm.id);
check("OA Dak (lid van P-B) ziet de vergunning zonder kost en notitie", !!oaV && oaV.costCents.length === 0 && oaV.note === "");
check("klant leest geen vergunningen van P-A", await rejects(klant.workPermits(A)));
// Gearchiveerde werfbord-vergunning (voor de lektest) — één keer
if (!(await admin.exportChunk("permits", 0n, 500n)).ok.permits.some((p) => p.workId === B && p.kind === "werfbord" && p.archivedAt.length === 1)) {
  const w = await wl.savePermit(B, { id: [], kind: "werfbord", title: "Werfbord (proef)", municipalityId: [], status: { needed: null }, location: "", taskIds: [], neededFrom: [start], neededTo: [start + 30n], leadDays: [], requestedOn: [], validFrom: [], validTo: [], reference: "", costCents: [], note: "" });
  check("werfbord-vergunning en archiveren", isOk(w) && isOk(await wl.archivePermit(w.ok.id, "draftproef")), errOf(w));
}
// Werfzone op P-A, geldig vandaag: op de gsm, architect leest, daarna gearchiveerd
const z = await admin.savePermit(A, { id: [], kind: "werfzone", title: "Werfzone (proef)", municipalityId: [], status: { granted: null }, location: "2 parkeerplaatsen", taskIds: [], neededFrom: [today], neededTo: [today + 2n], leadDays: [], requestedOn: [], validFrom: [today - 1n], validTo: [today + 2n], reference: "", costCents: [], note: "" });
check("werfzone op P-A, geldig vandaag", isOk(z), errOf(z));
check("op de gsm: de werfleider ziet ze vandaag", (await wl.permitsOnSite(today)).some((p) => p.id === z.ok.id));
check("architect (lid van P-A) leest ze; OA en calculator niet op de gsm", (await arch.workPermits(A)).permits.some((p) => p.id === z.ok.id) && (await rejects(oa2.permitsOnSite(today))) && (await rejects(calc.permitsOnSite(today))));
check("overzicht 'vraagt aandacht' (admin) toont de werfzone zonder bestand", (await admin.listPermits("aandacht", [])).some((p) => p.id === z.ok.id));
check("dashboard: teller vergunningen (admin) ≥ 1", ((await admin.dashboard(today)).counters.permitsThisMonth[0] ?? 0n) >= 1n);
check("werfzone weer gearchiveerd", isOk(await admin.archivePermit(z.ok.id, "draftproef")));
console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
