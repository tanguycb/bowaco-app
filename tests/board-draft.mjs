// Weekbord per OA (1.4) op een canister die al in gebruik is (een draft): de volledige rollentest vraagt een
// LEGE canister, deze proef niet. Gebruikt de testidentiteiten, de werven P-A/P-B en de proeffirma "Proef Dak
// NV" van de vorige proeven, en laat enkel testdata achter: één taak "Proef dubbel B" op P-B (op de startdag
// van «Dakwerken» op P-A: een dubbele boeking om te bekijken) en een gearchiveerde proefafwezigheid van kantoor
// (nodig voor tests/lek.mjs). Wat de proef zelf aanmaakt aan regels of meldingen van de OA, ruimt ze op.
// Opnieuw draaien mag.
//   node tests/board-draft.mjs <canister-id>
import { backend } from "../tools/lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/board-draft.mjs <canister-id>");
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
const monday = (d) => d - BigInt(wd(d));

const [admin, wl, calc, arch, oa2, klant, vc] = await Promise.all(["proef-admin", "proef-werfleider", "proef-calculator", "proef-architect", "proef-oa2", "proef-klant", "proef-vc"].map((n) => backend(n, cid)));
const anon = await backend(null, cid);
const me = await admin.me();
check("versie 1.4 of later op de canister", (/^1b\.|^[2-9][b-z]?\./.test(me.version) || /^1\.[4-9]/.test(me.version)), me.version);
const works = await admin.listWorks();
const A = works.find((w) => w.code === "P-A")?.id;
const B = works.find((w) => w.code === "P-B")?.id;
const orgDak = (await admin.listOrgs(false)).find((o) => o.name === "Proef Dak NV");
// 2.9: proefwerven van latere stappen (P-WS-, P-UI-, P-OM…) boeken Proef Dak NV ook in de planning; een afgesloten of geannuleerde
// proefwerf telt niet mee voor de weekbordregels (geannuleerde werven tellen sinds 2.9 niet meer mee), dus eerst opruimen.
for (const w of works) if (/^P-(UI|WS|WR|OM|OR)/.test(w.code) && !("cancelled" in w.status)) await admin.setWorkStatus(w.id, { cancelled: null });
if (A === undefined || B === undefined || !orgDak) throw new Error("P-A/P-B of Proef Dak NV ontbreken: eerst de vorige draftproeven");
const bq = (o = {}) => ({ from: o.from ?? day(), weeks: o.weeks ?? 6n, offset: 0n, limit: o.limit ?? 50n, text: o.text ?? "", trade: [], workId: opt(o.workId), onlyConflicts: o.only ?? false, withIdle: o.idle ?? false });
const tIn = (o) => ({ id: opt(o.id), title: o.title, note: "", kind: { work: null }, trade: opt(o.trade), responsibleOrgId: opt(o.org), status: { planned: null }, percent: 0n, start: o.start, workdays: o.workdays ?? 2n, leadDays: 0n, orderDay: [], reason: "proef 1.4" });

