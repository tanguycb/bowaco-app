// Rollentest HERVAT (stap 2b.4): gegenereerd door tools/maak-hervat.py uit tests/rollen.mjs. Voor een draft waarop de rollentest
// halverwege afbrak: de gegevens van de eerste helft worden opgezocht en de controles lopen verder vanaf het toewijzen van «tegels».
// Alleen met GECLAIMD=1 op een draft; draait NIET opnieuw wat al gebeurd is.
// Rollentest (architectuur §9.2): per rol wat moet lukken en wat moet falen. Vast instrument vóór
// elke draft. Alleen tegen een LEGE canister: de test claimt de opstartcode en vult de data waarop
// tests/lek.mjs daarna draait.
//   lokaal:  ICP_HOST=http://localhost:8041 node tests/rollen.mjs <canister-id>
//   draft:   node tests/rollen.mjs <canister-id>          (zonder klokproef)
// Lokaal verzet de test de klok van het EIGEN PocketIC-net (tests/net) om vervaltijden te bewijzen.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { backend, freshBackend, identity, KEYDIR, nepmail, resync } from "../tools/lib.mjs";
import { M, batchArgs, expectRaw, fromRead, sameTotals, saveAll } from "./offerte-lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/rollen.mjs <canister-id>");
const host = process.env.ICP_HOST || "https://icp-api.io";
const local = host.includes("localhost") || host.includes("127.0.0.1");
const bootstrap = readFileSync(join(KEYDIR, "test-opstartcode.txt"), "utf8").trim();
// GECLAIMD=1 (tools/draft-opbouw.mjs): een draft die de EIGENAAR met zijn eigen opstartcode claimde en waaraan hij de
// testbeheerder koppelde (tools/proef-admin-koppelen.mjs). Dan: geen claim (de testbeheerder is al beheerder), geen
// mailblok (op de draft zou de klokjob het testadres echt beleveren: er gaat nooit mail weg) en geen proef op "de laatste
// beheerder" (de eigenaar is er een tweede; de proef zou de testbeheerder echt degraderen). De rest is dezelfde test.
const geclaimd = process.env.GECLAIMD === "1"; // lokaal ook bruikbaar als generale repetitie (tools/draft-opbouw.mjs --proef)

let pass = 0;
let fail = 0;
const failures = [];
function check(name, cond, extra = "") {
  if (cond) pass++;
  else {
    fail++;
    failures.push(name);
  }
  console.log(`${cond ? "✓" : "✗"} ${name}${extra ? `  — ${extra}` : ""}`);
}
async function rejects(p) {
  try {
    await p;
    return false;
  } catch {
    return true;
  }
}
// Geweigerd = trap, of #err die met "Geen toegang" begint.
async function denied(p) {
  try {
    const r = await p;
    return !!(r && typeof r === "object" && "err" in r && /^Geen toegang/.test(r.err));
  } catch {
    return true;
  }
}
const isOk = (r) => r && typeof r === "object" && "ok" in r;
const ok1b = (r) => { if (r && typeof r === "object" && "err" in r) throw new Error(r.err); return r.ok; };
const errOf = (r) => (r && typeof r === "object" && "err" in r ? r.err : "");
const status = (me) => Object.keys(me.status)[0];
const roles = (...rs) => rs.map((r) => ({ [r]: null }));
const opt = (v) => (v === undefined || v === null ? [] : [v]);
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);

// Testidentiteiten (Ed25519, ~/.bowaco). "fresh" = wegwerpidentiteit voor de remming.
const as = async (name) => backend(name, cid);
const fresh = () => freshBackend(cid);

// Klok van het eigen PocketIC-net (alleen lokaal; nooit een gedeeld net).
const netDir = process.env.BOWACO_NET || join(KEYDIR, "net");
const descr = join(netDir, ".icp/cache/networks/local/descriptor.json");
async function advance(ns) {
  const d = JSON.parse(readFileSync(descr, "utf8"));
  if (d["project-dir"] !== netDir) throw new Error("niet ons eigen net");
  const base = `http://127.0.0.1:${d["pocketic-config-port"]}/instances/${d["pocketic-instance-id"]}`;
  const now = BigInt((await (await fetch(`${base}/read/get_time`)).json()).nanos_since_epoch);
  const r = await fetch(`${base}/update/set_time`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nanos_since_epoch: Number(now + ns) }),
  });
  if (!r.ok) throw new Error(`set_time: ${r.status} ${await r.text()}`);
  await new Promise((res) => setTimeout(res, 1500)); // het net moet de nieuwe tijd eerst in een ronde verwerken
  await resync(...everyone);
}
const HOUR = 3_600_000_000_000n;
const DAY = 24n * HOUR;

const t0 = Date.now();
async function sec(t) {
  console.log(`${t}  [${((Date.now() - t0) / 1000).toFixed(0)} s]`);
  if (local) await resync(...everyone);
}
const anon = await backend(null, cid);
const admin = await as("proef-admin");
const admin2 = await as("proef-admin2");
const wl = await as("proef-werfleider");
const wl2 = await as("proef-werfleider-toestel2");
const calc = await as("proef-calculator");
const arch = await as("proef-architect");
const oa = await as("proef-oa");
const oa2 = await as("proef-oa2");
const klant = await as("proef-klant");
const vc = await as("proef-vc");
const vreemde = await as("proef-vreemde");
const wlcalc = await as("proef-wlcalc");
const nieuw = await as("proef-nieuw");
const robot = await as("robot-test");
const everyone = [anon, admin, admin2, wl, wl2, calc, arch, oa, oa2, klant, vc, vreemde, nieuw, robot, wlcalc];
const P = (n) => identity(n).getPrincipal();
const codes = []; // alle uitgegeven codes, voor de auditcontrole


// ── Hervatten: hulpfuncties uit rollen.mjs (letterlijk) ──
const INTERN = ["admin", "werfleider", "calculator"];
const org = async (kind, name, extra = {}) =>
  admin.createOrg({ kind: { [kind]: null }, name, kbo: opt(extra.kbo), vat: [], aliases: extra.aliases ?? [], trades: [], address: opt(extra.address), notes: "" });
const invite = (who, name, rs, extra = {}) =>
  who.invitePerson({ name, roles: rs, orgId: opt(extra.orgId ?? (rs.every((r) => !INTERN.includes(Object.keys(r)[0])) ? orgX.ok.id : undefined)), shortCode: opt(extra.shortCode), lang: [], phone: [], workIds: extra.workIds ?? [], validDays: extra.days ?? 0n, tag: extra.tag ?? "" });
const redeem = async (who, code) => {
  codes.push(code);
  return who.redeemCode(code);
};
const mk = async (name, rs, extra, who) => {
  const r = await invite(admin, name, rs, extra);
  if (!isOk(r)) throw new Error(`${name}: ${errOf(r)}`);
  const rr = await redeem(who, r.ok.code);
  if (!isOk(rr)) throw new Error(`${name} inwisselen: ${errOf(rr)}`);
  return rr.ok;
};
const ids = async (who) => (await who.listWorks()).map((w) => Number(w.id)).sort();
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const cert = (who) => who._immutableObjectStorageCreateCertificate("sha256:" + "a".repeat(64));
const blob = (h) => new TextEncoder().encode("!caf!sha256:" + h.repeat(64));
const oaFilter = (o = {}) => ({ text: opt(o.text), trade: opt(o.trade), kind: opt(o.kind ? { [o.kind]: null } : undefined), includeArchived: o.archived ?? false });
const orgIn12 = (name, extra = {}) => ({ kind: { subcontractor: null }, name, kbo: opt(extra.kbo), vat: [], aliases: extra.aliases ?? [], trades: extra.trades ?? [], address: [], notes: "" });
const pIn = (name, extra = {}) => ({ id: opt(extra.id), name, shortCode: opt(extra.shortCode), phone: opt(extra.phone), email: opt(extra.email), jobTitle: extra.jobTitle ?? "", note: extra.note ?? "" });
const find = async (o) => (await admin.listOas(oaFilter(o))).map((v) => v.org.name);
const row = (key, name, extra = {}) => ({ key, kind: { [extra.kind ?? "subcontractor"]: null }, name, kbo: opt(extra.kbo), vat: [], aliases: extra.aliases ?? [], trades: extra.trades ?? [], phone: opt(extra.phone), email: opt(extra.email), website: [], notes: extra.notes ?? "", persons: extra.persons ?? [] });
const dayOf = (y, m, d) => BigInt(Math.floor(Date.UTC(y, m - 1, d) / 86_400_000));
const wd = (d) => (Number(d) + 3) % 7; // 0 = maandag
const fmt = (d) => new Date(Number(d) * 86_400_000).toISOString().slice(0, 10);
const tIn = (o) => ({ id: opt(o.id), title: o.title ?? "Proeftaak", note: o.note ?? "", kind: { [o.kind ?? "work"]: null }, trade: opt(o.trade), responsibleOrgId: opt(o.org), status: { [o.status ?? "planned"]: null }, percent: o.percent ?? 0n, start: o.start ?? dayOf(2026, 11, 2), workdays: o.workdays ?? 5n, leadDays: o.lead ?? 0n, orderDay: opt(o.orderDay), reason: o.reason ?? "" });
const plan = async (who, w = A) => { if (!local) await new Promise((r) => setTimeout(r, 2000)); return who.getPlan(w); };
const byKey = (p, k) => p.tasks.find((t) => t.templateKey[0] === k);
const START = dayOf(2026, 11, 2); // maandag
// ── Gegevens van de afgebroken run, opgezocht op de draft (er wordt niets opnieuw aangemaakt) ──
const ame = await admin.me();
const adminId = ame.person[0].id;
const wlId = (await wl.me()).person[0].id;
const oaDakId = (await oa2.me()).person[0].id;
const allOrgs = await admin.listOrgs(false);
const orgBy = (n) => { const o = allOrgs.find((x) => x.name === n); if (!o) throw new Error(`hervatten: firma ${n} niet gevonden`); return { ok: o }; };
const orgX = orgBy("Proef Tegels BV");
const orgY = orgBy("Proef Dak NV");
const orgArch = orgBy("Proef Architecten");
const orgKlant = orgBy("Familie Proef");
const orgElek = orgBy("Proef Elektro BV");
const worksAll = await admin.listWorks();
const A = worksAll.find((w) => w.code === "P-A").id;
const B = worksAll.find((w) => w.code === "P-B").id;
const tpls = await calc.listTemplates();
const std = tpls.find((t) => t.key === "standaardrenovatie");
const invAdmRow = (await admin.listInvites(0n, 500n)).find((i) => i.personName === "Code van admin");
const invAdm = { ok: { inviteId: invAdmRow ? invAdmRow.id : 0n } };
let pA = await plan(wl);

const tgA = byKey(pA, "tegels").assignments[0];
check("toewijzing open, firma is lid van de werf", tgA && "open" in tgA.confirmation && tgA.primary && tgA.inTeam && tgA.orgCode[0] === "GILS", JSON.stringify(tgA, big));
const dkT = byKey(pA, "dak");
check("«dak» naar OA Dak (lid via zijn firma, zonder bevestigingsrecht)", isOk(await wl.saveTask(A, tIn({ id: dkT.id, title: dkT.title, trade: "dak", org: orgY.ok.id, start: dkT.start, workdays: dkT.workdays }), pA.version)));
pA = await plan(wl);
const extra = await wl.saveAssignment(A, { id: [], taskId: byKey(pA, "tegels").id, orgId: orgElek.ok.id, personId: [], fromDay: [byKey(pA, "tegels").start], toDay: [byKey(pA, "tegels").start + 1n], note: "stopcontacten faïence" }, pA.version);
check("tweede uitvoerder voor een deel van de taak (elektricien, 2 dagen)", isOk(extra), errOf(extra));
pA = await plan(wl);
check("tweede uitvoerder niet in het team → inTeam = nee (ziet de taak niet)", byKey(pA, "tegels").assignments.some((a) => a.orgId === orgElek.ok.id && !a.inTeam && a.end === a.start + 1n));
check("de verantwoordelijke archiveren via de uitvoerders geweigerd", errOf(await wl.archiveAssignment(A, tgA.id, pA.version)).includes("bij de taak"));
// Zicht per rol
const pOa = await plan(oa);
check("OA Tegels ziet enkel zijn eigen taak (tegels), zonder interne notitie en zonder andere firma's", pOa.scope === "ownOrg" && pOa.tasks.length === 1 && pOa.tasks[0].title.startsWith("Tegel") && pOa.tasks[0].note === "" && pOa.tasks[0].assignments.every((a) => a.orgId === orgX.ok.id), JSON.stringify(pOa.tasks.map((t) => t.title)));
check("OA Tegels: geen afhankelijkheden van anderen, geen bewerken, wel bevestigen", pOa.dependencies.length === 0 && !pOa.caps.edit && pOa.caps.confirm);
const pOa2 = await plan(oa2);
check("OA Dak ziet op A enkel «dak»; bevestigen kan niet (geen grant #confirmPlanning)", pOa2.tasks.length === 1 && pOa2.tasks[0].title === "Dakwerken" && !pOa2.caps.confirm);
const pKl = await plan(klant);
check("klant ziet de samenvatting: alle taken en data, geen firma's, geen notities, geen uitvoerders", pKl.scope === "summary" && pKl.tasks.length === 28 && pKl.tasks.every((t) => t.responsibleName === "" && t.responsibleOrgId.length === 0 && t.note === "" && t.assignments.length === 0) && pKl.dependencies.length === 0);
const pAr = await plan(arch);
check("architect ziet alles behalve interne notities", pAr.scope === "external" && pAr.tasks.length === 28 && byKey(pAr, "tegels").responsibleName === "Proef Tegels BV" && byKey(pAr, "tegels").note === "" && !pAr.caps.edit);
check("veiligheidscoördinator ziet zoals de architect", (await plan(vc)).scope === "external");
check("werfleider ziet de interne notitie", byKey(pA, "tegels").note.includes("buren"));
check("wijzigingen: interne rollen wel, architect en OA niet", (await calc.taskHistory(A, [], 0n, 5n)).length === 5 && (await rejects(arch.taskHistory(A, [], 0n, 5n))) && (await rejects(oa.taskHistory(A, [], 0n, 5n))));
// Bevestigen (R6)
check("OA Dak kan de toewijzing van de tegelfirma niet bevestigen", await rejects(oa2.confirmAssignment(tgA.id, true, "")));
const dkA = byKey(pA, "dak").assignments[0];
check("OA Dak kan zijn eigen toewijzing op A niet bevestigen zonder grant", await rejects(oa2.confirmAssignment(dkA.id, true, "")));
check("werfleider kan niet bevestigen in naam van de OA", await rejects(wl.confirmAssignment(tgA.id, true, "")));
check("OA Tegels bevestigt zijn toewijzing", isOk(await oa.confirmAssignment(tgA.id, true, "")));
check("bevestiging zichtbaar voor de werfleider, met naam", await plan(wl).then((p) => { const a = byKey(p, "tegels").assignments.find((x13) => x13.id === tgA.id); return "confirmed" in a.confirmation && a.confirmedByName[0] === "Proef OA Tegels"; }));
const mine = await oa.orgAssignments([], dayOf(2026, 10, 1), dayOf(2027, 6, 30));
check("«Mijn taken» van de OA: de tegels op werf P-A, bevestigd, mag bevestigen", mine.length === 1 && mine[0].workCode === "P-A" && mine[0].canConfirm && "confirmed" in mine[0].assignment.confirmation, JSON.stringify(mine, big));
check("toewijzingen per firma (weekbord 1.4): werfleider en calculator wel, een andere OA niet", (await wl.orgAssignments([orgX.ok.id], dayOf(2026, 10, 1), dayOf(2027, 6, 30))).length === 1 && (await calc.orgAssignments([orgX.ok.id], dayOf(2026, 10, 1), dayOf(2027, 6, 30))).length === 1 && (await rejects(oa2.orgAssignments([orgX.ok.id], dayOf(2026, 10, 1), dayOf(2027, 6, 30)))));
// Verschuiven zet de bevestiging terug open
pA = await plan(wl);
const tg2 = byKey(pA, "tegels");
const mv2 = await wl.applyPlan(A, { move: { taskId: tg2.id, start: tg2.start + 7n, workdays: tg2.workdays, mode: { follow: null } } }, pA.version, "");
check("tegels een week later: bevestiging terug open (reopened ≥ 1)", isOk(mv2) && mv2.ok.reopened >= 1n && (await plan(wl).then((p) => "open" in byKey(p, "tegels").assignments.find((x13) => x13.id === tgA.id).confirmation)), errOf(mv2));
check("eigen bereik van de tweede uitvoerder schoof mee", await plan(wl).then((p) => { const t = byKey(p, "tegels"); const x13 = t.assignments.find((a) => a.orgId === orgElek.ok.id); return x13.start === t.start && x13.end === t.start + 1n; }));
check("weigeren zonder reden geweigerd", errOf(await oa.confirmAssignment(tgA.id, false, " ")).includes("reden"));
check("OA Tegels weigert met reden", isOk(await oa.confirmAssignment(tgA.id, false, "die week op een andere werf")));
check("werfleider krijgt een melding van de weigering", (await wl.myNotifications(true)).some((n) => n.kind === "planning-geweigerd" && n.text.includes("andere werf")));
// Levering met besteldatum
pA = await plan(wl);
const lr = byKey(pA, "levering-ramen");
const late13 = lr.start - 10n; // besteld 10 dagen vóór de geplande levering, levertermijn 56 d → te laat
const dl = await wl.saveTask(A, tIn({ id: lr.id, title: lr.title, kind: "delivery", trade: "buitenschrijnwerk", start: lr.start, workdays: 0n, lead: 56n, orderDay: late13 }), pA.version);
pA = await plan(wl);
check("levering te laat besteld: levering en opvolgers schuiven naar besteldatum + 56 d", isOk(dl) && byKey(pA, "levering-ramen").start >= late13 + 56n && byKey(pA, "ramen").start >= byKey(pA, "levering-ramen").start && pA.tasks.every((t) => t.warnings.length === 0), errOf(dl));
// Volgorde en archiveren
const order = pA.tasks.map((t) => t.id);
check("volgorde met een ontbrekende taak geweigerd", "err" in (await wl.setTaskOrder(A, order.slice(1), pA.version)));
check("volgorde omkeren", isOk(await wl.setTaskOrder(A, [...order].reverse(), pA.version)) && (await plan(wl)).tasks[0].id === order[order.length - 1]);
pA = await plan(wl);
const trap = byKey(pA, "trap");
check("taak archiveren (trap): weg uit de planning, met haar afhankelijkheden", isOk(await wl.archiveTask(A, trap.id, pA.version)) && await plan(wl).then((p) => p.tasks.length === 27 && p.dependencies.every((d) => d.fromTaskId !== trap.id && d.toTaskId !== trap.id)));
// Vrije taak, en twee planners tegelijk
pA = await plan(wl);
const free = await wl.saveTask(A, tIn({ title: "Nutsaansluiting (proef)", workdays: 1n, start: dayOf(2026, 11, 14) }), pA.version);
check("vrije taak op een zaterdag → naar maandag", isOk(free) && (await plan(wl)).tasks.some((t) => t.title === "Nutsaansluiting (proef)" && t.start === dayOf(2026, 11, 16)));
check("tweede planner met de oude versie: geweigerd", errOf(await admin.saveTask(A, tIn({ title: "Gelijktijdig" }), pA.version)).includes("intussen gewijzigd"));
// Werf B: een taak voor OA Dak (gebruikt door de lektest)
const pB = await plan(admin, B);
check("admin plant op werf B een taak voor OA Dak", isOk(await admin.saveTask(B, tIn({ title: "Dakgoot B", trade: "dak", org: orgY.ok.id, start: dayOf(2026, 11, 9) }), pB.version)));
check("OA Dak bevestigt op B (lid met standaardrechten)", await plan(oa2, B).then((p) => p.caps.confirm && p.tasks.length === 1));
// Sjablonen beheren (admin)
const stepsMod = std.steps.filter((s) => s.key !== "trap").map((s) => ({ ...s, after: s.after.filter((a) => a !== "trap") }));
check("werfleider kan geen sjabloon wijzigen", await denied(wl.saveTemplate({ key: "standaardrenovatie", name: "x13", steps: stepsMod, provisional: true, archived: false })));
check("sjabloon met een stap die wacht op een latere stap geweigerd", errOf(await admin.saveTemplate({ key: "fout", name: "Fout", steps: [{ ...std.steps[1], after: ["bestaat-later"] }], provisional: true, archived: false })).includes("niet vóór"));
check("sjabloon met onbekend vakgebied geweigerd", errOf(await admin.saveTemplate({ key: "fout", name: "Fout", steps: [{ ...std.steps[0], trade: ["bestaat-niet"] }], provisional: true, archived: false })).includes("vakgebied"));
check("admin past de standaard aan (zonder trap)", isOk(await admin.saveTemplate({ key: "standaardrenovatie", name: "Standaardrenovatie", steps: stepsMod, provisional: true, archived: false })));
const tpl2 = (await calc.listTemplates()).find((t) => t.key === "standaardrenovatie");
check("aangepaste standaard: 27 stappen, nu bewaard", tpl2.steps.length === 27 && tpl2.stored);
check("eigen sjabloon 'badkamer' (2 stappen)", isOk(await admin.saveTemplate({ key: "badkamer", name: "Badkamer", steps: [{ key: "afbraak", title: "Afbraak badkamer", trade: ["afbraak"], kind: { work: null }, workdays: 2n, leadDays: 0n, after: [], lagDays: 0n, note: "" }, { key: "tegels", title: "Tegels badkamer", trade: ["tegels"], kind: { work: null }, workdays: 4n, leadDays: 0n, after: ["afbraak"], lagDays: 0n, note: "" }], provisional: false, archived: false })));
pA = await plan(wl);
const app2 = await wl.applyTemplate(A, "badkamer", dayOf(2027, 3, 1), true, pA.version);
check("sjabloon 'badkamer' achteraan toevoegen", isOk(app2) && (await plan(wl)).tasks.length === 30, errOf(app2));
// Auditlog en export
const log13 = await admin.auditLog(0n, 200n);
check("auditlog: sjabloon, verschuiven, kalender, uitvoerder, bevestigd en geweigerd", ["planning-sjabloon", "planning-geschoven", "kalender", "planning-uitvoerder", "planning-bevestigd", "planning-geweigerd", "planning-taak", "sjabloon"].every((a) => log13.some((e) => e.action === a)), [...new Set(log13.map((e) => e.action))].filter((a) => /plan|kalender|sjabloon/.test(a)).join(","));
check("auditlog: geen interne notitie van de taak", !log13.some((e) => e.detail.includes("buren")));
const ex13 = await admin.exportIntern();
check("interne export bevat taken, uitvoerders, afhankelijkheden, kalender, wijzigingen en sjablonen", ex13.tasks.length >= 31 && ex13.assignments.length >= 3 && ex13.dependencies.length >= 30 && ex13.calendarBlocks.length === 3 && ex13.taskChanges.length > 50 && ex13.templates.length === 2);

