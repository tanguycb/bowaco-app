// Import van de planning (1.5) op een canister die al in gebruik is (een draft): de rollentest vraagt een LEGE
// canister, deze proef niet. Zet uitsluitend GEANONIMISEERDE gegevens (tools/plan-anonimiseer.mjs: «Werf 01»,
// «Taak 03-07», testfirma's TOA01…) op de canister: op een draft komen nooit echte werf-, adres- of firmanamen.
// Draait tools/plan-import.mjs (proef, echt, nog eens) en bewijst rechten, aliassen, rapport en terugdraaien.
//   node tests/import-draft.mjs <canister-id> <plan-anoniem.json> [--zonder-terug]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { backend } from "../tools/lib.mjs";

const cid = process.argv[2];
const planPath = process.argv[3];
if (!cid || !planPath) throw new Error("gebruik: node tests/import-draft.mjs <canister-id> <plan-anoniem.json>");
const plan = JSON.parse(readFileSync(planPath, "utf8"));
if (plan.bron !== "geanonimiseerd") throw new Error("Dit is geen geanonimiseerd importbestand: op een draft komen geen echte gegevens (wacht op het ja van de eigenaar).");
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const rejects = async (p) => { try { await p; return false; } catch { return true; } };
const denied = async (p) => { try { const r = await p; return !!(r && "err" in r && /^Geen toegang/.test(r.err)); } catch { return true; } };
const isOk = (r) => r && typeof r === "object" && "ok" in r;
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const [admin, wl, calc, arch, oa2, klant, vc] = await Promise.all(["proef-admin", "proef-werfleider", "proef-calculator", "proef-architect", "proef-oa2", "proef-klant", "proef-vc"].map((n) => backend(n, cid)));
const anon = await backend(null, cid);
const me = await admin.me();
check("versie 1.5 of later op de canister", /^1\.5/.test(me.version) || /^1\.[6-9]/.test(me.version), me.version);

// Rechten
const blk = { key: "d15-rechten", name: "Rechten", street: "", number: "", zip: "", city: "", vatBp: 600n, decision: { fresh: null }, tasks: [] };
check("import geweigerd voor werfleider, calculator, OA, architect, klant, veiligheid en anoniem", (await Promise.all([wl, calc, oa2, arch, klant, vc, anon].map((x) => denied(x.importPlanning(true, "x", "x", [], blk))))).every(Boolean));
check("batchlijst en terugdraaien enkel admin", (await Promise.all([wl, calc, oa2, arch, klant, vc, anon].map((x) => rejects(x.listImportBatches())))).every(Boolean));

// Testfirma's (met de aliassen TOA01…)
const row = (f) => ({ key: f.code, kind: { subcontractor: null }, name: f.name, kbo: [], vat: [], aliases: [f.code], trades: [], phone: [], email: [], website: [], notes: "Testfirma voor de proefimport (geanonimiseerd)", persons: [] });
const orgsBefore = (await admin.exportIntern()).orgs.length;
for (let i = 0; i < plan.testfirmas.length; i += 40) {
  const r = await admin.importOrgs(false, plan.testfirmas.slice(i, i + 40).map(row));
  if (!isOk(r)) throw new Error(r.err);
}
const orgsAfter = (await admin.exportIntern()).orgs.length;
check("testfirma's TOA01… staan in de OA-database (of waren er al)", orgsAfter >= orgsBefore && (await admin.listOas({ text: ["TOA01"], trade: [], kind: [], includeArchived: false })).length === 1, `${orgsBefore} → ${orgsAfter}`);

const importer = (...a) => { try { return execFileSync("node", [join(import.meta.dirname, "../tools/plan-import.mjs"), "--plan", planPath, "--canister", cid, "--identity", "proef-admin", ...a], { encoding: "utf8" }); } catch (e) { return String(e.stdout ?? "") + String(e.stderr ?? ""); } };
const n = (s, rx) => Number((rx.exec(s) ?? [])[1] ?? NaN);
const worksBefore = (await admin.exportIntern()).works.length;
const r1 = importer();
check("proefronde: tellingen, niets bewaard", r1.includes("PROEFRONDE") && n(r1, /taken nieuw (\d+)/) > 400 && (await admin.exportIntern()).works.length === worksBefore, r1.split("\n").filter((l) => /werven|taken/.test(l)).join(" | "));
const r2 = importer("--echt");
const tasksNew = n(r2, /taken nieuw (\d+)/);
const worksNew = n(r2, /werven nieuw (\d+)/);
const ex = await admin.exportIntern();
check("echt: werven, taken, uitvoerders en afspraken aangemaakt", r2.includes("ECHT BEWAARD") && worksNew > 30 && tasksNew > 400 && ex.works.length === worksBefore + worksNew, r2.split("\n").filter((l) => /werven|taken|uitvoer|afspraken|namen/.test(l)).join(" | "));
check("geen nieuwe firma's door de import (enkel de testfirma's van hierboven)", ex.orgs.length === orgsAfter);
check("de aantallen kloppen met de export (taken met import-batch)", ex.tasks.filter((t) => t.extra.some(([k, v]) => k === "import" && v === plan.batch)).length === tasksNew);
const r3 = importer("--echt");
check("tweede keer: niets nieuw (geen dubbels)", /werven nieuw 0 /.test(r3) && /taken nieuw 0 /.test(r3) && /uitvoerreeksen nieuw 0 /.test(r3) && /afspraken nieuw 0 /.test(r3) && (await admin.exportIntern()).tasks.length === ex.tasks.length, r3.split("\n").filter((l) => /nieuw/.test(l)).join(" | "));
const batches = await admin.listImportBatches();
check("batch staat in de lijst met de juiste aantallen", batches.some((b) => b.id === plan.batch && Number(b.tasks) === tasksNew && Number(b.works) === worksNew && b.rolledBackAt.length === 0));