// Rechten
check("anoniem, OA, architect, klant en veiligheid zien het weekbord niet", (await Promise.all([anon, oa2, arch, klant, vc].map((x) => rejects(x.weekBoard(bq()))))).every(Boolean));
const b0 = await calc.weekBoard(bq());
check("calculator leest het weekbord (alleen-lezen)", !b0.caps.manageAbsences && !b0.caps.manageRules, `${b0.rows.length} rijen, ${b0.conflictTotal} conflicten`);
check("werfleider: afwezigheden ja, regels nee", await wl.weekBoard(bq()).then((b) => b.caps.manageAbsences && !b.caps.manageRules));
// Een dubbele boeking om te bekijken: Proef Dak NV op P-A («Dakwerken») en P-B op dezelfde dag
const pA = await wl.getPlan(A);
const dak = pA.tasks.find((t) => t.templateKey[0] === "dak");
check("«Dakwerken» op P-A is van Proef Dak NV", dak && dak.responsibleOrgId[0] === orgDak.id, JSON.stringify(dak?.responsibleOrgId, big));
let pB = await admin.getPlan(B);
let dub = pB.tasks.find((t) => t.title === "Proef dubbel B");
if (!dub) {
  check("admin plant «Proef dubbel B» voor Proef Dak NV op de startdag van «Dakwerken»", isOk(await admin.saveTask(B, tIn({ title: "Proef dubbel B", trade: "dak", org: orgDak.id, start: dak.start }), pB.version)));
} else if (dub.start !== dak.start) {
  check("«Proef dubbel B» terug op de startdag van «Dakwerken»", isOk(await admin.saveTask(B, tIn({ id: dub.id, title: dub.title, trade: "dak", org: orgDak.id, start: dak.start }), pB.version)));
} else check("«Proef dubbel B» staat er al (tweede run)", true);
const W = monday(dak.start);
const rules = await admin.boardRules();
check("regels: per dag, hoogstens 1 werf tegelijk (standaard)", rules.unit === "dag" && rules.defaultMax === 1n, JSON.stringify(rules, big));
let b = await admin.weekBoard(bq({ from: W, weeks: 2n }));
let row = b.rows.find((r) => r.orgId === orgDak.id);
check("weekbord: Proef Dak NV dubbel geboekt op P-A en P-B (werflint)", row && row.conflicts.some((c) => c.kind === "dubbel" && c.works.length === 2) && row.cells[0]?.items.filter((i) => i.clash).length === 2, JSON.stringify(row?.conflicts.map((c) => c.text)));
check("Vraagt aandacht: boardConflicts bevat het", (await admin.boardConflicts(W, 2n, 20n)).items.some((c) => c.orgId === orgDak.id));
check("werfpagina P-B: workConflicts bevat het", (await wl.workConflicts(B, W, 2n)).items.some((c) => c.kind === "dubbel"));
check("OA en architect lezen geen conflicten", (await rejects(oa2.workConflicts(B, W, 2n))) && (await rejects(arch.boardConflicts(W, 2n, 5n))));
// Afwezigheid van kantoor: conflict, dan weg (blijft gearchiveerd voor de lektest)
const ab = await wl.saveAbsence({ id: [], orgId: orgDak.id, personId: [], kind: { verlof: null }, from: dak.start, to: dak.start + 1n, note: "proef draft" });
check("werfleider zet Proef Dak NV op verlof", isOk(ab), errOf(ab));
row = (await admin.weekBoard(bq({ from: W, weeks: 2n }))).rows.find((r) => r.orgId === orgDak.id);
check("conflict 'afwezig'", row.conflicts.some((c) => c.kind === "afwezig"), JSON.stringify(row.conflicts.map((c) => c.text)));
check("OA Dak ziet zijn afwezigheid, maar wijzigt die van kantoor niet", (await oa2.listAbsences([orgDak.id], W - 7n, W + 30n)).some((a) => a.id === ab.ok) && (await rejects(oa2.archiveAbsence(ab.ok))));
const my = await oa2.myBoard(W, 2n);
check("Mijn week van OA Dak: zijn firma, zijn werven, zijn conflicten", my.row.length === 1 && my.row[0].orgId === orgDak.id && my.row[0].conflicts.length >= 1 && my.row[0].cells.every((c) => c.items.every((i) => !i.hidden)));
check("architect en klant: lege Mijn week", (await arch.myBoard(W, 2n)).row.length === 0 && (await klant.myBoard(W, 2n)).row.length === 0);
// OA meldt zelf (en haalt het weer weg)
const own = await oa2.saveAbsence({ id: [], orgId: orgDak.id, personId: [], kind: { ziekte: null }, from: W + 70n, to: W + 70n, note: "" });
check("OA Dak meldt zelf een afwezigheid", isOk(own), errOf(own));
check("…en haalt ze zelf weer weg", isOk(own) && isOk(await oa2.archiveAbsence(own.ok)));
check("calculator geeft geen afwezigheid in", await denied(calc.saveAbsence({ id: [], orgId: orgDak.id, personId: [], kind: { verlof: null }, from: W, to: W, note: "" })));
check("kantoor haalt het verlof weg", isOk(await wl.archiveAbsence(ab.ok)));
check("geschiedenis: nieuw en weg", await oa2.absenceHistory(orgDak.id, 0n, 10n).then((h) => h.some((x) => x.what === "nieuw") && h.some((x) => x.what === "weg")));
// Regels: een regel voor de firma lost het dubbel op, en weg
check("werfleider wijzigt geen regels", await denied(wl.setCapacity(`org:${orgDak.id}`, [2n], "")));
check("admin: Proef Dak NV mag 2 werven tegelijk → geen dubbel", isOk(await admin.setCapacity(`org:${orgDak.id}`, [2n], "proef")) && !(await admin.weekBoard(bq({ from: W, weeks: 2n }))).rows.find((r) => r.orgId === orgDak.id).conflicts.some((c) => c.kind === "dubbel"));
check("regel weer weg → weer dubbel", isOk(await admin.setCapacity(`org:${orgDak.id}`, [], "")) && (await admin.weekBoard(bq({ from: W, weeks: 2n }))).rows.find((r) => r.orgId === orgDak.id).conflicts.some((c) => c.kind === "dubbel"));
// Grenzen en meting
check("venster van 13 weken geweigerd", await rejects(admin.weekBoard(bq({ weeks: 13n }))));
const big12 = await admin.weekBoard(bq({ weeks: 12n, idle: true }));
check("12 weken, alle firma's: begrensd en gemeten", big12.rows.length <= 50 && big12.instructions > 0n, `${big12.total} firma's, ${(Number(big12.instructions) / 1e6).toFixed(1)} M instructies`);
const log = await admin.auditLog(0n, 100n);
check("auditlog: afwezigheid en weekbord-regel, zonder notitie", log.some((e) => e.action === "afwezigheid") && log.some((e) => e.action === "weekbord-regel") && !log.some((e) => e.detail.includes("proef draft")));
const ex = await admin.exportIntern();
check("export bevat de afwezigheden en hun geschiedenis", ex.absences.length >= 2 && ex.absenceChanges.length >= 4);
console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