await sec("── 1.4 weekbord per OA: conflicten (dubbel, afwezig, blokkering), afwezigheden, regels, Mijn week, rechten");
const bq = (o = {}) => ({ from: o.from ?? START, weeks: o.weeks ?? 12n, offset: o.offset ?? 0n, limit: o.limit ?? 50n, text: o.text ?? "", trade: opt(o.trade), workId: opt(o.workId), onlyConflicts: o.only ?? false, withIdle: o.idle ?? false });
const rowOf = (b, orgId) => b.rows.find((r) => r.orgId === orgId);
const absIn = (o) => ({ id: opt(o.id), orgId: o.org ?? orgY.ok.id, personId: opt(o.person), kind: { [o.kind ?? "verlof"]: null }, from: o.from, to: o.to, note: o.note ?? "" });
const rulesIn = (o = {}) => ({ unit: o.unit ?? "dag", defaultMax: o.max ?? 1n, oaReportsAbsence: o.oa ?? true });
// Rechten: het weekbord is intern (#readOrgPlanning)
check("anoniem, ongekoppeld, OA, architect, klant en veiligheid zien het weekbord niet", (await Promise.all([anon, vreemde, oa, oa2, arch, klant, vc].map((x14) => rejects(x14.weekBoard(bq()))))).every(Boolean));
const wbCalc = await calc.weekBoard(bq());
check("calculator leest het weekbord, maar geeft geen afwezigheden in en wijzigt geen regels", !wbCalc.caps.manageAbsences && !wbCalc.caps.manageRules);
const wbWl = await wl.weekBoard(bq());
check("werfleider: afwezigheden ingeven ja, regels nee", wbWl.caps.manageAbsences && !wbWl.caps.manageRules);
check("admin: afwezigheden en regels", (await admin.weekBoard(bq())).caps.manageRules);
check("caps: OA Dak mag zijn eigen afwezigheid melden, de calculator niet", (await oa2.me()).caps[0].reportOwnAbsence && !(await calc.me()).caps[0].reportOwnAbsence && (await wl.me()).caps[0].manageAbsences);
// Dubbel: OA Dak op A («Dakwerken») en op B («Proef dubbel B») op dezelfde dagen
check("OA Dak krijgt het vakgebied dak (voor de regel per vakgebied)", isOk(await admin.updateOrg(orgY.ok.id, orgIn12("Proef Dak NV", { trades: ["dak"] }))));
pA = await plan(wl);
const dakA = byKey(pA, "dak");
const W14 = dakA.start - BigInt(wd(dakA.start)); // maandag van die week
let pB14 = await plan(admin, B);
check("admin plant «Proef dubbel B» voor OA Dak op de startdag van «Dakwerken» van A", isOk(await admin.saveTask(B, tIn({ title: "Proef dubbel B", trade: "dak", org: orgY.ok.id, start: dakA.start, workdays: 2n }), pB14.version)));
let wb = await admin.weekBoard(bq({ from: W14, weeks: 2n }));
let rY = rowOf(wb, orgY.ok.id);
check("conflict 'dubbel': OA Dak op A én B op dezelfde dag (regel: hoogstens 1, per dag)", wb.unit === "dag" && rY && rY.conflicts.some((c) => c.kind === "dubbel" && c.works.length === 2 && c.days.includes(dakA.start)), JSON.stringify(rY?.conflicts, big));
check("cel van die week: beide werven met het werflint", rY && rY.cells.find((c) => c.week === 0n)?.items.filter((i) => i.clash).length === 2);
check("de taken tonen enkel werkdagen (ma–vr) van die week", rY && rY.cells.every((c) => c.items.every((i) => i.tasks.every((x14) => x14.days.every((d) => wd(d) < 5)))));
check("regel van OA Dak: de algemene (1)", rY && rY.maxWorks === 1n && rY.maxFrom === "algemeen");
check("conflicttotaal ≥ 1 en de rijen gesorteerd op code", wb.conflictTotal >= 1n);
// Regels (admin)
check("werfleider en calculator wijzigen geen regels", (await denied(wl.setCapacity("trade:dak", [2n], ""))) && (await denied(calc.setBoardRules(rulesIn()))));
check("regel voor het vakgebied dak: 2 werven tegelijk → geen dubbel meer", isOk(await admin.setCapacity("trade:dak", [2n], "twee ploegen")) && await admin.weekBoard(bq({ from: W14, weeks: 2n })).then((b14) => { const r = rowOf(b14, orgY.ok.id); return r.maxFrom === "vakgebied" && r.maxWorks === 2n && !r.conflicts.some((c) => c.kind === "dubbel"); }));
check("eigen regel voor de firma (1) gaat voor die van het vakgebied: weer dubbel", isOk(await admin.setCapacity(`org:${orgY.ok.id}`, [1n], "")) && await admin.weekBoard(bq({ from: W14, weeks: 2n })).then((b14) => { const r = rowOf(b14, orgY.ok.id); return r.maxFrom === "firma" && r.conflicts.some((c) => c.kind === "dubbel"); }));
check("regel van de firma weg → volgt weer het vakgebied", isOk(await admin.setCapacity(`org:${orgY.ok.id}`, [], "")) && rowOf(await admin.weekBoard(bq({ from: W14, weeks: 2n })), orgY.ok.id).maxFrom === "vakgebied");
check("onbekende sleutel, onbekend vakgebied en te groot getal geweigerd", errOf(await admin.setCapacity("x", [1n], "")).includes("Code") && errOf(await admin.setCapacity("trade:bestaat-niet", [1n], "")).includes("vakgebied") && errOf(await admin.setCapacity("trade:dak", [99n], "")).includes("Hoogstens"));
const rl = await calc.boardRules();
check("regels lezen (intern): eenheid dag, algemeen 1, OA meldt ja, eigen regel 'Dak'", rl.unit === "dag" && rl.defaultMax === 1n && rl.oaReportsAbsence && rl.rules.length === 1 && rl.rules[0].maxWorks === 2n, JSON.stringify(rl, big));
check("OA leest de regels niet", await rejects(oa2.boardRules()));
check("regel van het vakgebied weer weg", isOk(await admin.setCapacity("trade:dak", [], "")));
// Per dag of per week: Elektro op maandag (A) en woensdag (B) van dezelfde week
const MON = dayOf(2027, 6, 7);
pA = await plan(wl);
check("Elektro op ma 07.06.2027 op A", isOk(await wl.saveTask(A, tIn({ title: "Proef ma A", org: orgElek.ok.id, start: MON, workdays: 1n }), pA.version)));
pB14 = await plan(admin, B);
check("Elektro op wo 09.06.2027 op B", isOk(await admin.saveTask(B, tIn({ title: "Proef wo B", org: orgElek.ok.id, start: MON + 2n, workdays: 1n }), pB14.version)));
const elek = async () => rowOf(await admin.weekBoard(bq({ from: MON, weeks: 1n })), orgElek.ok.id);
check("per dag: ma A en wo B is geen dubbel", (await elek()).conflicts.length === 0);
check("eenheid 'week' (zoals de Excel): wel dubbel", isOk(await admin.setBoardRules(rulesIn({ unit: "week" }))) && (await elek()).conflicts.some((c) => c.kind === "dubbel" && c.text.includes("week")));
check("onbekende eenheid geweigerd, eenheid terug op dag", errOf(await admin.setBoardRules(rulesIn({ unit: "maand" }))).includes("Eenheid") && isOk(await admin.setBoardRules(rulesIn())));
check("algemene regel 0 = onbeperkt: nergens dubbel", isOk(await admin.setBoardRules(rulesIn({ max: 0n }))) && !(await admin.weekBoard(bq({ from: W14, weeks: 2n }))).rows.some((r) => r.conflicts.some((c) => c.kind === "dubbel")) && isOk(await admin.setBoardRules(rulesIn())));
// Vraagt aandacht en de werfpagina
const bc = await admin.boardConflicts(W14, 2n, 50n);
check("Vraagt aandacht: boardConflicts toont het dubbel van OA Dak", bc.total >= 1n && bc.items.some((c) => c.orgId === orgY.ok.id && c.kind === "dubbel"));
check("werfpagina B: workConflicts(B) bevat het conflict", (await wl.workConflicts(B, W14, 2n)).items.some((c) => c.kind === "dubbel" && c.works.some(([w]) => w[0] === B)));
check("OA en architect lezen geen conflicten", (await rejects(oa2.workConflicts(B, W14, 2n))) && (await rejects(arch.boardConflicts(W14, 2n, 5n))));
// Een werfleider die niet alles ziet: B is "andere werf" (bezet, zonder code, naam of taak)
await admin.setSettings({ werfleiderZietAlles: false, inviteDays: 7n, threshold30bisCents: 3_000_000n, thresholdCheckinatworkCents: 50_000_000n });
const wbH = await wl.weekBoard(bq({ from: W14, weeks: 2n }));
const rH = rowOf(wbH, orgY.ok.id);
const hiddenIt = rH?.cells.flatMap((c) => c.items).find((i) => i.hidden);
check("werfleider (alles-zien uit): werf B als 'andere werf' zonder code, naam of taak", !!hiddenIt && hiddenIt.workId.length === 0 && hiddenIt.workCode === "" && hiddenIt.tasks.every((x14) => x14.title === "" && x14.taskId === 0n), JSON.stringify(hiddenIt, big));
check("…maar het dubbel blijft zichtbaar (met 'andere werf')", rH.conflicts.some((c) => c.kind === "dubbel" && c.works.some(([w, code]) => w.length === 0 && code === "andere werf")));
check("werfleider (alles-zien uit) leest de conflicten van werf B niet", await rejects(wl.workConflicts(B, W14, 2n)));
await admin.setSettings({ werfleiderZietAlles: true, inviteDays: 7n, threshold30bisCents: 3_000_000n, thresholdCheckinatworkCents: 50_000_000n });
// Afwezigheden
const tegelsId = (await oa.me()).person[0].id;
check("calculator geeft geen afwezigheid in", await denied(calc.saveAbsence(absIn({ from: W14, to: W14 + 4n }))));
check("OA Tegels meldt geen afwezigheid voor een andere firma", await denied(oa.saveAbsence(absIn({ from: W14, to: W14 + 4n }))));
const nAdm = (await admin.myNotifications(true)).length;
const abs1 = await wl.saveAbsence(absIn({ from: dakA.start, to: dakA.start + 2n, note: "proef (intern)" }));
check("werfleider zet OA Dak op verlof in de week van «Dakwerken»", isOk(abs1), errOf(abs1));
rY = rowOf(await admin.weekBoard(bq({ from: W14, weeks: 2n })), orgY.ok.id);
check("conflict 'afwezig': OA Dak staat ingepland tijdens zijn verlof", rY.conflicts.some((c) => c.kind === "afwezig" && c.days.includes(dakA.start)), JSON.stringify(rY.conflicts.map((c) => c.text)));
check("de afwezigheid staat op de rij (ingegeven door kantoor)", rY.absences.some((a) => a.id === abs1.ok && "intern" in a.source && !a.mine));
check("melding aan wie het moet weten (B heeft geen werfleider → de admins)", (await admin.myNotifications(true)).length > nAdm && (await admin.myNotifications(true)).some((n) => n.kind === "afwezigheid" && n.text.includes("Proef Dak NV")));
check("einde vóór begin, te lang en onbekende firma geweigerd", errOf(await wl.saveAbsence(absIn({ from: W14 + 4n, to: W14 }))).includes("vóór") && errOf(await wl.saveAbsence(absIn({ from: W14, to: W14 + 400n }))).includes("hoogstens") && errOf(await wl.saveAbsence(absIn({ org: 999_999n, from: W14, to: W14 }))).includes("Onbekende firma"));
check("een persoon van een andere firma geweigerd", errOf(await wl.saveAbsence(absIn({ person: tegelsId, from: W14, to: W14 }))).includes("hoort niet"));
check("een persoon van de firma: OA Tegels zelf (enkel zijn eigen toewijzingen botsen)", isOk(await wl.saveAbsence(absIn({ org: orgX.ok.id, person: tegelsId, kind: "andere", from: MON, to: MON }))));
// De OA zelf
check("OA Dak ziet de afwezigheden van zijn firma", (await oa2.listAbsences([orgY.ok.id], W14 - 30n, W14 + 200n)).some((a) => a.id === abs1.ok));
check("OA Dak ziet niet die van een andere firma, en niet de lijst van alle firma's", (await rejects(oa2.listAbsences([orgX.ok.id], W14, W14 + 10n))) && (await rejects(oa2.listAbsences([], W14, W14 + 10n))));
const abs2 = await oa2.saveAbsence(absIn({ kind: "ziekte", from: W14 + 35n, to: W14 + 36n }));
check("OA Dak meldt zelf een afwezigheid (ziekte, zonder reden)", isOk(abs2), errOf(abs2));
check("die staat als 'gemeld door de OA' en is van hem", (await oa2.listAbsences([orgY.ok.id], W14, W14 + 60n)).some((a) => a.id === abs2.ok && "oa" in a.source && a.mine));
check("OA Dak wijzigt of haalt de afwezigheid van kantoor niet weg", (await rejects(oa2.saveAbsence(absIn({ id: abs1.ok, from: dakA.start, to: dakA.start })))) && (await rejects(oa2.archiveAbsence(abs1.ok))));
check("OA Dak verlengt zijn eigen melding", isOk(await oa2.saveAbsence(absIn({ id: abs2.ok, kind: "ziekte", from: W14 + 35n, to: W14 + 37n }))));
check("een eigen melding zonder taken erin: de admins weten het", (await admin.myNotifications(true)).some((n) => n.kind === "afwezigheid" && n.text.includes("gemeld door")));
check("de firma van een afwezigheid wijzigen kan niet", await rejects(wl.saveAbsence(absIn({ id: abs2.ok, org: orgX.ok.id, from: W14, to: W14 }))));
check("admin zet 'OA meldt zelf' uit: OA Dak kan niet meer melden", isOk(await admin.setBoardRules(rulesIn({ oa: false }))) && (await denied(oa2.saveAbsence(absIn({ from: W14 + 50n, to: W14 + 50n })))) && !(await oa2.me()).caps[0].reportOwnAbsence);
check("…en weer aan", isOk(await admin.setBoardRules(rulesIn())));
const hist14 = await oa2.absenceHistory(orgY.ok.id, 0n, 20n);
check("geschiedenis: nieuw (kantoor), nieuw (OA) en gewijzigd, met wie", ["nieuw", "gewijzigd"].every((w14) => hist14.some((h) => h.what === w14)) && hist14.some((h) => h.byName === "Proef Werfleider") && hist14.some((h) => h.detail.includes("gemeld door de OA")), JSON.stringify(hist14.map((h) => `${h.what}:${h.detail}`)));
check("OA Tegels leest de geschiedenis van OA Dak niet", await rejects(oa.absenceHistory(orgY.ok.id, 0n, 5n)));
check("OA Dak haalt zijn eigen melding weg", isOk(await oa2.archiveAbsence(abs2.ok)) && !(await oa2.listAbsences([orgY.ok.id], W14, W14 + 60n)).some((a) => a.id === abs2.ok));
// Mijn week
const my14 = await oa2.myBoard(W14, 2n);
check("Mijn week van OA Dak: enkel zijn firma, enkel werven waar hij lid is, niets verborgen", my14.row.length === 1 && my14.row[0].orgId === orgY.ok.id && my14.canReport && my14.row[0].cells.every((c) => c.items.every((i) => !i.hidden)), JSON.stringify(my14.row[0]?.cells, big));
check("Mijn week: zijn conflicten (dubbel en afwezig) en zijn afwezigheid", my14.row[0].conflicts.some((c) => c.kind === "dubbel") && my14.row[0].conflicts.some((c) => c.kind === "afwezig") && my14.row[0].absences.length >= 1);
const myT = await oa.myBoard(W14, 2n);
check("OA Tegels ziet in Mijn week enkel zijn eigen firma", myT.row.length === 0 || myT.row[0].orgId === orgX.ok.id);
check("architect, klant, veiligheid: een lege Mijn week", (await Promise.all([arch, klant, vc].map((x14) => x14.myBoard(W14, 2n)))).every((m) => m.row.length === 0 && !m.canReport));
check("ongekoppeld en anoniem: geen Mijn week", (await rejects(vreemde.myBoard(W14, 2n))) && (await rejects(anon.myBoard(W14, 2n))));
// Blokkering: een STOP op B op de startdag van «Proef dubbel B», zonder herschikken
const stop14 = await wl.saveCalendarBlock({ id: [], scope: { work: B }, kind: { stop: null }, from: dakA.start, to: dakA.start, reason: "STOP (proef 1.4)" });
check("werfleider zet een STOP op B op de startdag van «Proef dubbel B»", isOk(stop14), errOf(stop14));
rY = rowOf(await admin.weekBoard(bq({ from: W14, weeks: 2n })), orgY.ok.id);
check("conflict 'blokkering': «Proef dubbel B» begint in een STOP", rY.conflicts.some((c) => c.kind === "blokkering" && c.text.includes("Proef dubbel B") && c.text.includes("STOP")), JSON.stringify(rY.conflicts.map((c) => c.text)));
check("STOP weer weg: geen blokkering meer", isOk(await wl.archiveCalendarBlock(stop14.ok)) && !rowOf(await admin.weekBoard(bq({ from: W14, weeks: 2n })), orgY.ok.id).conflicts.some((c) => c.kind === "blokkering"));
// Paginering en filters
const pg1 = await admin.weekBoard(bq({ from: W14, weeks: 2n, limit: 1n, idle: true }));
const pg2 = await admin.weekBoard(bq({ from: W14, weeks: 2n, limit: 1n, offset: 1n, idle: true }));
check("paginering: 1 firma per pagina, totaal ≥ 3, pagina 2 is een andere firma", pg1.rows.length === 1 && pg1.total >= 3n && pg2.rows.length === 1 && pg2.rows[0].orgId !== pg1.rows[0].orgId, `${pg1.total}`);
check("'ook zonder werk' toont ook de firma's zonder taak in het venster", pg1.total > (await admin.weekBoard(bq({ from: W14, weeks: 2n }))).total);
check("enkel conflicten: elke rij heeft een conflict", (await admin.weekBoard(bq({ from: W14, weeks: 2n, only: true }))).rows.every((r) => r.conflicts.length > 0));
check("zoeken op de planningcode 'gils' → enkel de tegelfirma", (await admin.weekBoard(bq({ text: "GILS", idle: true }))).rows.every((r) => r.orgId === orgX.ok.id));
check("filter op werf B → enkel firma's met werk op B", (await admin.weekBoard(bq({ from: W14, weeks: 2n, workId: B }))).rows.every((r) => r.cells.some((c) => c.items.some((i) => i.workId[0] === B))));
check("filter op vakgebied 'dak' → enkel firma's met dat vakgebied", (await admin.weekBoard(bq({ idle: true, trade: "dak" }))).rows.every((r) => r.trades.includes("dak")));
check("venster van 13 weken, 0 weken en een onmogelijke datum geweigerd", (await rejects(admin.weekBoard(bq({ weeks: 13n })))) && (await rejects(admin.weekBoard(bq({ weeks: 0n })))) && (await rejects(admin.weekBoard(bq({ from: 10n })))));
check("het weekbord geeft zijn rekenwerk mee (meetwaarde)", (await admin.weekBoard(bq())).instructions > 0n);
// Kantoor haalt zijn afwezigheid weg (de lektest gebruikt ze als gearchiveerde afwezigheid van kantoor)
check("werfleider haalt het verlof van OA Dak weg", isOk(await wl.archiveAbsence(abs1.ok)));
check("weg is weg: nog eens weghalen geeft een fout (geen trap)", errOf(await wl.archiveAbsence(abs1.ok)).includes("bestaat niet meer"));
// Auditlog en export
const log14 = await admin.auditLog(0n, 300n);
check("auditlog: afwezigheid (nieuw, gewijzigd, weg), weekbord-regel(s); nooit de notitie", ["afwezigheid", "weekbord-regel", "weekbord-regels"].every((a) => log14.some((e) => e.action === a)) && log14.some((e) => e.action === "afwezigheid" && e.detail.includes("weg")) && !log14.some((e) => e.detail.includes("proef (intern)")));
const ex14 = await admin.exportIntern();
check("interne export bevat afwezigheden, hun geschiedenis en de regels", ex14.absences.length >= 3 && ex14.absenceChanges.length >= 5 && ex14.capacity.length >= 2);

{
await sec("── 1.5 import van de bestaande planning: proefronde, idempotent, aliassen, vervolg/deelwerf, terugdraaien, rechten (R32)");
const M15 = dayOf(2027, 3, 1); // een maandag, ver van de rest van de testdata
const orgImpDak = await admin.createOrg(orgIn12("Import Test Dak BV", { aliases: ["IMPDAK", "I-DAK"] }));
const orgImpEl = await admin.createOrg(orgIn12("Import Test Elektro BV", { aliases: ["IMPEL"] }));
const nOrgs15 = (await admin.listOrgs(true)).length;
const nWorks15 = (await admin.listWorks()).length;
const run15 = (name, from, to, note = "") => ({ key: `r-${name}-${from}`, name, from: M15 + BigInt(from * 7), to: M15 + BigInt(to * 7 + 4), note });
const task15 = (key, title, w0, w1, o = {}) => ({
  key, title, note: o.note ?? "", responsible: opt(o.resp), status: { [o.status ?? "planned"]: null }, percent: o.status === "done" ? 100n : 0n,
  start: M15 + BigInt(w0 * 7), workdays: BigInt((w1 - w0 + 1) * 5), order: 1n, runs: o.runs ?? [], appointments: o.appts ?? [], extra: [["planning-rij", "1"]],
});
const appt15 = (key, week, dayInWeek, time, text, name) => ({ key, day: M15 + BigInt(week * 7 + dayInWeek), time: opt(time), text, name: opt(name), weekFallback: false });
const blk15 = (key, name, tasks, decision = { fresh: null }, vat = 600n) => ({ key, name, street: "Importstraat", number: "1", zip: "9000", city: "Gent", vatBp: vat, decision, tasks });
const b1 = blk15("t15-blok1", "Importwerf Een", [
  task15("t15-1-a", "Afbraakwerken", 0, 0, { status: "done" }),
  task15("t15-1-b", "Dakwerken", 1, 3, { resp: "impdak", runs: [run15("IMPDAK", 1, 2, "wk 2: later"), run15("I-DAK", 3, 3), run15("ONBEKEND1", 1, 1)], appts: [appt15("t15-1-b-p0", 2, 1, "7:30", "IMPDAK 7u30 dinsdag", "IMPDAK")] }),
  task15("t15-1-c", "Elektriciteit", 2, 2, { resp: "ONBEKEND2", runs: [run15("IMPEL", 2, 2)] }),
]);
const b2 = blk15("t15-blok2", "Importwerf Een (vervolg)", [task15("t15-2-a", "Opkuis", 5, 5, { resp: "IMPEL", runs: [run15("IMPEL", 5, 5)] })], { followUp: "t15-blok1" });
const b3 = blk15("t15-blok3", "Importwerf Twee (gevel)", [task15("t15-3-a", "Gevelwerken", 0, 1)], { sub: "t15-blok1" });
const imp = (who, dry, batch, blk, known = []) => who.importPlanning(dry, batch, "Proefimport 1.5", known, blk);
// Rechten: enkel admin
check("import: geweigerd voor werfleider, calculator, OA, architect, klant, veiligheid en anoniem", (await Promise.all([wl, calc, oa2, arch, klant, vc, anon, vreemde].map((x) => denied(imp(x, true, "x", b1))))).every(Boolean));
check("terugdraaien en batchlijst: enkel admin", (await Promise.all([wl, calc, oa2, arch, klant, vc, anon].map((x) => Promise.all([denied(x.rollbackImport("x", true)), rejects(x.listImportBatches())])))).every((r) => r[0] && r[1]));
check("caps: importPlan enkel voor admin", (await admin.me()).caps[0].importPlan && !(await wl.me()).caps[0].importPlan && !(await calc.me()).caps[0].importPlan);
// Invoercontrole
check("blok zonder taken geweigerd", "err" in (await imp(admin, true, "t15", { ...b1, tasks: [] })));
check("btw 7 % geweigerd", "err" in (await imp(admin, true, "t15", { ...b1, vatBp: 700n })));
check("start op een zaterdag geweigerd", "err" in (await imp(admin, true, "t15", { ...b1, tasks: [{ ...b1.tasks[0], start: M15 + 5n }] })));
check("duur 0 of > 400 werkdagen geweigerd", "err" in (await imp(admin, true, "t15", { ...b1, tasks: [{ ...b1.tasks[0], workdays: 401n }] })) && "err" in (await imp(admin, true, "t15", { ...b1, tasks: [{ ...b1.tasks[0], workdays: 0n }] })));
check("vervolg van een onbekend blok geweigerd", errOf(await imp(admin, true, "t15", { ...b2, decision: { followUp: "bestaat-niet" } })).includes("geen werf of eerder blok"));
check("te veel uitvoerders voor één taak geweigerd", "err" in (await imp(admin, true, "t15", { ...b1, tasks: [{ ...b1.tasks[1], runs: Array.from({ length: 9 }, (_, i) => run15("IMPDAK", i, i)) }] })));
// Proefronde bewaart niets
const d1 = await imp(admin, true, "t15", b1);
const d2 = await imp(admin, true, "t15", b2, ["t15-blok1"]);
check("proefronde blok 1: 1 werf, 3 taken, 4 uitvoerreeksen (1 zonder firma), 1 afspraak", isOk(d1) && d1.ok.workCreated === 1n && d1.ok.tasksCreated === 3n && d1.ok.assignmentsCreated === 3n && d1.ok.appointmentsCreated === 1n, JSON.stringify(d1, big));
check("proefronde: namen zonder firma in het rapport (ONBEKEND1, ONBEKEND2), geen nieuwe firma", isOk(d1) && d1.ok.unmatched.map((x) => x[0]).sort().join() === "ONBEKEND1,ONBEKEND2");
check("proefronde blok 2 (vervolg) verwijst naar blok 1 van dezelfde ronde", isOk(d2) && d2.ok.workCreated === 0n && d2.ok.tasksCreated === 1n);
check("proefronde bewaarde niets (werven, firma's, batches)", (await admin.listWorks()).length === nWorks15 && (await admin.listOrgs(true)).length === nOrgs15 && (await admin.listImportBatches()).length === 0);
// Echt
const r1 = await imp(admin, false, "t15", b1);
check("echt blok 1: 1 werf, 3 taken, 3 uitvoerreeksen, 1 afspraak", isOk(r1) && r1.ok.workCreated === 1n && r1.ok.tasksCreated === 3n && r1.ok.assignmentsCreated === 3n && r1.ok.appointmentsCreated === 1n && r1.ok.workId.length === 1, JSON.stringify(r1, big));
const W15 = r1.ok.workId[0];
const r2 = await imp(admin, false, "t15", b2, ["t15-blok1"]);
check("echt blok 2 (vervolg): taak komt in dezelfde werf", isOk(r2) && r2.ok.workId[0] === W15 && r2.ok.workCreated === 0n && r2.ok.tasksCreated === 1n, JSON.stringify(r2, big));
const r3 = await imp(admin, false, "t15", b3, ["t15-blok1", "t15-blok2"]);
const W15b = isOk(r3) ? r3.ok.workId[0] : 0n;
check("echt blok 3 (deelwerf): eigen werf met parentId", isOk(r3) && r3.ok.workCreated === 1n && (await admin.getWork(W15b)).parentId[0] === W15, JSON.stringify(r3, big));
const w15 = await admin.getWork(W15);
check("werf kreeg een eigen code PL-nn, het adres en de btw", /^PL-\d\d$/.test(w15.code) && w15.name === "Importwerf Een" && w15.address.city === "Gent" && w15.vatBp === 600n, w15.code);
const p15 = await plan(admin, W15);
const t15 = (title) => p15.tasks.find((t) => t.title === title);
check("4 taken in de werf (3 + 1 vervolg), op volgorde", p15.tasks.length === 4 && t15("Opkuis") && t15("Afbraakwerken").status.done !== undefined);
const dak = t15("Dakwerken");
check("Dakwerken: start maandag week 1, einde vrijdag week 3, 15 werkdagen", dak && dak.start === M15 + 7n && dak.workdays === 15n && dak.end === M15 + 25n, `${dak?.start} ${dak?.end}`);
check("Dakwerken: verantwoordelijke gekoppeld via alias (hoofdletters), eerste reeks is de primaire", dak.responsibleOrgId[0] === orgImpDak.ok.id && dak.assignments.some((a) => a.primary && a.orgId === orgImpDak.ok.id));
check("Dakwerken: reeksen I-DAK en IMPDAK samen bij één firma, ONBEKEND1 niet gekoppeld", dak.assignments.filter((a) => a.orgId === orgImpDak.ok.id).length === 2 && dak.assignments.length === 2 && dak.note.includes("ONBEKEND1"), dak.note);
check("Elektriciteit: verantwoordelijke ONBEKEND2 geen firma; IMPEL werkt wel", t15("Elektriciteit").responsibleOrgId.length === 0 && t15("Elektriciteit").assignments.some((a) => a.orgId === orgImpEl.ok.id));
check("taak zonder firma: Afbraakwerken heeft geen uitvoerder, wel zijn tijd", t15("Afbraakwerken").assignments.length === 0 && t15("Afbraakwerken").workdays === 5n);
check("geen nieuwe firma ontstaan", (await admin.listOrgs(true)).length === nOrgs15);
const ap15 = await admin.listAppointments(W15);
check("afspraak: dag, uur, tekst en firma", ap15.length === 1 && ap15[0].time[0] === "7:30" && ap15[0].text === "IMPDAK 7u30 dinsdag" && ap15[0].orgId[0] === orgImpDak.ok.id && ap15[0].day === M15 + 15n);
check("afspraken lezen: werfleider (ziet de werf) ja; OA, klant, architect, veiligheid en anoniem niet", (await rejects(oa2.listAppointments(W15))) && (await rejects(klant.listAppointments(W15))) && (await rejects(arch.listAppointments(W15))) && (await rejects(vc.listAppointments(W15))) && (await rejects(anon.listAppointments(W15))));
const hist = await admin.taskHistory(W15, [], 0n, 50n);
check("historiek: elke taak heeft zijn 'taak'-regel met reden «import t15»", hist.filter((h) => h.field === "taak" && h.reason === "import t15").length === 4);
// Weekbord: de firma staat op de werf
const wb15 = await admin.weekBoard(bq({ from: M15, weeks: 6n }));
const rowDak15 = wb15.rows.find((r) => r.orgId === orgImpDak.ok.id);
check("weekbord: Import Test Dak staat op de geïmporteerde werf", rowDak15 && rowDak15.cells.some((c) => c.items.some((i) => i.workId[0] === W15)));
// Idempotent
const again = [await imp(admin, false, "t15", b1), await imp(admin, false, "t15", b2, ["t15-blok1"]), await imp(admin, false, "t15", b3, ["t15-blok1", "t15-blok2"])];
check("tweede keer: niets nieuw, alles 'bestond al' (geen dubbels)", again.every((x) => isOk(x) && x.ok.workCreated === 0n && x.ok.tasksCreated === 0n && x.ok.assignmentsCreated === 0n && x.ok.appointmentsCreated === 0n) && again[0].ok.tasksExisting === 3n && again[0].ok.assignmentsExisting === 3n && again[0].ok.appointmentsExisting === 1n, JSON.stringify(again, big));
check("nog steeds 2 werven erbij, 4 taken, 1 afspraak", (await admin.listWorks()).length === nWorks15 + 2 && (await plan(admin, W15)).tasks.length === 4 && (await admin.listAppointments(W15)).length === 1);
check("batch: 3 blokken, 2 werven, 5 taken, 4 uitvoerreeksen, 1 afspraak (tweede ronde telt niet mee)", await admin.listImportBatches().then((b) => b.length === 1 && b[0].works === 2n && b[0].tasks === 5n && b[0].assignments === 4n && b[0].appointments === 1n && b[0].blocks === 6n), "");
// Auditlog: aantallen, geen firma- of werfnamen
const log15 = await admin.auditLog(0n, 400n);
check("auditlog: import-planning (proef en echt), zonder namen", ["import-planning-proef", "import-planning"].every((a) => log15.some((e) => e.action === a)) && !log15.filter((e) => e.action.startsWith("import-planning")).some((e) => /Importwerf|IMPDAK|ONBEKEND/.test(e.detail)));
// Vervolg met een werfcode
const r4 = await imp(admin, false, "t15", blk15("t15-blok4", "Nog een blok", [task15("t15-4-a", "Extra taak", 7, 7)], { followUp: w15.code }));
check("vervolg van een bestaande werf via zijn code", isOk(r4) && r4.ok.workId[0] === W15 && r4.ok.workCreated === 0n && (await plan(admin, W15)).tasks.length === 5);
// Terugdraaien: eerst een vreemde taak in de werf zetten → die werf blijft staan
const pf = await plan(admin, W15b);
check("admin zet een eigen taak in de deelwerf", isOk(await admin.saveTask(W15b, tIn({ title: "Eigen taak na de import", start: M15 + 70n, workdays: 2n }), pf.version)));
const tb0 = await admin.rollbackImport("t15", true);
check("proefronde terugdraaien: 1 werf (de deelwerf heeft een eigen taak en blijft), 6 taken, 4 uitvoerders, 1 afspraak", isOk(tb0) && tb0.ok.dryRun && tb0.ok.works === 1n && tb0.ok.tasks === 6n && tb0.ok.assignments === 4n && tb0.ok.appointments === 1n && tb0.ok.keptWorks.length === 1, JSON.stringify(tb0, big));
check("de proefronde veranderde niets", (await plan(admin, W15)).tasks.length === 5);
const tb = await admin.rollbackImport("t15", false);
const exTb = await admin.exportIntern();
check("terugdraaien: werf, taken, uitvoerders en afspraken gearchiveerd (niet gewist)", isOk(tb) && exTb.works.find((x) => x.id === W15).archivedAt.length === 1 && exTb.tasks.filter((x) => x.workId === W15).length === 5 && exTb.tasks.filter((x) => x.workId === W15).every((x) => x.archivedAt.length === 1) && exTb.assignments.filter((x) => x.workId === W15).every((x) => x.archivedAt.length === 1) && exTb.appointments.filter((x) => x.workId === W15).every((x) => x.archivedAt.length === 1));
check("een gearchiveerde werf geeft geen planning meer", await rejects(plan(admin, W15)));
check("de deelwerf met een eigen taak blijft: enkel de taken van de batch zijn weg", (await admin.getWork(W15b)).archivedAt.length === 0 && (await plan(admin, W15b)).tasks.length === 1 && (await plan(admin, W15b)).tasks[0].title === "Eigen taak na de import");
check("batch staat als teruggedraaid; nog eens terugdraaien geweigerd; de naam is niet meer te gebruiken", await admin.listImportBatches().then((b) => b[0].rolledBackAt.length === 1) && "err" in (await admin.rollbackImport("t15", false)) && errOf(await imp(admin, true, "t15", b1)).includes("teruggedraaid"));
check("het weekbord toont de gearchiveerde werf niet meer", await admin.weekBoard(bq({ from: M15, weeks: 6n })).then((b) => !b.rows.some((r) => r.cells.some((c) => c.items.some((i) => i.workId[0] === W15)))));
// Opnieuw na terugdraaien (sleutels vrij) onder een nieuwe batchnaam
const rr = await imp(admin, false, "t15-bis", b1);
check("na het terugdraaien kan dezelfde Excel opnieuw (nieuwe batch): nieuwe werf, geen dubbel met de oude", isOk(rr) && rr.ok.workCreated === 1n && rr.ok.tasksCreated === 3n && rr.ok.workId[0] !== W15, JSON.stringify(rr, big));
check("terugdraaien van de nieuwe batch: werf weg, geen vreemde inhoud", await admin.rollbackImport("t15-bis", false).then((x) => isOk(x) && x.ok.works === 1n && x.ok.keptWorks.length === 0));
const ex15 = await admin.exportIntern();
check("interne export bevat batches, sleutels en afspraken", ex15.importBatches.length === 2 && ex15.appointments.length >= 2 && Array.isArray(ex15.importKeys));
}

