// Werfverslag (1.6) op een canister die al in gebruik is (een draft): de volledige rollentest vraagt een LEGE
// canister, deze proef niet. Gebruikt de testidentiteiten en de proefwerf P-A, doet een ECHTE upload van een
// proefbeeld (gekleurde PNG, geen werffoto) en laat enkel testdata achter: de taak «Proef verslag 1.6» op P-A,
// een afgesloten proefverslag + correctie op de eerste werkdag zonder verslag, een afgehandelde proefvertraging en
// het proefvoertuig 1-PRF-016. Opnieuw draaien mag: elke run kiest een andere werkdag (hoogstens 60 dagen terug).
//   node tests/verslag-draft.mjs <canister-id> <project-id>
import { deflateSync } from "node:zlib";
import { backend } from "../tools/lib.mjs";
import { storageClient } from "../tools/opslag.mjs";

const [cid, projectId] = process.argv.slice(2);
if (!cid || !projectId) throw new Error("gebruik: node tests/verslag-draft.mjs <canister-id> <project-id>");
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const rejects = async (p) => { try { await p; return false; } catch { return true; } };
const isOk = (r) => r && typeof r === "object" && "ok" in r;
const errOf = (r) => (r && "err" in r ? r.err : "");
const opt = (v) => (v === undefined ? [] : [v]);
const wd = (d) => (Number(d) + 3) % 7;
const uid = () => crypto.randomUUID();
const done = (r) => r && "done" in r.outcome;
const outErr = (r) => (r && "err" in r.outcome ? r.outcome.err : "");
const sync1 = async (who, op) => (await who.reportSync([op]))[0];

const [admin, wl, calc, arch, oa2, klant, vc] = await Promise.all(["proef-admin", "proef-werfleider", "proef-calculator", "proef-architect", "proef-oa2", "proef-klant", "proef-vc"].map((n) => backend(n, cid)));
const me = await admin.me();
check("versie 1.6 of later op de canister", (/^1b\.|^[2-9][b-z]?\./.test(me.version) || /^1\.([6-9]|1\d)/.test(me.version)), me.version);
const works = await admin.listWorks();
const A = works.find((w) => w.code === "P-A")?.id;
const orgDak = (await admin.listOrgs(false)).find((o) => o.name === "Proef Dak NV");
if (A === undefined || !orgDak) throw new Error("P-A of Proef Dak NV ontbreken: eerst de vorige draftproeven");
const wlId = (await wl.me()).person[0].id;

// De eerste werkdag (terug in de tijd) zonder verslag op P-A.
let D = BigInt(Math.floor(Date.now() / 86_400_000));
for (let i = 0; i < 55; i++) {
  if (wd(D) < 5 && (await admin.getReportDay(A, D)).length === 0) break;
  D -= 1n;
}
console.log(`werkdag ${new Date(Number(D) * 86_400_000).toISOString().slice(0, 10)}`);

// Een taak van die dag voor Proef Dak NV (lid van P-A via zijn firma).
let pA = await wl.getPlan(A);
let task = pA.tasks.find((t) => t.title === "Proef verslag 1.6");
const tIn = (o) => ({ id: opt(o.id), title: "Proef verslag 1.6", note: "", kind: { work: null }, trade: opt("dak"), responsibleOrgId: opt(orgDak.id), status: { planned: null }, percent: 0n, start: D, workdays: 1n, leadDays: 0n, orderDay: [], reason: "proef 1.6" });
const st = await wl.saveTask(A, tIn({ id: task?.id }), pA.version);
check("taak «Proef verslag 1.6» op de werkdag (Proef Dak NV)", isOk(st), errOf(st));
task = (await wl.getPlan(A)).tasks.find((t) => t.title === "Proef verslag 1.6");
const day = await wl.myDay(D, false);
const dA = day.works.find((w) => w.id === A);
check("Vandaag van de werfleider: P-A met de taak en Proef Dak NV uit de planning", !!dA && dA.tasks.some((t) => t.id === task.id) && dA.planned.some((o) => o.orgId === orgDak.id));
check("Vandaag: calculator, OA, architect, klant en veiligheid geweigerd", (await Promise.all([calc, oa2, arch, klant, vc].map((x) => rejects(x.myDay(D, false))))).every(Boolean));