// Zicht
const imported = ex.works.filter((w) => w.code.startsWith("PL-") && w.name.startsWith("Werf "));
const pw = imported[0];
const gp = await admin.getPlan(pw.id);
check("getPlan van een geïmporteerde werf: taken met start, einde en uitvoerders", gp.tasks.length > 0 && gp.tasks.some((t) => t.assignments.length > 0 || t.workdays > 0));
check("werfleider ziet de planning; OA, klant, architect en veiligheid (geen lid) niet", isOk({ ok: await wl.getPlan(pw.id) }) && (await Promise.all([oa2, klant, arch, vc].map((x) => rejects(x.getPlan(pw.id))))).every(Boolean));
const withAp = ex.appointments.find((a) => a.batchId[0] === plan.batch);
check("afspraken zijn zichtbaar voor de werfleider, niet voor de OA", withAp ? (await wl.listAppointments(withAp.workId)).length > 0 && await rejects(oa2.listAppointments(withAp.workId)) : true);
const firstDay = BigInt(Math.min(...plan.blokken.flatMap((b) => b.tasks.map((t) => t.start))));
const wb = await admin.weekBoard({ from: firstDay - BigInt((Number(firstDay) + 3) % 7) + 7n * 60n, weeks: 12n, offset: 0n, limit: 50n, text: "", trade: [], workId: [], onlyConflicts: false, withIdle: false });
check("weekbord toont de testfirma's op de geïmporteerde werven", wb.rows.some((r) => r.name.startsWith("Test OA")), `${wb.rows.length} rijen, ${wb.conflictTotal} conflicten`);

// Terugdraaien (kleine eigen batch)
if (!process.argv.includes("--zonder-terug")) {
  const D = BigInt(Math.floor(Date.UTC(2028, 0, 3) / 86_400_000));
  const tk = (k, t, w0, w1) => ({ key: k, title: t, note: "", responsible: [], status: { planned: null }, percent: 0n, start: D + BigInt(w0 * 7), workdays: BigInt((w1 - w0 + 1) * 5), order: 1n, runs: [{ key: k + "/a", name: "TOA01", from: D + BigInt(w0 * 7), to: D + BigInt(w1 * 7 + 4), note: "" }], appointments: [], extra: [] });
  const b = { key: "d15-terug", name: "Terugdraaiproef", street: "Teststraat", number: "9", zip: "9000", city: "Teststad", vatBp: 600n, decision: { fresh: null }, tasks: [tk("d15-t1", "Terugtaak een", 0, 1), tk("d15-t2", "Terugtaak twee", 2, 2)] };
  const a1 = await admin.importPlanning(false, "proef-terug", "Terugdraaiproef", [], b);
  check("kleine proefbatch: 1 werf, 2 taken, 2 uitvoerders", isOk(a1) && a1.ok.workCreated === 1n && a1.ok.tasksCreated === 2n && a1.ok.assignmentsCreated === 2n, JSON.stringify(a1, big));
  const a2 = await admin.importPlanning(false, "proef-terug", "Terugdraaiproef", [], b);
  check("dezelfde proefbatch nog eens: niets nieuw", isOk(a2) && a2.ok.workCreated === 0n && a2.ok.tasksCreated === 0n && a2.ok.assignmentsCreated === 0n);
  const t0 = await admin.rollbackImport("proef-terug", true);
  check("terugdraaien, proef: 1 werf, 2 taken, 2 uitvoerders", isOk(t0) && t0.ok.works === 1n && t0.ok.tasks === 2n && t0.ok.assignments === 2n, JSON.stringify(t0, big));
  const t1 = await admin.rollbackImport("proef-terug", false);
  const ex2 = await admin.exportIntern();
  const w = ex2.works.find((x) => x.name === "Terugdraaiproef");
  check("terugdraaien: werf en taken gearchiveerd, niets gewist; de grote batch blijft", isOk(t1) && w.archivedAt.length === 1 && ex2.tasks.filter((x) => x.workId === w.id).every((x) => x.archivedAt.length === 1) && ex2.tasks.filter((x) => x.workId === w.id).length === 2 && ex2.tasks.filter((x) => x.extra.some(([k, v]) => k === "import" && v === plan.batch) && x.archivedAt.length === 0).length === tasksNew);
  const t2 = await admin.rollbackImport("proef-terug", false);
  check("nog eens terugdraaien geweigerd", !isOk(t2));
}
const log = await admin.auditLog(0n, 400n);
check("auditlog: import-planning gelogd, zonder namen of adressen", log.some((e) => e.action === "import-planning") && !log.filter((e) => e.action.startsWith("import-planning")).some((e) => /Teststraat|Test OA/.test(e.detail)));
console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