await sec("── 1.6 werfverslag: blokken, opId, twee toestellen, correctie, rechten per rol (R7, R8, R14)");
const nowDay = BigInt(Math.floor(Date.now() / 86_400_000));
let D = nowDay;
while (wd(D) >= 5) D -= 1n; // laatste werkdag (vandaag of vroeger)
const uid = () => crypto.randomUUID();
const ens = (key, w = A, day = D, opId = uid()) => ({ opId, clientKey: key, op: { ensure: { workId: w, day } } });
const att = (key, o = {}, opId = uid()) => ({ opId, clientKey: key, op: { attendance: { orgId: opt(o.org), personId: [], names: o.names ?? "", headcount: o.n ?? 1n, slots: o.slots ?? [{ fromMin: 450n, toMin: 720n }, { fromMin: 750n, toMin: 960n }], regie: o.regie ?? false, taskId: opt(o.task), note: "", replaces: opt(o.replaces) } } });
const sync1 = async (who, op) => (await who.reportSync([op]))[0];
const done = (r) => r && "done" in r.outcome;
const outErr = (r) => (r && "err" in r.outcome ? r.outcome.err : "");
const fileIn = (mime = "image/jpeg", c = "d") => ({ blob: new TextEncoder().encode("!caf!sha256:" + c.repeat(64)), name: "verslagfoto.jpg", mime, size: 120_000n });
const cWl = (await wl.me()).caps[0];
check("caps: admin en werfleider schrijven verslagen, calculator/OA niet", (await admin.me()).caps[0].writeReports && cWl.writeReports && !(await calc.me()).caps[0].writeReports && !(await oa.me()).caps[0].writeReports && cWl.readTrips && !cWl.manageVehicles);
// Een taak van vandaag op A voor OA Tegels (GILS), zodat "Vandaag" iets toont.
let pA16 = await plan(wl);
const st16 = await wl.saveTask(A, tIn({ title: "Proef vandaag", trade: "tegels", org: orgX.ok.id, start: D, workdays: 1n }), pA16.version);
check("werfleider plant «Proef vandaag» op de werkdag " + fmt(D), isOk(st16), errOf(st16));
const task16 = st16.ok.taskId[0];
const dayW = await wl.myDay(D, false);
const dA16 = dayW.works.find((w) => w.id === A);
check("Vandaag (werfleider): werf A met de taak van vandaag en GILS uit de planning", !!dA16 && dA16.mine && dA16.tasks.some((x) => x.id === task16 && x.orgCodes.includes("GILS")) && dA16.planned.some((x) => x.code === "GILS"), JSON.stringify(dA16?.planned ?? [], big));
check("Vandaag: chauffeurs zijn interne personen, firma's om toe te voegen", dayW.drivers.some((x) => x.id === wlId) && dayW.drivers.every((x) => x.id !== (oaDakId)) && dayW.orgs.some((o) => o.code === "GILS"));
check("Vandaag: calculator, OA, architect, klant, veiligheid en anoniem geweigerd", (await Promise.all([calc, oa, arch, klant, vc, anon].map((x16) => rejects(x16.myDay(D, false))))).every(Boolean));
check("verslag schrijven: calculator, OA, architect, klant, veiligheid en anoniem geweigerd (poort)", (await Promise.all([calc, oa, arch, klant, vc, anon].map((x16) => rejects(x16.reportSync([ens(uid())]))))).every(Boolean));
// Openen (ensure) en dezelfde opId nog eens (antwoord gemist)
const K1 = uid();
const e1op = ens(K1);
const e1 = await sync1(wl, e1op);
check("werfleider opent het verslag van A (nieuw)", done(e1) && e1.outcome.done.note === "nieuw", JSON.stringify(e1, big));
const rep1 = e1.outcome.done.reportId;
const e1b = await sync1(wl, e1op);
check("zelfde opId nog eens → hetzelfde resultaat, gemarkeerd als herhaling", done(e1b) && e1b.repeated && e1b.outcome.done.reportId === rep1);
check("zelfde clientKey, nieuwe opId → 'bestaat'", (await sync1(wl, ens(K1))).outcome.done?.note === "bestaat");
check("dezelfde sleutel voor een andere werf of dag geweigerd", outErr(await sync1(wl, ens(K1, B))).includes("andere werf of dag"));
check("verslag van 61 dagen geleden geweigerd", outErr(await sync1(wl, ens(uid(), A, nowDay - 61n))).includes("60 dagen"));
check("verslag voor over 5 dagen geweigerd", outErr(await sync1(wl, ens(uid(), A, nowDay + 5n))).includes("60 dagen"));
check("ongeldige opId geweigerd", outErr(await sync1(wl, { ...ens(uid()), opId: "x" })).includes("niet geldig"));
check("een blok zonder geopend verslag: 'eerst openen'", outErr(await sync1(wl, att(uid(), { org: orgX.ok.id }))).includes("eerst openen"));
await admin.setSettings({ werfleiderZietAlles: false, inviteDays: 7n, threshold30bisCents: 3_000_000n, thresholdCheckinatworkCents: 50_000_000n });
check("werfleider (alles-zien uit) opent geen verslag op werf B", outErr(await sync1(wl, ens(uid(), B))).includes("Geen toegang"));
await admin.setSettings({ werfleiderZietAlles: true, inviteDays: 7n, threshold30bisCents: 3_000_000n, thresholdCheckinatworkCents: 50_000_000n });
// Wie was er? (tijdvakken, regie)
const a1op = att(K1, { org: orgX.ok.id, n: 2n, regie: true, names: "Gils + Jan" });
const a1 = await sync1(wl, a1op);
check("aanwezigheid GILS ×2, 07:30–12:00 + 12:30–16:00, regie", done(a1), outErr(a1));
const a1b = await sync1(wl, a1op);
check("dezelfde aanwezigheid nog eens (zelfde opId) → geen dubbel", done(a1b) && a1b.repeated && a1b.outcome.done.entityId[0] === a1.outcome.done.entityId[0]);
check("overlappende tijdvakken geweigerd", outErr(await sync1(wl, att(K1, { org: orgX.ok.id, slots: [{ fromMin: 450n, toMin: 720n }, { fromMin: 700n, toMin: 900n }] }))).includes("overlappen"));
check("0 personen geweigerd", outErr(await sync1(wl, att(K1, { org: orgX.ok.id, n: 0n }))).includes("Aantal"));
check("een klant staat niet bij de aanwezigen", outErr(await sync1(wl, att(K1, { org: orgKlant.ok.id }))).includes("klant"));
// Tweede toestel (zelfde werfleider) en een tweede persoon (admin) op dezelfde werf en dag → hetzelfde verslag
const K2 = uid();
const e2 = await sync1(wl2, ens(K2));
check("tweede toestel van de werfleider komt in HETZELFDE verslag (samengevoegd)", done(e2) && e2.outcome.done.reportId === rep1 && e2.outcome.done.note === "samengevoegd", JSON.stringify(e2, big));
const K3 = uid();
const e3 = await sync1(admin, ens(K3));
check("admin op dezelfde werf en dag → hetzelfde verslag", done(e3) && e3.outcome.done.reportId === rep1);
const a2 = await sync1(admin, att(K3, { names: "Eigen ploeg" }));
check("admin voegt BOWACO (eigen ploeg) toe vanop zijn toestel", done(a2) && a2.outcome.done.reportId === rep1);
const opsBatch = await wl2.reportSync([att(K2, { org: orgY.ok.id, slots: [{ fromMin: 480n, toMin: 600n }] }), { opId: uid(), clientKey: K2, op: { text: { field: "weather", value: "regen" } } }]);
check("pakje van twee opdrachten vanop toestel 2: allebei uitgevoerd", opsBatch.every(done));
// Wat is er gedaan? → voortgang van de taak (Q-05 van 1.3)
const vBefore = (await plan(wl)).version;
const w1 = await sync1(wl, { opId: uid(), clientKey: K1, op: { workDone: { taskId: [task16], text: "", percent: [50n] } } });
const t16 = (await plan(wl)).tasks.find((x) => x.id === task16);
check("voortgang 50 % zet de taak op 'bezig' met werkelijk begin", done(w1) && t16.percent === 50n && "busy" in t16.status && t16.actualStart[0] === D, JSON.stringify(t16?.status));
check("de planversie gaat omhoog (een open Gantt ziet de wijziging)", (await plan(wl)).version > vBefore);
check("de wijziging staat in de planning met reden 'werfverslag'", (await wl.taskHistory(A, [task16], 0n, 20n)).some((c) => c.field === "voortgang" && c.reason.includes("werfverslag")));
check("een taak van werf B geweigerd", outErr(await sync1(wl, { opId: uid(), clientKey: K1, op: { workDone: { taskId: [(await admin.getPlan(B)).tasks[0].id], text: "", percent: [] } } })).includes("niet bij deze werf"));
check("lege regel geweigerd", outErr(await sync1(wl, { opId: uid(), clientKey: K1, op: { workDone: { taskId: [], text: " ", percent: [] } } })).includes("Schrijf"));
check("ander werk als tekst", done(await sync1(wl, { opId: uid(), clientKey: K1, op: { workDone: { taskId: [], text: "Opkuis kelder", percent: [] } } })));
// Foto's en bonnen
const ph = await sync1(wl, { opId: uid(), clientKey: K1, op: { photo: { file: fileIn(), thumb: [fileIn("image/jpeg", "e")], taskId: [task16], caption: "Voeg", takenAt: [] } } });
check("foto + miniatuur bij de taak", done(ph), outErr(ph));
check("een PDF als foto geweigerd", outErr(await sync1(wl, { opId: uid(), clientKey: K1, op: { photo: { file: fileIn("application/pdf"), thumb: [], taskId: [], caption: "", takenAt: [] } } })).includes("foto"));
check("een foto van 20 MB geweigerd (de gsm verkleint)", outErr(await sync1(wl, { opId: uid(), clientKey: K1, op: { photo: { file: { ...fileIn(), size: 20_000_000n }, thumb: [], taskId: [], caption: "", takenAt: [] } } })).includes("te groot"));
const repPhotoIds = (await admin.getReportDay(A, D)).flatMap((r) => r.photos.flatMap((p) => [p.file.id, ...p.thumb.map((x) => x.id)]));
check("foto's van een verslag staan NIET in de losse bestanden van de werf (R8/R12)", repPhotoIds.length === 2 && (await admin.listFiles([A])).every((f) => !repPhotoIds.includes(f.id)));
const mat = await sync1(wl, { opId: uid(), clientKey: K1, op: { material: { kind: { receipt: null }, text: "4 zakken mortel", quantity: "4", supplier: "Proef Bouwmarkt", file: [fileIn("image/jpeg", "f")] } } });
check("bon met foto", done(mat), outErr(mat));
check("materiaal zonder tekst of foto geweigerd", outErr(await sync1(wl, { opId: uid(), clientKey: K1, op: { material: { kind: { smallMaterial: null }, text: "", quantity: "", supplier: "", file: [] } } })).includes("Schrijf"));
const fileCount = (await admin.exportIntern()).files.length;
// Problemen en vertraging
const notesBefore = (await admin.myNotifications(true)).length;
const iss = await sync1(wl, { opId: uid(), clientKey: K1, op: { issue: { kind: { delay: null }, text: "Regen: voeg kan niet drogen", taskIds: [task16], delayDays: [2n] } } });
check("vertraging +2 wd gemeld", done(iss), outErr(iss));
check("de taak staat op 'vertraagd'", "delayed" in (await plan(wl)).tasks.find((x) => x.id === task16).status);
check("admin krijgt een melding van de vertraging", (await admin.myNotifications(true)).length > notesBefore && (await admin.myNotifications(true)).some((n) => n.kind === "verslag-vertraging"));
check("vertraging van 0 werkdagen geweigerd", outErr(await sync1(wl, { opId: uid(), clientKey: K1, op: { issue: { kind: { delay: null }, text: "x", taskIds: [], delayDays: [0n] } } })).includes("werkdagen"));
// Ritten en voertuigen
check("werfleider beheert geen voertuigen", await rejects(wl.saveVehicle({ id: [], plate: "1-ABC-123", name: "", archived: false })));
const veh = await admin.saveVehicle({ id: [], plate: "1-abc-123", name: "Camionette proef", archived: false });
check("admin voegt een voertuig toe (plaat in hoofdletters)", isOk(veh) && (await wl.listVehicles(false)).some((v) => v.plate === "1-ABC-123"));
check("dezelfde nummerplaat nog eens geweigerd", errOf(await admin.saveVehicle({ id: [], plate: "1-ABC-123", name: "", archived: false })).includes("bestaat al"));
check("OA leest geen voertuigen", await rejects(oa.listVehicles(false)));
const trip = await sync1(wl, { opId: uid(), clientKey: K1, op: { trip: { vehicleId: [veh.ok], plate: "", driverOutPersonId: [wlId], driverBackPersonId: [wlId], driverOutText: "", driverBackText: "", note: "", outMin: [], backMin: [] } } });
check("rit met voertuig en chauffeur heen/terug", done(trip), outErr(trip));
check("een OA als chauffeur geweigerd", outErr(await sync1(wl, { opId: uid(), clientKey: K1, op: { trip: { vehicleId: [], plate: "2-XYZ-999", driverOutPersonId: [oaDakId], driverBackPersonId: [], driverOutText: "", driverBackText: "", note: "", outMin: [], backMin: [] } } })).includes("BOWACO"));
check("ritten: admin ziet ze, de werfleider de zijne, calculator niet (R14)", (await admin.listTrips(D, D)).length >= 1 && (await wl.listTrips(D, D)).length >= 1 && (await rejects(calc.listTrips(D, D))));
check("rit van admin zonder werfleider als chauffeur: werfleider ziet ze niet", done(await sync1(admin, { opId: uid(), clientKey: K3, op: { trip: { vehicleId: [], plate: "9-ADM-001", driverOutPersonId: [adminId], driverBackPersonId: [], driverOutText: "", driverBackText: "", note: "", outMin: [], backMin: [] } } })) && (await wl.listTrips(D, D)).every((x) => x.plate !== "9-ADM-001") && (await admin.listTrips(D, D)).some((x) => x.plate === "9-ADM-001"));
// Samenvatting: laatste schrijver wint, de vorige waarde blijft zichtbaar
await sync1(wl, { opId: uid(), clientKey: K1, op: { text: { field: "summary", value: "Proef: voeg gezet" } } });
await sync1(admin, { opId: uid(), clientKey: K3, op: { text: { field: "summary", value: "Proef: voeg gezet, regen vanaf 14u" } } });
let v1 = (await admin.getReportDay(A, D))[0];
check("samenvatting: laatste schrijver wint, twee wijzigingen bewaard", v1.summary.includes("regen vanaf 14u") && v1.changes.filter((c) => c.field === "summary").length === 2);
check("weer staat erin ('regen', vanop toestel 2)", v1.weather === "regen");
check("verslag toont 3 aanwezigheidsregels, totalen en regie", v1.attendances.length === 3 && v1.regieMinutes === 960n && v1.totalMinutes === 960n + 480n + 120n, `${v1.totalMinutes} / ${v1.regieMinutes}`);
// Aanpassen (vervangen) en weghalen
const a1r = await sync1(wl, att(K1, { org: orgX.ok.id, n: 2n, regie: true, names: "Gils + Jan", slots: [{ fromMin: 450n, toMin: 720n }], replaces: a1op.opId }));
v1 = (await admin.getReportDay(A, D))[0];
check("uren aanpassen = oude regel gearchiveerd, nieuwe erbij (append-only)", done(a1r) && v1.attendances.length === 3 && v1.attendances.some((x) => x.minutesTotal === 540n) && !v1.attendances.some((x) => x.minutesTotal === 960n));
const rm = await sync1(admin, { opId: uid(), clientKey: K3, op: { remove: { blockKey: a2.opId } } });
v1 = (await admin.getReportDay(A, D))[0];
check("weghalen: het blok van de eigen ploeg is weg", done(rm) && v1.attendances.length === 2 && !v1.attendances.some((x) => x.orgId.length === 0));
check("onbekend blok weghalen geweigerd", outErr(await sync1(admin, { opId: uid(), clientKey: K3, op: { remove: { blockKey: uid() } } })).includes("Onbekend"));
// Zicht per rol (R8)
const vA = (await arch.getReportDay(A, D))[0];
check("architect (grant verslagen): alles behalve ritten en de foto van de bon", vA.scope === "reader" && vA.attendances.length === 2 && vA.trips.length === 0 && vA.materials.length === 1 && vA.materials[0].file.length === 0 && vA.materials[0].hasFile && vA.photos.length === 1);
const vAd = (await admin.getReportDay(A, D))[0];
check("admin: ritten en de foto van de bon", vAd.trips.length === 2 && vAd.materials[0].file.length === 1);
const vW = (await wl.getReportDay(A, D))[0];
check("werfleider ziet enkel zijn eigen rit (R14)", vW.trips.length === 1 && vW.trips[0].plate === "1-ABC-123");
const vK = (await klant.getReportDay(A, D))[0];
check("klant: samenvatting zonder namen, uren, problemen of materialen", vK.scope === "summary" && vK.attendances.length === 0 && vK.issues.length === 0 && vK.materials.length === 0 && vK.summary === "" && vK.authorName === "" && vK.photos.length === 1 && vK.workDone.length >= 1);
const vO = (await oa.getReportDay(A, D))[0];
check("OA Tegels: enkel de uren van zijn eigen firma", vO.scope === "ownHours" && vO.attendances.length === 1 && vO.attendances[0].orgId[0] === orgX.ok.id && vO.photos.length === 0 && vO.workDone.length === 0 && vO.summary === "");
check("veiligheidscoördinator (zonder grant) leest geen verslagen", await rejects(vc.getReportDay(A, D)));
check("OA leest de lijst van verslagen niet (enkel zijn uren)", await rejects(oa.listReports(A, 0n, 10n)));
check("OA Tegels: verslagen van werf B geweigerd", await rejects(oa.getReportDay(B, D)));
const lsA = await calc.listReports(A, 0n, 10n);
check("calculator: tijdlijn met het verslag (open, 2 regels, 1 foto)", lsA.length === 1 && "draft" in lsA[0].status && lsA[0].attendances === 2n && lsA[0].photos === 1n);
check("klant: tijdlijn zonder namen of uren", (await klant.listReports(A, 0n, 10n)).every((x) => x.authorName === "" && x.totalMinutes === 0n));
// Afsluiten (R7) en correctie (§8.4)
check("afsluiten: OA en calculator kunnen niet", (await rejects(calc.reportSync([{ opId: uid(), clientKey: K1, op: { finalize: null } }]))) && (await rejects(oa.reportSync([{ opId: uid(), clientKey: K1, op: { finalize: null } }]))));
const fz = { opId: uid(), clientKey: K1, op: { finalize: null } };
const f1 = await sync1(wl, fz);
check("werfleider (auteur) sluit af", done(f1) && f1.outcome.done.note === "afgesloten", outErr(f1));
check("afsluiten nog eens met dezelfde opId: herhaling", (await sync1(wl, fz)).repeated);
check("afsluiten vanop een ander toestel: 'al afgesloten' (idempotent)", (await sync1(admin, { opId: uid(), clientKey: K3, op: { finalize: null } })).outcome.done?.note === "al afgesloten");
check("een afgesloten verslag: weghalen kan niet meer", outErr(await sync1(wl, { opId: uid(), clientKey: K1, op: { remove: { blockKey: trip.opId } } })).includes("afgesloten"));
const late16 = await sync1(wl2, att(K2, { names: "Laat ingevuld (offline)" }));
check("een blok na het afsluiten (toestel was offline) → in een CORRECTIE, niet in het afgesloten verslag", done(late16) && late16.outcome.done.note === "correctie" && late16.outcome.done.reportId !== rep1);
const corrId = late16.outcome.done.reportId;
const day2 = await admin.getReportDay(A, D);
check("de dag heeft nu het afgesloten verslag en een open correctie", day2.length === 2 && "final" in day2[0].status && "draft" in day2[1].status && day2[1].corrects[0] === rep1);
check("het afgesloten verslag bleef ongewijzigd (2 regels)", day2[0].attendances.length === 2);
const f2 = await sync1(wl2, { opId: uid(), clientKey: K2, op: { finalize: null } });
check("toestel 2 sluit 'zijn' verslag af = de open correctie met inhoud", done(f2) && f2.outcome.done.note === "correctie afgesloten" && f2.outcome.done.reportId === corrId);
const day3 = await admin.getReportDay(A, D);
check("origineel = 'gecorrigeerd door' de correctie, de correctie = afgesloten", "corrected" in day3[0].status && day3[0].status.corrected.byReportId === corrId && "final" in day3[1].status);
const e9 = await sync1(admin, ens(uid()));
check("een nieuw toestel op een afgesloten dag begint meteen een correctie", done(e9) && e9.outcome.done.note === "correctie");
check("een leeg verslag afsluiten geweigerd", outErr(await sync1(admin, { opId: uid(), clientKey: (await (async () => { const k = uid(); await sync1(admin, ens(k, A, D - 1n)); return k; })()), op: { finalize: null } })).includes("leeg"));
// Problemen afhandelen
const openIss = await admin.listIssues([A], true, 10n);
check("open problemen op A: de vertraging", openIss.length === 1 && "delay" in openIss[0].kind && openIss[0].taskTitles[0] === "Proef vandaag");
check("calculator handelt niet af", await rejects(calc.handleIssue(openIss[0].id, "")));
check("werfleider handelt af; nog eens geweigerd", isOk(await wl.handleIssue(openIss[0].id, "Gantt verschoven")) && errOf(await wl.handleIssue(openIss[0].id, "")).includes("al afgehandeld"));
check("OA leest de problemen niet", await rejects(oa.listIssues([A], true, 10n)));
// Audit en export
const log16 = await admin.auditLog(0n, 300n);
check("auditlog: verslag-nieuw en verslag-afgesloten, zonder opslagverwijzing", log16.some((e) => e.action === "verslag-nieuw") && log16.some((e) => e.action === "verslag-afgesloten") && log16.every((e) => !e.detail.includes("!caf!")));
const ex16 = await admin.exportIntern();
check("export bevat verslagen, regels, foto's, bonnen, problemen, ritten en voertuigen", ex16.dayReports.length >= 3 && ex16.attendances.length >= 5 && ex16.photos.length === 1 && ex16.materials.length === 1 && ex16.issues.length === 1 && ex16.trips.length === 2 && ex16.vehicles.length === 1 && ex16.files.length === fileCount);

await sec("── 1.7 externe weergaven: Mijn uren (R9), mijn werven, rechten per externe, bestaande persoon uitnodigen, meldingen");
const oaId17 = (await oa.me()).person[0].id;
check("OA Tegels kreeg een melding: uren klaar om te bevestigen (na het afsluiten)", (await oa.myNotifications(false)).some((n) => n.kind === "uren-bevestigen"));
const hrs = await oa.myHours(D - 5n, D + 1n);
const gilsLine = hrs.find((h) => h.workId === A && h.minutesTotal === 540n);
check("Mijn uren (OA Tegels): de regel van GILS uit het afgesloten verslag, te bevestigen", !!gilsLine && gilsLine.reportFinal && gilsLine.canConfirm && hrs.every((h) => h.workId === A), JSON.stringify(hrs.map((h) => [h.workCode, String(h.minutesTotal)])));
check("Mijn uren: enkel de eigen firma (geen regels van Dak of BOWACO)", hrs.length === 1);
check("Mijn uren van een interne persoon: leeg", (await admin.myHours(D - 5n, D + 1n)).length === 0);
check("Mijn uren: periode langer dan 120 dagen geweigerd", await rejects(oa.myHours(D - 200n, D)));
check("OA bevestigt zijn uren", isOk(await oa.confirmHours(gilsLine.attendanceId, true, "")));
check("betwisten zonder reden geweigerd", errOf(await oa.confirmHours(gilsLine.attendanceId, false, " ")).includes("Schrijf"));
const wlNotes0 = (await wl.myNotifications(true)).length;
check("OA betwist daarna (append-only)", isOk(await oa.confirmHours(gilsLine.attendanceId, false, "we waren tot 17:00")));
const conf17 = (await admin.getReportDay(A, D))[0].attendances.find((x) => x.id === gilsLine.attendanceId).confirmations;
check("het verslag toont beide: bevestigd en betwist, met de reden", conf17.length === 2 && conf17[0].ok && !conf17[1].ok && conf17[1].remark.includes("17:00"));
check("de werfleider (auteur) krijgt een melding van de betwisting", (await wl.myNotifications(true)).length > wlNotes0 && (await wl.myNotifications(true)).some((n) => n.kind === "uren-betwist"));
check("OA Dak bevestigt de uren van GILS niet (andere firma)", await rejects(oa2.confirmHours(gilsLine.attendanceId, true, "")));
check("calculator, architect, klant bevestigen geen uren", (await Promise.all([calc, arch, klant].map((x17) => rejects(x17.confirmHours(gilsLine.attendanceId, true, ""))))).every(Boolean));
// Een regel in een OPEN verslag: nog niet te bevestigen
const K17 = uid();
await sync1(admin, ens(K17, A, D - 2n));
const open17 = await sync1(admin, att(K17, { org: orgX.ok.id }));
check("regel in een open verslag: 'nog niet afgesloten'", errOf(await oa.confirmHours(open17.outcome.done.entityId[0], true, "")).includes("niet afgesloten"));
// Rechten per externe (grants)
const memOa = (await admin.listMembers(A)).find((m) => m.personId[0] === oaId17 && "onderaannemer" in m.role && m.endedAt.length === 0);
check("OA Tegels heeft op A standaard: planning en uren bevestigen", !!memOa && memOa.grants.some((g) => "confirmHours" in g) && memOa.grants.some((g) => "confirmPlanning" in g));
check("calculator, OA en architect zetten geen rechten", (await Promise.all([calc, oa, arch].map((x17) => rejects(x17.setMemberGrants(memOa.id, []))))).every(Boolean));
check("een recht dat niet bij de rol past (verkoopprijzen voor een OA) geweigerd", errOf(await wl.setMemberGrants(memOa.id, [{ readSellPrices: null }])).includes("past niet"));
check("werfleider zet 'uren bevestigen' uit voor OA Tegels", isOk(await wl.setMemberGrants(memOa.id, [{ confirmPlanning: null }])));
check("zonder het recht: bevestigen geweigerd en 'kan bevestigen' uit", (await rejects(oa.confirmHours(gilsLine.attendanceId, true, ""))) && !(await oa.myHours(D - 5n, D + 1n))[0].canConfirm);
check("terug aan; de wijziging staat in de auditlog", isOk(await wl.setMemberGrants(memOa.id, [{ confirmPlanning: null }, { confirmHours: null }])) && (await admin.auditLog(0n, 50n)).some((e) => e.action === "lid-rechten"));
const memWl = (await admin.listMembers(A)).find((m) => "werfleider" in m.role && m.endedAt.length === 0);
check("een intern lidmaatschap (werfleider) heeft geen instelbare rechten", errOf(await admin.setMemberGrants(memWl.id, [])).includes("externe"));
// Mijn werven
const mw = await oa.myWorks();
check("Mijn werven (OA Tegels): enkel A, met rol en rechten", mw.length === 1 && mw[0].id === A && mw[0].roles.some((r) => "onderaannemer" in r) && mw[0].grants.length === 2);
check("Mijn werven van een interne persoon: leeg", (await calc.myWorks()).length === 0);
// Een bestaande contactpersoon uitnodigen (geen dubbele persoon)
const cp = await admin.saveOaPerson(orgX.ok.id, { id: [], name: "Proef Contact 1.7", shortCode: [], phone: [], email: [], jobTitle: "ploegbaas", note: "" });
check("contactpersoon zonder login in de OA-database", isOk(cp), errOf(cp));
const cpId = cp.ok.id;
const persons0 = (await admin.listPersons(true)).length;
const adminNotes17 = (await admin.myNotifications(true)).length;
check("OA en calculator nodigen niemand uit", (await denied(oa.inviteExistingPerson({ personId: cpId, workIds: [A], validDays: 0n, tag: "" }))) && (await denied(calc.inviteExistingPerson({ personId: cpId, workIds: [A], validDays: 0n, tag: "" }))));
const inv17 = await wl.inviteExistingPerson({ personId: cpId, workIds: [A], validDays: 0n, tag: "" });
check("werfleider nodigt de BESTAANDE contactpersoon uit voor zijn werf A (code, geen nieuwe persoon)", isOk(inv17) && inv17.ok.personId === cpId && (await admin.listPersons(true)).length === persons0, errOf(inv17));
check("de admin krijgt een melding van de uitnodiging door de werfleider", (await admin.myNotifications(true)).length > adminNotes17 && (await admin.myNotifications(true)).some((n) => n.kind === "uitnodiging" && n.text.includes("Proef Contact 1.7")));
check("hij is meteen lid van A (met de standaardrechten)", (await admin.listMembers(A)).some((m) => m.personId[0] === cpId && m.grants.length === 2));
const cpLogin = await fresh();
codes.push(inv17.ok.code);
const r17 = await cpLogin.redeemCode(inv17.ok.code);
check("de contactpersoon koppelt zich met de code → actief, ziet enkel A", isOk(r17) && status(r17.ok) === "active" && eq(await ids(cpLogin), [Number(A)]));
check("nog eens toegang geven: 'heeft al toegang'", errOf(await wl.inviteExistingPerson({ personId: cpId, workIds: [A], validDays: 0n, tag: "" })).includes("al toegang"));
check("een interne persoon (calculator) uitnodigen als bestaande persoon: geweigerd", "err" in (await admin.inviteExistingPerson({ personId: (await calc.me()).person[0].id, workIds: [], validDays: 0n, tag: "" })));
await sec("── 1.7 meldingen bij nieuwe en verschoven taken (Q-06 van 1.3, R-02 van 1.4)");
let p17 = await plan(wl);
const tk17 = p17.tasks.find((x) => x.id === task16);
const asg17 = tk17.assignments.find((a) => a.orgId === orgX.ok.id);
check("OA Tegels bevestigt «Proef vandaag»", isOk(await oa.confirmAssignment(asg17.id, true, "")));
const oaNotes0 = (await oa.myNotifications(true)).length;
p17 = await plan(wl);
const mv17 = await wl.applyPlan(A, { move: { taskId: task16, start: D + 7n, workdays: 1n, mode: { asNeeded: null } } }, p17.version, "proef 1.7");
check("werfleider verschuift de taak een week", isOk(mv17), errOf(mv17));
const oaN = await oa.myNotifications(true);
check("OA Tegels krijgt een melding 'planning schoof, bevestig opnieuw'", oaN.length > oaNotes0 && oaN.some((n) => n.kind === "planning-verschoven" && n.text.includes("Proef vandaag")), JSON.stringify(oaN.map((n) => n.text)));
check("de contactpersoon (zelfde firma, uren/planning-recht) krijgt ze ook", (await cpLogin.myNotifications(true)).some((n) => n.kind === "planning-verschoven"));
check("OA Dak (andere firma) krijgt ze niet", !(await oa2.myNotifications(true)).some((n) => n.kind === "planning-verschoven" && n.text.includes("Proef vandaag")));
p17 = await plan(wl);
const st17 = await wl.saveTask(A, tIn({ title: "Proef nieuwe taak 1.7", trade: "tegels", org: orgX.ok.id, start: D + 14n, workdays: 2n }), p17.version);
check("een nieuwe taak voor GILS → melding 'nieuwe taak'", isOk(st17) && (await oa.myNotifications(true)).some((n) => n.kind === "planning-nieuw" && n.text.includes("Proef nieuwe taak 1.7")));
check("meldingen lezen: enkel de eigen (R18), afvinken werkt", isOk({ ok: await oa.markNotificationsRead((await oa.myNotifications(true)).map((n) => n.id)) }) && (await oa.myNotifications(true)).length === 0);