// Echte upload van een proefbeeld (werfleider) — de gsm doet hetzelfde met de verkleinde foto.
function png(w, h, seed) {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = (x * 3 + seed) & 255; raw[o + 1] = (y * 2) & 255; raw[o + 2] = 0x60; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}
const store = await storageClient(cid, projectId, "proef-werfleider");
const bytes = png(160, 120, Date.now() & 255);
const { hash } = await store.putFile(bytes, () => {}, "image/png", "proef-verslag.png");
check("echte upload van het proefbeeld", !!hash, hash);
const ref = new TextEncoder().encode("!caf!" + hash);
const fileIn = { blob: ref, name: "proef-verslag.png", mime: "image/png", size: BigInt(bytes.length) };

// Het verslag: werfleider (toestel 1) en admin (toestel 2) op dezelfde werf en dag.
const K1 = uid();
const ensOp = { opId: uid(), clientKey: K1, op: { ensure: { workId: A, day: D } } };
const e1 = await sync1(wl, ensOp);
check("werfleider opent het verslag", done(e1) && e1.outcome.done.note === "nieuw", JSON.stringify(e1.outcome, (_, v) => (typeof v === "bigint" ? String(v) : v)));
const rep = e1.outcome.done.reportId;
check("zelfde opId nog eens → herhaling, geen tweede verslag", (await sync1(wl, ensOp)).repeated);
const attOp = { opId: uid(), clientKey: K1, op: { attendance: { orgId: [orgDak.id], personId: [], names: "Proefploeg", headcount: 2n, slots: [{ fromMin: 450n, toMin: 720n }, { fromMin: 750n, toMin: 960n }], regie: true, taskId: [task.id], note: "", replaces: [] } } };
const batch = await wl.reportSync([
  attOp,
  attOp, // dubbel in hetzelfde pakje: één keer uitgevoerd
  { opId: uid(), clientKey: K1, op: { workDone: { taskId: [task.id], text: "", percent: [100n] } } },
  { opId: uid(), clientKey: K1, op: { photo: { file: fileIn, thumb: [], taskId: [task.id], caption: "Proefbeeld", takenAt: [] } } },
  { opId: uid(), clientKey: K1, op: { material: { kind: { receipt: null }, text: "Proef: 2 rollen tape", quantity: "2", supplier: "", file: [] } } },
  { opId: uid(), clientKey: K1, op: { issue: { kind: { delay: null }, text: "Proef: vertraging", taskIds: [task.id], delayDays: [1n] } } },
  { opId: uid(), clientKey: K1, op: { trip: { vehicleId: [], plate: "1-PRF-016", driverOutPersonId: [wlId], driverBackPersonId: [wlId], driverOutText: "", driverBackText: "", note: "", outMin: [], backMin: [] } } },
  { opId: uid(), clientKey: K1, op: { text: { field: "summary", value: "Proefverslag stap 1.6 (geen echte werf)" } } },
]);
check("pakje van 8 opdrachten: alles uitgevoerd", batch.every(done), batch.filter((r) => !done(r)).map(outErr).join(" | "));
check("dezelfde opId tweemaal in één pakje = één regel", batch[1].repeated && batch[1].outcome.done.entityId[0] === batch[0].outcome.done.entityId[0]);
const K2 = uid();
const e2 = await sync1(admin, { opId: uid(), clientKey: K2, op: { ensure: { workId: A, day: D } } });
check("admin (tweede toestel) komt in hetzelfde verslag", done(e2) && e2.outcome.done.reportId === rep && e2.outcome.done.note === "samengevoegd");
check("admin voegt de eigen ploeg toe", done(await sync1(admin, { opId: uid(), clientKey: K2, op: { attendance: { orgId: [], personId: [], names: "Eigen ploeg (proef)", headcount: 1n, slots: [{ fromMin: 480n, toMin: 960n }], regie: false, taskId: [], note: "", replaces: [] } } })));
let v = (await admin.getReportDay(A, D))[0];
check("verslag: 2 regels, 1 foto, 1 bon, 1 vertraging, 1 rit; totaal 16 u + 8 u", v.attendances.length === 2 && v.photos.length === 1 && v.materials.length === 1 && v.issues.length === 1 && v.trips.length === 1 && v.totalMinutes === 1440n);
const url = await store.getDirectURL(hash);
check("de foto is terug op te halen via de opslagdienst", (await fetch(url)).status === 200);
const t1 = (await wl.getPlan(A)).tasks.find((t) => t.id === task.id);
// (Bij een tweede run is «klaar op» al ingevuld door de vorige run: het blijft staan, de backend overschrijft het niet;
// elke run kiest een vroegere dag, dus dat einde kan ná D liggen.)
check("taak: 100 % (klaar) via het verslag, met een werkelijk einde", t1.percent === 100n && t1.actualEnd.length === 1);
// Zicht per rol
const va = (await arch.getReportDay(A, D))[0];
check("architect: verslag zonder ritten", va.scope === "reader" && va.trips.length === 0 && va.attendances.length === 2);
const vk = (await klant.getReportDay(A, D))[0];
check("klant: enkel werken en foto's", vk.scope === "summary" && vk.attendances.length === 0 && vk.photos.length === 1 && vk.summary === "");
const vo = (await oa2.getReportDay(A, D))[0];
check("OA Dak: enkel zijn eigen uren", vo.scope === "ownHours" && vo.attendances.length === 1 && vo.attendances[0].orgId[0] === orgDak.id && vo.photos.length === 0);
check("veiligheidscoördinator zonder grant: geweigerd", await rejects(vc.getReportDay(A, D)));
check("OA, calculator, klant schrijven geen verslag", (await Promise.all([oa2, calc, klant].map((x) => rejects(x.reportSync([ensOp]))))).every(Boolean));
// Afsluiten en correctie
check("werfleider sluit af", (await sync1(wl, { opId: uid(), clientKey: K1, op: { finalize: null } })).outcome.done?.note === "afgesloten");
const late = await sync1(admin, { opId: uid(), clientKey: K2, op: { workDone: { taskId: [], text: "Proef: laat ingevuld", percent: [] } } });
check("blok na afsluiten → correctie", done(late) && late.outcome.done.note === "correctie" && late.outcome.done.reportId !== rep);
check("admin sluit de correctie af", (await sync1(admin, { opId: uid(), clientKey: K2, op: { finalize: null } })).outcome.done?.note === "correctie afgesloten");
const d2 = await admin.getReportDay(A, D);
check("origineel gecorrigeerd, correctie afgesloten", d2.length === 2 && "corrected" in d2[0].status && "final" in d2[1].status);
// Problemen en ritten
const iss = (await admin.listIssues([A], true, 20n)).find((i) => i.text === "Proef: vertraging");
check("de proefvertraging staat bij de open problemen", !!iss);
if (iss) check("werfleider handelt ze af", isOk(await wl.handleIssue(iss.id, "proef")));
check("ritten: admin en werfleider zien de proefrit, calculator niet", (await admin.listTrips(D, D)).some((t) => t.plate === "1-PRF-016") && (await wl.listTrips(D, D)).some((t) => t.plate === "1-PRF-016") && (await rejects(calc.listTrips(D, D))));
if (!(await admin.listVehicles(true)).some((x) => x.plate === "1-PRF-016")) check("proefvoertuig 1-PRF-016", isOk(await admin.saveVehicle({ id: [], plate: "1-PRF-016", name: "Proefvoertuig", archived: false })));
check("auditlog zonder opslagverwijzing", (await admin.auditLog(0n, 200n)).every((e) => !e.detail.includes("!caf!")));
console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
