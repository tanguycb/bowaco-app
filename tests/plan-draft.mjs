// Planning per werf (1.3) op een canister die al in gebruik is (een draft): de volledige rollentest vraagt
// een LEGE canister, deze proef niet. Gebruikt de testidentiteiten en werven (P-A, P-B) van tests/rollen.mjs
// en laat enkel testdata achter: het standaardsjabloon op P-A, één taak "Proef dakgoot B" op P-B en een
// gearchiveerd proefblok in de bedrijfskalender (nodig voor tests/lek.mjs). Opnieuw draaien mag.
//   node tests/plan-draft.mjs <canister-id>
import { backend } from "../tools/lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/plan-draft.mjs <canister-id>");
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const rejects = async (p) => { try { await p; return false; } catch { return true; } };
const denied = async (p) => { try { const r = await p; return !!(r && "err" in r && /^Geen toegang/.test(r.err)); } catch { return true; } };
const isOk = (r) => r && typeof r === "object" && "ok" in r;
const errOf = (r) => (r && "err" in r ? r.err : "");
const opt = (v) => (v === undefined ? [] : [v]);
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const day = (d = new Date()) => BigInt(Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000));
const wd = (d) => (Number(d) + 3) % 7;

const [admin, wl, calc, arch, oa2, klant, vc] = await Promise.all(["proef-admin", "proef-werfleider", "proef-calculator", "proef-architect", "proef-oa2", "proef-klant", "proef-vc"].map((n) => backend(n, cid)));
const anon = await backend(null, cid);
const me = await admin.me();
check("versie 1.3 of later op de canister", (/^1b\.|^[2-9][b-z]?\./.test(me.version) || /^1\.[3-9]/.test(me.version)), me.version);
const works = await admin.listWorks();
const A = works.find((w) => w.code === "P-A")?.id;
const B = works.find((w) => w.code === "P-B")?.id;
if (A === undefined || B === undefined) throw new Error("werven P-A/P-B ontbreken: eerst tests/rollen.mjs op deze canister");
const orgDak = (await admin.listOrgs(false)).find((o) => o.name === "Proef Dak NV");
const tIn = (o) => ({ id: opt(o.id), title: o.title ?? "Proeftaak", note: o.note ?? "", kind: { [o.kind ?? "work"]: null }, trade: opt(o.trade), responsibleOrgId: opt(o.org), status: { planned: null }, percent: 0n, start: o.start, workdays: o.workdays ?? 5n, leadDays: 0n, orderDay: [], reason: "proef" });
const byKey = (p, k) => p.tasks.find((t) => t.templateKey[0] === k);