await sec("── 1.8 dashboard: tellers, werven, achterstanden, deze week, openstaande bevestigingen, rechten");
const today18 = nowDay;
const mon18 = today18 - BigInt(wd(today18));
const prevWork18 = wd(today18) === 0 ? today18 - 3n : wd(today18) === 6 ? today18 - 2n : today18 - 1n;
check("dashboard: OA, architect, klant, veiligheid en anoniem geweigerd", (await Promise.all([oa2, arch, klant, vc, anon].map((x18) => rejects(x18.dashboard(today18))))).every(Boolean));
let pB18 = await admin.getPlan(B);
let lateStart = today18 - 14n;
while (wd(lateStart) >= 5) lateStart -= 1n;
const lt = await admin.saveTask(B, tIn({ title: "Proef achterstand 1.8", trade: "dak", org: orgY.ok.id, start: lateStart, workdays: 2n }), pB18.version);
check("admin plant op B een taak die al voorbij is (achterstand)", isOk(lt), errOf(lt));
check("werf B op 'bezig'", isOk(await admin.setWorkStatus(B, { running: null })));
pB18 = await admin.getPlan(B);
const wk = await admin.saveTask(B, tIn({ title: "Proef deze week 1.8", trade: "dak", org: orgY.ok.id, start: mon18, workdays: 5n }), pB18.version);
check("admin plant op B een taak voor deze week (ma–vr)", isOk(wk), errOf(wk));
const d18 = await admin.dashboard(today18);
const cB = d18.works.find((w) => w.id === B);
const cA = d18.works.find((w) => w.id === A);
check("tellers: werven bezig ≥ 1 (A), vertraagd ≥ 1, vergunningen geteld (1b.1)", d18.counters.running >= 1n && d18.counters.delayed >= 1n && d18.counters.permitsThisMonth.length === 1, JSON.stringify(d18.counters, big));
check("werf A: vertraagd (taak op 'vertraagd' uit het verslag van 1.6), met werfleider en voortgang", !!cA && cA.delayed && cA.tasksDelayed >= 1n);
check("werf B: achterstand met waarschuwing 'achter op de planning'", !!cB && cB.tasksLate >= 1n && cB.warnings.some((w) => w.includes("achter op de planning")) && cB.delayed);
const late18 = d18.late.find((x) => x.taskId === lt.ok.taskId[0]);
check("achterstanden: de taak met het aantal werkdagen te laat en de firma", !!late18 && late18.lateDays >= 5n && late18.orgNames.length === 1, JSON.stringify(late18, big));
check("deze week: de taak ma–vr van B", d18.thisWeek.some((x) => x.taskId === wk.ok.taskId[0]) && d18.monday === mon18);
check("deze week: taken die niet in deze week vallen staan er niet in", d18.thisWeek.every((x) => x.start <= mon18 + 4n && x.end >= mon18));
check("openstaande bevestigingen: «Proef vandaag» (verschoven, GILS moet opnieuw bevestigen)", d18.confirmations.some((c) => c.taskId === task16 && !c.declined && c.orgName === "GILS"));
const cntB = d18.confirmations.filter((c) => c.workId === B && !c.declined).length;
check("bevestigingen open per werf = de lijst", Number(cB.confirmOpen) === cntB);
const expectMissing = prevWork18 >= mon18;
check("ontbrekend werfverslag: werf B werkte op de vorige werkdag zonder verslag", expectMissing ? cB.missingReport[0] === prevWork18 && cB.warnings.some((w) => w.includes("geen werfverslag")) : cB.missingReport.length === 0, JSON.stringify({ miss: cB.missingReport.map(String), prev: String(prevWork18), status: Object.keys(cB.status)[0] }));
check("open problemen tellen (de vertraging van 1.6 is afgehandeld → 0 op A)", cA.openIssues === 0n);
check("rekenwerk ruim onder de grens (< 500 M instructies)", d18.instructions < 500_000_000n, `${Number(d18.instructions) / 1e6} M`);
check("calculator leest het dashboard", (await calc.dashboard(today18)).works.length === d18.works.length);
await admin.setSettings({ werfleiderZietAlles: false, inviteDays: 7n, threshold30bisCents: 3_000_000n, thresholdCheckinatworkCents: 50_000_000n });
const dWl18 = await wl.dashboard(today18);
check("werfleider (alles-zien uit): enkel zijn werf A, ook in de lijsten", dWl18.works.every((w) => w.id === A) && dWl18.late.every((x) => x.workId === A) && dWl18.thisWeek.every((x) => x.workId === A) && dWl18.confirmations.every((x) => x.workId === A));
await admin.setSettings({ werfleiderZietAlles: true, inviteDays: 7n, threshold30bisCents: 3_000_000n, thresholdCheckinatworkCents: 50_000_000n });
check("onmogelijke datum geweigerd", await rejects(admin.dashboard(5n)));

await sec("── 1b.1 vergunningen: soorten, kennisbank, deadline uit de planning, waarschuwingen, meldingen, bestand, rechten (R13)");
const today1b = nowDay;
const kinds1b = await calc.listPermitKinds(false);
check("soorten: de voorlopige standaardlijst (7) voor interne rollen", kinds1b.length === 7 && kinds1b.some((k) => k.key === "container" && k.words.includes("container")));
check("soorten: OA, architect, klant, veiligheid en anoniem geweigerd", (await Promise.all([oa2, arch, klant, vc, anon].map((x) => rejects(x.listPermitKinds(false))))).every(Boolean));
check("soort wijzigen: werfleider geweigerd", await rejects(wl.setPermitKind({ ...kinds1b[0], name: "x" })));
check("admin voegt een soort toe (hoogtewerker apart)", isOk(await admin.setPermitKind({ key: "proef-lift", name: "Proef ladderlift", leadDays: 5n, words: ["proeflift"], publicDomain: true, order: 200n, archived: false })));
check("soort met | in een woord geweigerd", "err" in (await admin.setPermitKind({ key: "proef-x", name: "x", leadDays: 1n, words: ["a|b"], publicDomain: false, order: 1n, archived: false })));
check("admin archiveert de proefsoort weer", isOk(await admin.setPermitKind({ key: "proef-lift", name: "Proef ladderlift", leadDays: 5n, words: ["proeflift"], publicDomain: true, order: 200n, archived: true })));
const wB1b = await admin.getWork(B);
const zipB = wB1b.address.zip || "8670";
if (!wB1b.address.zip) await admin.updateWork(B, { code: wB1b.code, name: wB1b.name, address: { ...wB1b.address, zip: zipB, city: wB1b.address.city || "Proefstad" }, parentId: wB1b.parentId, clientOrgId: wB1b.clientOrgId, architectOrgId: wB1b.architectOrgId, leaderPersonId: wB1b.leaderPersonId, vatBp: wB1b.vatBp, plannedStart: wB1b.plannedStart, plannedEnd: wB1b.plannedEnd, analyticCode: wB1b.analyticCode, vatNote: wB1b.vatNote });
check("kennisbank: calculator vult niet aan", await rejects(calc.saveMunicipality({ id: [], name: "x", zips: [], portal: [], email: [], phone: [], contact: "", notes: "", archived: false })));
const muni = await wl.saveMunicipality({ id: [], name: "Proefgemeente", zips: [zipB], portal: ["https://proef.example/loket"], email: ["vergunning@proef.example"], phone: [], contact: "dienst mobiliteit", notes: "", archived: false });
check("kennisbank: werfleider maakt een gemeente met de postcode van werf B", isOk(muni), errOf(muni));
check("kennisbank: dezelfde naam nog eens geweigerd", "err" in (await admin.saveMunicipality({ id: [], name: "PROEFGEMEENTE", zips: [], portal: [], email: [], phone: [], contact: "", notes: "", archived: false })));
check("kennisbank: foute postcode geweigerd", "err" in (await admin.saveMunicipality({ id: [], name: "Elders", zips: ["86A0"], portal: [], email: [], phone: [], contact: "", notes: "", archived: false })));
const proc = await wl.saveProcedure({ municipalityId: muni.ok.id, kind: "container", how: "portaal", portal: ["https://proef.example/inname"], email: [], leadDays: 10n, cost: "€ 25 + € 2/dag", attachments: ["situatieschets"], contact: "", notes: "", archived: false });
check("kennisbank: procedure container (portaal, 10 dagen, bijlage)", isOk(proc) && proc.ok.procedures.length === 1 && proc.ok.procedures[0].leadDays === 10n, errOf(proc));
check("kennisbank: onbekende soort geweigerd", "err" in (await wl.saveProcedure({ municipalityId: muni.ok.id, kind: "bestaat-niet", how: "portaal", portal: [], email: [], leadDays: 1n, cost: "", attachments: [], contact: "", notes: "", archived: false })));
check("kennisbank: OA en architect lezen ze niet", (await rejects(oa2.listMunicipalities(false))) && (await rejects(arch.listMunicipalities(false))));
check("kennisbank: calculator leest", (await calc.listMunicipalities(false)).some((m) => m.name === "Proefgemeente"));
// Een taak "container" binnen 12 dagen op B → suggestie met deadline = start − 10 (procedure van de gemeente).
let cStart = today1b + 12n;
while (wd(cStart) >= 5) cStart += 1n;
let pB1b = await admin.getPlan(B);
const tCont = await admin.saveTask(B, tIn({ title: "Container plaatsen (proef 1b)", trade: "afbraak", org: orgY.ok.id, start: cStart, workdays: 3n }), pB1b.version);
check("admin plant op B een taak 'Container plaatsen'", isOk(tCont), errOf(tCont));
const contId = tCont.ok.taskId[0];
let wpB = await wl.workPermits(B);
const sug = wpB.suggestions.find((x) => x.taskId === contId && x.kind === "container");
check("uit de planning: suggestie container met deadline = start − 10", !!sug && sug.deadline === cStart - 10n && sug.leadDays === 10n, JSON.stringify(wpB.suggestions, big));
check("de gemeente van werf B is gevonden (postcode)", wpB.municipality.length === 1 && wpB.municipality[0].name === "Proefgemeente");
const pmIn = (o) => ({ id: opt(o.id), kind: o.kind ?? "container", title: o.title ?? "", municipalityId: opt(o.muni), status: { [o.status ?? "needed"]: null }, location: o.location ?? "voor de deur", taskIds: o.tasks ?? [], neededFrom: opt(o.from), neededTo: opt(o.to), leadDays: opt(o.lead), requestedOn: opt(o.requested), validFrom: opt(o.vFrom), validTo: opt(o.vTo), reference: o.ref ?? "", costCents: opt(o.cost), note: o.note ?? "" });
check("calculator, OA, architect en klant maken geen vergunning", (await Promise.all([calc, oa2, arch, klant].map((x) => denied(x.savePermit(B, pmIn({ tasks: [contId] })))))).every(Boolean));
const pm = await wl.savePermit(B, pmIn({ tasks: [contId], cost: 2500n, note: "intern: betaald met kaart" }));
check("werfleider maakt de vergunning uit de suggestie", isOk(pm), errOf(pm));
const pmId = pm.ok.id;
check("periode = de taak, deadline = start − 10, gemeente automatisch", pm.ok.neededFrom[0] === cStart && pm.ok.deadline[0] === cStart - 10n && pm.ok.municipalityName === "Proefgemeente" && pm.ok.leadDays === 10n, JSON.stringify({ f: pm.ok.neededFrom, d: pm.ok.deadline, m: pm.ok.municipalityName }, big));
// Valt vandaag + 12 in een weekend, dan schuift de start naar maandag: de deadline ligt dan 3 of 4 dagen verder (2.10: was datumafhankelijk).
const soon = cStart - 10n - today1b;
check(`waarschuwing: aanvragen binnen ${soon} dagen`, pm.ok.warnings.some((x) => "deadlineSoon" in x && x.deadlineSoon === soon), JSON.stringify(pm.ok.warnings, big));
check("de suggestie is weg (taak heeft een vergunning)", !(await wl.workPermits(B)).suggestions.some((x) => x.taskId === contId && x.kind === "container"));
check("onmogelijke periode geweigerd (geldig tot vóór geldig van)", "err" in (await wl.savePermit(B, pmIn({ id: pmId, tasks: [contId], vFrom: today1b + 5n, vTo: today1b }))));
check("taak van een andere werf geweigerd", "err" in (await wl.savePermit(A, pmIn({ tasks: [contId] }))));
check("id van een vergunning op een andere werf: 'Geen toegang' (geen id-orakel)", await denied(wl.savePermit(A, pmIn({ id: pmId }))));
const n1 = await admin.scanPermits();
check("meldingen: de ronde meldt de nakende deadline", n1 >= 1n, String(n1));
const leaderB = wB1b.leaderPersonId[0];
const who1b = leaderB !== undefined && leaderB === (await wl.me()).person[0].id ? wl : admin;
check("melding 'vergunning' bij de werfleider van B (of de beheerders)", (await who1b.myNotifications(false)).some((x) => x.kind === "vergunning" && x.text.includes(`aanvragen binnen ${soon} dagen`)));
check("een tweede ronde meldt niets opnieuw", (await admin.scanPermits()) === 0n);
check("meldingen nakijken: enkel admin", await rejects(wl.scanPermits()));
// Aangevraagd en toegekend voor de periode van de taak, dan schuift de planning: waarschuwing + melding.
const endC = pm.ok.neededTo[0];
const g = await wl.savePermit(B, pmIn({ id: pmId, tasks: [contId], status: "granted", requested: today1b, vFrom: cStart, vTo: endC, ref: "GEM/2026/0042", cost: 2500n, note: "intern: betaald met kaart" }));
check("toegekend met geldigheid = de taak; enkel 'vergunning zelf ontbreekt'", isOk(g) && g.ok.warnings.length === 1 && "noDocument" in g.ok.warnings[0], JSON.stringify(g.ok?.warnings, big));
pB1b = await admin.getPlan(B);
const moved = await admin.saveTask(B, tIn({ id: contId, title: "Container plaatsen (proef 1b)", trade: "afbraak", org: orgY.ok.id, start: cStart + 7n, workdays: 3n, reason: "proef herplanning" }), pB1b.version);
check("de taak schuift een week op", isOk(moved), errOf(moved));
const afterMove = (await wl.workPermits(B)).permits.find((x) => x.id === pmId);
check("herplanning: waarschuwing 'planning schoof' met de nieuwe periode", afterMove.warnings.some((x) => "outsidePlan" in x && x.outsidePlan.neededFrom === cStart + 7n), JSON.stringify(afterMove.warnings, big));
check("herplanning: de ronde meldt het", (await admin.scanPermits()) >= 1n && (await who1b.myNotifications(false)).some((x) => x.kind === "vergunning" && x.text.includes("planning schoof")));
// De vergunning zelf opladen (bewijs bij controle).
const fPm = await admin.addFile("vergunning-proef.pdf", "application/pdf", 1234n, new TextEncoder().encode("!caf!sha256:" + "e".repeat(64)), [B], false);
check("bestand bij werf B", isOk(fPm), errOf(fPm));
const at = await wl.attachPermitFile(pmId, fPm.ok);
check("de vergunning zelf hangt eraan; 'ontbreekt' weg", isOk(at) && at.ok.files.length === 1 && !at.ok.warnings.some((x) => "noDocument" in x), errOf(at));
check("de vergunning staat niet bij de losse bestanden", !(await admin.listFiles([B])).some((f) => f.id === fPm.ok));
check("hetzelfde bestand aan een tweede vergunning geweigerd", "err" in (await wl.attachPermitFile((ok1b(await wl.savePermit(B, pmIn({ kind: "werfbord", from: cStart, to: cStart + 20n })))).id, fPm.ok)));
check("OA hangt geen bestand aan", await denied(oa2.attachPermitFile(pmId, fPm.ok)));
// Externen: OA Dak (lid van B) ziet de vergunning zonder kost en notitie, zonder suggesties en zonder kennisbank.
const oaView = await oa2.workPermits(B);
const oaP = oaView.permits.find((x) => x.id === pmId);
check("OA (lid van B) leest de vergunning met het bestand", !!oaP && oaP.files.length === 1 && !oaP.canEdit);
check("OA ziet geen kost, notitie, suggesties of kennisbank", oaP.costCents.length === 0 && oaP.note === "" && oaView.suggestions.length === 0 && oaView.municipality.length === 0);
check("OA: geen geschiedenis", (await oa2.permitHistory(pmId)).length === 0);
check("intern: geschiedenis per veld (status, geldig, bestand)", (await admin.permitHistory(pmId)).some((h) => h.field === "status") && (await admin.permitHistory(pmId)).some((h) => h.field === "bestand"));
check("klant leest geen vergunningen (A)", await rejects(klant.workPermits(A)));
const pmA = await admin.savePermit(A, pmIn({ kind: "werfzone", from: today1b - 1n, to: today1b + 3n, status: "granted", vFrom: today1b - 1n, vTo: today1b + 3n, location: "2 parkeerplaatsen" }));
check("admin: werfzone op A, geldig vandaag", isOk(pmA), errOf(pmA));
check("architect en veiligheidscoördinator (leden van A) lezen ze", (await arch.workPermits(A)).permits.some((x) => x.id === pmA.ok.id) && (await vc.workPermits(A)).permits.some((x) => x.id === pmA.ok.id));
check("op de gsm: werfleider ziet de werfzone van vandaag", (await wl.permitsOnSite(today1b)).some((x) => x.id === pmA.ok.id));
check("op de gsm en het overzicht: OA, calculator, architect geweigerd", (await Promise.all([oa2, calc, arch].map((x) => rejects(x.permitsOnSite(today1b))))).every(Boolean) && (await rejects(calc.listPermits("alles", []))));
const att1b = await admin.listPermits("aandacht", []);
check("overzicht 'vraagt aandacht': de werfzone zonder bestand; de container zonder waarschuwing niet meer… behalve de herplanning", att1b.some((x) => x.id === pmA.ok.id) && att1b.some((x) => x.id === pmId));
check("dashboard: vergunningen die aandacht vragen ≥ 2 (admin), null voor de calculator", ((await admin.dashboard(today1b)).counters.permitsThisMonth[0] ?? 0n) >= 2n && (await calc.dashboard(today1b)).counters.permitsThisMonth.length === 0);
check("archiveren: OA geweigerd, werfleider mag", (await denied(oa2.archivePermit(pmA.ok.id, ""))) && isOk(await wl.archivePermit(pmA.ok.id, "proef")));
check("gearchiveerd: niet meer in de lijst", !(await admin.listPermits("alles", [])).some((x) => x.id === pmA.ok.id));
check("regels: werfleider past ze niet aan; admin wel (7/7)", (await rejects(wl.setPermitRules({ warnDays: 3n, expiryDays: 3n }))) && isOk(await admin.setPermitRules({ warnDays: 7n, expiryDays: 7n })));
const ex1b = await admin.exportIntern();
check("export: vergunningen, wijzigingen, gemeenten, procedures, meldingen", ex1b.permits.length >= 3 && ex1b.permitChanges.length >= 3 && ex1b.municipalities.length === 1 && ex1b.procedures.length === 1 && ex1b.permitAlerts.length >= 2);
check("export in stukken: 'permits'", "permits" in ok1b(await admin.exportChunk("permits", 0n, 10n)));

await sec("── 1b.2 boete-opzoeking: dag, uur, plaat, plaats → rit, chauffeur, werf, ploeg, vergunning (R14)");
const fqb2 = (o) => ({ day: o.day ?? D, time: opt(o.time), plate: o.plate ?? "", place: o.place ?? "", widen: o.widen ?? false });
check("calculator, OA, architect, klant en anoniem zoeken geen boetes", (await Promise.all([calc, oa2, arch, klant, anon].map((x) => rejects(x.lookupFine(fqb2({ plate: "1-ABC-123" })))))).every(Boolean));
const f1b2 = ok1b(await admin.lookupFine(fqb2({ plate: "1abc123", time: 420n })));
const m1b2 = f1b2.matches.find((m) => m.plate === "1-ABC-123");
check("plaat zonder streepjes gevonden: werf A, chauffeur heen = Proef Werfleider", !!m1b2 && m1b2.plateMatch && m1b2.workId === A && m1b2.driverOut === "Proef Werfleider" && f1b2.vehicleKnown, JSON.stringify(f1b2, big).slice(0, 300));
check("om 07:00 (vóór de ploeg om 07:30): heenrit", m1b2.guess.startsWith("heenrit") && m1b2.guess.includes("07:30"), m1b2.guess);
check("de ploeg van BOWACO met haar tijdvakken", m1b2.crew.some((c) => c.includes("07:30–12:00")), JSON.stringify(m1b2.crew));
check("om 13:00: tijdens de werkuren (voertuig aan de werf)", ok1b(await admin.lookupFine(fqb2({ plate: "1-ABC-123", time: 780n }))).matches[0].guess.startsWith("tijdens de werkuren"));
check("om 17:00: terugrit", ok1b(await admin.lookupFine(fqb2({ plate: "1-ABC-123", time: 1020n }))).matches[0].guess.startsWith("terugrit"));
const wA2b2 = await admin.getWork(A);
if (wA2b2.address.city) check("plaats (gemeente van werf A) klopt", ok1b(await admin.lookupFine(fqb2({ plate: "1-ABC-123", place: wA2b2.address.city }))).matches[0].placeMatch);
check("zonder plaat: alle ritten van die dag (admin ziet ook de rit 9-ADM-001)", ok1b(await admin.lookupFine(fqb2({}))).matches.some((m) => m.plate === "9-ADM-001"));
const fWb2 = ok1b(await wl.lookupFine(fqb2({ plate: "9-ADM-001" })));
check("werfleider: de rit van de admin (andere chauffeur) niet (R14), en 'enkel je eigen ritten'", fWb2.matches.length === 0 && fWb2.ownTripsOnly);
const fUb2 = ok1b(await admin.lookupFine(fqb2({ plate: "0-XXX-000" })));
check("onbekende plaat: geen rit, voertuig niet gekend", fUb2.matches.length === 0 && !fUb2.vehicleKnown);
check("andere dag zonder 'ruimer': niets; met 'ruimer' (dag erna): de rit", ok1b(await admin.lookupFine(fqb2({ day: D + 1n, plate: "1-ABC-123" }))).matches.length === 0 && ok1b(await admin.lookupFine(fqb2({ day: D + 1n, plate: "1-ABC-123", widen: true }))).matches.some((m) => !m.sameDay));
check("onmogelijk uur geweigerd", "err" in (await admin.lookupFine(fqb2({ time: 1500n }))));
const pmDb2 = await admin.savePermit(A, pmIn({ kind: "werfzone", status: "granted", from: D, to: D, vFrom: D, vTo: D, location: "camionette voor de deur", ref: "PARK-1" }));
check("met een vergunning (werfzone) op die dag: ze staat bij de rit", isOk(pmDb2) && ok1b(await admin.lookupFine(fqb2({ plate: "1-ABC-123" }))).matches[0].permits.some((x) => x.reference === "PARK-1"));
// Rit met uren (1b.2): vertrek heen 07:00, terug 16:30
const K1b2b2 = uid();
check("admin opent het verslag van vandaag op B", done(await sync1(admin, ens(K1b2b2, B, nowDay))));
const tr2b2 = await sync1(admin, { opId: uid(), clientKey: K1b2b2, op: { trip: { vehicleId: [], plate: "2-BOE-002", driverOutPersonId: [adminId], driverBackPersonId: [wlId], driverOutText: "", driverBackText: "", note: "", outMin: [420n], backMin: [990n] } } });
check("rit met uren van vertrek heen en terug", done(tr2b2), outErr(tr2b2));
check("onmogelijk uur in een rit geweigerd", outErr(await sync1(admin, { opId: uid(), clientKey: K1b2b2, op: { trip: { vehicleId: [], plate: "2-BOE-003", driverOutPersonId: [], driverBackPersonId: [], driverOutText: "", driverBackText: "", note: "", outMin: [2000n], backMin: [] } } })).includes("Uur"));
const lt2b2 = (await admin.listTrips(nowDay, nowDay)).find((x) => x.plate === "2-BOE-002");
check("ritten tonen de uren (07:00 / 16:30)", lt2b2?.outTime[0] === "07:00" && lt2b2?.backTime[0] === "16:30");
const f2b2 = ok1b(await admin.lookupFine(fqb2({ day: nowDay, plate: "2-BOE-002", time: 1000n })));
check("om 16:40 na vertrek terug 16:30: terugrit met de chauffeur terug (Proef Werfleider)", f2b2.matches[0]?.guess.startsWith("terugrit") && f2b2.matches[0]?.guess.includes("Proef Werfleider") && f2b2.matches[0]?.backTime[0] === "16:30", f2b2.matches[0]?.guess);
check("werfleider (chauffeur terug) vindt deze rit wel", ok1b(await wl.lookupFine(fqb2({ day: nowDay, plate: "2-BOE-002" }))).matches.length === 1);
check("auditlog: 'boete-opgezocht' met dag en plaat, zonder namen", (await admin.auditLog(0n, 50n)).some((e) => e.action === "boete-opgezocht" && e.detail.includes("2-BOE-002") && !e.detail.includes("Proef")));

if (geclaimd) console.log("· mailblok overgeslagen (geclaimde draft: er gaat nooit mail weg; de mailproef draait droog in tests/mail-proef.mjs)");
else {
await sec("── 1b.3 + mail-caffeine: postbode = de app verstuurt zelf via de maildienst van Caffeine (testmodus, logboek, nooit dubbel)");
{
const rPost = await as("robot-post");
const nep = local && process.env.NEPMAIL ? await nepmail(process.env.NEPMAIL) : null;
const nMails = async () => (nep ? Number(await nep.aantal()) : 0);
const lastMails = async (n0) => (nep ? await nep.mails(BigInt(n0)) : []);
const ps0 = await admin.postSettings();
check("postbode: standaard alles uit (geen mails zonder beslissing)", !ps0.weekmail && !ps0.reminders && ps0.day === 4n && ps0.hour === 14n);
check("testmodus staat standaard AAN, zonder testadres (droog); dit is geen draft", ps0.testMode && ps0.testAddress === "" && !ps0.draft);
check("testbouw: deze canister telt als live (1b.5: enkel dan kan de testmodus uit); cycles van de app zichtbaar", ps0.liveMail && ps0.cyclesBalance > 0n);
check("instellingen: werfleider, calculator, OA, robot en anoniem geweigerd", (await Promise.all([wl, calc, oa2, rPost, anon].map((x) => rejects(x.postSettings())))).every(Boolean));
check("testmodus, nu versturen, logboek, voorbeeld, taal: enkel de beheerder", (await Promise.all([wl, calc, oa2, rPost, anon].flatMap((x) => [rejects(x.setMailTest(true, "")), rejects(x.sendMailNow()), rejects(x.listMailLog(0n, 1n)), rejects(x.mailPreview("proef", [], 0n)), rejects(x.setOrgMailLang(orgY.ok.id, "fr"))]))).every(Boolean));
check("instellingen: uur 25 geweigerd, adres zonder https geweigerd, kantooradres zonder @ geweigerd", ("err" in (await admin.setPostSettings({ weekmail: false, reminders: false, day: 4n, hour: 25n, reminderDay: 2n, appUrl: "", contact: [] }))) && ("err" in (await admin.setPostSettings({ weekmail: false, reminders: false, day: 4n, hour: 14n, reminderDay: 2n, appUrl: "http://x", contact: [] }))) && ("err" in (await admin.setPostSettings({ weekmail: false, reminders: false, day: 4n, hour: 14n, reminderDay: 2n, appUrl: "", contact: ["geen-adres"] }))));
check("instellingen bewaard (weekmail uit, adres van de app, kantoor)", isOk(await admin.setPostSettings({ weekmail: false, reminders: false, day: 4n, hour: 14n, reminderDay: 2n, appUrl: "https://app.proef.invalid/", contact: ["kantoor@proef.invalid"] })) && (await admin.postSettings()).contact === "kantoor@proef.invalid");
check("e-mailadres van Proef Dak NV (algemeen)", isOk(await admin.saveOrgContact(orgY.ok.id, { phone: [], email: ["planning@proef-dak.invalid"], website: [], contactNote: "" })));
// De dag van de canister (de klokproeven verzetten de klok van dit net): de jongste auditregel.
const cDay = BigInt(Math.floor(Number((await admin.auditLog(0n, 1n))[0].at / 1_000_000n) / 86_400_000));
const monOf = (d) => d - BigInt(wd(d));
const monA = monOf(cDay) + 14n; // over twee weken
const planB = async () => (await admin.getPlan(B)).version;
const tMail = ok1b(await admin.saveTask(B, tIn({ title: "Dak <b>& goot</b>", org: orgY.ok.id, start: monA, workdays: 3n }), await planB()));
check("taak voor Proef Dak NV over twee weken (titel met <b> en &)", tMail.taskId.length === 1);
const pv = await admin.mailPreview("weekplanning", [orgY.ok.id], monA);
const pvh = isOk(pv) ? pv.ok.html : "";
check("voorbeeld: aan het adres van de firma, werf P-B met de taak, knop naar Mijn week", isOk(pv) && pv.ok.mail.to[0].email === "planning@proef-dak.invalid" && pv.ok.mail.sections.some((x) => x.title.startsWith("P-B") && x.lines.some((l) => l.includes("Dak <b>& goot</b>"))) && pvh.includes('href="https://app.proef.invalid/#/week"'), JSON.stringify(pv, big).slice(0, 300));
check("voorbeeld-HTML: alles ontsnapt (geen <b> uit de taaktitel), kantooradres in de voet, Nederlands", pvh.includes("Dak &lt;b&gt;&amp; goot&lt;/b&gt;") && !pvh.includes("<b>&") && pvh.includes("kantoor@proef.invalid") && pvh.includes('lang="nl"') && !pvh.includes("<script"));
check("voorbeeld: testmodus zonder testadres → 'niets verstuurd' (en geen bedragen)", isOk(pv) && pv.ok.deliver.includes("niets verstuurd") && !pvh.includes("€"));
check("taal per firma: Frans → onderwerp en aanhef in het Frans", isOk(await admin.setOrgMailLang(orgY.ok.id, "fr")) && (await admin.mailPreview("weekplanning", [orgY.ok.id], monA)).ok?.html.includes("Bonjour Proef Dak NV") && (await admin.postSettings()).langs.some(([o, l]) => o === orgY.ok.id && l === "fr"));
check("taal: onbekende taal geweigerd; terug naar automatisch (nl)", "err" in (await admin.setOrgMailLang(orgY.ok.id, "de")) && isOk(await admin.setOrgMailLang(orgY.ok.id, "")) && (await admin.mailPreview("weekplanning", [orgY.ok.id], monA)).ok?.lang === "nl");
check("voorbeeld voor een firma zonder adres: 'geen e-mailadres' of 'niets gepland'", /geen e-mailadres|niets gepland/.test(errOf(await admin.mailPreview("weekplanning", [orgX.ok.id], monA))));
check("geen maandag geweigerd", "err" in (await admin.queueWeekMails(monA + 1n, [])));
check("werfleider zet geen mails klaar", await rejects(wl.queueWeekMails(monA, [])));
const q1 = await admin.queueWeekMails(monA, [orgY.ok.id]);
check("weekmail voor Proef Dak NV klaargezet", isOk(q1) && q1.ok === 1n, errOf(q1));
check("nog eens: 0 nieuw (idempotentiesleutel firma + week + soort)", ok1b(await admin.queueWeekMails(monA, [orgY.ok.id])) === 0n);
const jA = (await admin.listJobs("open", 0n, 50n)).find((j) => j.kind === "weekplanning" && j.orgId[0] === orgY.ok.id);
check("wachtrij: sleutel weekplanning:org…:jjjj-Www", !!jA && /^weekplanning:org\d+:\d{4}-W\d{2}$/.test(jA.key) && "queued" in jA.state, JSON.stringify(jA, big));
// De robot krijgt geen mail meer
check("een niet-geregistreerde robot en personen leasen niets", (await rejects(rPost.leaseJobs(10n))) && (await rejects(wl.leaseJobs(10n))) && (await rejects(admin.leaseJobs(10n))));
check("robot met de oude soort 'mail' geweigerd (de app verstuurt zelf)", errOf(await admin.addRobot(P("robot-post"), "Postbode", ["mail"])).includes("Onbekende soort"));
check("een robot (soort proef) leaset GEEN mailopdracht", isOk(await admin.addRobot(P("robot-post"), "Gateway", ["proef"])) && (await rPost.leaseJobs(10n)).length === 0);
check("een robot kan een mailopdracht niet afsluiten", "err" in (await rPost.completeJob(jA.id, 1n, "x")) && "err" in (await rPost.failJob(jA.id, 1n, "x", true)));
// Droog: testmodus zonder testadres
// De eigen klokjob van de mail loopt intussen ook (elke 5 min, echte tijd): een ronde kan "bezig" zijn of de opdracht al
// verwerkt hebben. Daarom: versturen tot er geen ronde meer loopt, en dan de toestand en de nep-maildienst nakijken.
const flush = async () => {
  const tot = { sent: 0, dry: 0, skipped: 0, failed: 0, busy: 0 };
  for (let i = 0; i < 60; i++) {
    const r = ok1b(await admin.sendMailNow());
    if (r.busy) { tot.busy++; await new Promise((x) => setTimeout(x, 1000)); continue; }
    for (const k of ["sent", "dry", "skipped", "failed"]) tot[k] += Number(r[k]);
    break;
  }
  return tot;
};
const jobOf = async (id) => (await admin.listJobs("alles", 0n, 100n)).find((j) => j.id === id);
const n0 = await nMails();
const r1 = await flush();
const jA1 = (await admin.listJobs("alles", 0n, 50n)).find((j) => j.id === jA.id);
const log1 = await admin.listMailLog(0n, 20n);
check("droog: de ronde verstuurt niets (testmodus zonder testadres)", r1.sent === 0 && (await nMails()) === n0, JSON.stringify(r1));
check("droog: opdracht klaar als 'droog', logboek 'droog' (1 adres, nl)", "done" in jA1.state && jA1.state.done.result.startsWith("droog") && log1.some((l) => l.jobId === jA.id && "dryRun" in l.outcome && l.recipients === 1n && l.test && l.lang === "nl"));
// Testadres: alles naar één adres
check("testadres zonder @ geweigerd; testadres bewaard", "err" in (await admin.setMailTest(true, "geen-adres")) && isOk(await admin.setMailTest(true, "Test@Proef.invalid")) && (await admin.postSettings()).testAddress === "test@proef.invalid");
check("auditlog: testmodus zonder het adres", (await admin.auditLog(0n, 10n)).some((e) => e.action === "postbode-testmodus" && !e.detail.includes("@")));
const monB = monA + 7n;
ok1b(await admin.saveTask(B, tIn({ title: "Dak week B", org: orgY.ok.id, start: monB, workdays: 2n }), await planB()));
check("weekmail week B klaargezet", ok1b(await admin.queueWeekMails(monB, [orgY.ok.id])) === 1n);
const tm = await admin.queueTestMail("eigen@proef.invalid");
check("proefmail klaargezet", isOk(tm), errOf(tm));
if (nep) {
  await nep.zet("", 0n, 1_000_000n);
  const n1 = await nMails();
  await flush();
  const got = await lastMails(n1);
  check("testmodus: 2 mails, ENKEL naar het testadres (niet de firma, niet het proefadres)", got.length === 2 && got.every((m) => m.to === "test@proef.invalid"), JSON.stringify(got.map((m) => [m.to, m.subject])));
  check("testmodus: [TEST] in het onderwerp, bovenaan voor wie ze bedoeld was", got.every((m) => m.subject.startsWith("[TEST] ")) && got.some((m) => m.html.includes("bedoeld voor Proef Dak NV (1 adres)")));
  check("maildienst: soort 'service', afzender no-reply", got.every((m) => m.sub === "service" && m.from === "no-reply"));
  const log2 = await admin.listMailLog(0n, 20n);
  check("logboek: verstuurd (testadres), cycles zoals de maildienst aanrekende", log2.filter((l) => "sent" in l.outcome && l.test && l.cycles === 1_000_000n).length >= 2);
  check("logboek en export bevatten nooit een adres", !JSON.stringify(log2, big).includes("@") && !JSON.stringify((await admin.exportIntern()).mailLog, big).includes("@"));
  check("opdrachten 'verstuurd via Caffeine'", (await admin.listJobs("alles", 0n, 50n)).filter((j) => j.id === tm.ok || (j.kind === "weekplanning" && j.ref === String(monB))).every((j) => "done" in j.state && j.state.done.result.startsWith("verstuurd via Caffeine")));
  check("nog een ronde: niets nieuws, geen tweede mail (idempotent)", (await flush()).sent === 0 && (await nMails()) === n1 + 2);
  check("klaarzetten voor dezelfde week na het versturen: 0 nieuw", ok1b(await admin.queueWeekMails(monB, [orgY.ok.id])) === 0n);
  // De maildienst weigert de INHOUD (InvalidArgs): zeker niet verstuurd en opnieuw proberen helpt niet → meteen mislukt
  // (1b.5 M1; de nieuwe poging met wachttijd is er enkel voor een "schone" weigering: review D9).
  await nep.zet("weiger", 0n, 0n);
  const tw = ok1b(await admin.queueTestMail("eigen@proef.invalid"));
  const n2 = await nMails();
  await flush();
  const jw = await jobOf(tw);
  check("inhoud geweigerd: meteen mislukt (geen nieuwe poging), niets verstuurd", "failed" in jw.state && !jw.state.failed.why.startsWith("onzeker") && jw.attempts === 1n && (await nMails()) === n2, JSON.stringify(jw, big));
  const lw = (await admin.listMailLog(0n, 5n)).find((l) => l.jobId === tw);
  check("geweigerd: logboek met reden, het adres uit de fout weggelaten ([adres])", !!lw && "failed" in lw.outcome && lw.outcome.failed.includes("[adres]") && !lw.outcome.failed.includes("@"), JSON.stringify(lw, big));
  check("geweigerd: melding aan de admins 'Mail mislukt' zonder adres", (await admin.myNotifications(false)).some((n) => n.kind === "postbode" && n.text.includes("Mail mislukt") && !n.text.includes("@")));
  check("opnieuw zetten en annuleren (admin)", isOk(await admin.retryJob(tw)) && isOk(await admin.cancelJob(tw)) && "err" in (await admin.cancelJob(tw)));
  // Onzeker: de maildienst valt NA het versturen → nooit vanzelf opnieuw
  await nep.zet("val", 0n, 0n);
  const tv = ok1b(await admin.queueTestMail("eigen@proef.invalid"));
  const n3 = await nMails();
  await flush();
  const jv = await jobOf(tv);
  check("onzeker: de dienst viel na het versturen → 'onzeker', de mail is wel weg (1)", "failed" in jv.state && jv.state.failed.why.startsWith("onzeker") && (await nMails()) === n3 + 1, JSON.stringify(jv, big));
  check("onzeker: melding aan de admins 'misschien verstuurd'", (await admin.myNotifications(false)).some((n) => n.kind === "postbode" && n.text.includes("misschien verstuurd")));
  await nep.zet("", 0n, 1_000_000n);
  check("onzeker: een volgende ronde verstuurt ze NIET opnieuw", (await flush()).sent === 0 && (await nMails()) === n3 + 1);
  check("onzeker: de admin zet ze bewust opnieuw → één mail", isOk(await admin.retryJob(tv)) && (await flush()) && (await nMails()) === n3 + 2 && "done" in (await jobOf(tv)).state);
  // Twee rondes tegelijk (de klok en de knop): één slot, geen dubbele mail
  await nep.zet("traag", 6n, 1_000_000n); // 6 s per mail bij de maildienst
  const ta = ok1b(await admin.queueTestMail("eigen@proef.invalid"));
  const tb = ok1b(await admin.queueTestMail("eigen@proef.invalid"));
  const n4 = await nMails();
  const [ra, rb] = await Promise.all([admin.sendMailNow(), admin2.sendMailNow()]);
  const rr = [ok1b(ra), ok1b(rb)];
  await flush();
  check("twee rondes tegelijk: minstens één is 'bezig', samen precies 2 mails", rr.some((r) => r.busy) && (await nMails()) === n4 + 2 && "done" in (await jobOf(ta)).state && "done" in (await jobOf(tb)).state, JSON.stringify(rr, big));
  check("na de rondes: niets meer 'bij de maildienst'", (await admin.postSettings()).leased === 0n && !(await admin.postSettings()).sending && [ta, tb].every(Boolean));
  await nep.zet("", 0n, 1_000_000n);
  // Afgemelde firma en afgezette persoon: geen mail
  const monC = monB + 7n;
  ok1b(await admin.saveTask(B, tIn({ title: "Dak week C", org: orgY.ok.id, start: monC, workdays: 2n }), await planB()));
  check("weekmail week C klaargezet", ok1b(await admin.queueWeekMails(monC, [orgY.ok.id])) === 1n);
  check("firma afmelden: voorbeeld 'ontvangt geen mails', klaarzetten 0", isOk(await admin.setOrgMail(orgY.ok.id, false)) && errOf(await admin.mailPreview("weekplanning", [orgY.ok.id], monC)).includes("geen mails") && ok1b(await admin.queueWeekMails(monC + 7n, [orgY.ok.id])) === 0n);
  const n5 = await nMails();
  await flush();
  check("afgemelde firma: de al klaargezette weekmail wordt overgeslagen, geen mail", (await nMails()) === n5 && (await admin.listJobs("alles", 0n, 50n)).some((j) => j.ref === String(monC) && "done" in j.state && j.state.done.result.includes("geen mails")));
  check("firma weer aanmelden", isOk(await admin.setOrgMail(orgY.ok.id, true)) && (await admin.postSettings()).optedOut.length === 0);
  const orgZ = ok1b(await admin.createOrg(orgIn12("Proef Afgezet BV", {})));
  const pZ = ok1b(await admin.saveOaPerson(orgZ.id, pIn("Afgezet Persoon", { email: "afgezet@proef.invalid" })));
  const asgZ = await admin.saveAssignment(B, { id: [], taskId: tMail.taskId[0], orgId: orgZ.id, personId: [], fromDay: [], toDay: [], note: "" }, await planB());
  check("firma zonder algemeen adres: de mail gaat naar haar contactpersoon", isOk(asgZ) && (await admin.mailPreview("weekplanning", [orgZ.id], monA)).ok?.mail.to[0].email === "afgezet@proef.invalid", errOf(asgZ));
  ok1b(await admin.archivePerson(pZ.id));
  check("contactpersoon afgezet: 'geen e-mailadres', niets klaar te zetten voor haar", errOf(await admin.mailPreview("weekplanning", [orgZ.id], monA)).includes("geen e-mailadres"));
  const n6 = await nMails();
  ok1b(await admin.queueWeekMails(monA, [orgZ.id]));
  await flush();
  check("afgezette persoon: geen mail", (await nMails()) === n6 && !(await lastMails(0)).some((m) => m.to === "afgezet@proef.invalid"));
  // Testmodus uit (enkel buiten de draft): echte adressen
  check("testmodus uit met een testadres geweigerd", "err" in (await admin.setMailTest(false, "test@proef.invalid")));
  check("testmodus uit (lokaal, geen draft)", isOk(await admin.setMailTest(false, "")) && !(await admin.postSettings()).testMode);
  const monD = monC + 7n;
  ok1b(await admin.saveTask(B, tIn({ title: "Dak week D", org: orgY.ok.id, start: monD, workdays: 2n }), await planB()));
  ok1b(await admin.queueWeekMails(monD, [orgY.ok.id]));
  const n7 = await nMails();
  await flush();
  const gotD = await lastMails(n7);
  check("testmodus uit: de weekmail gaat naar het adres van de firma, zonder [TEST]", gotD.length === 1 && gotD[0].to === "planning@proef-dak.invalid" && !gotD[0].subject.startsWith("[TEST]") && gotD[0].subject.includes("BOWACO planning"), JSON.stringify(gotD.map((m) => [m.to, m.subject])));
  check("testmodus weer aan, droog", isOk(await admin.setMailTest(true, "")) && (await admin.postSettings()).testMode);
  // Verouderd: een week die voorbij is
  const past = ok1b(await admin.queueWeekMails(monOf(cDay) - 14n, [orgY.ok.id]));
  await flush();
  check("een weekmail voor een week die voorbij is: overgeslagen", past === 0n || (await admin.listJobs("alles", 0n, 80n)).some((j) => j.ref === String(monOf(cDay) - 14n) && "done" in j.state && j.state.done.result.includes("voorbij")));
  // De eigen klokjob (elke 5 min): verstuurt zonder knop
  if (!process.env.ZONDER_KLOK) {
    check("klok: testadres terug voor de klokproef", isOk(await admin.setMailTest(true, "test@proef.invalid")));
    const tk = ok1b(await admin.queueTestMail("eigen@proef.invalid"));
    const n8 = await nMails();
    await advance(6n * 60_000_000_000n);
    let sentByClock = false;
    for (let i = 0; i < 20 && !sentByClock; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      sentByClock = (await admin.listJobs("alles", 0n, 80n)).some((j) => j.id === tk && "done" in j.state);
    }
    check("klok: na 6 min vertrok de proefmail vanzelf (eigen klokjob), één keer", sentByClock && (await nMails()) === n8 + 1);
    check("klok: auditregel 'post-verstuurd' door de timer, zonder adres", (await admin.auditLog(0n, 80n)).some((e) => e.action === "post-verstuurd" && !e.detail.includes("@")));
    ok1b(await admin.setMailTest(true, ""));
  }
} else {
  check("(zonder nep-maildienst) geen mailproeven", true);
}
check("herinneringen klaarzetten (admin): idempotent", isOk(await admin.queueReminders(monOf(cDay))) && ok1b(await admin.queueReminders(monOf(cDay))) === 0n);
for (const j of await admin.listJobs("open", 0n, 100n)) await admin.cancelJob(j.id);
// Opruimen: de proeftaken van dit blok (en Proef Afgezet BV) weg uit de planning, zodat de blokken hierna (30bis,
// dashboard, lektest) dezelfde werf zien als vroeger.
{
  const pB = await admin.getPlan(B);
  let v = pB.version;
  for (const t of pB.tasks.filter((t) => t.title.startsWith("Dak <b>") || /^Dak week [BCD]$/.test(t.title))) v = ok1b(await admin.archiveTask(B, t.id, v));
  const zOrg = (await admin.listOas({ text: ["Proef Afgezet"], trade: [], kind: [], includeArchived: false }))[0];
  if (zOrg) ok1b(await admin.archiveOrg(zOrg.org.id));
  check("proeftaken van de mail en Proef Afgezet BV opgeruimd", !(await admin.getPlan(B)).tasks.some((t) => t.title.startsWith("Dak <b>") || t.title.startsWith("Dak week")));
}
check("auditlog: post-* zonder e-mailadres", (await admin.auditLog(0n, 200n)).filter((e) => e.action.startsWith("post")).every((e) => !e.detail.includes("@")));
check("postbode ingetrokken: robot leaset niets meer", isOk(await admin.revokeRobot(P("robot-post"))) && (await rejects(rPost.leaseJobs(1n))));
check("export: de werkwachtrij en het logboek; in stukken 'jobs' en 'mailLog'", (await admin.exportIntern()).jobs.length >= 3 && "jobs" in ok1b(await admin.exportChunk("jobs", 0n, 10n)) && "mailLog" in ok1b(await admin.exportChunk("mailLog", 0n, 10n)));
}

}

await sec("── 1b.4 werfadministratie: 30bis (bedrag, onderaannemers, asbest), aangifte, Checkinatwork-export, inhoudingsplicht");
{
  // Laatste bijwerking van de databank inhoudingsplicht: vrijdag na de laatste donderdag van de maand (zoals Wadm.mo).
  const upd = (y, m) => { const last = Date.UTC(y, m, 0); let d = new Date(last); while (d.getUTCDay() !== 4) d = new Date(d.getTime() - 86_400_000); return BigInt(Math.round(d.getTime() / 86_400_000) + 1); };
  const tdy = BigInt(Math.floor(Date.now() / 86_400_000));
  const nd = new Date(Number(tdy) * 86_400_000);
  const cur = upd(nd.getUTCFullYear(), nd.getUTCMonth() + 1);
  const expUpd = tdy >= cur ? cur : upd(nd.getUTCMonth() === 0 ? nd.getUTCFullYear() - 1 : nd.getUTCFullYear(), nd.getUTCMonth() === 0 ? 12 : nd.getUTCMonth());
  check("werfadministratie: OA, architect, klant, VC en anoniem lezen niets", (await Promise.all([oa2, arch, klant, vc, anon].map((x) => rejects(x.workAdmin(B))))).every(Boolean));
  const wa = await wl.workAdmin(B);
  check("werf B: onderaannemers geteld (lidmaatschap of planning) en een reden", wa.oaCount >= 1n && wa.reason.length > 0, JSON.stringify({ n: wa.oaCount, r: wa.reason, a: wa.art30bis }, big));
  check("databank inhoudingsplicht: laatste bijwerking = vrijdag na de laatste donderdag", wa.dbUpdated === expUpd, `${wa.dbUpdated} vs ${expUpd}`);
  check("werfleider ziet geen bedragen, calculator wel", !wa.canSeeAmounts && (await calc.workAdmin(B)).canSeeAmounts && wa.canEdit && !(await calc.workAdmin(B)).canEdit);
  check("regels: werfleider past ze niet aan", await rejects(wl.setWadmRules({ threshold30bisCents: 1n, threshold30bisWithOaCents: 1n, oaCountAlways: 1n, thresholdCheckinatworkCents: 1n })));
  const r0 = await calc.wadmRules();
  check("standaard: € 30.000 · € 5.000 met OA · altijd vanaf 2 OA's · Checkinatwork € 500.000", r0.threshold30bisCents === 3_000_000n && r0.threshold30bisWithOaCents === 500_000n && r0.oaCountAlways === 2n && r0.thresholdCheckinatworkCents === 50_000_000n);
  check("admin: altijd vanaf 1 OA → werf B: aangifte nodig 'ongeacht het bedrag'", isOk(await admin.setWadmRules({ ...r0, oaCountAlways: 1n })) && (await wl.workAdmin(B)).art30bis[0] === true && (await wl.workAdmin(B)).reason.includes("ongeacht"));
  check("regels terug op de standaard", isOk(await admin.setWadmRules(r0)));
  // Asbest: altijd
  check("calculator houdt de aangifte niet bij (#editWork)", await denied(calc.saveDeclaration(B, { status: { todo: null }, nature: "eenmalig", asbestos: true, note: "" })));
  check("asbest → aangifte verplicht ('werken met asbest')", isOk(await wl.saveDeclaration(B, { status: { todo: null }, nature: "eenmalig", asbestos: true, note: "" })) && (await wl.workAdmin(B)).reason === "werken met asbest" && (await wl.getWork(B)).facts[0].art30bis[0] === true);
  check("gedaan zonder nummer geweigerd; niet nodig zonder reden geweigerd; onbekende aard geweigerd", ("err" in (await wl.saveDeclaration(B, { status: { done: { on: tdy, number: "" } }, nature: "eenmalig", asbestos: true, note: "" }))) && ("err" in (await wl.saveDeclaration(B, { status: { notNeeded: { reason: " " } }, nature: "eenmalig", asbestos: true, note: "" }))) && ("err" in (await wl.saveDeclaration(B, { status: { todo: null }, nature: "soms", asbestos: false, note: "" }))));
  const dDraftWl = ok1b(await wl.declarationDraft(B));
  check("aangifte klaarzetten (werfleider): werfadres, onderaannemers met KBO, deadline = start − 15, GEEN bedrag of adres van de opdrachtgever", dDraftWl.workCode === "P-B" && dDraftWl.oas.length >= 1 && dDraftWl.amountCents.length === 0 && dDraftWl.clientAddress.length === 0 && dDraftWl.portal.startsWith("https://formica.socialsecurity.be") && (dDraftWl.start.length === 0 || dDraftWl.deadline[0] === dDraftWl.start[0] - 15n), JSON.stringify(dDraftWl, big).slice(0, 300));
  await calc.declarationDraft(B);
  check("calculator ziet het bedrag (als er een contract is); 'bekeek:aangifte-30bis' in de auditlog", (await admin.auditLog(0n, 30n)).some((e) => e.action === "bekeek:aangifte-30bis"));
  const dn = await wl.saveDeclaration(B, { status: { done: { on: tdy, number: "AVW-2026-123456" } }, nature: "eenmalig", asbestos: true, note: "proef" });
  check("aangifte gedaan met nummer", isOk(dn) && "done" in dn.ok.status, errOf(dn));
  const dos = await wl.getDossier(B);
  check("checklist: document 'aangifte-30bis' ontvangen met het nummer", dos.documents.some((d) => d.kind === "aangifte-30bis" && "received" in d.status && d.title.includes("AVW-2026-123456")));
  check("overzicht: werf B staat niet meer bij de openstaande aangiftes", !(await calc.wadmOverview()).declarations.some((d) => d.workId === B));
  check("overzicht: OA, klant geweigerd", (await rejects(oa2.wadmOverview())) && (await rejects(klant.wadmOverview())));
  // Inhoudingsplicht
  const orgsAll = await admin.listOrgs(false);
  const withKbo = orgsAll.find((o) => o.kbo.length === 1 && "subcontractor" in o.kind);
  const noKbo = orgsAll.find((o) => o.kbo.length === 0 && "subcontractor" in o.kind);
  const inW = (r) => ({ result: { [r]: null }, consultedOn: tdy, reference: "REF-1", note: "", workId: [B] });
  check("inhoudingsplicht: OA, architect, klant geweigerd", (await Promise.all([oa2, arch, klant].map((x) => denied(x.recordWithholdingCheck(withKbo.id, inW("clear")))))).every(Boolean));
  if (noKbo) check("firma zonder KBO: geweigerd met uitleg", errOf(await wl.recordWithholdingCheck(noKbo.id, inW("clear"))).includes("KBO"));
  const c1 = await wl.recordWithholdingCheck(withKbo.id, inW("clear"));
  check("werfleider legt 'geen inhoudingsplicht' vast → ok; link met het KBO-nummer", isOk(c1) && c1.ok.state === "ok" && c1.ok.link[0] === `https://www.checkinhoudingsplicht.be/?identificationnumber=${withKbo.kbo[0]}`, JSON.stringify(c1, big).slice(0, 200));
  check("een raadpleging in de toekomst of te oud geweigerd", ("err" in (await wl.recordWithholdingCheck(withKbo.id, { ...inW("clear"), consultedOn: tdy + 5n }))) && ("err" in (await wl.recordWithholdingCheck(withKbo.id, { ...inW("clear"), consultedOn: tdy - 500n }))));
  const c2 = await calc.recordWithholdingCheck(withKbo.id, inW("social"));
  check("calculator: sociale schulden → 'inhoudingsplicht' + melding aan de beheerders", isOk(c2) && c2.ok.state === "inhoudingsplicht" && (await admin.myNotifications(false)).some((n) => n.kind === "inhoudingsplicht" && n.text.includes(withKbo.name)));
  check("groen van vóór de laatste bijwerking = 'opnieuw nakijken'", isOk(await wl.recordWithholdingCheck(withKbo.id, { ...inW("clear"), consultedOn: expUpd - 1n })) && (await calc.withholdingHistory(withKbo.id)).length === 3);
  check("geschiedenis: OA geweigerd", await rejects(oa2.withholdingHistory(withKbo.id)));
  check("auditlog: inhoudingsplicht met resultaat", (await admin.auditLog(0n, 40n)).some((e) => e.action === "inhoudingsplicht" && e.detail.includes(withKbo.name)));
  // Checkinatwork-export (de aanwezigheden van werf A uit 1.6)
  check("Checkinatwork-export: calculator en OA geweigerd", (await denied(calc.checkinatworkExport(A, D, D))) && (await denied(oa2.checkinatworkExport(A, D, D))));
  const ce = await wl.checkinatworkExport(A, D - 1n, D + 1n);
  check("export werf A: de aanwezigheden van de werfdag met firma, KBO, tijdvakken en regie", isOk(ce) && ce.ok.rows.length >= 2 && ce.ok.rows.some((r) => r.regie && r.slots.includes("07:30")) && ce.ok.rows.every((r) => r.day >= D - 1n && r.day <= D + 1n), errOf(ce));
  check("export: periode > 400 dagen geweigerd; auditregel", ("err" in (await wl.checkinatworkExport(A, 20_000n, 20_500n))) && (await admin.auditLog(0n, 20n)).some((e) => e.action === "checkinatwork-export"));
  const exW = await admin.exportIntern();
  check("export: raadplegingen en aangiftes; in stukken", exW.withholdingChecks.length >= 3 && exW.declarations.length >= 1 && "declarations" in ok1b(await admin.exportChunk("declarations", 0n, 10n)));
}