// Sjabloon en rechten
const tpl = (await calc.listTemplates()).find((t) => t.key === "standaardrenovatie");
check("standaardsjabloon aanwezig (voorlopig)", !!tpl && tpl.provisional, `${tpl?.steps.length} stappen`);
check("OA, architect, klant lezen geen sjablonen", (await Promise.all([oa2, arch, klant].map((x) => rejects(x.listTemplates())))).every(Boolean));
let pA = await wl.getPlan(A);
if (pA.tasks.length === 0) {
  const start = day() + 14n;
  const r = await wl.applyTemplate(A, "standaardrenovatie", start, false, pA.version);
  check("werfleider zet het sjabloon op P-A (vanaf over 2 weken)", isOk(r), errOf(r));
  pA = await wl.getPlan(A);
} else {
  check("P-A had al een planning (tweede run)", true);
}
check("P-A: ≥ 27 taken, alles op werkdagen", pA.tasks.length >= 27 && pA.tasks.every((t) => wd(t.start) < 5 && wd(t.end) < 5), `${pA.tasks.length}`);
check("calculator, architect, klant, veiligheid en OA plannen niet", (await Promise.all([calc, arch, klant, vc, oa2].map((x) => denied(x.saveTask(A, tIn({ start: day() }), pA.version))))).every(Boolean));
check("anoniem leest geen planning", await rejects(anon.getPlan(A)));
// Verschuiven met voorvertoning, en terug
// De eerste taak van het sjabloon (losse proeftaken van latere stappen, zoals «Proef verslag 1.6», tellen niet).
const first = pA.tasks.filter((t) => t.templateKey.length === 1).reduce((a, b) => (a.start <= b.start ? a : b));
const pv = await wl.previewPlan(A, { move: { taskId: first.id, start: first.start + 7n, workdays: first.workdays, mode: { follow: null } } });
check("voorvertoning: eerste taak +1 week → de hele keten schuift mee", isOk(pv) && pv.ok.changes.length >= 20, errOf(pv) || `${pv.ok?.changes.length}`);
const mv = await wl.applyPlan(A, { move: { taskId: first.id, start: first.start + 7n, workdays: first.workdays, mode: { follow: null } } }, pA.version, "proef: week later");
check("verschuiven bewaard (planversie +1)", isOk(mv) && mv.ok.version === pA.version + 1n, errOf(mv));
pA = await wl.getPlan(A);
const back = await wl.applyPlan(A, { move: { taskId: first.id, start: first.start, workdays: first.workdays, mode: { follow: null } } }, pA.version, "proef: terug");
check("en terug naar de oude datum", isOk(back), errOf(back));
pA = await wl.getPlan(A);
check("geen waarschuwingen", pA.tasks.every((t) => t.warnings.length === 0), pA.tasks.flatMap((t) => t.warnings).join(" | "));
const vb4 = pA.version;
// "trap" bestaat niet als de huidige rollentest de draft opbouwde (die archiveert de trap): dan een andere latere taak.
const naDak = byKey(pA, "trap") ?? byKey(pA, "tegels") ?? byKey(pA, "schilderen");
const pvD = await wl.previewDependency(A, { fromTaskId: byKey(pA, "dak").id, toTaskId: naDak.id, kind: { finishToStart: null }, lagDays: 2n });
check("voorvertoning van een afhankelijkheid (C2) verandert niets", isOk(pvD) && (await wl.getPlan(A)).version === vb4, errOf(pvD));
const ab = byKey(pA, "afbraak");
const pvF = await wl.previewPlan(A, { move: { taskId: ab.id, start: ab.start, workdays: ab.workdays + 2n, mode: { follow: null } } });
const pvN = await wl.previewPlan(A, { move: { taskId: ab.id, start: ab.start, workdays: ab.workdays + 2n, mode: { asNeeded: null } } });
check("verlengen met 'mee verschuiven' schuift de keten (C1), 'enkel waar nodig' niet meer", isOk(pvF) && isOk(pvN) && pvF.ok.changes.length >= 20 && pvN.ok.changes.length <= pvF.ok.changes.length, `${pvF.ok?.changes.length} / ${pvN.ok?.changes.length}`);
check("verouderde versie geweigerd", errOf(await wl.saveTask(A, tIn({ start: day() }), 0n)).includes("intussen gewijzigd"));
// Werfblokkering (STOP) en bedrijfskalender
const stopFrom = byKey(pA, "ruwbouw")?.start ?? day() + 30n;
const stop = await wl.saveCalendarBlock({ id: [], scope: { work: A }, kind: { stop: null }, from: stopFrom, to: stopFrom + 2n, reason: "Proef STOP" });
check("werfleider zet een STOP op P-A", isOk(stop), errOf(stop));
const pv2 = await wl.previewPlan(A, { reflow: null });
check("herschikken na de STOP: voorvertoning toont verschuivingen", isOk(pv2) && pv2.ok.changes.length > 0, errOf(pv2));
check("STOP weer weg", isOk(await wl.archiveCalendarBlock(stop.ok)));
check("werfleider kan geen bedrijfsblok zetten", await denied(wl.saveCalendarBlock({ id: [], scope: { company: null }, kind: { other: null }, from: day() + 400n, to: day() + 400n, reason: "x" })));
const cb = await admin.saveCalendarBlock({ id: [], scope: { company: null }, kind: { other: null }, from: day() + 400n, to: day() + 400n, reason: "Proefblok (meteen gearchiveerd)" });
check("admin: bedrijfsblok zetten en archiveren", isOk(cb) && isOk(await admin.archiveCalendarBlock(cb.ok)), errOf(cb));
// Uitvoerders en zicht per rol
pA = await wl.getPlan(A);
const dak = byKey(pA, "dak");
if (dak && orgDak && dak.responsibleOrgId.length === 0) {
  check("«Dakwerken» naar Proef Dak NV", isOk(await wl.saveTask(A, tIn({ id: dak.id, title: dak.title, trade: "dak", org: orgDak.id, start: dak.start, workdays: dak.workdays }), pA.version)));
  pA = await wl.getPlan(A);
}
const pOa = await oa2.getPlan(A);
check("OA Dak ziet op P-A enkel zijn eigen taak", pOa.scope === "ownOrg" && pOa.tasks.length >= 1 && pOa.tasks.filter((t) => !t.title.startsWith("Proef verslag")).every((t) => t.title === "Dakwerken" && t.note === "") && pOa.tasks.every((t) => t.note === ""), JSON.stringify(pOa.tasks.map((t) => t.title)));
const pKl = await klant.getPlan(A);
check("klant: samenvatting zonder firma's", pKl.scope === "summary" && pKl.tasks.every((t) => t.responsibleName === "" && t.assignments.length === 0));
check("architect en veiligheid: alles behalve notities", (await arch.getPlan(A)).scope === "external" && (await vc.getPlan(A)).scope === "external");
let pB = await admin.getPlan(B);
if (!pB.tasks.some((t) => t.title === "Proef dakgoot B") && orgDak) {
  check("admin plant «Proef dakgoot B» voor Proef Dak NV", isOk(await admin.saveTask(B, tIn({ title: "Proef dakgoot B", trade: "dak", org: orgDak.id, start: day() + 21n, workdays: 2n }), pB.version)));
  pB = await admin.getPlan(B);
}
const asg = pB.tasks.find((t) => t.title === "Proef dakgoot B")?.assignments[0];
check("OA Dak bevestigt op P-B (eigen firma, met #confirmPlanning)", asg && isOk(await oa2.confirmAssignment(asg.id, true, "")));
check("OA Dak kan op P-A niet bevestigen (geen #confirmPlanning)", (await oa2.getPlan(A)).caps.confirm === false);
const mine = await oa2.orgAssignments([], day() - 7n, day() + 300n);
check("«Mijn taken» van OA Dak: P-A en P-B", mine.some((m) => m.workCode === "P-A") && mine.some((m) => m.workCode === "P-B" && m.canConfirm), JSON.stringify(mine.map((m) => m.workCode)));
check("wijzigingen: werfleider wel, architect niet", (await wl.taskHistory(A, [], 0n, 5n)).length > 0 && (await rejects(arch.taskHistory(A, [], 0n, 5n))));
const log = await admin.auditLog(0n, 200n);
check("auditlog: sjabloon/verschuiven/kalender/bevestigd", ["planning-geschoven", "kalender", "planning-bevestigd"].every((a) => log.some((e) => e.action === a)));
const ex = await admin.exportIntern();
check("export bevat de planning", ex.tasks.length >= 28 && ex.dependencies.length > 0 && ex.taskChanges.length > 0, JSON.stringify({ t: ex.tasks.length, d: ex.dependencies.length }, big));
console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