await sec("── postenbibliotheek (2.2): hoofdstukken, posten, versies; prijzen enkel admin en calculator (R20–R23)");
{
  const vandaag = BigInt(Math.floor(Date.now() / 86_400_000));
  const noPrice = (x) => !/cost|sell|marg|price|prijs/i.test(JSON.stringify(x, big));
  check("werfleider laadt geen startlijst (enkel admin en calculator)", await denied(wl.loadLibraryStartChapters()));
  const ls = await calc.loadLibraryStartChapters();
  check("calculator laadt de startlijst: 19 hoofdstukken (VOORLOPIG)", isOk(ls) && ls.ok === 19n, errOf(ls));
  check("startlijst een tweede keer: geweigerd, niets dubbel", "err" in (await calc.loadLibraryStartChapters()) && (await calc.libraryChapters(true)).length === 19);
  const chs = await wl.libraryChapters(false);
  check("werfleider leest de hoofdstukken (intern); 09 en 10 herhalen als groep", chs.length === 19 && chs.filter((c) => c.code === "10").length === 6);
  for (const [n, x] of [["architect", arch], ["OA", oa2], ["klant", klant], ["veiligheidscoördinator", vc]]) {
    check(`${n} ziet de bibliotheek niet`, (await rejects(x.libraryChapters(false))) && (await rejects(x.listLibrary({ text: "", chapterId: [], trade: [], unit: [], form: [], orgId: [], includeArchived: false, offset: 0n, limit: 10n }))));
  }
  const tegels = chs.find((c) => c.title.endsWith("Tegels"));
  const units = await wl.libraryUnits(false);
  check("eenheden: de 12 voorlopige uit de offerte (sog, st, m2, lm …)", units.length === 12 && ["sog", "st", "m2", "lm", "dlm"].every((k) => units.some((u) => u.key === k)));
  check("calculator beheert de eenheden niet (keuzelijst = admin, R17)", await denied(calc.setLibraryUnit({ key: "ton", name: "ton", order: 200n, archived: false })));
  check("admin voegt een eenheid toe", isOk(await admin.setLibraryUnit({ key: "ton", name: "ton", order: 200n, archived: false })) && (await calc.libraryUnits(false)).some((u) => u.key === "ton"));
  check("rare sleutel voor een eenheid geweigerd", "err" in (await admin.setLibraryUnit({ key: "M 2!", name: "x", order: 1n, archived: false })));
  const base = { id: [], chapterId: tegels.id, code: "10.4.01", title: "Proef vloertegels 60x60 leveren en plaatsen", text: "Leveren en plaatsen van keramische vloertegels 60x60 cm, gelijmd.\nInclusief voegen.", unit: "m2", form: { vh: null }, trade: ["tegels"], orgId: [orgX.ok.id], durationDays: [5n], perDayMilli: [], planStepKey: ["tegels"], keywords: ["vloer", "keramiek"], importKey: ["rollen:t1"] };
  check("werfleider maakt geen post", await denied(wl.saveLibraryItem(base, 0n)));
  check("onbekende eenheid geweigerd", "err" in (await calc.saveLibraryItem({ ...base, unit: "vat" }, 0n)));
  check("een klant als standaard-OA geweigerd", "err" in (await calc.saveLibraryItem({ ...base, orgId: [orgKlant.ok.id] }, 0n)));
  check("onbekende planningsstap geweigerd", "err" in (await calc.saveLibraryItem({ ...base, planStepKey: ["bestaat-niet"] }, 0n)));
  check("titel leeg geweigerd", "err" in (await calc.saveLibraryItem({ ...base, title: "  " }, 0n)));
  const it1 = await calc.saveLibraryItem(base, 0n);
  check("calculator maakt een post (VH, m2, standaard-OA, 5 werkdagen, planningsstap)", isOk(it1) && it1.ok.version === 1n && it1.ok.orgName === "Proef Tegels BV" && it1.ok.unitName === "m²", errOf(it1));
  const id1 = it1.ok.id;
  check("dezelfde importsleutel nog eens: geweigerd (geen dubbel)", "err" in (await calc.saveLibraryItem(base, 0n)));
  const it2 = await wlcalc.saveLibraryItem({ ...base, code: "10.4.02", title: "Proef wandtegels 30x60", text: "Wandtegels in de badkamer.", importKey: [], keywords: [], form: { fixed: null }, durationDays: [], perDayMilli: [20_000n] }, 0n);
  check("werfleider die ook calculator is: mag via die rol (som van rollen)", isOk(it2), errOf(it2));
  const it3 = await calc.saveLibraryItem({ ...base, chapterId: chs[0].id, code: "", title: "Proef werfvoorbereiding (eigen prestatie)", text: "", unit: "sog", form: { fixed: null }, trade: [], orgId: [], durationDays: [], planStepKey: [], keywords: [], importKey: [] }, 0n);
  check("post zonder OA in hoofdstuk 00", isOk(it3), errOf(it3));
  // Versies
  check("verouderde versie bewaren: geweigerd", "err" in (await calc.saveLibraryItem({ ...base, id: [id1], text: "andere tekst" }, 0n)));
  const v2 = await calc.saveLibraryItem({ ...base, id: [id1], text: base.text + "\nVoegkleur naar keuze." }, 1n);
  check("nieuwe versie (2) met de tekst erbij", isOk(v2) && v2.ok.version === 2n, errOf(v2));
  const hist = await wl.libraryItemHistory(id1);
  check("werfleider ziet de versies (tekst), nieuwste eerst, met wat veranderde", isOk(hist) && hist.ok.length === 2 && hist.ok[0].fields === "tekst" && hist.ok[1].item.text === base.text);
  check("niets gewijzigd = geen nieuwe versie", (await calc.saveLibraryItem({ ...base, id: [id1], text: base.text + "\nVoegkleur naar keuze." }, 2n)).ok?.version === 2n);
  // Zoeken en filteren
  const find = async (f) => (await wl.listLibrary({ text: "", chapterId: [], trade: [], unit: [], form: [], orgId: [], includeArchived: false, offset: 0n, limit: 50n, ...f })).items.map((x) => x.title);
  check("zoeken: 'tegel 60' vindt beide tegelposten", (await find({ text: "tegel 60" })).length === 2);
  check("zoeken in de lastenboektekst ('badkamer')", (await find({ text: "badkamer" })).join() === "Proef wandtegels 30x60");
  check("zoeken op code en zoekwoord", (await find({ text: "10.4.01" })).length === 1 && (await find({ text: "keramiek" })).length === 1);
  check("filter op contractvorm VH en op hoofdstuk", (await find({ form: [{ vh: null }] })).join() === "Proef vloertegels 60x60 leveren en plaatsen" && (await find({ chapterId: [chs[0].id] })).length === 1);
  check("filter op standaard-OA en eenheid", (await find({ orgId: [orgX.ok.id] })).length === 2 && (await find({ unit: ["sog"] })).length === 1);
  check("volgorde: hoofdstuk, dan code (10.4.01 vóór 10.4.02)", (await find({})).join("|") === "Proef werfvoorbereiding (eigen prestatie)|Proef vloertegels 60x60 leveren en plaatsen|Proef wandtegels 30x60");
  const pageWl = await wl.listLibrary({ text: "", chapterId: [], trade: [], unit: [], form: [], orgId: [], includeArchived: false, offset: 0n, limit: 50n });
  check("de views van de werfleider dragen geen enkele prijs of marge", noPrice(pageWl) && noPrice(await wl.getLibraryItem(id1)) && noPrice(hist));
  // Prijzen: enkel admin en calculator, via update-calls met een auditregel
  check("werfleider: geen prijzen, geen historiek, geen prijs toevoegen, geen verkoopregel", (await denied(wl.readLibraryPrices([id1]))) && (await denied(wl.readLibraryPriceHistory(id1))) && (await denied(wl.addLibraryCost(id1, { orgId: [], day: vandaag, costCents: 100n, source: "eigen", ref: "", note: "" }))) && (await denied(wl.setLibrarySell(id1, { rule: [], reason: "" }, 0n))));
  for (const [n, x] of [["architect", arch], ["OA", oa2], ["klant", klant], ["veiligheidscoördinator", vc]]) {
    check(`${n}: geen prijzen`, (await denied(x.readLibraryPrices([id1]))) && (await denied(x.readLibraryPriceHistory(id1))));
  }
  check("prijs met een klant als OA geweigerd", "err" in (await calc.addLibraryCost(id1, { orgId: [orgKlant.ok.id], day: vandaag, costCents: 3200n, source: "oa-offerte", ref: "", note: "" })));
  check("onbekende herkomst geweigerd", "err" in (await calc.addLibraryCost(id1, { orgId: [], day: vandaag, costCents: 3200n, source: "vrij", ref: "", note: "" })));
  const c1 = await calc.addLibraryCost(id1, { orgId: [orgY.ok.id], day: vandaag - 3n, costCents: 2900n, source: "oa-offerte", ref: "PROEF-DAK-1", note: "" });
  const c2 = await calc.addLibraryCost(id1, { orgId: [orgX.ok.id], day: vandaag - 30n, costCents: 3200n, source: "oa-offerte", ref: "PROEF-OFF-7", note: "" });
  check("calculator voegt twee aankoopprijzen toe (twee OA's)", isOk(c1) && isOk(c2));
  const pr = await calc.readLibraryPrices([id1, it3.ok.id]);
  const p1 = pr.ok?.prices[0];
  check("geldende aankoopprijs = de jongste van de STANDAARD-OA (ook al is een andere OA jonger)", p1?.cost[0]?.costCents[0] === 3200n && p1.cost[0].orgName === "Proef Tegels BV" && p1.perOrg.length === 2, JSON.stringify(p1?.cost, big));
  check("standaardmarge 20 %: verkoop = 32,00 / 0,8 = 40,00", pr.ok.standardMarginBp === 2000n && p1.sellCents[0] === 4000n && p1.marginBp[0] === 2000n && p1.deviates === false);
  check("post zonder aankoopprijs: geen verkoopprijs, markering mogelijk", pr.ok.prices[1].cost.length === 0 && pr.ok.prices[1].sellCents.length === 0);
  const wlc = await wlcalc.readLibraryPrices([id1]);
  check("werfleider die ook calculator is leest de prijzen", isOk(wlc));
  check("eigen marge zonder reden geweigerd", "err" in (await calc.setLibrarySell(id1, { rule: [{ margin: 2500n }], reason: "" }, 0n)));
  check("marge boven 90 % geweigerd", "err" in (await calc.setLibrarySell(id1, { rule: [{ margin: 9500n }], reason: "x" }, 0n)));
  const s1 = await calc.setLibrarySell(id1, { rule: [{ margin: 2500n }], reason: "kleine oppervlakte" }, 0n);
  const pr2 = (await calc.readLibraryPrices([id1])).ok.prices[0];
  check("eigen marge 25 %: verkoop = 32,00 / 0,75 = 42,67, gemarkeerd als afwijkend", isOk(s1) && pr2.sellCents[0] === 4267n && pr2.deviates === true && pr2.reason === "kleine oppervlakte", JSON.stringify(pr2.sellCents, big));
  check("verouderde versie van de verkoopregel: geweigerd", "err" in (await calc.setLibrarySell(id1, { rule: [], reason: "" }, 0n)));
  const s3 = await calc.setLibrarySell(it3.ok.id, { rule: [{ price: 130_000n }], reason: "eigen prestatie" }, 0n);
  const pr3 = (await calc.readLibraryPrices([it3.ok.id])).ok.prices[0];
  check("vaste verkoopprijs zonder aankoopprijs (eigen prestatie): € 1.300, geen marge", isOk(s3) && pr3.sellCents[0] === 130_000n && pr3.marginBp.length === 0 && pr3.deviates === true);
  check("terug naar de standaardmarge (versie 2); een meegestuurde reden valt weg", (await calc.setLibrarySell(id1, { rule: [], reason: "oude reden" }, 1n)).ok === 2n && (await calc.readLibraryPrices([id1])).ok.prices[0].sellCents[0] === 4000n && (await calc.readLibraryPrices([id1])).ok.prices[0].reason === "");
  check("prijs archiveren zonder reden geweigerd", "err" in (await calc.archiveLibraryCost(c2.ok, "")));
  check("prijs archiveren met reden: telt niet meer mee, de andere OA wordt de geldende prijs", isOk(await calc.archiveLibraryCost(c2.ok, "tikfout (proef)")) && (await calc.readLibraryPrices([id1])).ok.prices[0].cost[0].costCents[0] === 2900n);
  const ph = await calc.readLibraryPriceHistory(id1);
  check("historiek: beide prijzen (één gearchiveerd met reden) en de versies van de verkoopregel", isOk(ph) && ph.ok.costs.length === 2 && ph.ok.costs.some((c) => c.archived && c.archiveReason === "tikfout (proef)") && ph.ok.sells.length === 2);
  check("standaardmarge: calculator niet, admin wel", (await denied(calc.setLibraryMargin(2000n))) && isOk(await admin.setLibraryMargin(2000n)) && "err" in (await admin.setLibraryMargin(9999n)));
  const log = await admin.auditLog(0n, 300n);
  const libLog = log.filter((e) => /prijs|verkoopregel|bekeek:prijs|standaardmarge/.test(e.action));
  check("auditlog: 'bekeek:prijzen' en 'bekeek:prijshistoriek' bij elk lezen van prijzen", log.some((e) => e.action === "bekeek:prijzen") && log.some((e) => e.action === "bekeek:prijshistoriek"));
  check("auditlog: nooit een bedrag, marge of OA bij de prijzen", libLog.length >= 6 && !libLog.some((e) => /3200|32,00|2900|4267|1300|25 %|2500|Proef Tegels|Proef Dak/.test(e.detail)), libLog.map((e) => `${e.action}:${e.detail}`).slice(0, 4).join(" | "));
  // Archiveren (nooit wissen)
  check("hoofdstuk met actieve posten archiveren: geweigerd", "err" in (await calc.setLibraryChapterArchived(tegels.id, true)));
  check("post archiveren (met reden)", isOk(await calc.setLibraryItemArchived(it2.ok.id, true, "proef")));
  check("gearchiveerde post: weg uit de lijst, wel met 'gearchiveerde tonen', versies blijven", (await find({ text: "wandtegels" })).length === 0 && (await find({ text: "wandtegels", includeArchived: true })).length === 1 && (await wl.libraryItemHistory(it2.ok.id)).ok.length === 1);
  check("gearchiveerde post wijzigen of een prijs geven: geweigerd", "err" in (await calc.saveLibraryItem({ ...base, id: [it2.ok.id], importKey: [], title: "x" }, 1n)) && "err" in (await calc.addLibraryCost(it2.ok.id, { orgId: [], day: vandaag, costCents: 1n, source: "eigen", ref: "", note: "" })));
  check("post terugzetten", isOk(await calc.setLibraryItemArchived(it2.ok.id, false, "")) && (await find({ text: "wandtegels" })).length === 1);
  check("eenheid in gebruik archiveren: geweigerd", "err" in (await admin.setLibraryUnit({ key: "m2", name: "m²", order: 30n, archived: true })));
  // Export: het interne deel zonder prijzen, de prijzen in de vertrouwelijke export
  const exI = await admin.exportIntern();
  const exC = await admin.exportConfidential();
  check("interne export: hoofdstukken, posten en versies, zonder prijzen", exI.libChapters.length === 19 && exI.libItems.length === 3 && exI.libItemVersions.length === 4 && noPrice(exI.libItems));
  check("vertrouwelijke export: de aankoopprijzen en verkoopregels", exC.libCosts.length === 2 && exC.libSells.length === 2 && exC.libSellVersions.length === 3);
  check("export in stukken: libCosts enkel voor wie ook de prijzen mag (admin)", isOk(await admin.exportChunk("libCosts", 0n, 10n)) && (await rejects(calc.exportChunk("libCosts", 0n, 10n))));
  const meC = await calc.me();
  const meW = await wl.me();
  check("caps: calculator leest, bewerkt en ziet prijzen; werfleider leest enkel", meC.caps[0].readLibrary && meC.caps[0].editLibrary && meC.caps[0].libraryPrices && meW.caps[0].readLibrary && !meW.caps[0].editLibrary && !meW.caps[0].libraryPrices);
}

await sec("── offertes (2.4): versies, rekenen in de browser + controle op de server, prijzen enkel admin en calculator (R20–R23)");
{
  const year = new Date().getUTCFullYear();
  const meOf = (me, k) => !!me.caps[0]?.[k];
  const qIn = (workId, title, number = "") => ({ workId, number, title });
  for (const [n, x] of [["werfleider", wl], ["architect", arch], ["OA", oa2], ["klant", klant], ["veiligheidscoördinator", vc], ["anoniem", anon]]) {
    check(`${n}: geen offerte maken`, await denied(x.createQuote(qIn(A, "x"))));
  }
  const q1 = await calc.createQuote(qIn(A, "Proef rollentest A"));
  check("calculator maakt de eerste offerte van het jaar: <jaar>/001", isOk(q1) && q1.ok.number === `${year}/001`, errOf(q1) || q1.ok?.number);
  check("calculator zet het volgnummer niet (instelling, R17)", await denied(calc.setQuoteSequence(BigInt(year), 230n)));
  check("admin zet het volgnummer op 230 (verder na de offertes van vóór de app)", isOk(await admin.setQuoteSequence(BigInt(year), 230n)));
  check("admin leest het volgnummer (230) voor Instellingen; calculator niet", (await admin.quoteSequence(BigInt(year))) === 230n && (await rejects(calc.quoteSequence(BigInt(year)))));
  const q2 = await calc.createQuote(qIn(B, "Proef rollentest B"));
  check("de volgende: <jaar>/231 op P-B (btw 21 %)", isOk(q2) && q2.ok.number === `${year}/231`, q2.ok?.number);
  check("eigen nummer kan; hetzelfde nummer nog eens: geweigerd", isOk(await calc.createQuote(qIn(B, "Proef eigen nummer", "PROEF-900"))) && /bestaat al/.test(errOf(await calc.createQuote(qIn(A, "x", "PROEF-900")))));
  check("titel leeg, nummer > 20 tekens, onbekende werf: geweigerd", "err" in (await calc.createQuote(qIn(A, " "))) && "err" in (await calc.createQuote(qIn(A, "x", "N".repeat(21)))) && "err" in (await calc.createQuote(qIn(999_999n, "x"))));
  const r2 = ok1b(await calc.readQuoteVersion(q2.ok.versionId));
  check("versie 1: ontwerp, btw 21 % van P-B, standaardmarge 20 %", "draft" in r2.version.status && r2.version.vatBp === 2100n && r2.margins[0]?.standardMarginBp === 2000n);
  // Invullen en bewaren zoals de browser
  const m = fromRead(r2);
  M.setHeader(m, { clientOrgId: orgKlant.ok.id }); // 2.6: een offerte zonder klant wordt niet verstuurd
  const c1 = M.addChapter(m, { code: "02", title: "Proef afbraak" });
  const c2 = M.addChapter(m, { code: "03", title: "Proef grondwerken" });
  const pr = (cost, rule = null, reason = "") => ({ cost, rule, reason, orgId: null, source: cost === null ? "" : "eigen", libCostId: null });
  M.addLine(m, c1.key, { title: "Proef afbraak wand", qtyMilli: 7_260n, unit: "m3", form: "vh", price: pr(4_000n) });
  M.addLine(m, c1.key, { title: "Proef container", qtyMilli: 1_000n, unit: "st", form: "fixed", price: pr(null, { price: 45_000n }, "proef: vaste prijs") });
  M.addLine(m, c2.key, { title: "Proef uitgraving", qtyMilli: 18_600n, unit: "m3", form: "vh", price: pr(3_333n, { margin: 2500n }, "proef") });
  M.addLine(m, c2.key, { kind: "text", title: "Proef: grond blijft op de werf" , unit: "" });
  M.addLine(m, c2.key, { kind: "option", title: "Proef optie afvoer", qtyMilli: 18_600n, unit: "m3", form: "fixed", price: pr(1_500n) });
  const s2 = await saveAll(calc, m);
  check("bewaren: de server rekent hetzelfde (subtotaal, btw 21 %, opties apart, marge)", isOk(s2) && sameTotals(m, s2.ok.totals, s2.ok.margins), errOf(s2).slice(0, 200));
  const t2 = M.totals(m);
  check("70,00 aankoop (40,00/0,8 = 50,00 × 7,26 m³ = 363,00); vaste prijs 450,00; 33,33/0,75 = 44,44 × 18,6 = 826,58", t2.chapters[0].sell === 36_300n + 45_000n && t2.chapters[1].sell === 82_658n, JSON.stringify(t2.chapters.map((c) => c.sell), big));
  const vid = q2.ok.versionId;
  // Invoercontrole (alles of niets)
  const r2b = ok1b(await calc.readQuoteVersion(vid));
  const base = () => fromRead(r2b);
  const tryOne = async (f) => { const x = base(); f(x); const b = M.nextBatch(x); return calc.saveQuoteDraft(...batchArgs(x, b)); };
  const firstLine = (x) => x.lines.find((l) => l.title === "Proef afbraak wand").key;
  check("tekstregel met een prijs: geweigerd", /geen prijs/.test(errOf(await tryOne((x) => M.addLine(x, x.chapters[0].key, { kind: "text", title: "t", unit: "", price: pr(100n) })))));
  check("onbekende eenheid: geweigerd", /eenheid/.test(errOf(await tryOne((x) => M.updateLine(x, firstLine(x), { unit: "liter" })))));
  check("negatieve aankoopprijs, marge 95 %, hoeveelheid > 1 miljard: geweigerd", /aankoopprijs/.test(errOf(await tryOne((x) => M.updateLine(x, firstLine(x), { price: pr(-1n) })))) && /90 %/.test(errOf(await tryOne((x) => M.updateLine(x, firstLine(x), { price: pr(100n, { margin: 9500n }, "x") })))) && /te groot/.test(errOf(await tryOne((x) => M.updateLine(x, firstLine(x), { qtyMilli: 1_000_000_000_001n })))));
  check("een klant als OA van een aankoopprijs: geweigerd", /onderaannemer of leverancier/.test(errOf(await tryOne((x) => M.updateLine(x, firstLine(x), { price: { ...pr(100n), orgId: orgKlant.ok.id } })))));
  check("btw anders dan 6/21 %, OA-firma als klant: geweigerd", /6 of 21/.test(errOf(await tryOne((x) => M.setHeader(x, { vatBp: 1200n })))) && /klant/.test(errOf(await tryOne((x) => M.setHeader(x, { clientOrgId: orgX.ok.id })))));
  {
    const x = base();
    const ops = batchArgs(x, M.nextBatch((() => { M.updateChapter(x, x.chapters[0].key, { title: "Proef afbraak (weg)" }); return x; })()));
    ops[3] = [{ ...ops[3][0], remove: true }];
    check("hoofdstuk weg terwijl er nog lijnen in staan: geweigerd", /niet \(meer\) is|verschillen/.test(errOf(await calc.saveQuoteDraft(...ops))));
  }
  {
    const x = base();
    for (let i = 0; i < 301; i++) M.addLine(x, x.chapters[0].key, { title: `Proef ${i}`, qtyMilli: 1000n, unit: "st", price: pr(100n) });
    const b = M.nextBatch(x, 400);
    check("meer dan 300 wijzigingen in één oproep: geweigerd", /Te veel wijzigingen/.test(errOf(await calc.saveQuoteDraft(...batchArgs(x, b)))));
    const big2 = await saveAll(calc, x);
    check("… in stukken van 300 wel (2 oproepen), totalen gelijk", isOk(big2) && sameTotals(x, big2.ok.totals, big2.ok.margins), errOf(big2).slice(0, 160));
    const after = ok1b(await calc.readQuoteVersion(vid));
    const y = fromRead(after);
    for (const l of y.lines.filter((l) => /^Proef \d+$/.test(l.title))) M.removeLine(y, l.key);
    check("… en weer weg (archief, nooit gewist)", isOk(await saveAll(calc, y)) && ok1b(await calc.readQuoteVersion(vid)).lines.length === 5);
  }
  const fresh = fromRead(ok1b(await calc.readQuoteVersion(vid)));
  const bad = (() => { const x = fresh; M.updateLine(x, firstLine(x), { qtyMilli: 8_000n }); const b = M.nextBatch(x); const a = batchArgs(x, b); a[5] = expectRaw({ ...b.expect, vat: b.expect.vat + 1n, total: b.expect.total + 1n }); return a; })();
  check("btw van de browser 1 cent anders: geweigerd en niets bewaard", /verschillen/.test(errOf(await calc.saveQuoteDraft(...bad))) && ok1b(await calc.readQuoteVersion(vid)).lines.find((l) => l.title === "Proef afbraak wand").qtyMilli === 7_260n);
  // Wie ziet wat
  const rv = ok1b(await calc.readQuoteVersion(vid));
  const rw = ok1b(await wl.readQuoteVersion(vid));
  check("werfleider: scope 'totals', hoeveelheden en hoofdstuktotalen, geen prijs per lijn, aankoop of marge", "totals" in rw.scope && rw.sell.length === 0 && rw.costs.length === 0 && rw.margins.length === 0 && rw.totals.totalCents === rv.totals.totalCents && rw.lines.some((l) => l.qtyMilli === 7_260n));
  const rwc = ok1b(await wlcalc.readQuoteVersion(vid));
  check("werfleider die ook calculator is: alles (rechten = som van de rollen, R20)", "full" in rwc.scope && rwc.costs.length === 5);
  for (const [n, x] of [["architect (zonder grant)", arch], ["OA", oa2], ["klant", klant], ["veiligheidscoördinator", vc], ["anoniem", anon], ["onbekende login", vreemde]]) {
    const rs = await Promise.all([x.readQuoteVersion(vid), x.listQuotes([B], false), x.listQuotes([], false), x.newQuoteVersion(q2.ok.quoteId, []), x.sendQuoteVersion(vid, 0n, 0n, "proef: regels"), x.decideQuoteVersion(vid, true, ""), x.setQuoteArchived(q2.ok.quoteId, true, "x")].map(denied));
    check(`${n}: geen enkele offertefunctie (7 oproepen geweigerd)`, rs.every(Boolean), rs.map((r) => (r ? "·" : "✗")).join(""));
  }
  check("werfleider: lijst van de werf wel, zonder bedragen; bewaren, versturen, nieuwe versie: geweigerd", (await wl.listQuotes([B], false)).length === 2 && (await Promise.all([wl.saveQuoteDraft(...bad), wl.sendQuoteVersion(vid, 0n, 0n, "proef: regels"), wl.newQuoteVersion(q2.ok.quoteId, [])].map(denied))).every(Boolean));
  check("caps: offertes voor interne rollen, bewerken en prijzen enkel admin en calculator", meOf(await wl.me(), "quotes") && !meOf(await wl.me(), "editQuotes") && !meOf(await wl.me(), "quotePrices") && meOf(await calc.me(), "quotePrices") && !meOf(await oa2.me(), "quotes"));
  // Versturen en versies
  const sent = await calc.sendQuoteVersion(vid, rv.version.rev, rv.totals.totalCents, "proef: regels");
  check("versturen: hash; daarna niets meer aan te passen", isOk(sent) && /kan niet meer veranderen/.test(errOf(await calc.saveQuoteDraft(...bad))));
  check("lege offerte versturen: geweigerd", /nog geen enkele post/.test(errOf(await calc.sendQuoteVersion(q1.ok.versionId, 0n, 0n, "proef: regels"))));
  const nv = await calc.newQuoteVersion(q2.ok.quoteId, []);
  check("nieuwe versie v2 als kopie; een tweede ontwerp: geweigerd", isOk(nv) && /al een ontwerp/.test(errOf(await calc.newQuoteVersion(q2.ok.quoteId, []))));
  const rv2 = ok1b(await calc.readQuoteVersion(nv.ok));
  check("v2: zelfde lijnen, prijzen en totalen; kopieën wijzen naar v1", rv2.lines.length === 5 && rv2.totals.totalCents === rv.totals.totalCents && rv2.lines.every((l) => l.copiedFrom.length === 1) && rv2.costs.length === 5);
  check("beslissen op een ontwerp: geweigerd; op de verzonden v1: aanvaard", "err" in (await calc.decideQuoteVersion(nv.ok, true, "")) && isOk(await calc.decideQuoteVersion(vid, true, "proef")));
  // Export: intern zonder bedragen, prijzen enkel vertrouwelijk
  const exI = await admin.exportIntern();
  const exC = await admin.exportConfidential();
  check("interne export: offertes, versies, hoofdstukken, lijnen, zonder prijsvelden", exI.quotes.length >= 3 && exI.quoteVersions.length >= 4 && exI.quoteLines.length >= 10 && !Object.keys(exI.quoteLines[0]).some((k) => /cost|sell|marg|price/i.test(k)));
  check("vertrouwelijke export: de prijs per lijn en de standaardmarge per versie", exC.quotePrices.length === exI.quoteLines.length && exC.quoteVersionConf.length === exI.quoteVersions.length);
  check("export in stukken: quotePrices enkel admin", isOk(await admin.exportChunk("quotePrices", 0n, 10n)) && (await rejects(calc.exportChunk("quotePrices", 0n, 10n))));
  const log = await admin.auditLog(0n, 300n);
  check("auditlog: offertes zonder één bedrag", log.filter((e) => /offerte/.test(e.action)).length >= 8 && !log.filter((e) => /offerte/.test(e.action)).some((e) => /\b(4000|45000|3333|36300|82658)\b|€/.test(e.detail)));
  check("archiveren vraagt een reden; dan weg uit de lijst", "err" in (await calc.setQuoteArchived(q1.ok.quoteId, true, " ")) && isOk(await calc.setQuoteArchived(q1.ok.quoteId, true, "proef")) && !(await calc.listQuotes([A], false)).some((q) => q.id === q1.ok.quoteId));
}

await sec("── tickets en robot (§6, R28, R29)");
check("robot zonder registratie: checkTicket geweigerd", await rejects(robot.checkTicket("TK-0")));
check("werfleider kan geen robot toevoegen", await rejects(wl.addRobot(P("robot-test"), "Proefrobot", [])));
check("admin kan een persoon niet als robot registreren", "err" in (await admin.addRobot(P("proef-oa"), "x", [])));
check("admin registreert de proefrobot", isOk(await admin.addRobot(P("robot-test"), "Proefrobot", ["proef"])));
check("robot: me().isRobot", (await robot.me()).isRobot === true);
check("robot is geen persoon: listWorks geweigerd", await rejects(robot.listWorks()));
check("OA kan geen ticket maken", await rejects(oa.createTicket("proef", [])));
check("onbekende taak geweigerd", "err" in (await wl.createTicket("vrij-te-kiezen", [])));
const tk = await wl.createTicket("proef", [A]);
check("werfleider maakt een ticket voor werf A", isOk(tk));
check("een persoon kan geen ticket controleren", await rejects(wl.checkTicket(tk.ok.ticket)));
const ck = await robot.checkTicket(tk.ok.ticket);
check("robot controleert het ticket", isOk(ck) && ck.ok.personName === "Proef Werfleider");
check("tweede controle faalt", "err" in (await robot.checkTicket(tk.ok.ticket)));
check("robot schrijft één voorstel", isOk(await robot.submitProposal(tk.ok.ticketId, "proef", "{}")));
check("tweede voorstel faalt", "err" in (await robot.submitProposal(tk.ok.ticketId, "proef", "{}")));
const props = await wl.myProposals();
check("werfleider ziet zijn voorstel", props.length === 1);
check("OA ziet het voorstel niet", (await oa.myProposals()).length === 0);
check("OA kan er niet over beslissen", await denied(oa.decideProposal(props[0].id, true, "")));
check("werfleider beslist", isOk(await wl.decideProposal(props[0].id, true, "ok")));
const tk2 = await wl.createTicket("proef", []);
check("admin trekt de robot in", isOk(await admin.revokeRobot(P("robot-test"))));
check("ingetrokken robot: checkTicket geweigerd", await rejects(robot.checkTicket(tk2.ok.ticket)));

await sec("── opmeting (2.9): caps en schrijfpoort per rol (de rest staat in tests/opmeting-draft.mjs en tests/review.mjs J1–J8)");
{
  const cp = async (x) => (await x.me()).caps[0];
  const set = async (oaPropose, externalRead) => ok1b(await admin.saveMeasureSettings({ thresholdBp: 1000n, oaPropose, externalRead }));
  await set(false, false);
  const c = { admin: await cp(admin), wl: await cp(wl), calc: await cp(calc), arch: await cp(arch), oa: await cp(oa2), klant: await cp(klant), vc: await cp(vc) };
  check("caps.measure: admin, werfleider en calculator ja; OA, architect, klant en veiligheid nee (OA-voorstellen staan uit)", c.admin.measure && c.wl.measure && c.calc.measure && !c.oa.measure && !c.arch.measure && !c.klant.measure && !c.vc.measure);
  check("caps.measureRead: interne rollen en OA ja; architect, klant en veiligheid nee zolang de beheerder 'externen lezen mee' niet aanzet", c.admin.measureRead && c.wl.measureRead && c.calc.measureRead && c.oa.measureRead && !c.arch.measureRead && !c.klant.measureRead && !c.vc.measureRead);
  check("de schrijfpoort van de opmeting is dicht voor OA, architect, klant, veiligheid, anoniem, de robot", (await Promise.all([oa2, arch, klant, vc, anon, robot].map((x) => denied(x.measureSync([]))))).every(Boolean));
  await set(true, true);
  const d = { oa: await cp(oa2), arch: await cp(arch), klant: await cp(klant), vc: await cp(vc) };
  check("met de schakelaars aan: OA mag schrijven (voorstellen), architect en klant lezen; veiligheid nog altijd niet", d.oa.measure && d.oa.measureRead && !d.arch.measure && d.arch.measureRead && !d.klant.measure && d.klant.measureRead && !d.vc.measure && !d.vc.measureRead);
  check("de OA komt door de poort met een lege lijst; de architect nog altijd niet", Array.isArray(await oa2.measureSync([])) && (await denied(arch.measureSync([]))));
  await set(false, false);
  check("terug uit: de OA is weer buiten", !(await cp(oa2)).measure && !(await cp(arch)).measureRead);
  check("een drempel buiten bereik wordt geweigerd; enkel de beheerder wijzigt", (await denied(wl.saveMeasureSettings({ thresholdBp: 1000n, oaPropose: true, externalRead: true }))) && "err" in (await admin.saveMeasureSettings({ thresholdBp: 0n, oaPropose: false, externalRead: false })));
}

await sec("── vorderingsstaten (2.10): caps en poorten per rol (de rest staat in tests/vordering-draft.mjs en tests/review.mjs K1–K8)");
{
  const cp = async (x) => (await x.me()).caps[0];
  const c = { admin: await cp(admin), wl: await cp(wl), calc: await cp(calc), arch: await cp(arch), oa: await cp(oa2), klant: await cp(klant), vc: await cp(vc) };
  check("caps.progress: admin, werfleider en calculator ja; OA, architect, klant en veiligheid nee", c.admin.progress && c.wl.progress && c.calc.progress && !c.oa.progress && !c.arch.progress && !c.klant.progress && !c.vc.progress);
  check("caps.myProgress: enkel de klant", c.klant.myProgress && !c.admin.myProgress && !c.wl.myProgress && !c.calc.myProgress && !c.oa.myProgress && !c.arch.myProgress && !c.vc.myProgress);
  check("caps.quotePrices (bedragen in de vorderingsstaat): admin en calculator, nooit de werfleider", c.admin.quotePrices && c.calc.quotePrices && !c.wl.quotePrices);
  check("het menu Vorderingen is dicht voor OA, architect, klant, veiligheid, anoniem en de robot", (await Promise.all([oa2, arch, klant, vc, anon, robot].map((x) => denied(x.progressWorks())))).every(Boolean));
  check("de klantfuncties zijn dicht voor wie geen klant is (ook de beheerder)", (await Promise.all([admin, wl, calc, oa2, arch, vc, anon, robot].map((x) => denied(x.listMyProgress())))).every(Boolean));
  check("de werfleider leest geen staat met bedragen, geen rekenmodel en geen factuurgegevens", (await denied(wl.readProgressStatement(1n))) && (await denied(wl.readProgressRevision(A))) && (await denied(wl.progressInvoiceData(1n))));
  check("instellingen van de vorderingsstaten: interne rollen lezen, enkel de beheerder schrijft", (await Promise.all([admin, wl, calc].map((x) => x.progressSettings()))).every((x) => typeof x.client === "string") && (await denied(wl.saveProgressSettings({ client: "uit", retentionOnIncl: false }))) && (await denied(calc.saveProgressSettings({ client: "uit", retentionOnIncl: false }))));
}

await sec("── OA-facturen (2.11): caps en poorten per rol (de rest staat in tests/oafactuur-draft.mjs en tests/review.mjs L1–L6)");
{
  const cp = async (x) => (await x.me()).caps[0];
  const s0 = await admin.oaInvoiceSettings();
  const c = { admin: await cp(admin), wl: await cp(wl), calc: await cp(calc), arch: await cp(arch), oa: await cp(oa2), klant: await cp(klant), vc: await cp(vc) };
  check("caps.oaInvoices: admin, werfleider en calculator ja; OA, architect, klant en veiligheid nee", c.admin.oaInvoices && c.wl.oaInvoices && c.calc.oaInvoices && !c.oa.oaInvoices && !c.arch.oaInvoices && !c.klant.oaInvoices && !c.vc.oaInvoices);
  check("caps.myOaInvoices: niemand zolang de beheerder het niet aanzet", [c.admin, c.wl, c.calc, c.oa, c.arch, c.klant, c.vc].every((x) => !x.myOaInvoices));
  check("het menu OA-facturen is dicht voor OA, architect, klant, veiligheid, anoniem en de robot", (await Promise.all([oa2, arch, klant, vc, anon, robot].map((x) => denied(x.listOaInvoices([], []))))).every(Boolean));
  check("de werfleider registreert geen factuur en leest geen factuur met bedragen", (await denied(wl.saveOaInvoice({ id: [], orgId: 0n, workId: A, number: "x", invoiceDay: 0n, dueDay: [], periodFrom: [], periodTo: [], vatRegime: { reverse: null }, reverseMention: true, fileId: [], note: "", netCents: 0n, vatCents: 0n, totalCents: 0n, lines: [] }, 0n))) && (await denied(wl.readOaInvoice(1n))) && (await denied(wl.oaInvoicePosts(A))));
  ok1b(await admin.saveOaInvoiceSettings({ ...s0, oaView: true }));
  check("met de schakelaar aan: enkel de OA krijgt 'Mijn facturen' (en komt door de poort); architect en klant niet", (await cp(oa2)).myOaInvoices && Array.isArray(await oa2.myOaInvoices()) && !(await cp(arch)).myOaInvoices && (await denied(arch.myOaInvoices())) && (await denied(klant.myOaInvoices())));
  // 2.12 (R31): een OA die nergens meer actief lid is, krijgt "Mijn facturen" niet, ook niet met de schakelaar aan (poort in Rights.mo).
  const invZ = await invite(admin, "Proef OA zonder werf (2.12)", roles("onderaannemer"));
  const oaZ = await freshBackend(cid);
  await redeem(oaZ, invZ.ok.code);
  check("2.12: een OA zonder actief lidmaatschap krijgt 'Mijn facturen' niet (caps nee, poort dicht)", !(await cp(oaZ)).myOaInvoices && (await denied(oaZ.myOaInvoices())));
  ok1b(await admin.archivePerson(invZ.ok.personId));
  ok1b(await admin.saveOaInvoiceSettings(s0));
  check("instellingen: enkel de beheerder schrijft; ongeldige betwistingsmelding geweigerd", (await denied(calc.saveOaInvoiceSettings(s0))) && "err" in (await admin.saveOaInvoiceSettings({ ...s0, disputeNotice: "soms" })));
}

await sec("── afzetten (R16, T7)");
const oaId = (await oa.me()).person[0].id;
const invOa3 = await invite(admin, "Nog een code voor OA", roles("onderaannemer"));
check("admin zet de OA af", isOk(await admin.archivePerson(oaId)));
check("afgezette OA: volgende call geweigerd", await rejects(oa.listWorks()));
check("afgezette OA: me() = unlinked", status(await oa.me()) === "unlinked");
check("afgezette OA: geen uploadcertificaat meer", await rejects(cert(oa)));
check("afgezette OA: geen lid meer van werf A", (await admin.listMembers(A)).every((m) => m.personId[0] !== oaId));
check("afzetten logt het einde van zijn lidmaatschap", (await admin.auditLog(0n, 30n)).some((e) => e.action === "lid-beeindigd" && e.detail.includes("afgezet")));
const admin2Id = (await admin2.me()).person[0].id;
check("admin zet admin 2 af", isOk(await admin.archivePerson(admin2Id)));
check("admin 2 kan niets meer", await rejects(admin2.listPersons(false)));
if (!geclaimd) check("de laatste admin kan zijn adminrol niet verliezen", "err" in (await admin.updatePerson(adminId, { name: "x", roles: roles("werfleider"), orgId: [], shortCode: [], lang: [], phone: [] })));
check("admin zet admin 2 terug (zonder login)", isOk(await admin.restorePerson(admin2Id)) && status(await admin2.me()) === "unlinked");

await sec("── pending blijft dicht");
const invN = await invite(admin, "Proef Nieuw", roles("calculator"));
await redeem(nieuw, invN.ok.code);
check("nieuw (intern, niet bevestigd): me() pending zonder caps", await nieuw.me().then((m) => status(m) === "pending" && m.caps.length === 0));
check("nieuw: geen werven, geen team, geen certificaat", (await rejects(nieuw.listWorks())) && (await rejects(nieuw.listPersons(false))) && (await rejects(cert(nieuw))));

await sec("── auditlog en export (§3)");
const log = await admin.auditLog(0n, 500n);
const details = log.map((e) => e.detail + " " + e.action).join("\n");
const bare = codes.filter(Boolean).flatMap((c) => [c, c.replace(/^BOW-/, "").replaceAll("-", "")]);
check("auditlog bevat geen enkele volledige code", !bare.some((c) => details.includes(c)), `${codes.length} codes nagekeken`);
check("auditlog bevat geen opslagverwijzing", !details.includes("!caf!"));
check("uitnodiging met werf: lidmaatschap staat in de auditlog", log.some((e) => e.action === "lid-toegevoegd" && e.detail.includes("uitnodiging Proef OA Tegels")));
check("auditlog: 'bekeek' bij vertrouwelijk lezen", log.some((e) => e.action === "bekeek:organisatie-vertrouwelijk") && log.some((e) => e.action === "bekeek:bestand-vertrouwelijk"));
check("werfleider ziet enkel zijn eigen auditregels", (await wl.auditLog(0n, 500n)).every((e) => e.personId[0] === wlId));
check("werfleider kan geen export", await rejects(wl.exportIntern()));
const ex = await admin.exportIntern();
check("admin: interne export met personen, codes zonder hash, werven", ex.persons.length >= 10 && ex.invites.length >= 10 && !("hash" in ex.invites[0]) && ex.works.filter((w) => !w.code.startsWith("PL-")).length === 3);
check("export staat in de auditlog", (await admin.auditLog(0n, 5n)).some((e) => e.action === "export-intern"));

if (local && !process.env.ZONDER_KLOK) {
  await sec("── globale remming (open punt 4) — 1.000 foute pogingen van wegwerpidentiteiten");
  const N = 1000;
  const batch = 50;
  for (let i = 0; i < N; i += batch) {
    await Promise.all(
      Array.from({ length: batch }, async (_, j) => {
        const x = await fresh();
        await x.redeemCode(`BOW-ZZZZ-ZZZZ-${String(i + j).padStart(4, "0").replace(/[ILOU]/g, "0")}`).catch(() => {});
      }),
    );
  }
  const st = await admin.accessStats();
  check("accessStats telt de fouten van dit uur", st.failuresThisHour >= 1000n, `${st.failuresThisHour}`);
  check("admin kreeg een melding 'remming'", (await admin.myNotifications(true)).some((n) => n.kind === "remming"));
  check("codes zijn globaal dicht", st.codesLockedUntil.length === 1);
  const invL = await invite(admin, "Na de remming", roles("onderaannemer"));
  codes.push(invL.ok.code);
  const late = await fresh();
  everyone.push(late);
  const blocked = await late.redeemCode(invL.ok.code);
  check("tijdens de remming faalt ook een geldige code", errOf(blocked).includes("Te veel pogingen"), errOf(blocked));
  await advance(HOUR + 60_000_000_000n);
  const after = await late.redeemCode(invL.ok.code);
  check("na het uur werkt de geldige code weer", isOk(after), errOf(after));

  await sec("── vervaltijd (open punt 9) — klok 8 dagen vooruit");
  const invE = await invite(admin, "Vervalt", roles("onderaannemer"));
  codes.push(invE.ok.code);
  const tk3 = await admin.createTicket("proef", []);
  await advance(8n * DAY);
  await new Promise((r) => setTimeout(r, 2000));
  const exp = await (await fresh()).redeemCode(invE.ok.code);
  check("code na 8 dagen: geweigerd", "err" in exp, errOf(exp));
  const st2 = (await admin.listInvites(0n, 500n)).find((i) => i.id === invE.ok.inviteId).state;
  check("code staat nu op 'verlopen'", "expired" in st2, JSON.stringify(st2, big));
  check("vervallen code is geen 'open code' meer", (await admin.accessStats()).openInvites >= 0n);
  await admin.addRobot(P("robot-test"), "Proefrobot", ["proef"]).catch(() => {});
  const ck3 = await robot.checkTicket(tk3.ok.ticket);
  check("ticket na 8 dagen: geweigerd", "err" in ck3, errOf(ck3));
  check("geblokkeerde principal is na 24 uur weer vrij", (await vreemde.me()).blockedUntil.length === 0);
}

await sec("── 2b.1 Firma's & contacten: firmasoort veiligheidscoördinator, rol van een contact volgt de firma, toegang zonder dubbel, werven van een firma");
{
  const vcOrg = await org("safetyCoordinator", "Proef VC Bureau");
  check("admin maakt een firma van soort veiligheidscoördinator", isOk(vcOrg) && "safetyCoordinator" in vcOrg.ok.kind, JSON.stringify(vcOrg, big));
  check("werfleider maakt ook een VC-firma (manageOrgs), calculator niet", isOk(await wl.createOrg({ kind: { safetyCoordinator: null }, name: "Proef VC Twee", kbo: [], vat: [], aliases: [], trades: [], address: [], notes: "" })) && (await rejects(calc.createOrg({ kind: { safetyCoordinator: null }, name: "x", kbo: [], vat: [], aliases: [], trades: [], address: [], notes: "" }))));
  check("de VC-firma staat in de OA-database (filter op soort)", (await admin.listOas(oaFilter({ kind: "safetyCoordinator" }))).some((v) => v.org.id === vcOrg.ok.id));
  const vcP = await wl.saveOaPerson(vcOrg.ok.id, pIn("Proef Coördinator 2b"));
  const archP = await wl.saveOaPerson(orgArch.ok.id, pIn("Proef Architect 2b"));
  const elekP = await wl.saveOaPerson(orgElek.ok.id, pIn("Proef Elektricien 2b"));
  const rolesOf = async (id) => (await admin.listPersons(false)).find((p) => p.id === id)?.roles.map((r) => Object.keys(r)[0]).join() ?? "";
  check("nieuw contact bij een VC-firma krijgt de rol veiligheidscoördinator", isOk(vcP) && (await rolesOf(vcP.ok.id)) === "veiligheidscoordinator");
  check("nieuw contact bij een architectenbureau krijgt de rol architect", isOk(archP) && (await rolesOf(archP.ok.id)) === "architect");
  check("nieuw contact bij een OA krijgt (zoals vroeger) de rol onderaannemer", isOk(elekP) && (await rolesOf(elekP.ok.id)) === "onderaannemer");
  const before = (await admin.listPersons(true)).length;
  const inv = await wl.inviteExistingPerson({ personId: vcP.ok.id, workIds: [A], validDays: 1n, tag: "2b.1" });
  check("werfleider geeft toegang aan het bestaande VC-contact voor werf A (code)", isOk(inv), errOf(inv));
  check("toegang geven maakt geen tweede persoon", (await admin.listPersons(true)).length === before);
  check("het VC-contact is meteen lid van werf A als veiligheidscoördinator", (await admin.listMembers(A)).some((m) => m.personId[0] === vcP.ok.id && "veiligheidscoordinator" in m.role));
  check("tweede code voor dezelfde persoon blijft dezelfde persoon (geen dubbel lid)", isOk(await admin.inviteExistingPerson({ personId: vcP.ok.id, workIds: [A], validDays: 1n, tag: "2b.1b" })) && (await admin.listMembers(A)).filter((m) => m.personId[0] === vcP.ok.id).length === 1);
  // 2b.2 AD-01: ook de backend weigert een dubbel lid (zelfde persoon of firma, zelfde rol, zelfde werf, nog actief)
  const dupP = await admin.addMembership(A, [vcP.ok.id], [], { veiligheidscoordinator: null }, []);
  check("AD-01: addMembership weigert dezelfde persoon met dezelfde rol op dezelfde werf", errOf(dupP).includes("Staat al"), JSON.stringify(dupP, big));
  check("AD-01: ook de werfleider van de werf krijgt die weigering", errOf(await wl.addMembership(A, [vcP.ok.id], [], { veiligheidscoordinator: null }, [])).includes("Staat al"));
  check("AD-01: dezelfde firma met dezelfde rol (hele firma Dak, al lid op A) wordt geweigerd", errOf(await admin.addMembership(A, [], [orgY.ok.id], { onderaannemer: null }, [])).includes("Staat al"));
  check("AD-01: dezelfde persoon met een andere rol mag wel (en wordt daarna beëindigd)", await (async () => {
    const r = await admin.addMembership(A, [vcP.ok.id], [], { onderaannemer: null }, []);
    if (!isOk(r)) return false;
    return isOk(await admin.endMembership(r.ok));
  })());
  check("AD-01: na beëindigen van een lid kan dezelfde rol opnieuw", await (async () => {
    const m = (await admin.listMembers(A)).find((x) => x.personId[0] === vcP.ok.id && x.endedAt.length === 0 && "veiligheidscoordinator" in x.role);
    if (!m || !isOk(await admin.endMembership(m.id))) return false;
    const again = await admin.addMembership(A, [vcP.ok.id], [], { veiligheidscoordinator: null }, []);
    return isOk(again);
  })());
  check("calculator geeft geen toegang (geen #inviteExternal)", await rejects(calc.inviteExistingPerson({ personId: archP.ok.id, workIds: [A], validDays: 1n, tag: "" })));
  // orgWorks: de werven van een firma voor de firmafiche
  check("werven van de klant: werf A (klant op de werf)", (await admin.orgWorks(orgKlant.ok.id)).includes(A));
  check("werven van de VC-firma: werf A (via haar contact als lid)", (await wl.orgWorks(vcOrg.ok.id)).includes(A));
  check("werven van een firma zonder werf: leeg", (await calc.orgWorks(vcOrg.ok.id + 1_000_000n)).length === 0);
  check("OA, architect, klant, veiligheid en anoniem lezen de werven van een firma niet", (await Promise.all([oa, arch, klant, vc, anon].map((x) => rejects(x.orgWorks(orgKlant.ok.id))))).every(Boolean));
  for (const i of (await admin.listInvites(0n, 500n)).filter((x) => x.tag.startsWith("2b.1") && "open" in x.state)) {
    const r = await admin.revokeInvite(i.id);
    if ("err" in r) check(`code #${i.id} (2b.1) intrekken`, false, r.err);
  }
}

await sec("── 2b.2 menu per rol: welke menu-items en welke Beheer-tabbladen ziet elke rol, en elke oude route opent nog iets");
{
  const { loadNav, OUD_NAAR_NIEUW } = await import("./menu-lib.mjs");
  const nav = await loadNav();
  const capsOf = async (x) => (await x.me()).caps[0];
  const rolesAll = { admin, werfleider: wl, calculator: calc, oa: oa2, architect: arch, klant, vc, "werfleider+calculator": wlcalc };
  const caps = {};
  for (const [k, x] of Object.entries(rolesAll)) { caps[k] = await capsOf(x); check(`menu: caps van ${k} opgehaald`, !!caps[k]); }
  const keys = (c) => nav.navFor(c).filter((g) => g.id !== "meer").flatMap((g) => g.items.map((i) => i.key));
  const meer = (c) => nav.navFor(c).filter((g) => g.id === "meer").flatMap((g) => g.items.map((i) => i.key));
  const tabs = (c) => nav.beheerTabs(c).map((x) => x.key);
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const show = (k) => `${keys(caps[k]).join(",")} | meer: ${meer(caps[k]).join(",")} | tabs: ${tabs(caps[k]).join(",")}`;
  check("menu beheerder: 9 items (was 21), in groepen Werk · Geld · Opvolging · Adresboek + Beheer", eq(keys(caps.admin), ["overzicht", "werven", "weekbord", "offertes", "facturatie", "opvolging", "adresboek", "team", "beheer"]) && nav.itemCount(nav.navFor(caps.admin)) === 9, show("admin"));
  check("menu beheerder: de groepen heten Werk, Geld, Opvolging, Adresboek", eq(nav.navFor(caps.admin).map((g) => g.label), ["Werk", "Geld", "Opvolging", "Adresboek", null]));
  check("menu werfleider: Vandaag · Werven · Planning · Vergunningen & administratie · Firma's & contacten + Meer", eq(keys(caps.werfleider), ["vandaag", "werven", "weekbord", "opvolging", "adresboek"]) && meer(caps.werfleider).length > 0, show("werfleider"));
  check("werfleider: Meer bevat Team, Postenbibliotheek, Ritten & boetes (en zijn codes); het Dashboard is weg (2b.4)", ["team", "posten", "beheer-voertuigen", "beheer-toegang"].every((k) => meer(caps.werfleider).includes(k)) && !meer(caps.werfleider).includes("dashboard"));
  check("menu calculator: Werven · Offertes · Facturatie · Firma's & contacten + Meer (Planning, Team)", eq(keys(caps.calculator).sort(), ["adresboek", "facturatie", "offertes", "werven"]) && ["weekbord", "team"].every((k) => meer(caps.calculator).includes(k)) && nav.itemCount(nav.navFor(caps.calculator)) === 5, show("calculator"));
  check("menu onderaannemer: Mijn week · Mijn uren (· Mijn facturen als dat openstaat)", keys(caps.oa).slice(0, 2).join() === "week,uren" && keys(caps.oa).length <= 3 && meer(caps.oa).length === 0, show("oa"));
  check("menu architect: 1 item (Mijn werven)", eq(keys(caps.architect), ["werven"]) && nav.navFor(caps.architect)[0].items[0].label === "Mijn werven", show("architect"));
  check("menu klant: 1 item (Mijn werf)", eq(keys(caps.klant), ["werven"]) && nav.navFor(caps.klant)[0].items[0].label === "Mijn werf", show("klant"));
  check("menu veiligheidscoördinator: 1 item (Mijn werven)", eq(keys(caps.vc), ["werven"]), show("vc"));
  check("menu werfleider+calculator: start Vandaag, Offertes en Facturatie erbij", keys(caps["werfleider+calculator"]).includes("vandaag") && keys(caps["werfleider+calculator"]).includes("offertes") && keys(caps["werfleider+calculator"]).includes("facturatie"), show("werfleider+calculator"));
  check("niemand behalve de beheerder heeft Beheer als menu-item", Object.entries(caps).every(([k, c]) => (k === "admin") === keys(c).includes("beheer")));
  check("de beheerder heeft geen menu-item Vandaag (vraag 13: een blok in het Overzicht)", !keys(caps.admin).includes("vandaag") && caps.admin.writeReports);
  check("Mijn login is geen menu-item meer (staat bij je naam)", Object.values(caps).every((c) => !keys(c).includes("login") && !meer(c).includes("login")));
  // Beheer-tabbladen per rol
  check("Beheer beheerder: alle 9 tabbladen", eq(tabs(caps.admin), ["bedrijf", "offertes", "opmeting", "planning", "documenten", "voertuigen", "mail", "toegang", "audit"]), tabs(caps.admin).join());
  check("Beheer werfleider: enkel voertuigen & ritten en toegang & codes", eq(tabs(caps.werfleider), ["voertuigen", "toegang"]), tabs(caps.werfleider).join());
  check("Beheer calculator, OA, architect, klant en VC: geen tabbladen", ["calculator", "oa", "architect", "klant", "vc"].every((k) => tabs(caps[k]).length === 0), ["calculator", "oa", "architect", "klant", "vc"].map((k) => tabs(caps[k]).join("-")).join(" / "));
  check("hubs: Facturatie toont vorderingsstaten en OA-facturen enkel waar de rol ze mag", eq(nav.hubTabs("vorderingen", caps.admin).map((x) => x.key), ["vorderingen", "oa-facturen"]) && nav.hubTabs("vorderingen", caps.werfleider).length >= 1);
  check("hub Offertes · Posten voor admin en calculator, Posten alleen voor de werfleider", eq(nav.hubTabs("offertes", caps.admin).map((x) => x.key), ["offertes", "posten"]) && eq(nav.hubTabs("offertes", caps.calculator).map((x) => x.key), ["offertes", "posten"]) && !keys(caps.werfleider).includes("offertes"));
  check("hub Mijn werf voor de klant: voortgang · offerte · vorderingsstaten", eq(nav.hubTabs("werven", caps.klant).map((x) => x.key), ["werven", "mijn-offerte", "mijn-vordering"]) && nav.hubTabs("werven", caps.architect).length === 0);
  check("vaste balk onderaan enkel voor de werfleider: Vandaag · Werven · + Verslag · Meer", eq(nav.bottomBar(caps.werfleider), ["vandaag", "werven", "verslag", "meer"]) && ["admin", "calculator", "oa", "architect", "klant", "vc"].every((k) => nav.bottomBar(caps[k]).length === 0));
  // Elk menu-item opent iets dat de rol mag; Rights.mo blijft de enige matrix (het menu kent geen eigen regels)
  let alles = true;
  const slecht = [];
  for (const [k, c] of Object.entries(caps)) {
    for (const g of nav.navFor(c)) for (const i of g.items) {
      const r = nav.resolveRoute(i.to.split("/"), c);
      if (r.page !== i.to.split("/")[0] || r.page === c.home && i.to.split("/")[0] !== c.home) { alles = false; slecht.push(`${k}:${i.to}→${r.page}`); }
    }
  }
  check("elk menu-item van elke rol opent het bedoelde scherm (geen terugval naar het startscherm)", alles, slecht.join(" "));
  // Tabel oud → nieuw: elke oude route opent nog iets, voor elke rol die er recht op had
  let gevonden = 0;
  const fouten = [];
  const heeft = (c, cond) => cond === "any" || (cond.startsWith("home=") ? c.home === cond.slice(5) : !!c[cond]);
  for (const [oud, scherm, nieuw, cond] of OUD_NAAR_NIEUW) {
    for (const [k, c] of Object.entries(caps)) {
      const r = nav.resolveRoute([oud], c);
      const mag = heeft(c, cond) && (nieuw === null || nav.pagesFor(c).has(nieuw.split("/")[0]));
      if (oud === "onderaannemers" || oud === "organisaties") { if (!c.readTeam && !c.readOa) continue; }
      if (mag) {
        gevonden++;
        if (r.page !== scherm || (nieuw && r.redirect !== nieuw)) fouten.push(`${k}: #/${oud} → ${r.page}${r.redirect ? "/" + r.redirect : ""} (verwacht ${scherm}${nieuw ? " " + nieuw : ""})`);
      } else if (r.page === scherm && scherm !== c.home && !nieuw) {
        fouten.push(`${k}: #/${oud} opent ${r.page} zonder recht`);
      }
    }
  }
  check(`tabel oud → nieuw: ${gevonden} (route × rol)-combinaties openen het scherm uit de tabel`, fouten.length === 0 && gevonden > 80, fouten.slice(0, 5).join(" | "));
  check("oude adressen met een deel erachter blijven bewaard (#/boetes/… → beheer/voertuigen/…)", nav.resolveRoute(["boetes", "x"], caps.admin).redirect === "beheer/voertuigen/x" && nav.resolveRoute(["postbode"], caps.admin).redirect === "beheer/mail");
  check("een oud adres zonder recht valt terug op het startscherm (geen blanco scherm)", nav.resolveRoute(["weekbord"], caps.klant).page === "werven" && nav.resolveRoute(["beheer"], caps.calculator).page === "offertes" && nav.resolveRoute(["onbekend"], caps.oa).page === "week");
  check("Boete opzoeken blijft bereikbaar voor de werfleider (Meer → Ritten & boetes) maar niet voor de calculator", nav.resolveRoute(["boetes"], caps.werfleider).page === "beheer" && nav.resolveRoute(["beheer", "voertuigen"], caps.calculator).page === caps.calculator.home);
}

await sec("── 2b.3 de werf als centrum: stand van de werf (listWorkStages), fase, tabbladen per rol, volgende stap, oude adressen");
{
  const { loadNav, loadFase } = await import("./menu-lib.mjs");
  const nav = await loadNav();
  const F = await loadFase();
  const rolesAll = { admin, werfleider: wl, calculator: calc, oa: oa2, architect: arch, klant, vc, "werfleider+calculator": wlcalc };
  const caps = {};
  for (const [k, x] of Object.entries(rolesAll)) caps[k] = (await x.me()).caps[0];
  // Dezelfde werven als listWorks, per rol; enkel momenten, tellingen en vlaggen (geen bedrag, geen naam)
  let zelfde = true;
  const verschil = [];
  for (const [k, x] of Object.entries(rolesAll)) {
    const ws = (await x.listWorks()).map((w) => String(w.id)).sort();
    const st = (await x.listWorkStages()).map((s) => String(s.workId)).sort();
    if (JSON.stringify(ws) !== JSON.stringify(st)) { zelfde = false; verschil.push(`${k}: ${ws.length} werven, ${st.length} standen`); }
  }
  check("listWorkStages: elke rol krijgt de stand van precies de werven die ze ziet (zelfde als listWorks)", zelfde, verschil.join(" | "));
  const velden = Object.keys((await admin.listWorkStages())[0] ?? {}).sort().join(",");
  check("listWorkStages: enkel momenten, tellingen en vlaggen (geen bedrag, naam of inhoud)", velden === "acceptedAt,firstReportAt,invoicedAt,measuredAt,progressDraft,progressSent,quoteSentAt,quoteWaiting,startPending,startedAt,surveyOpen,tasks,workId", velden);
  const leeg = (s) => s.quoteSentAt.length + s.acceptedAt.length + s.startedAt.length + s.firstReportAt.length + s.measuredAt.length + s.invoicedAt.length === 0 && s.tasks === 0n && s.progressSent === 0n && !s.quoteWaiting && !s.startPending && !s.surveyOpen && !s.progressDraft;
  check("listWorkStages: OA, architect en VC krijgen een lege stand (niets van offertes, staten of planning)", (await Promise.all([oa2, arch, vc].map((x) => x.listWorkStages()))).every((l) => l.every(leeg)));
  check("listWorkStages: de klant krijgt geen interne vlaggen (aantal taken, ontwerp, open opmeting)", (await klant.listWorkStages()).every((s) => s.tasks === 0n && !s.progressDraft && !s.surveyOpen && !s.startPending));
  check("listWorkStages: anoniem en een ongekoppelde login geweigerd", (await rejects(anon.listWorkStages())) && (await rejects(nieuw.listWorkStages())));
  const stA = (await admin.listWorkStages()).find((s) => s.workId === A);
  const ex3 = await admin.exportIntern();
  const tA = ex3.tasks.filter((x) => x.workId === A && x.archivedAt.length === 0).length;
  const rA = (ex3.dayReports ?? []).filter((x) => x.workId === A);
  const firstA = rA.length ? rA.map((x) => x.createdAt).sort((a, b) => (a < b ? -1 : 1))[0] : null;
  check("stand van P-A klopt met de export: taken, eerste werfverslag, geen offerte", !!stA && Number(stA.tasks) === tA && (firstA === null ? stA.firstReportAt.length === 0 : stA.firstReportAt[0] === firstA) && stA.quoteSentAt.length === 0, JSON.stringify(stA, (k, v) => (typeof v === "bigint" ? String(v) : v)));
  // De fase van P-A volgt uit de stand + de status die de rollentest zette (bezig): in uitvoering, offerte en akkoord overgeslagen
  const wA = (await admin.listWorks()).find((w) => w.id === A);
  const toFacts = (s, w) => ({ ...Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])), status: Object.keys(w.status)[0] });
  const fA = F.werfFase(toFacts(stA, wA));
  check("fase van P-A (bezig, geen offerte): In uitvoering, Offerte en Akkoord overgeslagen (opdracht zonder offerte, vraag 2)", "running" in wA.status && fA.index === 4 && fA.steps[1] === "skipped" && fA.steps[2] === "skipped" && fA.steps[3] === "done", JSON.stringify(fA.steps) + Object.keys(wA.status));
  // Tabbladen per rol (echte caps): enkel wat de rol mag
  const tabs = (k) => F.werfTabs(caps[k], fA, toFacts(stA, wA)).map((x) => x.key).join(",");
  check("tabbladen beheerder: alle negen", tabs("admin") === "overzicht,offerte,planning,verslagen,opmeting,facturatie,vergunningen,documenten,wie", tabs("admin"));
  check("tabbladen werfleider: alle negen (offerte en facturatie zonder bedragen, zoals vroeger)", tabs("werfleider") === "overzicht,offerte,planning,verslagen,opmeting,facturatie,vergunningen,documenten,wie", tabs("werfleider"));
  check("tabbladen calculator: alle negen (vergunningen & admin voor de werfadministratie)", tabs("calculator") === "overzicht,offerte,planning,verslagen,opmeting,facturatie,vergunningen,documenten,wie", tabs("calculator"));
  check("tabbladen klant: Voortgang · Offerte · Vorderingsstaten · Documenten", tabs("klant") === "overzicht,offerte,facturatie,documenten" && F.werfTabs(caps.klant, fA, {}).map((x) => x.label).join("|") === "Voortgang|Offerte|Vorderingsstaten|Documenten", tabs("klant"));
  check("tabbladen onderaannemer: geen offerte, verslagen, facturatie of wie werkt mee", ["offerte", "verslagen", "facturatie", "wie"].every((k) => !tabs("oa").split(",").includes(k)) && tabs("oa").startsWith("overzicht,planning"), tabs("oa"));
  check("tabbladen architect en VC: geen offerte, facturatie of wie werkt mee", ["architect", "vc"].every((r) => ["offerte", "facturatie", "wie"].every((k) => !tabs(r).split(",").includes(k))), `${tabs("architect")} / ${tabs("vc")}`);
  check("tabbladen: niemand buiten kantoor ziet Wie werkt mee", ["oa", "architect", "klant", "vc"].every((r) => !tabs(r).includes("wie")));
  // Volgende stap per rol
  const stap = (k, f, s, edit) => F.volgendeStap(f, s, caps[k], edit)?.key ?? null;
  const f0 = F.werfFase({ status: "request" });
  check("volgende stap in Aanvraag: calculator en beheerder 'Offerte maken', werfleider 'Wacht op de offerte', architect/OA geen kaart", stap("calculator", f0, { status: "request" }) === "offerteMaken" && stap("admin", f0, { status: "request" }) === "offerteMaken" && stap("werfleider", f0, { status: "request" }) === "wachtOfferte" && stap("architect", f0, { status: "request" }) === null && stap("oa", f0, { status: "request" }) === null);
  const s2 = { status: "quoting", quoteSentAt: 1n, acceptedAt: 2n, startPending: true };
  check("volgende stap in Akkoord: werfleider en beheerder 'Werf starten', calculator wacht", stap("werfleider", F.werfFase(s2), s2) === "werfStarten" && stap("admin", F.werfFase(s2), s2) === "werfStarten" && stap("calculator", F.werfFase(s2), s2) === "wachtStart");
  const s1 = { status: "quoting", quoteSentAt: 1n, quoteWaiting: true };
  check("volgende stap van de klant met een verstuurde offerte: 'Uw offerte bekijken' (Mijn offerte)", F.volgendeStap(F.werfFase(s1), s1, caps.klant, false)?.action?.to === "mijn-offerte");
  // Oude adressen van de werfpagina
  check("oud adres #/vorderingen/w/<id> → tabblad Facturatie van de werf", nav.resolveRoute(["vorderingen", "w", String(A)], caps.admin).redirect === `werven/${A}/facturatie` && nav.resolveRoute(["vorderingen", "w", String(A)], caps.calculator).redirect === `werven/${A}/facturatie`);
  check("#/werven/<id>/planning en #/opmeting/<id> blijven openen (tabblad Planning; opmeting werkt ook zonder bereik)", nav.resolveRoute(["werven", String(A), "planning"], caps.werfleider).page === "werven" && nav.resolveRoute(["opmeting", String(A)], caps.werfleider).page === "opmeting");
}

await sec("── 2b.4 startpunt en overzicht: Zo werkt het voor jou per persoon, de blokken per rol, Vraagt aandacht, de bel, Planning-tabbladen, oude adressen");
{
  const { loadNav, loadStart } = await import("./menu-lib.mjs");
  const nav = await loadNav();
  const S = await loadStart();
  const rolesAll = { admin, werfleider: wl, calculator: calc, oa: oa2, architect: arch, klant, vc, "werfleider+calculator": wlcalc };
  const me = {};
  for (const [k, x] of Object.entries(rolesAll)) me[k] = (await x.me());
  const caps = Object.fromEntries(Object.entries(me).map(([k, m]) => [k, m.caps[0]]));
  const roleNames = (m) => m.person[0].roles.map((r) => Object.keys(r)[0]);
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // Zo werkt het voor jou: één keer per persoon (bewaard bij de persoon), een andere persoon ziet het opnieuw
  const kinds = Object.fromEntries(Object.keys(rolesAll).map((k) => [k, S.introKind(roleNames(me[k]))]));
  check("Zo werkt het: de tekst volgt de rol (beheerder, werfleider, calculator, OA, architect, VC, klant)", eq(["admin", "werfleider", "calculator", "oa", "architect", "vc", "klant"].map((k) => kinds[k === "oa" ? "oa" : k]), ["admin", "werfleider", "calculator", "oa", "architect", "vc", "klant"]) && kinds["werfleider+calculator"] === "werfleider", JSON.stringify(kinds));
  check("Zo werkt het: alle zeven rollen hebben een eigen tekst (zeven soorten)", S.INTRO_KINDS.length === 7 && new Set(Object.values(kinds)).size >= 7);
  const seen0 = Object.fromEntries(await Promise.all(Object.entries(rolesAll).map(async ([k, x]) => [k, (await x.startState()).introSeen])));
  check("Zo werkt het: vóór 'Begrepen' ziet elke persoon (behalve wie het al deed) de kaart", ["werfleider", "calculator", "oa", "architect", "klant", "vc"].every((k) => seen0[k] === false), JSON.stringify(seen0));
  await wl.markIntroSeen();
  await wl.markIntroSeen(); // twee keer: nog steeds één vlag, geen fout
  const seen1 = Object.fromEntries(await Promise.all(Object.entries(rolesAll).map(async ([k, x]) => [k, (await x.startState()).introSeen])));
  check("Begrepen door de werfleider: voor hem bewaard (ook na herladen van de stand)", seen1.werfleider === true);
  check("een andere persoon ziet het opnieuw (calculator, OA, architect, klant, VC)", ["calculator", "oa", "architect", "klant", "vc"].every((k) => seen1[k] === false), JSON.stringify(seen1));
  const wl2seen = await wl2.startState(); // het tweede toestel van dezelfde werfleider: dezelfde persoon = dezelfde vlag
  check("hetzelfde persoon op een tweede toestel ziet het niet opnieuw (bewaard bij de persoon, niet in het toestel)", wl2seen.introSeen === true);
  await Promise.all([calc, oa2, arch, klant, vc].map((x) => x.markIntroSeen()));
  check("elke persoon bevestigt voor zichzelf (calculator, OA, architect, klant, VC)", (await Promise.all([calc, oa2, arch, klant, vc].map((x) => x.startState()))).every((x) => x.introSeen));
  check("anoniem en ongekoppeld: startState en markIntroSeen geweigerd", (await rejects(anon.startState())) && (await rejects(anon.markIntroSeen())) && (await rejects(nieuw.startState())) && (await rejects(nieuw.markIntroSeen())));

  // Aan de slag: enkel de beheerder bewaart en ziet de stappen
  check("Aan de slag bewaren (stap, verbergen): alleen de beheerder", (await Promise.all([wl, calc, oa2, arch, klant, vc].map((x) => denied(x.setStartStep("team", true)).then((a) => a && true)))).every(Boolean) && (await Promise.all([wl, calc, oa2, arch, klant, vc].map((x) => denied(x.setStartHidden(true))))).every(Boolean));
  await admin.setStartStep("posten", true);
  await admin.setStartHidden(true);
  const stNa = await Promise.all([wl, calc, oa2, klant].map((x) => x.startState()));
  check("een niet-beheerder krijgt geen stappen en geen 'verborgen' terug (ook niet als de beheerder iets markeerde)", stNa.every((x) => x.marked.length === 0 && x.hidden === false));
  await admin.setStartStep("posten", false);
  await admin.setStartHidden(false);
  check("de markering en het verbergen bewaren zich in settings.values (zichtbaar in de export, geen nieuw stabiel veld)", (await admin.exportIntern()).values.some(([k]) => k.startsWith("intro:")));
  const seenKeys = (await admin.exportIntern()).values.filter(([k]) => k.startsWith("intro:")).length;
  check("'Begrepen' staat per persoon: één sleutel per persoon die het bevestigde", seenKeys >= 7, `${seenKeys} sleutels`);

  // Wat de app zelf ziet (bestaande queries): met de rollentest-gegevens is er een werf, een planning en een team
  const f = async (x) => {
    const [doc, persons, oas, lib, works, stages] = await Promise.all([x.getQuoteDocSettings(), x.listPersons(false), x.listOas({ includeArchived: false, text: [], trade: [], kind: [] }), x.listLibrary({ text: "", chapterId: [], form: [], trade: [], unit: [], orgId: [], includeArchived: false, offset: 0n, limit: 1n }), x.listWorks(), x.listWorkStages()]);
    const live = new Set(works.filter((w) => w.archivedAt.length === 0).map((w) => String(w.id)));
    return { issuer: S.issuerFilled(doc.issuer), team: persons.filter((p) => p.roles.some((r) => ["admin", "werfleider", "calculator"].includes(Object.keys(r)[0]))).length, oas: oas.length, posts: Number(lib.total), works: live.size, planned: stages.filter((st) => live.has(String(st.workId)) && Number(st.tasks) > 0).length };
  };
  const facts = await f(admin);
  const steps = S.startSteps(facts, []);
  check("Aan de slag met de rollentest-gegevens: team, werf en planning door de app gezien; elke stap klopt met de tellingen", steps.find((x) => x.key === "team").done && steps.find((x) => x.key === "werf").done && steps.find((x) => x.key === "planning").done && steps.every((x) => x.done === (x.how === "app")) && steps.find((x) => x.key === "onderaannemers").done === (facts.oas >= 1) && steps.find((x) => x.key === "posten").done === (facts.posts >= 1), JSON.stringify(facts));
  check("Aan de slag: een stap telt als klaar door de app OF door een markering (zuivere regel)", S.startSteps({ issuer: false, team: 1, oas: 0, posts: 0, works: 0, planned: 0 }, ["bedrijf"])[0].how === "hand" && S.startSteps({ issuer: true, team: 2, oas: 1, posts: 1, works: 1, planned: 1 }, []).every((x) => x.done && x.how === "app") && S.startDoneCount(S.startSteps({ issuer: true, team: 1, oas: 0, posts: 0, works: 0, planned: 0 }, ["werf"])) === 2);
  check("Aan de slag: de adresbalk ?start=3 → stap 3; de route van een stap draagt het nummer", S.startParam("#/adresboek?start=3") === 3 && S.startParam("#/team") === null && S.startParam("#/team?start=7") === null && S.startRoute("onderaannemers") === "adresboek?start=3" && S.startRoute("posten") === "posten?start=4");
  check("Aan de slag: elke stap opent een scherm dat de beheerder mag (menu/route uit de caps)", S.START_KEYS.every((k) => { const r = nav.resolveRoute(S.START_TO[k].split("/"), caps.admin); return r.page === S.START_TO[k].split("/")[0]; }));

  // De blokken per rol: een OA, architect, VC of klant ziet geen kantoorblokken
  const blocks = (k) => S.overzichtBlocks(caps[k], true);
  check("Overzicht (beheerder): Aan de slag · Vraagt aandacht · Vandaag op de werven · Werven per fase · Deze week", eq(blocks("admin"), ["start", "aandacht", "vandaag", "fase", "week"]), blocks("admin").join());
  check("Overzicht: zonder startkaart (alles klaar of verborgen) valt enkel het eerste blok weg", !S.overzichtBlocks(caps.admin, false).includes("start") && S.overzichtBlocks(caps.admin, false).length === 4);
  check("OA, architect, VC en klant: géén enkel kantoorblok (geen aandacht, vandaag, werven per fase, deze week, aan de slag)", ["oa", "architect", "vc", "klant"].every((k) => blocks(k).length === 0), ["oa", "architect", "vc", "klant"].map((k) => `${k}:${blocks(k).join("-")}`).join(" "));
  check("OA, architect, VC en klant: geen 'Vraagt aandacht' op hun startscherm (de rechten van de bronnen volgen uit Rights.mo)", ["oa", "architect", "vc", "klant"].every((k) => !S.hasAttention(caps[k])));
  check("calculator: Vraagt aandacht en Werven per fase, geen Aan de slag, geen Vandaag op de werven", eq(blocks("calculator"), ["aandacht", "fase", "week"]) && !blocks("calculator").includes("start") && !blocks("calculator").includes("vandaag"), blocks("calculator").join());
  check("werfleider: geen Aan de slag (enkel de beheerder), wel Vandaag en Vraagt aandacht", !blocks("werfleider").includes("start") && blocks("werfleider").includes("vandaag") && blocks("werfleider").includes("aandacht"), blocks("werfleider").join());
  check("startscherm per rol: Overzicht, Vandaag, Offertes, Mijn week, Mijn werven (architect, VC), Mijn werf (klant)", eq(["admin", "werfleider", "calculator", "oa", "architect", "vc", "klant"].map((k) => S.startScreen(caps[k])), ["overzicht", "vandaag", "offertes", "mijn-week", "mijn-werven", "mijn-werven", "mijn-werf"]), ["admin", "werfleider", "calculator", "oa", "architect", "vc", "klant"].map((k) => S.startScreen(caps[k])).join());
  // De bronnen van Vraagt aandacht zijn bestaande queries: elke rol krijgt enkel wat Rights.mo al toestond
  const today2b4 = BigInt(Math.floor(Date.now() / 86_400_000));
  check("Vraagt aandacht: dashboard, boardConflicts en listIssues voor kantoor; OA, architect, klant en VC geweigerd (geen nieuwe query, geen breder zicht)", (await Promise.all([admin, wl, calc].map((x) => x.dashboard(today2b4).then(() => true, () => false)))).every(Boolean) && (await Promise.all([oa2, arch, klant, vc].map((x) => rejects(x.dashboard(today2b4))))).every(Boolean) && (await Promise.all([oa2, arch, klant, vc].map((x) => rejects(x.boardConflicts(BigInt(Math.floor(Date.now() / 86_400_000)), 6n, 5n))))).every(Boolean));
  check("Vraagt aandacht: de vergunningen die aandacht vragen enkel voor wie vergunningen mag lezen (calculator, OA, klant geweigerd)", (await Promise.all([calc, oa2, klant].map((x) => rejects(x.listPermits("aandacht", []))))).every(Boolean));

  // Vraagt aandacht: groepen per soort, hoogstens vijf, toon alle
  const mk = (n, p) => Array.from({ length: n }, (_, i) => ({ key: `${p}${i}`, title: `t${i}`, detail: "d", to: "x" }));
  const grp = S.attentionGroups([{ kind: "vertraagd", items: mk(7, "a") }, { kind: "oa", items: [] }, { kind: "dubbel", items: mk(5, "b") }, { kind: "wacht", items: mk(1, "c") }]);
  check("Vraagt aandacht: lege groepen vallen weg; 7 regels → 5 getoond met 'toon alle (7)'; 5 → geen 'toon alle'", grp.length === 3 && grp[0].shown.length === 5 && grp[0].total === 7 && grp[0].more && !grp[1].more && grp[1].shown.length === 5 && !grp[2].more);
  check("Vraagt aandacht: 'Toon alle' klapt de groep uit; de andere groepen blijven op vijf", (() => { const g = S.attentionGroups([{ kind: "vertraagd", items: mk(7, "a") }, { kind: "dubbel", items: mk(9, "b") }], new Set(["vertraagd"])); return g[0].shown.length === 7 && !g[0].more && g[1].shown.length === 5 && g[1].more; })());
  check("Vraagt aandacht: de soorten van het prototype (vertraagd, OA kan niet, dubbel geboekt, vergunning vervalt, wacht op jou) bestaan", ["vertraagd", "oa", "dubbel", "vergunning", "wacht"].every((k) => S.ATTENTION_KINDS.includes(k)));

  // De bel: gebundeld per soort
  const notes = await admin.myNotifications(false);
  const bundles = S.bundleNotes(notes);
  check("de bel bundelt per soort: elke melding valt in precies één groep, de aantallen kloppen", bundles.reduce((n, g) => n + g.items.length, 0) === notes.length && bundles.every((g) => g.items.every((n) => S.noteGroup(n.kind) === g.key)), `${notes.length} meldingen in ${bundles.length} groepen`);
  check("de bel: binnen een groep de nieuwste eerst; elk soort van het prototype heeft een groep", bundles.every((g) => g.items.every((n, i) => i === 0 || g.items[i - 1].createdAt >= n.createdAt)) && ["planning", "offerte", "opmeting", "facturatie", "vergunning", "verslag", "uren", "toegang", "mail", "overig"].every((k) => typeof k === "string") && S.noteGroup("afwezigheid-nieuw") === "planning" && S.noteGroup("vergunning-verloopt") === "vergunning" && S.noteGroup("probleem-nieuw") === "verslag" && S.noteGroup("onbekend") === "overig");

  // Planning-tabbladen (WC-03) en het Dashboard dat uit Meer verdween
  const pt = (k) => nav.planningTabs(caps[k]).map((x) => x.key).join();
  check("Planning: tabbladen Weekbord · Afwezigheden · Conflicten & regels voor beheerder, werfleider en calculator", ["admin", "werfleider", "calculator"].every((k) => pt(k) === "weekbord,weekbord/afwezigheden,weekbord/conflicten") && nav.planningTabs(caps.admin).map((x) => x.label).join("|") === "Weekbord|Afwezigheden|Conflicten & regels", pt("admin"));
  check("Planning: OA, architect, VC en klant krijgen geen tabbladen (en geen weekbord)", ["oa", "architect", "vc", "klant"].every((k) => pt(k) === "" && nav.resolveRoute(["weekbord", "afwezigheden"], caps[k]).page === caps[k].home));
  check("Planning: #/weekbord/afwezigheden en #/weekbord/conflicten openen het weekbord (de tabbladen zitten in het scherm)", ["admin", "werfleider", "calculator"].every((k) => nav.resolveRoute(["weekbord", "afwezigheden"], caps[k]).page === "weekbord" && nav.resolveRoute(["weekbord", "conflicten"], caps[k]).page === "weekbord"));
  const keysOf = (c) => nav.navFor(c).flatMap((g) => g.items.map((i) => i.key));
  // Bevinding uit de claim door de eigenaar (draft 56): een wachtende koppeling verscheen pas na herladen en de link ging naar een scherm zonder Bevestigen
  const aandachtSrc = readFileSync(join(import.meta.dirname, "../src/frontend/src/screens/Aandacht.tsx"), "utf8");
  const teamSrc = readFileSync(join(import.meta.dirname, "../src/frontend/src/screens/Team.tsx"), "utf8");
  check("Vraagt aandacht: de koppelingen verversen bij terugkeren naar het venster en elke 30 s (een koppeling die binnenkomt verschijnt zonder herladen)", /listLinks\(\), enabled: on && caps\.manageAccess, refetchOnWindowFocus: true, refetchInterval: 30_000/.test(aandachtSrc));
  check("Vraagt aandacht: een wachtende koppeling wijst naar Team, waar Bevestigen bestaat (niet naar Beheer → Toegang & codes zonder knop)", /code …\$\{l\.codeHint\}`, "team"/.test(aandachtSrc) && teamSrc.includes("confirmLink"));
  check("het Dashboard staat in geen enkel menu meer (ook niet in Meer van werfleider en calculator)", Object.values(caps).every((c) => !keysOf(c).includes("dashboard")));
  check("#/dashboard blijft werken: beheerder → Overzicht, werfleider en calculator → Werven · Lopend", nav.resolveRoute(["dashboard"], caps.admin).redirect === "overzicht" && nav.resolveRoute(["dashboard"], caps.werfleider).redirect === "werven/lopend" && nav.resolveRoute(["dashboard"], caps.calculator).redirect === "werven/lopend" && nav.resolveRoute(["dashboard"], caps["werfleider+calculator"]).redirect === "werven/lopend");
  check("#/dashboard voor OA, architect, VC en klant: gewoon hun startscherm (geen blanco scherm, geen recht erbij)", ["oa", "architect", "vc", "klant"].every((k) => nav.resolveRoute(["dashboard"], caps[k]).page === caps[k].home && !nav.resolveRoute(["dashboard"], caps[k]).redirect));
  check("de tellers van het Dashboard staan er nog: dashboard() geeft ze aan kantoor (Werven · Lopend, Overzicht · Deze week)", (await admin.dashboard(today2b4)).counters && (await wl.dashboard(today2b4)).counters && (await calc.dashboard(today2b4)).counters && true);
  check("het menu van de beheerder blijft 9 items (Dashboard zat er niet in)", nav.itemCount(nav.navFor(caps.admin)) === 9);
}

// De test laat niets achter dat iemand later per vergissing kan bevestigen of gebruiken
// (les draft 1: een achtergebleven wachtende koppeling werd blind bevestigd).
await sec("── opruimen: eigen wachtende koppelingen en open codes");
const nieuwMe = await nieuw.me();
if (nieuwMe.person.length) check("testkoppeling 'Proef Nieuw' afgesloten (afgezet)", isOk(await admin.archivePerson(nieuwMe.person[0].id)));
for (const c of [invAdm, invOa3]) {
  const r = await admin.revokeInvite(c.ok.inviteId);
  if ("err" in r && !r.err.includes("niet meer open")) check(`code #${c.ok.inviteId} intrekken`, false, r.err);
}
check("geen wachtende koppelingen meer", (await admin.listLinks()).every((l) => !("pending" in l.status)));
check("geen open codes van de test meer", (await admin.listInvites(0n, 500n)).every((i) => !("open" in i.state) || i.expiresAt < BigInt(Date.now()) * 1_000_000n));

const s = (Date.now() - t0) / 1000;
console.log(`\n${pass} ✓  ${fail} ✗  (${s.toFixed(1)} s)`);
if (fail) console.log("Rood:\n  " + failures.join("\n  "));
writeFileSync(join(import.meta.dirname, ".laatste-rollen.json"), JSON.stringify({ cid, at: new Date().toISOString(), pass, fail, failures, A: String(A), B: String(B) }, null, 2));
process.exit(fail ? 1 : 0);
