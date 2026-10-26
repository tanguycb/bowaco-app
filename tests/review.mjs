// Securityreview 0.7/1.9: de aanvallen die de review opleverde, als vaste controle na tests/rollen.mjs en tests/lek.mjs
// op dezelfde canister (gebruikt diens werven P-A/P-B, firma's en testidentiteiten). Elke regel hier hoort bij een
// bevinding in BOWACO_securityreview_0.7_1.9.md (nummer tussen haakjes). Laat niets bruikbaars achter.
//   lokaal:  ICP_HOST=http://localhost:8041 node tests/review.mjs <canister-id>
//   draft:   node tests/review.mjs <canister-id>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { backend, freshBackend, identity, KEYDIR, nepmail, ok, setCanisterEnv } from "../tools/lib.mjs";
import { M, batchArgs, ensureProofClientAddress, expectRaw, fromRead, sameTotals, saveAll } from "./offerte-lib.mjs";
import { proefWerf } from "./opmeting-lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/review.mjs <canister-id>");
const host = process.env.ICP_HOST || "https://icp-api.io";
const local = host.includes("localhost") || host.includes("127.0.0.1");
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const rejects = async (p) => { try { await p; return false; } catch { return true; } };
const denied = async (p) => { try { const r = await p; return !!(r && typeof r === "object" && "err" in r && /^Geen toegang/.test(r.err)); } catch { return true; } };
const isOk = (r) => r && typeof r === "object" && "ok" in r;
const errOf = (r) => (r && typeof r === "object" && "err" in r ? r.err : "");
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const uid = () => crypto.randomUUID();
const today = BigInt(Math.floor(Date.now() / 86_400_000));

const [admin, wl, calc, arch, oa2, klant, vc, robot] = await Promise.all(["proef-admin", "proef-werfleider", "proef-calculator", "proef-architect", "proef-oa2", "proef-klant", "proef-vc", "robot-test"].map((n) => backend(n, cid)));
const me = await admin.me();
check("versie 1.9 of later op de canister", /^1\.(9|1\d)|^1b\.|^[2-9]\./.test(me.version), me.version);
const works = await admin.listWorks();
const A = works.find((w) => w.code === "P-A")?.id;
const B = works.find((w) => w.code === "P-B")?.id;
if (A === undefined || B === undefined) throw new Error("P-A/P-B ontbreken: eerst tests/rollen.mjs op deze canister");
const orgs = await admin.listOrgs(false);
const orgDak = orgs.find((o) => o.name === "Proef Dak NV");
const orgKlant = orgs.find((o) => o.name === "Familie Proef");
const oa2Id = (await oa2.me()).person[0].id;
const personOrg = new Map((await admin.listPersons(true)).map((p) => [p.id, p.orgId[0]]));

// ── (B1) Externen zien het team niet, enkel kantoor en de eigen firma ──
const teamAdmin = await admin.listMembers(A);
const names = (ms) => ms.map((m) => `${Object.keys(m.role)[0]}:${m.name}`);
for (const [who, x] of [["OA", oa2], ["architect", arch], ["klant", klant], ["veiligheidscoördinator", vc]]) {
  const ms = await x.listMembers(A);
  const mine = (await x.me()).person[0];
  const myOrg = mine.orgId[0];
  // Vreemd = een persoon met een externe rol die niet ikzelf ben en niet van mijn firma is.
  const strange = ms.filter((m) => !["admin", "werfleider", "calculator"].includes(Object.keys(m.role)[0]) && m.personId[0] !== undefined && m.personId[0] !== mine.id && personOrg.get(m.personId[0]) !== myOrg);
  const leakOther = ms.some((m) => !["admin", "werfleider", "calculator"].includes(Object.keys(m.role)[0]) && (m.orgId[0] !== undefined ? m.orgId[0] !== myOrg : false));
  const leakClient = orgKlant && ms.some((m) => m.orgId[0] === orgKlant.id || m.name === "Familie Proef");
  check(`(B1) ${who} ziet van het team van P-A enkel kantoor en de eigen firma`, ms.length < teamAdmin.length && !leakOther && (who === "klant" || !leakClient), JSON.stringify(names(ms)));
  const persons = ms.filter((m) => m.personId[0] !== undefined);
  check(`(B1) ${who}: geen vreemde personen in de lijst`, strange.length === 0 || strange.every((m) => ["admin", "werfleider", "calculator"].includes(Object.keys(m.role)[0])), JSON.stringify(names(strange)));
}
check("(B1) kantoor (werfleider) ziet het hele team", (await wl.listMembers(A)).length === teamAdmin.length);

// ── (B2) Analytische code en btw-grond enkel intern ──
const wAdmin = await admin.getWork(A);
await admin.updateWork(A, { code: wAdmin.code, name: wAdmin.name, address: wAdmin.address, parentId: wAdmin.parentId, clientOrgId: wAdmin.clientOrgId, architectOrgId: wAdmin.architectOrgId, leaderPersonId: wAdmin.leaderPersonId, vatBp: wAdmin.vatBp, plannedStart: wAdmin.plannedStart, plannedEnd: wAdmin.plannedEnd, analyticCode: ["AN-REVIEW"], vatNote: "woning ouder dan 10 jaar (review)" });
const wOa = await oa2.getWork(A);
check("(B2) OA ziet geen analytische code en geen btw-grond", wOa.analyticCode.length === 0 && wOa.vatNote === "", JSON.stringify([wOa.analyticCode, wOa.vatNote]));
check("(B2) werfleider ziet ze wel", (await wl.getWork(A)).analyticCode[0] === "AN-REVIEW");
await admin.updateWork(A, { code: wAdmin.code, name: wAdmin.name, address: wAdmin.address, parentId: wAdmin.parentId, clientOrgId: wAdmin.clientOrgId, architectOrgId: wAdmin.architectOrgId, leaderPersonId: wAdmin.leaderPersonId, vatBp: wAdmin.vatBp, plannedStart: wAdmin.plannedStart, plannedEnd: wAdmin.plannedEnd, analyticCode: wAdmin.analyticCode, vatNote: wAdmin.vatNote });

// ── (B3) Losse bestanden: een externe ziet enkel wat hijzelf of zijn firma oplaadde ──
const ref = (h) => new TextEncoder().encode("!caf!sha256:" + h.repeat(64));
const fWl = await wl.addFile("review-kantoor.jpg", "image/jpeg", 1000n, ref("a"), [A], false);
const fOa = await oa2.addFile("review-oa.jpg", "image/jpeg", 1000n, ref("b"), [A], false);
check("(B3) werfleider en OA laden elk een los bestand op bij P-A", isOk(fWl) && isOk(fOa), errOf(fWl) + errOf(fOa));
const oaFiles = await oa2.listFiles([A]);
check("(B3) OA ziet zijn eigen bestand, niet dat van kantoor", oaFiles.some((f) => f.id === fOa.ok) && !oaFiles.some((f) => f.id === fWl.ok), JSON.stringify(oaFiles.map((f) => f.name)));
check("(B3) architect ziet geen van beide", !(await arch.listFiles([A])).some((f) => f.id === fWl.ok || f.id === fOa.ok));
const wlFiles = await wl.listFiles([A]);
check("(B3) kantoor ziet allebei", wlFiles.some((f) => f.id === fWl.ok) && wlFiles.some((f) => f.id === fOa.ok));
check("(B3) opruimen: beide bestanden gearchiveerd", isOk(await wl.archiveFile(fWl.ok)) && isOk(await oa2.archiveFile(fOa.ok)));

// ── (B4) Een robotprincipal wordt nooit een persoon (R28) ──
const inv = await admin.invitePerson({ name: "Proef Robotpersoon (review)", roles: [{ onderaannemer: null }], orgId: [orgDak.id], shortCode: [], lang: [], phone: [], workIds: [], validDays: 1n, tag: "review" });
check("(B4) uitnodiging voor de robotproef gemaakt", isOk(inv), errOf(inv));
check("(B4) de robot kan de code niet inwisselen", await denied(robot.redeemCode(inv.ok.code)));
check("(B4) de robot kan de opstartcode niet claimen", await denied(robot.claimBootstrap("BOW-0000-0000-0000-0000", "x")));
check("(B4) opruimen: code ingetrokken en persoon afgezet", isOk(await admin.revokeInvite(inv.ok.inviteId)) && isOk(await admin.archivePerson(inv.ok.personId)));

// ── (B5) Grenzen op invoer ──
const addr = (street) => ({ street, number: "1", zip: "8670", city: "Koksijde", country: "BE" });
check("(B5) werf met een straatnaam van 500 tekens geweigerd", errOf(await admin.createWork({ code: "RV-LANG", name: "Review", address: addr("x".repeat(500)), parentId: [], clientOrgId: [], architectOrgId: [], leaderPersonId: [], vatBp: 600n })).includes("Adres"));
check("(B5) firma met een te lang adres geweigerd", errOf(await admin.createOrg({ kind: { subcontractor: null }, name: "Review Lang BV", kbo: [], vat: [], aliases: [], trades: [], address: [addr("x".repeat(500))], notes: "" })).includes("Adres"));
check("(B5) klantcontact met een te lang adres geweigerd", errOf(await admin.setOrgConfidential(orgKlant.id, [{ name: "x", phone: [], email: [], address: [addr("x".repeat(500))] }], "")).includes("Adres"));
check("(B5) 501 meldingen in één keer gelezen zetten: geweigerd", await rejects(admin.markNotificationsRead(Array.from({ length: 501 }, (_, i) => BigInt(i + 1)))));
check("(B5) lidmaatschap met een recht dat niet bij de rol past: geweigerd", errOf(await admin.addMembership(B, [], [orgDak.id], { onderaannemer: null }, [{ readSellPrices: null }])).includes("past niet"));
const impBlock = { key: "review-extra", name: "Review", street: "", number: "", zip: "", city: "", vatBp: 600n, decision: { fresh: null }, tasks: [{ key: "review-t", title: "Taak", note: "", responsible: [], status: { planned: null }, percent: 0n, start: 20_000n, workdays: 1n, order: 1n, runs: [], appointments: [], extra: Array.from({ length: 30 }, (_, i) => [`k${i}`, "v"]) }] };
check("(B5) import met 30 extra velden op een taak: geweigerd (proefronde)", errOf(await admin.importPlanning(true, "review", "Review", [], impBlock)).includes("extra"));

// ── (B6) Geen id-orakel voor externen ──
check("(B6) OA: onbekend lidmaatschap beëindigen = 'Geen toegang'", await denied(oa2.endMembership(999_999n)));
check("(B6) OA: onbekend bestand archiveren = 'Geen toegang'", await denied(oa2.archiveFile(999_999n)));

// ── (B7) Reden van een STOP op een werf: niet voor externen ──
const stop = await wl.saveCalendarBlock({ id: [], scope: { work: A }, kind: { stop: null }, from: today + 700n, to: today + 701n, reason: "wacht op betaling klant (review)" });
check("(B7) werfleider zet een STOP met een gevoelige reden", isOk(stop), errOf(stop));
const blkK = (await klant.getPlan(A)).blocks.find((b) => b.id === stop.ok);
const blkO = (await oa2.listCalendarBlocks([A])).find((b) => b.id === stop.ok);
const blkW = (await wl.getPlan(A)).blocks.find((b) => b.id === stop.ok);
check("(B7) klant en OA zien de periode, niet de reden of wie", !!blkK && blkK.reason === "" && blkK.createdByName === "" && !!blkO && blkO.reason === "", JSON.stringify([blkK?.reason, blkO?.reason]));
check("(B7) werfleider ziet de reden", !!blkW && blkW.reason.includes("betaling"));
check("(B7) opruimen: STOP weg", isOk(await wl.archiveCalendarBlock(stop.ok)));

// ── (B8) Offline wachtrij: een opId van iemand anders herhalen, en een afgezet toestel ──
const K = uid();
const op1 = { opId: uid(), clientKey: K, op: { ensure: { workId: A, day: today } } };
const r1 = (await wl.reportSync([op1]))[0];
check("(B8) werfleider opent het verslag van vandaag", "done" in r1.outcome, JSON.stringify(r1, big));
const r2 = (await admin.reportSync([op1]))[0];
check("(B8) dezelfde opId door iemand anders: geweigerd (geen herhaling, geen dubbel)", "err" in r2.outcome && /iemand anders/.test(r2.outcome.err), JSON.stringify(r2, big));

// ── (B9) Herstelpoort: op een gevulde canister voor niemand, ook niet met de juiste (test)opstartcode ──
const codeFile = join(KEYDIR, "test-opstartcode.txt");
const testCode = local ? readFileSync(codeFile, "utf8").trim() : "BOW-0000-0000-0000-0000";
check("(B9) herstel begint niet op een gevulde canister (admin, juiste code lokaal)", await denied(admin.restoreBegin(testCode)));
check("(B9) herstel: stuk en afsluiten zonder lopend herstel geweigerd", (await denied(admin.restoreChunk(testCode, { counters: [] }))) && (await denied(admin.restoreFinish(testCode))));
check("(B9) herstel: anoniem geweigerd", await rejects((await backend(null, cid)).restoreBegin(testCode)));
check("(B9) herstel: een vreemde geweigerd", await denied((await freshBackend(cid)).restoreBegin(testCode)));

// ── (B10) Export bevat wat een herstel nodig heeft ──
const ex = await admin.exportIntern();
check("(B10) export: tellers, keuzelijsten, vlaggen, planversies, verslagsleutels, opdrachten, meldingen", Array.isArray(ex.counters) && ex.counters.length > 0 && Array.isArray(ex.lookups) && Array.isArray(ex.values) && Array.isArray(ex.planVersions) && Array.isArray(ex.reportKeys) && Array.isArray(ex.ops) && Array.isArray(ex.notifications));
check("(B10) export: bestanden dragen archivedAt, lidmaatschappen endedBy", ex.files.every((f) => "archivedAt" in f) && ex.memberships.every((m) => "endedBy" in m));
// (B12) Export in stukken (O-11): dezelfde inhoud als exportIntern, pagina per pagina; vertrouwelijke stukken enkel met dat recht.
const page1 = await admin.exportChunk("tasks", 0n, 2n);
const page2 = await admin.exportChunk("tasks", 2n, 2n);
check("(B12) exportChunk geeft dezelfde taken als exportIntern, in stukken", isOk(page1) && isOk(page2) && JSON.stringify([...page1.ok.tasks, ...page2.ok.tasks], big) === JSON.stringify(ex.tasks.slice(0, 4), big), errOf(page1));
check("(B12) exportChunk: onbekende collectie geweigerd, werfleider geweigerd", "err" in (await admin.exportChunk("bestaat-niet", 0n, 1n)) && (await denied(wl.exportChunk("tasks", 0n, 1n))));

// ── (C) Rollentest met echte II (24-10, verslag II-test): de punten als vaste controle ──
// (C1) De fototeller in de lijst = wat de rol in de fiche ziet; enkel werkfoto's tellen (geen bonfoto's).
const reps = (await admin.listReports(A, 0n, 6n)).filter((r) => r.photos > 0n);
check("(C1) er is een verslag met een werkfoto op P-A", reps.length > 0);
for (const [who, x] of [["klant", klant], ["architect", arch], ["admin", admin]]) {
  let same = true;
  const seen = [];
  for (const r of reps) {
    const sum = (await x.listReports(A, 0n, 50n)).find((y) => y.id === r.id);
    const full = await x.getReport(r.id);
    seen.push(`${r.id}:${sum?.photos}/${full.photos.length}`);
    if (!sum || Number(sum.photos) !== full.photos.length) same = false;
  }
  check(`(C1) ${who}: teller "n foto's" = foto's in de fiche`, same, seen.join(" "));
}
const fAdmin = await admin.getReport(reps[0].id);
check("(C1) een bonfoto telt niet als foto (teller = werkfoto's)", Number(reps[0].photos) === fAdmin.photos.length, `${reps[0].photos} vs ${fAdmin.photos.length} werkfoto's, ${fAdmin.materials.filter((m) => m.hasFile).length} bon(nen)`);
// (C7) De klant krijgt geen aanwezigen (de lijst toont dan geen "0 personen"; de frontend laat de teller weg bij 0).
const kSum = await klant.listReports(A, 0n, 6n);
check("(C7) klant: geen aantallen, uren of auteur in de verslagenlijst", kSum.every((r) => r.headcount === 0n && r.attendances === 0n && r.totalMinutes === 0n && r.authorName === ""));
// (C2) Dezelfde bevestiging nog eens voegt niets toe (de fiche toonde "bevestigd · Proef OA Dak" acht keer).
// Een uurregel zoeken die een OA (Dak of GILS) mag bevestigen: in een afgesloten verslag op P-A of P-B (de dag uit
// het verslag zelf, want lokaal verzet de rollentest de klok).
const oa1 = await backend("proef-oa", cid);
let hl = null;
let hx = null;
let restoreGrants = async () => {};
// Zonder het recht "uren bevestigen" van Proef Dak op P-A (de rollentest nam het weg; ook op de draft kan het uit
// staan) is geen enkele regel te bevestigen: even aan, achteraf hersteld. Zo wordt een vorig proefverslag hergebruikt.
const mDak = (await admin.listMembers(A)).find((m) => m.orgId[0] === orgDak.id && "onderaannemer" in m.role);
if (mDak && !mDak.grants.some((g) => "confirmHours" in g)) {
  await admin.setMemberGrants(mDak.id, [...mDak.grants, { confirmHours: null }]);
  restoreGrants = () => admin.setMemberGrants(mDak.id, mDak.grants);
}
for (const w of [A, B]) {
  for (const r of await admin.listReports(w, 0n, 100n)) {
    if (hl || r.attendances === 0n || "draft" in r.status) continue;
    for (const x of [oa2, oa1]) {
      const l = (await x.myHours(r.day > 0n ? r.day - 1n : 0n, r.day + 1n).catch(() => [])).find((y) => y.reportId === r.id && y.canConfirm);
      if (l) { hl = l; hx = x; break; }
    }
  }
}
if (!hl) {
  // Nog geen (lokaal): de werfleider schrijft één afgesloten verslag met een regel van Proef Dak NV op een vrije
  // werkdag van P-A (de dag volgt de klok van de canister: het jongste verslag), daarna bevestigt Proef Dak.
  const recent = await admin.listReports(A, 0n, 1n);
  let D = recent.length ? (await admin.getReport(recent[0].id)).createdAt / 86_400_000_000_000n : today;
  for (let i = 0; i < 40 && (((Number(D) + 3) % 7) >= 5 || (await admin.getReportDay(A, D)).length > 0); i++) D -= 1n;
  const K2 = uid();
  const res = await wl.reportSync([
    { opId: uid(), clientKey: K2, op: { ensure: { workId: A, day: D } } },
    { opId: uid(), clientKey: K2, op: { attendance: { orgId: [orgDak.id], personId: [], names: "Review", headcount: 1n, slots: [{ fromMin: 480n, toMin: 720n }], regie: false, taskId: [], note: "", replaces: [] } } },
    { opId: uid(), clientKey: K2, op: { finalize: null } },
  ]);
  const rid = res[0] && "done" in res[0].outcome ? res[0].outcome.done.reportId : null;
  if (rid !== null) hl = (await oa2.myHours(D > 0n ? D - 1n : 0n, D + 1n).catch(() => [])).find((y) => y.reportId === rid && y.canConfirm) ?? null;
  hx = oa2;
  check("(C2) proefverslag met een uurregel van Proef Dak NV (eerste keer)", !!hl, JSON.stringify(res.map((r) => r.outcome), big));
}
if (hl) {
  const n0 = hl.confirmations.length;
  const last = hl.confirmations[n0 - 1];
  const ok1 = await hx.confirmHours(hl.attendanceId, last ? last.ok : true, last ? last.remark : "");
  const ok2 = await hx.confirmHours(hl.attendanceId, last ? last.ok : true, last ? last.remark : "");
  const n1 = (await hx.myHours(hl.day > 0n ? hl.day - 1n : 0n, hl.day + 1n)).find((l) => l.attendanceId === hl.attendanceId).confirmations.length;
  check("(C2) dezelfde bevestiging twee keer: hoogstens één erbij", isOk(ok1) && isOk(ok2) && (last ? n1 === n0 : n1 === 1), `${n0} → ${n1}`);
} else check("(C2) een OA heeft een uurregel om te bevestigen", false, "geen afgesloten verslag met uren van een proef-OA op P-A/P-B");
await restoreGrants();
// (C4) Werven bij een interne uitnodiging: werfleider = werfleider van die werf; calculator/beheerder = duidelijke weigering.
const invWl = await admin.invitePerson({ name: "Proef WL met werf (review)", roles: [{ werfleider: null }], orgId: [], shortCode: [], lang: [], phone: [], workIds: [B], validDays: 1n, tag: "review" });
check("(C4) werfleider uitnodigen met werf P-B: lukt", isOk(invWl), errOf(invWl));
const mWl = isOk(invWl) ? (await admin.listMembers(B)).filter((m) => m.personId[0] === invWl.ok.personId && "werfleider" in m.role) : [];
check("(C4) … en is meteen werfleider-lid van P-B (niet stil genegeerd)", mWl.length === 1, JSON.stringify(mWl.map((m) => m.id), big));
const invCalc = await admin.invitePerson({ name: "Proef calculator met werf (review)", roles: [{ calculator: null }], orgId: [], shortCode: [], lang: [], phone: [], workIds: [B], validDays: 1n, tag: "review" });
check("(C4) calculator met een werf: geweigerd met uitleg", /Werven gelden enkel/.test(errOf(invCalc)), errOf(invCalc));
check("(C4) werfleider (geen admin) kan geen werfleider uitnodigen, ook niet met werf", await denied(wl.invitePerson({ name: "x", roles: [{ werfleider: null }], orgId: [], shortCode: [], lang: [], phone: [], workIds: [A], validDays: 1n, tag: "" })));
if (isOk(invWl)) check("(C4) opruimen: code ingetrokken, persoon afgezet, lidmaatschap beëindigd", isOk(await admin.revokeInvite(invWl.ok.inviteId)) && isOk(await admin.archivePerson(invWl.ok.personId)) && !(await admin.listMembers(B)).some((m) => m.personId[0] === invWl.ok.personId));
// (C5) Het versielabel volgt de draft (tools/push.sh zet het); lokaal staat er "-dev".
if (local) check("(C5) lokaal: versielabel uit de broncode (-dev)", /-dev$/.test(me.version), me.version);
else {
  const nums = (await import("node:fs")).readdirSync(KEYDIR).filter((f) => /^preview-\d+\.json$/.test(f)).map((f) => JSON.parse(readFileSync(join(KEYDIR, f), "utf8"))?.data?.draftVersion ?? 0);
  const n = Math.max(0, ...nums);
  check(`(C5) draft: versielabel noemt draft ${n}`, me.version.includes(`-draft${n} `), me.version);
}

// ── (D1–D6) mail-caffeine: de app verstuurt zelf via de maildienst van Caffeine ──
{
  const ps = await admin.postSettings();
  const draftCid = cid === "5vwqk-vqaaa-aaaab-aadwq-cai";
  check("(D1) de testmodus staat aan; de canister weet of hij de draft is", ps.testMode && ps.draft === draftCid, JSON.stringify({ testMode: ps.testMode, draft: ps.draft }));
  if (ps.draft) {
    check("(D1) op de draft kan de testmodus NIET uit (ook niet door de beheerder)", errOf(await admin.setMailTest(false, "")).includes("Op de draft blijft de testmodus aan") && (await admin.postSettings()).testMode);
  } else {
    check("(D1) buiten de draft: testmodus uit met een testadres geweigerd (adres hoort bij de testmodus)", "err" in (await admin.setMailTest(false, "x@proef.invalid")));
  }
  const ext = [["werfleider", wl], ["calculator", calc], ["architect", arch], ["OA", oa2], ["klant", klant], ["veiligheidscoördinator", vc], ["robot", robot]];
  for (const [who, x] of ext) {
    const all = await Promise.all([denied(x.setMailTest(true, "")), denied(x.setPostSettings({ weekmail: true, reminders: true, day: 4n, hour: 14n, reminderDay: 2n, appUrl: "", contact: [] })), denied(x.mailPreview("proef", [], 0n)), denied(x.previewMail("proef", [], 0n)), denied(x.sendMailNow()), denied(x.listMailLog(0n, 1n)), denied(x.setOrgMail(orgDak.id, true)), denied(x.setOrgMailLang(orgDak.id, "fr")), denied(x.queueTestMail("x@proef.invalid"))]);
    check(`(D2) ${who}: postbode aan/uit, testmodus, voorbeeld, versturen, logboek, taal: geweigerd`, all.every(Boolean), JSON.stringify(all));
  }
  check("(D2) anoniem: testmodus en versturen geweigerd", (await denied((await backend(null, cid)).setMailTest(false, ""))) && (await denied((await backend(null, cid)).sendMailNow())));
  check("(D3) robot met de soort 'mail' kan niet meer bestaan; de robot leaset geen mail", errOf(await admin.addRobot(identity("robot-review-mail").getPrincipal(), "Mail?", ["mail"])).includes("Onbekende soort") && (await robot.leaseJobs(10n)).every((j) => !["weekplanning", "herinnering-planning", "herinnering-uren", "proef"].includes(j.kind)));
  // (D4) Geen mail naar een afgemelde firma (voorbeeld zegt het; klaarzetten = 0)
  const nextMon = (() => { const d = today; return d + BigInt(7 - ((Number(d) + 3) % 7)); })();
  const optedBefore = ps.optedOut.some((o) => o === orgDak.id);
  await admin.setOrgMail(orgDak.id, false);
  const pvOff = await admin.mailPreview("weekplanning", [orgDak.id], nextMon);
  const qOff = await admin.queueWeekMails(nextMon + 70n, [orgDak.id]);
  check("(D4) afgemelde firma: voorbeeld 'ontvangt geen mails', klaarzetten 0", (errOf(pvOff).includes("geen mails") || errOf(pvOff).includes("geen e-mailadres") || errOf(pvOff).includes("niets gepland")) && isOk(qOff) && qOff.ok === 0n, errOf(pvOff));
  if (!optedBefore) await admin.setOrgMail(orgDak.id, true);
  // (D5) Geen adressen in het logboek en de auditlog
  const log = await admin.listMailLog(0n, 500n);
  check("(D5) logboek zonder e-mailadres (n = " + log.length + ")", !JSON.stringify(log, big).includes("@"));
  check("(D5) auditlog: post-*/postbode-* zonder e-mailadres", (await admin.auditLog(0n, 500n)).filter((e) => e.action.startsWith("post")).every((e) => !e.detail.includes("@")));
  // (D6) Echte firma's (alles wat niet "Proef …" heet, o.a. de 13 met KBO van E-0): op de draft kan geen mail naar hen
  // vertrekken. Elk voorbeeld is "geen mail" of gaat in de testmodus enkel naar het testadres.
  const real = (await admin.listOas({ text: [], trade: [], kind: [], includeArchived: false })).filter((o) => o.org.kind && "subcontractor" in o.org.kind && !o.org.name.startsWith("Proef"));
  let toReal = 0;
  for (const o of real) {
    const r = await admin.mailPreview("weekplanning", [o.org.id], nextMon);
    if (isOk(r) && !r.ok.deliver.startsWith("testmodus")) toReal++;
  }
  check(`(D6) ${real.length} echte/geanonimiseerde firma's: geen enkele mail naar hun eigen adres (testmodus of geen mail)`, toReal === 0, String(toReal));
}

// ── (D7–D13) securityreview 1b.5: livecanister-lijst (M2), foutclassificatie van de maildienst (M1), cycles (G6),
//    annuleren bij de maildienst (L2), taaktitels op een vergunning (L1) ──
{
  const ps = await admin.postSettings();
  if (local) {
    check("(D7) testbouw: deze canister telt als live (Config.mailLiveAnyCanister via tests/lokaal.sh), dus de testmodus kan uit", ps.liveMail === true);
  } else {
    check("(D7) geen livecanister (Config.mailLiveBackends): liveMail = false en de testmodus kan niet uit, met de reden", ps.liveMail === false && /livecanister|Op de draft/.test(errOf(await admin.setMailTest(false, ""))));
  }
  check("(D12) de beheerder ziet de cycles van de app (G6)", ps.cyclesBalance > 0n, String(ps.cyclesBalance));
  // (D14 = L3) Een e-mailadres met witruimte, stuurtekens of kopstructuur wordt overal geweigerd (testadres, firma, kantoor).
  const bad = ["a@b.c\n", "a@b.c;x@y.z", "\"a\"@b.c", "a@b.c,d@e.f", "a<b>@c.d"];
  const badAll = await Promise.all(bad.flatMap((e) => [admin.setMailTest(true, e), admin.saveOrgContact(orgDak.id, { phone: [], email: [e], website: [], contactNote: "" }), admin.setPostSettings({ weekmail: false, reminders: false, day: 4n, hour: 14n, reminderDay: 2n, appUrl: "", contact: [e] })]));
  check("(D14) e-mailadres met regeleinde, ; , aanhalingstekens of < >: geweigerd als testadres, firma-adres en kantooradres", badAll.every((r) => "err" in r && /E-mailadres klopt niet|klopt niet/.test(r.err)), JSON.stringify(badAll.filter((r) => !("err" in r)), big).slice(0, 200));
  // (D13 = L1) Een externe ziet op een vergunning enkel de titels van de taken van zijn eigen firma.
  const far = today + 600n;
  const tIn13 = (title, org) => ({ id: [], title, note: "", kind: { work: null }, trade: [], responsibleOrgId: org === null ? [] : [org], status: { planned: null }, percent: 0n, start: far, workdays: 1n, leadDays: 0n, orderDay: [], reason: "" });
  const tOwn = await admin.saveTask(B, tIn13("Review eigen taak (Dak)", orgDak.id), (await admin.getPlan(B)).version);
  const tOther = isOk(tOwn) ? await admin.saveTask(B, tIn13("Review taak van kantoor", null), (await admin.getPlan(B)).version) : tOwn;
  const pm = isOk(tOther) ? await admin.savePermit(B, { id: [], kind: "container", title: "Review vergunning", municipalityId: [], status: { needed: null }, location: "", taskIds: [tOwn.ok.taskId[0], tOther.ok.taskId[0]], neededFrom: [], neededTo: [], leadDays: [], requestedOn: [], validFrom: [], validTo: [], reference: "", costCents: [], note: "intern" }) : tOther;
  check("(D13) vergunning op P-B met een taak van Proef Dak NV en een taak van kantoor", isOk(pm), errOf(pm));
  if (isOk(pm)) {
    const mine = (await oa2.workPermits(B)).permits.find((x) => x.id === pm.ok.id);
    const all = (await admin.workPermits(B)).permits.find((x) => x.id === pm.ok.id);
    check("(D13) OA ziet enkel de titel van zijn eigen taak (en geen notitie); kantoor ziet beide", !!mine && mine.taskTitles.length === 1 && mine.taskTitles[0].includes("Dak") && mine.note === "" && !!all && all.taskTitles.length === 2, JSON.stringify([mine?.taskTitles, all?.taskTitles]));
    check("(D13) opruimen: vergunning gearchiveerd", isOk(await admin.archivePermit(pm.ok.id, "review")));
  }
  if (isOk(tOther)) { let v = (await admin.getPlan(B)).version; for (const id of [tOwn.ok.taskId[0], tOther.ok.taskId[0]]) v = ok(await admin.archiveTask(B, id, v)); }
  if (local && process.env.NEPMAIL) {
    const nep = await nepmail(process.env.NEPMAIL);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const jobOf = async (id) => (await admin.listJobs("alles", 0n, 100n)).find((j) => j.id === id);
    // Versturen tot er geen ronde meer loopt (de klokjob kan bezig zijn); de tellers als gewone getallen (geen bigint).
    const flush = async () => { for (let i = 0; i < 60; i++) { const r = ok(await admin.sendMailNow()); if (!r.busy) return { sent: Number(r.sent), dry: Number(r.dry), skipped: Number(r.skipped), failed: Number(r.failed) }; await sleep(1000); } throw new Error("de verstuurronde bleef bezig"); };
    const nMails = async () => Number(await nep.aantal());
    const notes = async (re) => (await admin.myNotifications(false)).filter((n) => n.kind === "postbode" && re.test(n.text)).length;
    ok(await admin.setMailTest(true, "review@proef.invalid"));
    // (D8 = M1) Het antwoord van de maildienst is onleesbaar: de leverancier heeft de mail al → onzeker, nooit vanzelf opnieuw.
    await nep.zet("onleesbaar", 0n, 1_000_000n);
    const t8 = ok(await admin.queueTestMail("eigen@proef.invalid"));
    const n8 = await nMails();
    await flush();
    const j8 = await jobOf(t8);
    check("(D8) antwoord van de maildienst onleesbaar: de mail is weg (1), de opdracht 'onzeker' (geen nieuwe poging)", !!j8 && "failed" in j8.state && j8.state.failed.why.startsWith("onzeker") && (await nMails()) === n8 + 1, JSON.stringify(j8?.state, big));
    await nep.zet("", 0n, 1_000_000n);
    check("(D8) een volgende ronde verstuurt ze niet opnieuw; logboek 'onzeker' zonder adres", (await flush()).sent === 0 && (await nMails()) === n8 + 1 && (await admin.listMailLog(0n, 10n)).some((l) => l.jobId === t8 && "unsure" in l.outcome && !l.outcome.unsure.includes("@")));
    // (D9) De maildienst is onbereikbaar (schone weigering, Error.isCleanReject): zeker niet verstuurd → opnieuw met wachttijd.
    // De app zoekt de dienst via INTEGRATIONS_CANISTER_ID: even naar een canister die niet bestaat (via de beheercanister;
    // tests/lokaal.sh maakte de testbeheerder controller van dit eigen net), daarna terug.
    const setSvc = (v) => setCanisterEnv("proef-admin", cid, { INTEGRATIONS_CANISTER_ID: v });
    await setSvc("rrkah-fqaaa-aaaaa-aaaaq-cai");
    const t9 = ok(await admin.queueTestMail("eigen@proef.invalid"));
    const n9 = await nMails();
    const r9 = await flush();
    const j9 = await jobOf(t9);
    await setSvc(process.env.NEPMAIL);
    check("(D9) maildienst onbereikbaar: niets verstuurd, opnieuw met wachttijd (poging 1), reden zonder adres", !!j9 && "queued" in j9.state && j9.attempts === 1n && j9.notBefore > BigInt(Date.now()) * 1_000_000n && (await nMails()) === n9 && r9.failed === 1, JSON.stringify([r9, j9?.state, j9?.attempts], big));
    check("(D9) tijdens de wachttijd niet opnieuw geprobeerd; daarna annuleren", (await flush()).failed === 0 && (await jobOf(t9)).attempts === 1n && isOk(await admin.cancelJob(t9)));
    // (D10 = G6) De maildienst vraagt meer cycles per mail dan de app meegeeft: de ronde stopt, niets verbruikt, één melding met het getal.
    await nep.zet("cycles", 0n, 0n);
    const t10 = ok(await admin.queueTestMail("eigen@proef.invalid"));
    const r10 = await flush();
    const j10 = await jobOf(t10);
    await nep.zet("", 0n, 1_000_000n);
    check("(D10) te weinig cycles per mail volgens de maildienst: ronde gestopt, opdracht ongewijzigd in de wachtrij (geen poging verbruikt)", !!j10 && "queued" in j10.state && j10.attempts === 0n && r10.sent === 0 && r10.failed === 0, JSON.stringify([r10, j10?.state, j10?.attempts], big));
    check("(D10) … met een melding aan de beheerders die de gevraagde cycles noemt", (await notes(/vraagt 60000000000 cycles per mail/)) >= 1);
    check("(D10) opruimen: opdracht geannuleerd", isOk(await admin.cancelJob(t10)));
    // (D11 = L2) Een mail die al bij de maildienst is, kan niet meer geannuleerd worden ("geannuleerd" zou liegen).
    await nep.zet("traag", 12n, 1_000_000n); // 12 s bij de maildienst
    const t11 = ok(await admin.queueTestMail("eigen@proef.invalid"));
    const inflight = admin.sendMailNow();
    let j11 = await jobOf(t11);
    for (let i = 0; i < 20 && !(j11 && "leased" in j11.state); i++) { await sleep(500); j11 = await jobOf(t11); }
    const c11 = await admin.cancelJob(t11);
    check("(D11) 'bij de maildienst' kan niet meer geannuleerd worden", !!j11 && "leased" in j11.state && "err" in c11 && /bij de maildienst/.test(c11.err), JSON.stringify([j11?.state, c11], big));
    await inflight;
    await flush();
    await nep.zet("", 0n, 1_000_000n);
    check("(D11) na de ronde is ze verstuurd en staat niets meer bij de maildienst", "done" in (await jobOf(t11)).state && (await admin.postSettings()).leased === 0n);
    ok(await admin.setMailTest(true, ""));
  }
}

// ── (E1–E10) stap 2.2: postenbibliotheek. Aankoopprijzen en marges gaan NOOIT naar werfleider, OA, architect, klant,
// VC of robot, en nooit via een query of de interne export (R20–R23). Beslissing eigenaar 24-10: geen versleuteling.
{
  // (E1) Mechanisch op de .did: welke typen dragen (rechtstreeks of via een ander type) een prijs? Geen enkele query mag
  // zo'n type teruggeven, en de interne vormen (post, hoofdstuk, interne export) mogen er geen bevatten.
  const did = readFileSync(join(import.meta.dirname, "../src/backend/dist/backend.did"), "utf8");
  const types = new Map([...did.matchAll(/^type (\w+) =([\s\S]*?);\n(?=type |service|$)/gm)].map((m) => [m[1], m[2]]));
  const tainted = new Set(["LibCost", "LibSell", "LibSellVersion", "LibSellRule", "LibCostView", "LibPriceView", "LibPrices", "LibPriceHistory", "LibSellVersionView"]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [n, body] of types) if (!tainted.has(n) && [...tainted].some((t) => new RegExp(`\\b${t}\\b`).test(body))) { tainted.add(n); grew = true; }
  }
  const service = did.slice(did.indexOf("service"));
  const queries = [...service.matchAll(/^ {2}"?(\w+)"?\s*:\s*\(([^)]*)\)\s*->\s*\(([^)]*)\)\s*query/gm)];
  const bad = queries.filter((m) => [...tainted].some((t) => new RegExp(`\\b${t}\\b`).test(m[3]))).map((m) => m[1]);
  check("(E1) geen enkele query geeft een prijs of marge terug (enkel update-calls met auditregel)", queries.length > 50 && bad.length === 0, bad.join(", ") || `${queries.length} queries nagekeken, ${tainted.size} prijstypen`);
  check("(E1) de interne vormen dragen geen prijs: post, hoofdstuk, bladzijde, versie, interne export", ["LibItemView", "LibChapterView", "LibPage", "LibItemVersionView", "ExportIntern", "LibItem", "LibItemVersion"].every((n) => types.has(n) && !tainted.has(n)), ["LibItemView", "ExportIntern"].filter((n) => tainted.has(n)).join());
  // Een eigen proefpost (idempotent via de importsleutel), met een proefprijs.
  if ((await calc.libraryChapters(false)).length === 0) await calc.loadLibraryStartChapters();
  const ch = (await calc.libraryChapters(false))[0];
  const findRev = async () => (await calc.listLibrary({ text: "Proef reviewpost", chapterId: [], trade: [], unit: [], form: [], orgId: [], includeArchived: false, offset: 0n, limit: 5n })).items.find((x) => x.importKey[0] === "review:e");
  let rp = await findRev();
  if (!rp) rp = ok(await calc.saveLibraryItem({ id: [], chapterId: ch.id, code: "", title: "Proef reviewpost", text: "Testpost van tests/review.mjs (verzonnen).", unit: "st", form: { fixed: null }, trade: [], orgId: [], durationDays: [], perDayMilli: [], planStepKey: [], keywords: [], importKey: ["review:e"] }, 0n));
  const prices = ok(await calc.readLibraryPrices([rp.id]));
  if (prices.prices[0].costCount === 0n) ok(await calc.addLibraryCost(rp.id, { orgId: [], day: today, costCents: 1234n, source: "eigen", ref: "review", note: "verzonnen" }));
  // (E2) Elke rol zonder prijsrecht, ook de robot en een onbekende login, op elke prijsfunctie en de vertrouwelijke export.
  const anon = await backend(null, cid);
  const vreemd = await freshBackend(cid);
  const nope = [["werfleider", wl], ["architect", arch], ["OA", oa2], ["klant", klant], ["VC", vc], ["robot", robot], ["anoniem", anon], ["onbekend", vreemd]];
  const priceCalls = (x) => [x.readLibraryPrices([rp.id]), x.readLibraryPriceHistory(rp.id), x.addLibraryCost(rp.id, { orgId: [], day: today, costCents: 1n, source: "eigen", ref: "", note: "" }), x.setLibrarySell(rp.id, { rule: [{ margin: 2000n }], reason: "x" }, 99n), x.archiveLibraryCost(1n, "x"), x.setLibraryMargin(2000n), x.exportChunk("libCosts", 0n, 1n), x.exportChunk("libSells", 0n, 1n), x.exportConfidential()];
  for (const [n, x] of nope) {
    const rs = await Promise.all(priceCalls(x).map((c) => denied(c)));
    check(`(E2) ${n}: elke prijsfunctie geweigerd (9 oproepen)`, rs.every(Boolean), rs.map((v) => (v ? "·" : "✗")).join(""));
  }
  // (E3) De interne lijst van de werfleider draagt geen bedrag (ook niet in de tekst van een veld).
  const wlPage = await wl.listLibrary({ text: "Proef reviewpost", chapterId: [], trade: [], unit: [], form: [], orgId: [], includeArchived: false, offset: 0n, limit: 5n });
  check("(E3) werfleider: de post zonder enig prijsveld en zonder het bedrag 12,34", wlPage.items.length === 1 && !/12,34|cost|sell|marg/i.test(JSON.stringify(wlPage, (k, v) => (typeof v === "bigint" ? "" : v))));
  // (E4) Grenzen
  const big1 = { id: [], chapterId: ch.id, code: "", title: "x".repeat(161), text: "", unit: "st", form: { fixed: null }, trade: [], orgId: [], durationDays: [], perDayMilli: [], planStepKey: [], keywords: [], importKey: [] };
  check("(E4) titel > 160, tekst > 4.000, > 12 zoekwoorden, importsleutel > 200 tekens: geweigerd", "err" in (await calc.saveLibraryItem(big1, 0n)) && "err" in (await calc.saveLibraryItem({ ...big1, title: "x", text: "y".repeat(4001) }, 0n)) && "err" in (await calc.saveLibraryItem({ ...big1, title: "x", keywords: Array.from({ length: 13 }, (_, i) => `k${i}`) }, 0n)) && "err" in (await calc.saveLibraryItem({ ...big1, title: "x", importKey: ["k".repeat(201)] }, 0n)));
  check("(E4) prijzen: negatief, boven € 1 miljard en een datum buiten bereik geweigerd; > 300 posten per oproep geweigerd", "err" in (await calc.addLibraryCost(rp.id, { orgId: [], day: today, costCents: -1n, source: "eigen", ref: "", note: "" })) && "err" in (await calc.addLibraryCost(rp.id, { orgId: [], day: today, costCents: 100_000_000_001n, source: "eigen", ref: "", note: "" })) && "err" in (await calc.addLibraryCost(rp.id, { orgId: [], day: 5n, costCents: 1n, source: "eigen", ref: "", note: "" })) && "err" in (await calc.readLibraryPrices(Array.from({ length: 301 }, () => rp.id))));
  check("(E4) zoekvraag langer dan 80 tekens: geweigerd", await rejects(wl.listLibrary({ text: "z".repeat(81), chapterId: [], trade: [], unit: [], form: [], orgId: [], includeArchived: false, offset: 0n, limit: 5n })));
  check("(E4) bladzijde begrensd op 200", (await wl.listLibrary({ text: "", chapterId: [], trade: [], unit: [], form: [], orgId: [], includeArchived: true, offset: 0n, limit: 100_000n })).items.length <= 200);
  // (E5) Lezen van prijzen staat in de auditlog, zonder bedrag; een onbekend id lekt niets (zelfde fout als geen post).
  const before = await admin.auditCount();
  ok(await calc.readLibraryPrices([rp.id]));
  const after = await admin.auditCount();
  const last = (await admin.auditLog(0n, 3n)).find((e) => e.action === "bekeek:prijzen");
  check("(E5) elke oproep van readLibraryPrices = één auditregel 'bekeek:prijzen' zonder bedrag", after === before + 1n && last && !/1234|12,34/.test(last.detail), last?.detail);
  check("(E5) onbekende post: een gewone fout, geen auditregel", errOf(await calc.readLibraryPrices([999_999n])).startsWith("Onbekende post") && (await admin.auditCount()) === after);
  // (E6) Archiveren is nooit wissen: een gearchiveerde prijs blijft in de historiek, de post blijft met zijn versies.
  const h = ok(await calc.readLibraryPriceHistory(rp.id));
  check("(E6) de historiek bevat elke ooit ingegeven prijs (geen wis-functie in de .did)", h.costs.length >= 1 && !/delete|remove|wis/i.test(service.split("\n").filter((l) => /Library|library/.test(l)).join("\n")));
  // (E7) Een standaard-OA koppelen geeft die OA geen zicht: hij heeft geen #readLibrary.
  check("(E7) de OA van een post (Proef Dak NV) ziet de bibliotheek niet", await rejects(oa2.listLibrary({ text: "", chapterId: [], trade: [], unit: [], form: [], orgId: [], includeArchived: false, offset: 0n, limit: 5n })));
  // (E8) caps: enkel kantoor ziet de knop en de kolommen met prijzen.
  const capsOf = async (x) => (await x.me()).caps[0];
  check("(E8) caps.libraryPrices: admin en calculator ja; werfleider nee", (await capsOf(admin)).libraryPrices && (await capsOf(calc)).libraryPrices && !(await capsOf(wl)).libraryPrices);
  // (E9) Een afgezette calculator leest geen prijzen meer (enkel lokaal: op een draft maakt dit een persoon en een melding).
  if (local) {
    const inv = ok(await admin.invitePerson({ name: "Proef Calc Afgezet (review)", roles: [{ calculator: null }], orgId: [], shortCode: [], lang: [], phone: [], workIds: [], validDays: 1n, tag: "review" }));
    const c2 = await freshBackend(cid);
    ok(await c2.redeemCode(inv.code));
    ok(await admin.confirmLink((await c2.me()).principal));
    check("(E9) nieuwe calculator leest de prijzen", isOk(await c2.readLibraryPrices([rp.id])));
    ok(await admin.archivePerson(inv.personId));
    check("(E9) na afzetten: meteen geweigerd", await denied(c2.readLibraryPrices([rp.id])));
  }
  // (E10) Verkoopregel: een afwijking zonder reden wordt geweigerd (controle vóór verzending, 2.6).
  check("(E10) eigen marge of vaste prijs zonder reden: geweigerd", "err" in (await calc.setLibrarySell(rp.id, { rule: [{ price: 5000n }], reason: " " }, ok(await calc.readLibraryPrices([rp.id])).prices[0].sellVersion)));
}

// ── (F1–F10) offerte-editor 2.4: prijzen en marges enkel kantoor, rekenen nagekeken door de server, onwijzigbaar na verzending ──
{
  const did = readFileSync(join(import.meta.dirname, "../src/backend/dist/backend.did"), "utf8");
  const types = new Map([...did.matchAll(/^type (\w+) =([\s\S]*?);\n(?=type |service|$)/gm)].map((m) => [m[1], m[2]]));
  // Vormen die een aankoopprijs, marge of prijs per lijn dragen (rechtstreeks of via een ander type).
  const tainted = new Set(["QuoteLinePrice", "QuoteVersionConf", "QuoteCostLine", "QuoteSellLine", "QuoteMarginTotals", "QuoteChapterMargin", "QuotePriceInput", "LibCost", "LibSell", "LibSellRule", "LibCostView", "LibPriceView"]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [n, body] of types) if (!tainted.has(n) && [...tainted].some((t) => new RegExp(`\\b${t}\\b`).test(body))) { tainted.add(n); grew = true; }
  }
  const service = did.slice(did.indexOf("service"));
  const queries = [...service.matchAll(/^ {2}"?(\w+)"?\s*:\s*\(([^)]*)\)\s*->\s*\(([^)]*)\)\s*query/gm)];
  const bad = queries.filter((m) => [...tainted].some((t) => new RegExp(`\\b${t}\\b`).test(m[3]))).map((m) => m[1]);
  check("(F1) geen enkele query geeft een prijs per lijn, aankoopprijs of marge van een offerte terug", bad.length === 0 && tainted.has("QuoteRead"), bad.join(", ") || `${queries.length} queries, ${tainted.size} prijstypen`);
  check("(F1) de interne vormen dragen geen prijs: lijst, kop, hoofdstuk, lijn, interne export", ["QuoteSummary", "QuoteVersionBrief", "QuoteVersionView", "QuoteChapterView", "QuoteLineView", "QuoteLine", "QuoteChapter", "QuoteVersion", "ExportIntern"].every((n) => types.has(n) && !tainted.has(n)), ["QuoteLineView", "QuoteLine", "ExportIntern"].filter((n) => tainted.has(n)).join());
  // (G1) 2.7: wat de klant krijgt, heeft geen veld voor een aankoopprijs, marge, reden, interne notitie of bibliotheek-id, en de
  // lijst "mijn offertes" (een query) draagt geen bedrag.
  const fieldsOf = (n) => [...(types.get(n) ?? "").matchAll(/^\s+(\w+)\s*:/gm)].map((m) => m[1]);
  const clientTypes = ["MyQuoteBrief", "MyQuoteChapter", "MyQuoteLine", "MyQuoteRead", "MyQuoteAnswered", "QuoteDocInfo", "MyAcceptanceView", "QuoteDigitalView", "MySignedView"];
  const badFields = clientTypes.flatMap((n) => fieldsOf(n).filter((f) => /cost|margin|marg|reason|note|libItem|copied|standard|purchase|aankoop/i.test(f) && f !== "decisionNote" && f !== "vatNote").map((f) => `${n}.${f}`));
  check("(G1) de typen van de klant bestaan, zijn niet 'prijsbesmet' en hebben geen veld voor aankoop, marge, reden, notitie of bibliotheek-id", clientTypes.every((n) => types.has(n) && !tainted.has(n)) && badFields.length === 0, badFields.join(", ") || `${clientTypes.length} typen`);
  check("(G1) listMyQuotes (een query) heeft geen bedragveld", !fieldsOf("MyQuoteBrief").some((f) => /Cents|price|amount/i.test(f)));
  check("(G1) de klant heeft geen enkele functie met 'Quote' behalve de vier eigen (voor kantoor: zie lek.mjs)", ["listMyQuotes", "readMyQuote", "acceptMyQuote", "declineMyQuote"].every((m) => service.includes(`"${m}"`) || service.includes(` ${m}:`)));
  // Een eigen reviewofferte op P-A (vast nummer, idempotent): een ontwerp om op te werken.
  const NR = "PROEF-REVIEW";
  let q = (await calc.listQuotes([A], true)).find((x) => x.number === NR);
  if (!q) { ok(await calc.createQuote({ workId: A, number: NR, title: "Proef reviewofferte (tests/review.mjs)" })); q = (await calc.listQuotes([A], true)).find((x) => x.number === NR); }
  if (q.archived) ok(await calc.setQuoteArchived(q.id, false, ""));
  let draft = q.versions.find((v) => "draft" in v.status);
  if (!draft) { ok(await calc.newQuoteVersion(q.id, [])); draft = (await calc.listQuotes([A], true)).find((x) => x.number === NR).versions[0]; }
  const vid = draft.id;
  let m = fromRead(ok(await calc.readQuoteVersion(vid)));
  for (const l of m.lines) M.removeLine(m, l.key);
  for (const c of m.chapters) M.removeChapter(m, c.key);
  await ensureProofClientAddress(admin);
  if (orgKlant) M.setHeader(m, { clientOrgId: orgKlant.id }); // 2.6: zonder klant wordt een offerte niet verstuurd
  const ch = M.addChapter(m, { code: "R", title: "Proef review" });
  M.addLine(m, ch.key, { title: "Proef reviewlijn", qtyMilli: 3_000n, unit: "st", form: "fixed", price: { cost: 1_234n, rule: null, reason: "", orgId: orgDak ? orgDak.id : null, source: "eigen", libCostId: null } });
  M.addLine(m, ch.key, { title: "Proef reviewlijn vast", qtyMilli: 1_000n, unit: "sog", form: "fixed", price: { cost: null, rule: { price: 77_700n }, reason: "review", orgId: null, source: "", libCostId: null } });
  const sv = await saveAll(calc, m);
  check("(F2) calculator bewaart de reviewofferte; de server rekent hetzelfde", isOk(sv) && sameTotals(m, sv.ok.totals, sv.ok.margins), errOf(sv).slice(0, 160));
  // (F3) Elke rol zonder prijsrecht, ook de robot en een onbekende login.
  const anon = await backend(null, cid);
  const vreemd = await freshBackend(cid);
  const stale = [vid, 0n, [], [], [], expectRaw({ subtotal: 0n, vat: 0n, total: 0n, optionsPlus: 0n, optionsMinus: 0n, cost: 0n, margin: 0n, chapters: [] })];
  for (const [n, x] of [["architect", arch], ["OA", oa2], ["klant", klant], ["VC", vc], ["robot", robot], ["anoniem", anon], ["onbekend", vreemd]]) {
    const rs = await Promise.all([x.readQuoteVersion(vid), x.listQuotes([A], false), x.listQuotes([], false), x.createQuote({ workId: A, number: "", title: "x" }), x.saveQuoteDraft(...stale), x.sendQuoteVersion(vid, 0n, 0n, "proef: regels"), x.decideQuoteVersion(vid, true, ""), x.newQuoteVersion(q.id, []), x.setQuoteArchived(q.id, true, "x"), x.exportChunk("quotePrices", 0n, 1n), x.exportChunk("quoteVersionConf", 0n, 1n)].map((c) => denied(c)));
    check(`(F3) ${n}: elke offertefunctie geweigerd (11 oproepen)`, rs.every(Boolean), rs.map((v) => (v ? "·" : "✗")).join(""));
  }
  // (F4) De werfleider: totalen, geen enkele prijs per lijn, aankoopprijs, marge of OA van de prijs.
  const rw = ok(await wl.readQuoteVersion(vid));
  const flat = JSON.stringify({ lines: rw.lines, chapters: rw.chapters, version: rw.version, quote: rw.quote }, big);
  check("(F4) werfleider: scope totals, geen prijs per lijn, geen aankoop of marge, geen bedrag in de tekst", "totals" in rw.scope && rw.sell.length === 0 && rw.costs.length === 0 && rw.margins.length === 0 && !/\b(1234|1543|77700|4629)\b|Proef Dak/.test(flat));
  check("(F4) werfleider: bewaren, versturen, beslissen, nieuwe versie, archiveren, export: geweigerd", (await Promise.all([wl.saveQuoteDraft(...stale), wl.sendQuoteVersion(vid, 0n, 0n, "proef: regels"), wl.decideQuoteVersion(vid, true, ""), wl.newQuoteVersion(q.id, []), wl.setQuoteArchived(q.id, true, "x"), wl.exportChunk("quotePrices", 0n, 1n)].map(denied))).every(Boolean));
  // (F5) Een architect MET de grant #readSellPrices: verkoopprijzen, nooit aankoopprijzen of marges.
  const meArch = (await arch.me()).person[0];
  const mArch = (await admin.listMembers(A)).find((x) => x.personId[0] === meArch.id && "architect" in x.role);
  if (mArch) {
    ok(await admin.setMemberGrants(mArch.id, [...mArch.grants.filter((g) => !("readSellPrices" in g)), { readSellPrices: null }]));
    const ra = await arch.readQuoteVersion(vid).catch((e) => ({ trap: String(e) }));
    check("(F5) architect met de grant: scope sell, prijs per lijn, GEEN aankoopprijs of marge", isOk(ra) && "sell" in ra.ok.scope && ra.ok.sell.length === 2 && ra.ok.costs.length === 0 && ra.ok.margins.length === 0, errOf(ra) || ra.trap || "");
    check("(F5) … en nog altijd niet bewerken of versturen", (await Promise.all([arch.saveQuoteDraft(...stale), arch.sendQuoteVersion(vid, 0n, 0n, "proef: regels")].map(denied))).every(Boolean));
    ok(await admin.setMemberGrants(mArch.id, mArch.grants));
    check("(F5) grant terug weg: meteen geweigerd", await denied(arch.readQuoteVersion(vid)));
  } else check("(F5) architect is lid van P-A", false);
  // (F6) Een werf die de werfleider niet ziet ('ziet alles' uit en geen lid van die werf; op een draft kan hij lid zijn van
  // P-B, dus zoeken we een werf zonder hem), met een eigen proefofferte daar (vast nummer, idempotent).
  const setBefore = await admin.getSettings();
  const wlId = (await wl.me()).person[0].id;
  let other = null;
  for (const w of (await admin.listWorks()).filter((x) => x.archivedAt.length === 0)) {
    if (!(await admin.listMembers(w.id)).some((m) => m.personId[0] === wlId)) { other = w; break; }
  }
  if (other) {
    let qo = (await calc.listQuotes([other.id], true)).find((x) => x.number === "PROEF-REVIEW-F6");
    if (!qo) { ok(await calc.createQuote({ workId: other.id, number: "PROEF-REVIEW-F6", title: "Proef reviewofferte F6 (verzonnen)" })); qo = (await calc.listQuotes([other.id], true)).find((x) => x.number === "PROEF-REVIEW-F6"); }
    ok(await admin.setSettings({ ...setBefore, werfleiderZietAlles: false }));
    const deniedO = await denied(wl.readQuoteVersion(qo.versions[0].id));
    const listAll = await wl.listQuotes([], true);
    ok(await admin.setSettings(setBefore));
    check(`(F6) werfleider zonder 'ziet alles': geen offerte van een werf die hij niet ziet (${other.code}: lezen, lijst)`, deniedO && !listAll.some((x) => x.workId === other.id));
  } else console.log("· (F6) geen werf zonder de werfleider: overgeslagen");
  // (F7) Rekenen: een verkeerd totaal wordt geweigerd en er verandert niets (ook de stand niet).
  const r0 = ok(await calc.readQuoteVersion(vid));
  const x0 = fromRead(r0);
  M.updateLine(x0, x0.lines[0].key, { qtyMilli: 4_000n });
  const b0 = M.nextBatch(x0);
  const tamper = batchArgs(x0, b0);
  tamper[5] = expectRaw({ ...b0.expect, margin: b0.expect.margin + 1n });
  check("(F7) marge van de browser 1 cent anders: geweigerd, stand en hoeveelheid ongewijzigd", /verschillen/.test(errOf(await calc.saveQuoteDraft(...tamper))) && ok(await calc.readQuoteVersion(vid)).version.rev === r0.version.rev);
  // (F8) Grenzen: tekst > 4.000 tekens, > 300 wijzigingen in één oproep.
  const x1 = fromRead(r0);
  M.updateLine(x1, x1.lines[0].key, { text: "y".repeat(4001) });
  check("(F8) lastenboektekst > 4.000 tekens: geweigerd", /te lang/.test(errOf(await calc.saveQuoteDraft(...batchArgs(x1, M.nextBatch(x1))))));
  const x2 = fromRead(r0);
  for (let i = 0; i < 301; i++) M.addLine(x2, x2.chapters[0].key, { title: `R${i}`, qtyMilli: 1000n, unit: "st", price: M.emptyPrice() });
  check("(F8) 301 wijzigingen in één oproep: geweigerd", /Te veel wijzigingen/.test(errOf(await calc.saveQuoteDraft(...batchArgs(x2, M.nextBatch(x2, 400))))));
  // (F9) Lezen staat in de auditlog (één regel per oproep), nooit met een bedrag.
  const c0 = await admin.auditCount();
  ok(await calc.readQuoteVersion(vid));
  const c1 = await admin.auditCount();
  const last = (await admin.auditLog(0n, 3n)).find((e) => e.action === "bekeek:offerteprijzen");
  check("(F9) readQuoteVersion = één auditregel 'bekeek:offerteprijzen', zonder bedrag", c1 === c0 + 1n && last && !/\d{3,}/.test(last.detail.replace(/#\d+|v\d+/g, "")), last?.detail);
  // (F10) Versturen legt vast: daarna geen enkele wijziging, en de hash klopt nog na een nieuwe versie.
  const rs = ok(await calc.readQuoteVersion(vid));
  const h = ok(await calc.sendQuoteVersion(vid, rs.version.rev, rs.totals.totalCents, "proef: regels"));
  const x3 = fromRead(ok(await calc.readQuoteVersion(vid)));
  M.updateLine(x3, x3.lines[0].key, { qtyMilli: 9_000n });
  check("(F10) verzonden versie bewerken: geweigerd", /kan niet meer veranderen/.test(errOf(await calc.saveQuoteDraft(...batchArgs(x3, M.nextBatch(x3))))));
  const nv = ok(await calc.newQuoteVersion(q.id, []));
  const x4 = fromRead(ok(await calc.readQuoteVersion(nv)));
  M.updateLine(x4, x4.lines[0].key, { qtyMilli: 9_000n });
  check("(F10) de nieuwe versie bewerken mag", isOk(await saveAll(calc, x4)));
  const rsv = ok(await calc.readQuoteVersion(vid));
  check("(F10) de verzonden versie: zelfde hash en totaal, inhoud intact", rsv.version.hash === h && rsv.version.intact && rsv.totals.totalCents === rs.totals.totalCents);
}


// ── (H1–H6) stap 2.8: offerte → werf. Het voorstel draagt geen bedrag (de werfleider ziet het), rechten per werf,
//    idempotent ook bij twee gelijktijdige bevestigingen, de getekende versie enkel via de werfstart, de robot nergens ──
{
  const did = readFileSync(join(import.meta.dirname, "../src/backend/dist/backend.did"), "utf8");
  const types = new Map([...did.matchAll(/^type (\w+) =([\s\S]*?);\n(?=type |service|$)/gm)].map((m) => [m[1], m[2]]));
  const fieldsOf = (n) => [...(types.get(n) ?? "").matchAll(/^\s+(\w+)\s*:/gm)].map((m) => m[1]);
  const wsTypes = ["WorkStartPreview", "WorkStartGroup", "WorkStartLine", "WorkStartPermit", "WorkStartNote", "WorkStartPending", "WorkStartDone", "WorkStartExisting", "WorkStart", "WorkStartInput"];
  const badWs = wsTypes.flatMap((n) => fieldsOf(n).filter((f) => /cents|cost|margin|marg|price|prijs|amount|bedrag|subtotal|total/i.test(f)).map((f) => `${n}.${f}`));
  const priceTypes = ["QuoteLinePrice", "QuoteCostLine", "QuoteSellLine", "QuoteMarginTotals", "QuoteTotalsView", "LibCost", "LibSell", "ContractParams", "WorkConfidential"];
  const refs = wsTypes.filter((n) => priceTypes.some((t) => new RegExp(`\\b${t}\\b`).test(types.get(n) ?? "")));
  check("(H1) de typen van de werfstart bestaan en hebben geen veld en geen verwijzing naar een bedrag, prijs, marge of contract", wsTypes.every((n) => types.has(n)) && badWs.length === 0 && refs.length === 0, badWs.concat(refs).join(", ") || `${wsTypes.length} typen`);
  const wlId = (await wl.me()).person[0].id;
  const stamp = Date.now().toString(36).toUpperCase();
  const addr = { street: "Proefstraat", number: "9", zip: "8670", city: "Koksijde", country: "BE" };
  await ensureProofClientAddress(admin);
  const mkWork = async (code, leader) => { const w = ok(await admin.createWork({ code, name: "Proefwerf review 2.8", address: addr, parentId: [], clientOrgId: [orgKlant.id], architectOrgId: [], leaderPersonId: leader ? [leader] : [], vatBp: 2100n })); return w.id; };
  const mkAccepted = async (workId, nr) => {
    const q = ok(await calc.createQuote({ workId, number: nr, title: "Proef review werfstart (2.8)" }));
    const m = fromRead(ok(await calc.readQuoteVersion(q.versionId)));
    M.setHeader(m, { clientOrgId: orgKlant.id });
    const c = M.addChapter(m, { code: "01", title: "Afbraak" });
    M.addLine(m, c.key, { title: "Proef afbraak review", qtyMilli: 10_000n, unit: "m2", form: "vh", price: { cost: 2000n, rule: null, reason: "", orgId: null, source: "eigen", libCostId: null } });
    M.addLine(m, c.key, { title: "Proef container review", qtyMilli: 1_000n, unit: "st", form: "fixed", price: { cost: 30_000n, rule: null, reason: "", orgId: null, source: "eigen", libCostId: null } });
    const r = await saveAll(calc, m);
    if (r && "err" in r) throw new Error(errOf(r));
    const rd = ok(await calc.readQuoteVersion(q.versionId));
    ok(await calc.sendQuoteVersion(q.versionId, rd.version.rev, rd.totals.totalCents, "proef: review 2.8"));
    ok(await calc.decideQuoteVersion(q.versionId, true, "proef: review 2.8"));
    return q.versionId;
  };
  const inp = { target: { existing: null }, startDay: 0n, templateKey: "", leaderPersonId: [], lineSteps: [], options: [], groupDays: [], skipPermits: [], declaration: true };
  // (H2) Een werfleider enkel op de werven die hij ziet: met "werfleider ziet alles" uit kan hij een werf zonder hem niet starten.
  const wOther = await mkWork(`P-WR-${stamp}`, null);
  const vOther = await mkAccepted(wOther, `WR-${stamp}`);
  const st = await admin.getSettings();
  ok(await admin.setSettings({ ...st, werfleiderZietAlles: false }));
  try {
    const rs = await Promise.all([wl.workStartPreview(vOther, inp), wl.startWorkFromQuote(vOther, inp, 0n), wl.dismissWorkStart(vOther, "proef: review"), wl.pendingWorkStarts([wOther])].map(denied));
    check("(H2) 'werfleider ziet alles' uit: de werfleider ziet en start het voorstel van een werf zonder hem niet", rs.every(Boolean) && !(await wl.pendingWorkStarts([])).some((x) => x.versionId === vOther), rs.map((r) => (r ? "·" : "✗")).join(""));
  } finally {
    ok(await admin.setSettings(st));
  }
  // (H3) Twee gelijktijdige bevestigingen: één start, de andere geeft dezelfde start terug; niets dubbel.
  const wMine = await mkWork(`P-WR-${stamp}-B`, wlId);
  const vMine = await mkAccepted(wMine, `WR-${stamp}-B`);
  const pv = ok(await wl.workStartPreview(vMine, inp));
  const [a, b] = await Promise.all([wl.startWorkFromQuote(vMine, inp, pv.planVersion), admin.startWorkFromQuote(vMine, inp, pv.planVersion)]);
  const plan = await admin.getPlan(wMine);
  check("(H3) twee gelijktijdige bevestigingen: precies één start, de andere 'al gebeurd'; de taken één keer", isOk(a) && isOk(b) && [a.ok.already, b.ok.already].filter(Boolean).length === 1 && a.ok.tasks === b.ok.tasks && BigInt(plan.tasks.length) === a.ok.tasks, `${errOf(a)}${errOf(b)} ${plan.tasks.length}`);
  // (H4) De getekende offerteversie zet enkel de werfstart: setContract (de browser) kan ze niet zetten of wissen.
  const c0 = ok(await admin.readContract(wMine));
  const k0 = c0.contract[0];
  const r4 = await admin.setContract(wMine, { contract: { ...k0, signedQuoteVersionId: [999_999n], note: "proef: review H4" }, clientContact: c0.clientContact, notes: c0.notes[0] ?? "" }, c0.version);
  const c1 = ok(await admin.readContract(wMine));
  check("(H4) setContract met een andere getekende versie: bewaard zonder die versie (de werfstart blijft de bron)", isOk(r4) && c1.contract[0].signedQuoteVersionId[0] === vMine && c1.contract[0].note === "proef: review H4", errOf(r4) || String(c1.contract[0].signedQuoteVersionId[0]));
  const r4b = await admin.setContract(wMine, { contract: { ...c1.contract[0], signedQuoteVersionId: [], note: "proef: review H4b" }, clientContact: c1.clientContact, notes: c1.notes[0] ?? "" }, c1.version);
  check("(H4) … en ook niet wissen", isOk(r4b) && ok(await admin.readContract(wMine)).contract[0].signedQuoteVersionId[0] === vMine);
  // (H5) De robot en de calculator: nergens toegang (ook niet met een echte versie).
  const rs5 = await Promise.all([robot.pendingWorkStarts([]), robot.workStartPreview(vOther, inp), robot.startWorkFromQuote(vOther, inp, 0n), robot.dismissWorkStart(vOther, "proef: robot"), calc.startWorkFromQuote(vOther, inp, 0n), calc.workStartPreview(vOther, inp)].map(denied));
  check("(H5) robot en calculator: de werfstart geweigerd (6 oproepen)", rs5.every(Boolean), rs5.map((r) => (r ? "·" : "✗")).join(""));
  // (H6) Een verouderde planning: bevestigen met een oude planversie weigert, er gebeurt niets.
  ok(await wl.saveTask(wOther, { id: [], title: "Proef taak review", note: "", kind: { work: null }, trade: [], responsibleOrgId: [], status: { planned: null }, percent: 0n, start: today + 30n, workdays: 2n, leadDays: 0n, orderDay: [], reason: "proef: review H6" }, 0n));
  const stale = await admin.startWorkFromQuote(vOther, inp, 0n);
  check("(H6) bevestigen met een verouderde planversie: geweigerd, geen start", /intussen gewijzigd/.test(errOf(stale)) && !(await admin.workStartPreview(vOther, inp)).ok.done.length);
  ok(await admin.dismissWorkStart(vOther, "proef: review 2.8 opgeruimd"));
  for (const w of [wOther, wMine]) await admin.setWorkStatus(w, { cancelled: null });
}

// ── (J1–J8) stap 2.9: opmeting ter plaatse. Hoeveelheden, nooit een prijs; een OA enkel zijn eigen posten; een afgesloten opmeting
//    verandert niet; twee gelijktijdige afsluitingen = één stand; de robot nergens; de foto's enkel via de opmeting; grenzen ──
{
  const did = readFileSync(join(import.meta.dirname, "../src/backend/dist/backend.did"), "utf8");
  const types = new Map([...did.matchAll(/^type (\w+) =([\s\S]*?);\n(?=type |service|$)/gm)].map((m) => [m[1], m[2]]));
  const fieldsOf = (n) => [...(types.get(n) ?? "").matchAll(/^\s+(\w+)\s*:/gm)].map((m) => m[1]);
  const mTypes = ["MeasurePostView", "MeasureSummaryView", "SurveyBrief", "MeasureTotals", "MeasureEntryView", "MeasureFileView", "MeasurePostDetail", "SurveyPostSnapView", "SurveyDetail", "MeasureWorkBrief", "MeasureSettingsView", "MeasureFileIn", "MeasureOp", "MeasureOpInput", "MeasureOutcome", "MeasureOpResult", "MeasureEntry", "MeasureFile", "MeasureReview", "Survey", "SurveyPostSnap", "SurveyOpRecord"];
  const badM = mTypes.flatMap((n) => fieldsOf(n).filter((f) => /cents|cost|margin|marg|price|prijs|amount|bedrag|subtotal|euro|vat|btw/i.test(f)).map((f) => `${n}.${f}`));
  const priceTypes = ["QuoteLinePrice", "QuoteCostLine", "QuoteSellLine", "QuoteMarginTotals", "QuoteTotalsView", "LibCost", "LibSell", "ContractParams", "WorkConfidential"];
  const refsM = mTypes.filter((n) => priceTypes.some((t) => new RegExp(`\\b${t}\\b`).test(types.get(n) ?? "")));
  check("(J1) de typen van de opmeting bestaan en hebben geen veld en geen verwijzing naar een prijs, aankoopprijs, marge, btw of het contract", mTypes.every((n) => types.has(n)) && badM.length === 0 && refsM.length === 0, badM.concat(refsM).join(", ") || `${mTypes.length} typen`);
  const st0 = await admin.measureSettings();
  ok(await admin.saveMeasureSettings({ thresholdBp: 1000n, oaPropose: true, externalRead: false }));
  const w = await proefWerf({ admin, calc, wl }, { prefix: "P-OR", titleSuffix: " review 2.9" });
  const mOa = ok(await admin.addMembership(w.wid, [oa2Id], [], { onderaannemer: null }, []));
  const sync = (who, ...ops) => who.measureSync(ops);
  const done = (r) => r && "done" in r.outcome;
  const outErr = (r) => (r && "err" in r.outcome ? r.outcome.err : "");
  const ent = (lineId, qty, o = {}) => ({ entry: { lineId, qtyMilli: qty, day: today, complete: false, note: "", files: [], corrects: [], reason: "", ...o } });
  const cDay = BigInt(Math.floor(Number((await admin.auditLog(0n, 1n))[0].at / 1_000_000n) / 86_400_000));
  const e = (lineId, qty, o = {}) => ent(lineId, qty, { day: cDay, ...o });
  try {
    const K1 = uid();
    const K2 = uid();
    const S = (await sync(wl, { opId: uid(), clientKey: K1, op: { open: { workId: w.wid } } }))[0].outcome.done.surveyId;
    await sync(admin, { opId: uid(), clientKey: K2, op: { open: { workId: w.wid } } });
    const [eWl] = await sync(wl, { opId: uid(), clientKey: K1, op: e(w.L.afbraak, 20_000n) });
    const [eGoot] = await sync(wl, { opId: uid(), clientKey: K1, op: e(w.L.goot, 12_000n) });
    const [eStop] = await sync(wl, { opId: uid(), clientKey: K1, op: e(w.L.stop, 24_000n) });
    const KO = uid();
    await sync(oa2, { opId: uid(), clientKey: KO, op: { open: { workId: w.wid } } });
    const [prop] = await sync(oa2, { opId: uid(), clientKey: KO, op: e(w.L.goot, 3_000n) });
    // (J2) De OA ziet en doet enkel zijn eigen posten.
    const oaSum = await oa2.measureSummary(w.wid);
    const oaSurvey = await oa2.getMeasureSurvey(S);
    const oaTxt = JSON.stringify([oaSum, oaSurvey], big);
    check("(J2) OA: samenvatting en opmeting tonen enkel de dakgoot: geen andere post, geen regel van een andere post, geen foreign totalen", oaSum.posts.length === 1 && oaSurvey.snapshot.length === 0 && oaSurvey.entries.every((x) => x.root === oaSum.posts[0].root) && !/afbraak|stopcontacten|container|gevel|verlichting/i.test(oaTxt), oaSum.posts.map((p) => p.title).join(","));
    check("(J2) OA: een regel op de post van een andere firma, een voorstel bevestigen, een regel van de werfleider weghalen, afsluiten: alles geweigerd", !done((await sync(oa2, { opId: uid(), clientKey: KO, op: e(w.L.stop, 1_000n) }))[0]) && !done((await sync(oa2, { opId: uid(), clientKey: KO, op: { review: { entryId: prop.outcome.done.entityId[0], ok: true, note: "" } } }))[0]) && !done((await sync(oa2, { opId: uid(), clientKey: KO, op: { remove: { entryId: eWl.outcome.done.entityId[0] } } }))[0]) && !done((await sync(oa2, { opId: uid(), clientKey: KO, op: { close: { note: "" } } }))[0]));
    check("(J2) OA: de afbraakregel van de werfleider niet te raden via een directe post-oproep", await denied(oa2.measurePost(w.wid, w.L.afbraak)));
    // (M3, 2.12) Een OA haalt enkel zijn eigen WACHTENDE voorstel weg; een voorstel dat de werfleider al bevestigde, is een geldige
    // regel geworden en gaat enkel nog weg via kantoor.
    const [prop2] = await sync(oa2, { opId: uid(), clientKey: KO, op: e(w.L.goot, 1_000n) });
    const [prop3] = await sync(oa2, { opId: uid(), clientKey: KO, op: e(w.L.goot, 500n) });
    await sync(wl, { opId: uid(), clientKey: K1, op: { review: { entryId: prop2.outcome.done.entityId[0], ok: true, note: "" } } });
    const rmOk = (await sync(oa2, { opId: uid(), clientKey: KO, op: { remove: { entryId: prop2.outcome.done.entityId[0] } } }))[0];
    const rmPend = (await sync(oa2, { opId: uid(), clientKey: KO, op: { remove: { entryId: prop3.outcome.done.entityId[0] } } }))[0];
    check("(M3) OA: een bevestigd eigen voorstel weghalen geweigerd; een wachtend eigen voorstel weghalen mag", !done(rmOk) && /Geen toegang/.test(outErr(rmOk)) && done(rmPend), outErr(rmOk));
    await sync(wl, { opId: uid(), clientKey: K1, op: { remove: { entryId: prop2.outcome.done.entityId[0] } } });
    // (J3) Twee gelijktijdige afsluitingen: één stand, één afgesloten opmeting.
    ok(await admin.saveMeasureSettings({ thresholdBp: 1000n, oaPropose: false, externalRead: false }));
    await sync(wl, { opId: uid(), clientKey: K1, op: { review: { entryId: prop.outcome.done.entityId[0], ok: false, note: "proef: review J3" } } });
    const [c1, c2] = await Promise.all([sync(wl, { opId: uid(), clientKey: K1, op: { close: { note: "A" } } }), sync(admin, { opId: uid(), clientKey: K2, op: { close: { note: "B" } } })]);
    const sv = await wl.measureSummary(w.wid);
    check("(J3) twee gelijktijdige afsluitingen: één opmeting afgesloten, één stand, de andere 'al afgesloten'", done(c1[0]) && done(c2[0]) && [c1[0], c2[0]].filter((x) => x.outcome.done.note === "al afgesloten").length === 1 && sv.surveys.length === 1 && !sv.surveys[0].open);
    // (J4) Een afgesloten opmeting verandert niet: weghalen, een voorstel erbij en een correctie zonder reden mislukken.
    const before = JSON.stringify((await wl.getMeasureSurvey(S)).snapshot, big);
    const rm = await sync(wl, { opId: uid(), clientKey: K1, op: { remove: { entryId: eWl.outcome.done.entityId[0] } } });
    await sync(wl, { opId: uid(), clientKey: K1, op: e(w.L.container, 2_000n) });
    check("(J4) afgesloten opmeting: een regel weghalen geweigerd; een nieuwe regel komt in opmeting 2; de stand van opmeting 1 blijft byte-voor-byte", !done(rm[0]) && (await wl.measureSummary(w.wid)).surveys.length === 2 && JSON.stringify((await wl.getMeasureSurvey(S)).snapshot, big) === before);
    // (J5) De robot en de anderen: nergens.
    const rs5 = await Promise.all([robot.measureSummary(w.wid), robot.measureSync([]), robot.listMeasureWorks(), robot.measureSettings(), robot.getMeasureSurvey(S), robot.measurePost(w.wid, w.L.afbraak), robot.saveMeasureSettings({ thresholdBp: 1000n, oaPropose: true, externalRead: true }), calc.saveMeasureSettings({ thresholdBp: 1000n, oaPropose: true, externalRead: true }), wl.saveMeasureSettings({ thresholdBp: 1000n, oaPropose: true, externalRead: true }), oa2.saveMeasureSettings({ thresholdBp: 1000n, oaPropose: true, externalRead: true })].map(denied));
    check("(J5) robot en niet-beheerders: opmeting en instellingen geweigerd (10 oproepen)", rs5.every(Boolean), rs5.map((r) => (r ? "·" : "✗")).join(""));
    // (J6) De foto's: een regel met foto's maakt ze niet zichtbaar bij de losse bestanden en ze zijn niet los te archiveren.
    const ff = { role: { photo: null }, file: { blob: new TextEncoder().encode("!caf!sha256:" + "b".repeat(64)), name: "review-j6.jpg", mime: "image/jpeg", size: 100_000n }, thumb: [], caption: "" };
    const [wf] = await sync(wl, { opId: uid(), clientKey: K1, op: e(w.L.gevel, 5_000n, { files: [ff] }) });
    const gv = await wl.measurePost(w.wid, w.L.gevel);
    const fid = gv.entries.find((x) => x.files.length)?.files[0].file.id;
    check("(J6) foto bij een regel: niet bij de losse bestanden van de werf (werfleider, calculator, admin, OA) en niet los te archiveren, ook niet door wie ze oplaadde", done(wf) && fid !== undefined && [wl, calc, admin, oa2].every(async () => true) && (await Promise.all([wl, calc, admin].map(async (x) => !(await x.listFiles([w.wid])).some((f) => f.id === fid)))).every(Boolean) && /hoort bij een opmeting/.test(errOf(await wl.archiveFile(fid))) && /hoort bij een opmeting/.test(errOf(await admin.archiveFile(fid))));
    // (J7) Grens per post: hoogstens 50 regels; de 51e wordt geweigerd.
    const many = Array.from({ length: 40 }, (_, i) => ({ opId: uid(), clientKey: K1, op: e(w.L.pm, 1_000n, { note: `n${i}` }) }));
    const r1 = await wl.measureSync(many);
    const r2 = await wl.measureSync(many.slice(0, 15).map((x) => ({ ...x, opId: uid() })));
    const accepted = [...r1, ...r2].filter(done).length;
    check("(J7) grens: hoogstens 50 regels per post (40 + 15 pogingen = 50 aanvaard, de rest geweigerd)", accepted === 50 && [...r1, ...r2].some((x) => /Te veel regels/.test(outErr(x))), String(accepted));
    // (J8) Een regel op een post die er niet meer in staat (nieuwe versie zonder post): alleen een correctie, geen nieuwe meting.
    const v2 = ok(await calc.newQuoteVersion(w.rd.version.quoteId, []));
    const m2 = fromRead(ok(await calc.readQuoteVersion(v2)));
    M.removeLine(m2, m2.lines.find((l) => l.title === "Proef container 10 m³ puin").key);
    const sv2 = await saveAll(calc, m2);
    if (sv2 && "err" in sv2) throw new Error(errOf(sv2));
    const rd2 = ok(await calc.readQuoteVersion(v2));
    ok(await calc.sendQuoteVersion(v2, rd2.version.rev, rd2.totals.totalCents, "proef: review J8"));
    ok(await calc.decideQuoteVersion(v2, true, "proef: review J8"));
    const sum2 = await wl.measureSummary(w.wid);
    const gone = sum2.posts.find((p) => p.title === "Proef container 10 m³ puin");
    check("(J8) meerwerk-versie zonder de container: de post blijft zichtbaar als 'niet meer in de offerte' met wat gemeten is; nieuwe meting op die post geweigerd", !!gone && !gone.inOffer && gone.measuredMilli === 2_000n && /niet \(meer\)/.test(outErr((await sync(wl, { opId: uid(), clientKey: K1, op: e(w.L.container, 1_000n) }))[0])), JSON.stringify([gone?.inOffer, gone?.measuredMilli], big));
  } finally {
    await admin.endMembership(mOa).catch(() => {});
    ok(await admin.saveMeasureSettings({ thresholdBp: st0.thresholdBp, oaPropose: st0.oaPropose, externalRead: st0.externalRead }));
    await admin.setWorkStatus(w.wid, { cancelled: null });
  }
}

// ── (K1–K8) stap 2.10: vorderingsstaten. Nooit een bedrag naar de werfleider of externen; een verzonden staat verandert nooit
//    (ook niet als de offerte of het model later wijzigt); twee gelijktijdige verzendingen = één nummer; geen id-orakel voor de
//    klant; de robot nergens; grenzen; crediteren enkel de laatste staat ──
{
  const did = readFileSync(join(import.meta.dirname, "../src/backend/dist/backend.did"), "utf8");
  const types = new Map([...did.matchAll(/^type (\w+) =([\s\S]*?);\n(?=type |service|$)/gm)].map((m) => [m[1], m[2]]));
  const fieldsOf = (n) => [...(types.get(n) ?? "").matchAll(/^\s+(\w+)\s*:/gm)].map((m) => m[1]);
  const qTypes = ["ProgressQtyLine", "ProgressQtyView", "ProgressHints", "ProgressBrief", "ProgressWorkBrief", "ProgressStatement", "ProgressInput", "ProgressInputOp", "MyProgressBrief"];
  const badQ = qTypes.flatMap((n) => fieldsOf(n).filter((f) => /cents|cost|margin|price|prijs|amount|bedrag|total|euro|payable|retention|revision/i.test(f)).map((f) => `${n}.${f}`));
  const moneyTypes = ["ProgressMoney", "ProgressLineView", "ProgressTotals", "ProgressLineFrozen", "ProgressFrozen", "ProgressFullView", "ProgressInvoiceData", "RevisionModel", "QuoteLinePrice", "ContractParams"];
  const refsQ = qTypes.filter((n) => moneyTypes.some((t) => new RegExp(`\\b${t}\\b`).test(types.get(n) ?? "")));
  check("(K1) de typen die de werfleider leest (en de interne records) hebben geen bedragveld en verwijzen niet naar een bedragtype", qTypes.every((n) => types.has(n)) && badQ.length === 0 && refsQ.length === 0, badQ.concat(refsQ).join(", ") || `${qTypes.length} typen`);
  const { proefVordering, saveAs } = await import("./vordering-lib.mjs");
  const ps0 = await admin.progressSettings();
  const V = await proefVordering({ admin, calc, wl }, { prefix: "P-VR", titleSuffix: " review 2.10" });
  try {
    const id = ok(await calc.newProgress(V.wid));
    const sv = await saveAs(calc, id, new Map(), { sIndex: 100_000n, iIndex: 200_000n });
    if ("err" in sv.r) throw new Error(sv.r.err);
    // (K2) Elk kanaal naar de bedragen is dicht voor de werfleider.
    const k2 = await Promise.all([wl.readProgressStatement(id), wl.progressInvoiceData(id), wl.readProgressRevision(V.wid), wl.exportChunk("progressFrozen", 0n, 10n), wl.exportChunk("progressConf", 0n, 10n), wl.exportChunk("progressRevisions", 0n, 10n), wl.readMyProgress(id)].map(denied));
    const q = await wl.progressQty(id);
    const keys = new Set();
    const walk = (x) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { keys.add(k); walk(v); } };
    walk(q);
    check("(K2) werfleider: staat met bedragen, factuurgegevens, rekenmodel, vertrouwelijke export en de klantlezing geweigerd; zijn eigen lezing draagt geen bedragsleutel", k2.every(Boolean) && ![...keys].some((k) => /cents|price|cost|margin|total|payable|retention|revision/i.test(k)), k2.map((x) => (x ? "·" : "✗")).join(""));
    // (K6) De robot nergens.
    check("(K6) de robot: menu, lijst, nieuw, lezen, bewaren, versturen en de klantfuncties geweigerd", (await Promise.all([robot.progressWorks(), robot.listProgress(V.wid), robot.newProgress(V.wid), robot.progressQty(id), robot.readProgressStatement(id), robot.sendProgress(id, 0n, 0n, "x"), robot.listMyProgress(), robot.readMyProgress(id)].map(denied))).every(Boolean));
    // (K7) Grenzen.
    const v0 = ok(await calc.readProgressStatement(id));
    const root = v0.lines[0].q.root;
    const many = Array.from({ length: 401 }, () => ({ root, cumPctBp: [], cumQtyMilli: [1n], note: "", clear: false }));
    const lim = await calc.saveProgressDraft(id, v0.brief.rev, { periodTo: [], note: [], setIndexes: false, sIndex: [], iIndex: [], lines: many, expect: [{ periodCents: 0n, revisionCents: 0n, vatCents: 0n, totalCents: 0n, payableCents: 0n }] });
    const big = await calc.saveProgressDraft(id, v0.brief.rev, { periodTo: [], note: ["x".repeat(1001)], setIndexes: false, sIndex: [], iIndex: [], lines: [], expect: [{ periodCents: 0n, revisionCents: 0n, vatCents: 0n, totalCents: 0n, payableCents: 0n }] });
    const idx = await calc.saveProgressDraft(id, v0.brief.rev, { periodTo: [], note: [], setIndexes: true, sIndex: [0n], iIndex: [1n], lines: [], expect: [{ periodCents: 0n, revisionCents: 0n, vatCents: 0n, totalCents: 0n, payableCents: 0n }] });
    const fut = await calc.saveProgressDraft(id, v0.brief.rev, { periodTo: [v0.brief.periodTo + 30n], note: [], setIndexes: false, sIndex: [], iIndex: [], lines: [], expect: [{ periodCents: 0n, revisionCents: 0n, vatCents: 0n, totalCents: 0n, payableCents: 0n }] });
    check("(K7) grenzen: 401 regels, een te lange notitie, indexwaarde 0, een periode in de toekomst: geweigerd", /Te veel/.test(errOf(lim)) && /te lang/.test(errOf(big)) && /Indexwaarde/.test(errOf(idx)) && /toekomst/.test(errOf(fut)), [lim, big, idx, fut].map(errOf).join(" | "));
    // (K4) Twee gelijktijdige verzendingen met dezelfde bewerkteller: één nummer.
    const v1 = ok(await calc.readProgressStatement(id));
    const [s1, s2] = await Promise.all([calc.sendProgress(id, v1.brief.rev, v1.totals.totalCents, "proef: review K4"), admin.sendProgress(id, v1.brief.rev, v1.totals.totalCents, "proef: review K4")]);
    const okCount = [s1, s2].filter(isOk).length;
    const vs = (await calc.listProgress(V.wid)).filter((b) => b.code.startsWith("VS "));
    check("(K4) twee gelijktijdige verzendingen: precies één verstuurd, één nummer (VS …/1)", okCount === 1 && vs.length === 1 && vs[0].code.endsWith("/1"), [s1, s2].map((x) => (isOk(x) ? x.ok : x.err)).join(" | "));
    // (K5) Een verzonden staat verandert niet als de offerte (nieuwe aanvaarde versie met andere prijzen) of het model later wijzigt.
    const before = ok(await calc.readProgressStatement(id));
    const nv = ok(await calc.newQuoteVersion(V.q1.quoteId, []));
    {
      const m = fromRead(ok(await calc.readQuoteVersion(nv)));
      for (const l of M.activeLines(m)) M.updateLine(m, l.key, { price: { ...l.price, cost: (l.price.cost ?? 0n) * 2n } });
      const r = await saveAll(calc, m);
      if (r && "err" in r) throw new Error(errOf(r));
      const rd = ok(await calc.readQuoteVersion(nv));
      ok(await calc.sendQuoteVersion(nv, rd.version.rev, rd.totals.totalCents, "proef: review K5"));
      ok(await calc.decideQuoteVersion(nv, true, "proef: review K5"));
    }
    ok(await calc.saveProgressRevision(V.wid, { aBp: 10_000n, bBp: 0n, cBp: 0n, sBase: 1n, iBase: 1n, sLabel: "", iLabel: "", note: "proef K5" }));
    const after = ok(await calc.readProgressStatement(id));
    check("(K5) na een nieuwe aanvaarde versie met dubbele prijzen en een ander model: zelfde hash, zelfde totalen, intact", after.hash === before.hash && after.totals.totalCents === before.totals.totalCents && after.lines[0].m.unitPriceCents === before.lines[0].m.unitPriceCents && after.intact);
    const n2 = ok(await calc.newProgress(V.wid));
    const d2 = ok(await calc.readProgressStatement(n2));
    check("(K5) een nieuwe staat rekent wel met de nieuwe prijzen, en de vorige staten blijven die van de verzonden staat", d2.lines.find((l) => l.q.root === before.lines[0].q.root).m.unitPriceCents === before.lines[0].m.unitPriceCents * 2n && d2.lines.find((l) => l.q.root === before.lines[0].q.root).m.prevCents === before.lines[0].m.cumCents);
    // (K3) Geen id-orakel voor de klant: een staat van een werf waar hij geen klant is = een onbekende staat.
    const r3a = await klant.readMyProgress(id);
    const r3b = await klant.readMyProgress(999_999_999n);
    const r3c = await klant.answerMyProgress(id, before.hash, true, "");
    check("(K3) klant zonder lidmaatschap: dezelfde 'Onbekende staat' als voor een onbestaande staat, ook bij antwoorden", errOf(r3a) === "Onbekende staat" && errOf(r3b) === "Onbekende staat" && errOf(r3c) === "Onbekende staat" && !(await klant.listMyProgress()).some((x) => x.id === id));
    // (K8) Crediteren: een ontwerp op de werf blokkeert, enkel de laatste staat; na de creditnota telt de volgende verder op de staat ervoor.
    check("(K8) crediteren terwijl er een ontwerp open is: geweigerd", /ontwerp open/.test(errOf(await calc.creditProgress(id, "proef: review K8"))));
    ok(await calc.cancelProgressDraft(n2, "proef: review K8"));
    const cn = ok(await calc.creditProgress(id, "proef: review K8"));
    check("(K8) een tweede creditnota-ontwerp naast het eerste: geweigerd", /ontwerp open/.test(errOf(await calc.creditProgress(id, "proef: review K8 nog eens"))));
    const cv = ok(await calc.readProgressStatement(cn));
    ok(await calc.sendProgress(cn, cv.brief.rev, cv.totals.totalCents, ""));
    const n3 = ok(await calc.newProgress(V.wid));
    const d3 = ok(await calc.readProgressStatement(n3));
    check("(K8) na de creditnota: geen vorige staten meer (de enige staat is gecrediteerd)", d3.totals.prevCents === 0n && d3.lines.every((l) => l.m.prevCents === 0n));
    ok(await calc.cancelProgressDraft(n3, "proef: review opgeruimd"));
  } finally {
    await admin.setWorkStatus(V.wid, { cancelled: null }).catch(() => {});
    await admin.saveProgressSettings(ps0).catch(() => {});
  }
}

// ── (L1–L6) stap 2.11: OA-facturen. Nooit een bedrag naar de werfleider of een OA; geen id-orakel; de inhoudingsplicht is
//    verplicht; een goedgekeurde factuur verandert niet; twee gelijktijdige goedkeuringen = één; de robot nergens ──
{
  const did = readFileSync(join(import.meta.dirname, "../src/backend/dist/backend.did"), "utf8");
  const types = new Map([...did.matchAll(/^type (\w+) =([\s\S]*?);\n(?=type |service|$)/gm)].map((m) => [m[1], m[2]]));
  const fieldsOf = (n) => [...(types.get(n) ?? "").matchAll(/^\s+(\w+)\s*:/gm)].map((m) => m[1]);
  const qTypes = ["OaLineQty", "OaInvoiceQtyView", "OaInvoiceBrief", "OaHoursView", "OaInvoice", "MyOaInvoice", "OaInvoiceDecision"];
  const badQ = qTypes.flatMap((n) => fieldsOf(n).filter((f) => /cents|cost|margin|price|prijs|amount|bedrag|total|euro|agreed/i.test(f)).map((f) => `${n}.${f}`));
  const moneyTypes = ["OaLineMoney", "OaLineView", "OaInvoiceAmounts", "OaInvoiceLine", "OaInvoiceFullView", "QuoteLinePrice", "ContractParams"];
  const refsQ = qTypes.filter((n) => moneyTypes.some((t) => new RegExp(`\\b${t}\\b`).test(types.get(n) ?? "")));
  check("(L1) de typen die de werfleider en de OA lezen (en het interne record) hebben geen bedragveld en verwijzen niet naar een bedragtype", qTypes.every((n) => types.has(n)) && badQ.length === 0 && refsQ.length === 0, badQ.concat(refsQ).join(", ") || `${qTypes.length} typen`);
  const { proefVordering } = await import("./vordering-lib.mjs");
  const s0 = await admin.oaInvoiceSettings();
  const V = await proefVordering({ admin, calc, wl }, { prefix: "P-OFR", titleSuffix: " review 2.11", model: false });
  try {
    const posts = await calc.oaInvoicePosts(V.wid);
    const root = posts.find((p) => p.title.startsWith("Proef container")).root;
    const nr = `PFR-${Date.now().toString(36).toUpperCase()}`;
    const fid = ok(await calc.addFile("proef-review.pdf", "application/pdf", 10_000n, new TextEncoder().encode("!caf!sha256:" + "a".repeat(64)), [V.wid], true));
    const cDayL = BigInt(Math.floor(Number((await admin.auditLog(0n, 1n))[0].at / 1_000_000n) / 86_400_000));
    if (!orgDak.kbo.length) ok(await admin.updateOrg(orgDak.id, { kind: orgDak.kind, name: orgDak.name, kbo: ["0999111222"], vat: orgDak.vat, aliases: orgDak.aliases, trades: orgDak.trades, address: orgDak.address, notes: orgDak.notes }));
    const inv = { id: [], orgId: orgDak.id, workId: V.wid, number: nr, invoiceDay: cDayL, dueDay: [], periodFrom: [], periodTo: [], vatRegime: { reverse: null }, reverseMention: true, fileId: [fid], note: "", netCents: 32_000n, vatCents: 0n, totalCents: 32_000n, lines: [{ kind: { post: null }, root: [root], description: "container", qtyMilli: 1_000n, unitCents: 32_000n, amountCents: 32_000n }] };
    const id = ok(await calc.saveOaInvoice(inv, 0n));
    // (L2) Elk kanaal naar de bedragen is dicht voor de werfleider en de OA.
    const l2 = await Promise.all([wl.readOaInvoice(id), wl.exportChunk("oaInvoiceAmounts", 0n, 10n), wl.oaInvoicePosts(V.wid), oa2.readOaInvoice(id), oa2.oaInvoiceQty(id), oa2.listOaInvoices([], [])].map(denied));
    check("(L2) werfleider en OA: factuur met bedragen, vertrouwelijke export, posten van het formulier; de OA ook de regels en de lijst: geweigerd", l2.every(Boolean), l2.map((x) => (x ? "·" : "✗")).join(""));
    // (L3) Geen id-orakel: een onbekende en een bestaande factuur geven voor wie niet mag hetzelfde antwoord.
    const a1 = await arch.oaInvoiceQty(id).then((r) => "ok", (e) => String(e).includes("Geen toegang") ? "geen" : "?");
    const a2 = await arch.oaInvoiceQty(999_999_999n).then((r) => "ok", (e) => String(e).includes("Geen toegang") ? "geen" : "?");
    check("(L3) architect: dezelfde 'Geen toegang' voor een bestaande en een onbekende factuur", a1 === "geen" && a2 === "geen");
    // (L4) De robot nergens.
    check("(L4) de robot: lijst, lezen, registreren, goedkeuren en 'mijn facturen' geweigerd", (await Promise.all([robot.listOaInvoices([], []), robot.readOaInvoice(id), robot.saveOaInvoice(inv, 0n), robot.approveOaInvoice(id, 0n, { exception: "x".repeat(20) }, "x"), robot.myOaInvoices()].map(denied))).every(Boolean));
    // (L5) Inhoudingsplicht verplicht; twee gelijktijdige goedkeuringen = één beslissing.
    const v = ok(await calc.readOaInvoice(id));
    check("(L5) goedkeuren zonder raadpleging van vandaag en zonder uitzondering kan niet (een onbekende raadpleging)", /Onbekende raadpleging/.test(errOf(await calc.approveOaInvoice(id, v.brief.rev, { check: 999_999_999n }, "proef"))));
    const ref = `PROEF-REVIEW-L5-${nr}`;
    ok(await calc.recordWithholdingCheck(orgDak.id, { result: { clear: null }, consultedOn: cDayL, reference: ref, note: "proef", workId: [V.wid] }));
    const chkId = (await calc.withholdingHistory(orgDak.id)).find((c) => c.reference === ref).id;
    const [r1, r2] = await Promise.all([calc.approveOaInvoice(id, v.brief.rev, { check: chkId }, "proef: review L5"), admin.approveOaInvoice(id, v.brief.rev, { check: chkId }, "proef: review L5")]);
    check("(L5) twee gelijktijdige goedkeuringen met dezelfde bewerkteller: precies één", [r1, r2].filter(isOk).length === 1, [r1, r2].map((x) => (isOk(x) ? "ok" : x.err)).join(" | "));
    // (L6) Een goedgekeurde factuur verandert niet: ook niet via een nieuwe registratie met hetzelfde nummer, of via de werf.
    const after = ok(await calc.readOaInvoice(id));
    check("(L6) goedgekeurd: verbeteren, intrekken en een tweede registratie met hetzelfde nummer geweigerd; bedragen ongewijzigd", /Enkel een geregistreerde/.test(errOf(await calc.saveOaInvoice({ ...inv, id: [id], netCents: 1n }, after.brief.rev))) && /goedgekeurd/.test(errOf(await calc.withdrawOaInvoice(id, after.brief.rev, "proef: review L6"))) && /al geregistreerd/.test(errOf(await calc.saveOaInvoice(inv, 0n))) && after.netCents === 32_000n);
    // (M6, 2.12) Goedkeuren met een gemotiveerde uitzondering (zonder raadpleging): de motivering staat in de auditlog.
    const nr2 = `${nr}-M6`;
    const id2 = ok(await calc.saveOaInvoice({ ...inv, number: nr2 }, 0n));
    const v2 = ok(await calc.readOaInvoice(id2));
    const r6 = await calc.approveOaInvoice(id2, v2.brief.rev, { exception: `proef M6: geen raadpleging mogelijk (${nr})` }, "proef: review M6");
    const a6 = (await admin.auditLog(0n, 8n)).find((x) => x.action === "oa-factuur-goedgekeurd" && x.detail.includes(nr2));
    check("(M6) goedkeuren met een uitzondering: de motivering staat in de auditlog", isOk(r6) && !!a6 && a6.detail.includes("uitzondering op de inhoudingsplicht: proef M6"), errOf(r6) || a6?.detail || "geen auditregel");
  } finally {
    await admin.setWorkStatus(V.wid, { cancelled: null }).catch(() => {});
    await admin.saveOaInvoiceSettings(s0).catch(() => {});
  }
}

// ── (M1, M2, M4, M5) securityreview 2.12: de getekende offerte enkel als vertrouwelijk bestand (geen opslag-URL voor de werfleider,
//    niets voor een externe); een klant van een ANDERE organisatie op dezelfde werf leest en aanvaardt een versie niet; de poort
//    "Mijn facturen" via Rights.mo (schakelaar én nog ergens actief OA, R31); geen enkel bestand buiten Rights.mo test zelf op een rol ──
{
  const stamp = Date.now().toString(36).toUpperCase();
  const addr = { street: "Proefstraat", number: "12", zip: "8670", city: "Koksijde", country: "BE" };
  await ensureProofClientAddress(admin);
  const wlId = (await wl.me()).person[0].id;
  const klantId = (await klant.me()).person[0].id;
  const wid = ok(await admin.createWork({ code: `P-SR-${stamp}`, name: "Proefwerf review 2.12", address: addr, parentId: [], clientOrgId: [orgKlant.id], architectOrgId: [], leaderPersonId: [wlId], vatBp: 2100n })).id;
  const mkSent = async (nr, clientOrgId) => {
    const q = ok(await calc.createQuote({ workId: wid, number: nr, title: "Proef review 2.12 (verzonnen)" }));
    const m = fromRead(ok(await calc.readQuoteVersion(q.versionId)));
    M.setHeader(m, { clientOrgId });
    const c = M.addChapter(m, { code: "01", title: "Proef" });
    M.addLine(m, c.key, { title: "Proef reviewlijn 2.12", qtyMilli: 2_000n, unit: "st", form: "fixed", price: { cost: 5_000n, rule: null, reason: "", orgId: null, source: "eigen", libCostId: null } });
    const r = await saveAll(calc, m);
    if (r && "err" in r) throw new Error(errOf(r));
    const rd = ok(await calc.readQuoteVersion(q.versionId));
    return { vid: q.versionId, hash: ok(await calc.sendQuoteVersion(q.versionId, rd.version.rev, rd.totals.totalCents, "proef: review 2.12")) };
  };
  const pdfRef = (h) => new TextEncoder().encode("!caf!sha256:" + h.repeat(64));
  const mOa = ok(await admin.addMembership(wid, [oa2Id], [], { onderaannemer: null }, []));
  const mKl = ok(await admin.addMembership(wid, [klantId], [], { klant: null }, []));
  try {
    // (M1) De getekende offerte-PDF draagt alle verkoopprijzen en de klantgegevens: enkel als vertrouwelijk bestand.
    const s1 = await mkSent(`SR-${stamp}-A`, orgKlant.id);
    const fOpen = ok(await calc.addFile("getekend-open.pdf", "application/pdf", 10_000n, pdfRef("d"), [wid], false));
    const rOpen = await calc.registerSignedQuote(s1.vid, fOpen, "proef M1");
    check("(M1) getekende offerte als gewoon (niet-vertrouwelijk) bestand registreren: geweigerd, de versie blijft verstuurd", /vertrouwelijk/.test(errOf(rOpen)) && "sent" in ok(await calc.readQuoteVersion(s1.vid)).version.status, errOf(rOpen));
    ok(await admin.archiveFile(fOpen));
    const fConf = ok(await calc.addFile("getekend-vertrouwelijk.pdf", "application/pdf", 10_000n, pdfRef("e"), [wid], true));
    const rConf = await calc.registerSignedQuote(s1.vid, fConf, "proef M1");
    check("(M1) als vertrouwelijk bestand: aanvaard, de versie is aanvaard", isOk(rConf) && "accepted" in ok(await calc.readQuoteVersion(s1.vid)).version.status, errOf(rConf));
    const wlSigned = (await wl.listFiles([wid])).find((f) => f.id === fConf);
    check("(M1) werfleider: het getekende bestand zonder verwijzing (geen opslag-URL) en readConfidentialFile geweigerd", !!wlSigned && wlSigned.blob.length === 0 && (await denied(wl.readConfidentialFile(fConf))), JSON.stringify(wlSigned?.blob?.length));
    check("(M1) OA op de werf: ziet het getekende bestand niet, ook niet via readConfidentialFile; kantoor opent het met een auditregel", !(await oa2.listFiles([wid])).some((f) => f.id === fConf) && (await denied(oa2.readConfidentialFile(fConf))) && isOk(await calc.readConfidentialFile(fConf)));
    await admin.dismissWorkStart(s1.vid, "proef: review 2.12 opgeruimd").catch(() => {});
    // (M2) Een versie gericht aan een andere klantorganisatie: voor deze klant onbekend, ook al is hij klant-lid van de werf.
    let org2 = (await admin.listOrgs(true)).find((o) => o.name === "Proef Klant Twee (review 2.12)");
    if (!org2) org2 = ok(await admin.createOrg({ kind: { client: null }, name: "Proef Klant Twee (review 2.12)", kbo: [], vat: [], aliases: [], trades: [], address: [addr], notes: "verzonnen, enkel voor tests/review.mjs" }));
    const s2 = await mkSent(`SR-${stamp}-B`, org2.id);
    const r2a = await klant.readMyQuote(s2.vid);
    const r2b = await klant.acceptMyQuote(s2.vid, s2.hash);
    check("(M2) klant op de werf: een versie aan een ANDERE klantorganisatie = 'Onbekende offerte' bij lezen én aanvaarden; niet in zijn lijst; de versie blijft verstuurd", errOf(r2a) === "Onbekende offerte" && errOf(r2b) === "Onbekende offerte" && !(await klant.listMyQuotes()).some((x) => x.versionId === s2.vid) && "sent" in ok(await calc.readQuoteVersion(s2.vid)).version.status, `${errOf(r2a)} | ${errOf(r2b)}`);
    check("(M2) … en de versie aan zijn eigen organisatie leest hij wel", isOk(await klant.readMyQuote(s1.vid)));
  } finally {
    await admin.endMembership(mOa).catch(() => {});
    await admin.endMembership(mKl).catch(() => {});
    await admin.setWorkStatus(wid, { cancelled: null }).catch(() => {});
  }
  // (M4) De poort "Mijn facturen": enkel een OA die nog ergens actief lid is (R31). Enkel lokaal: op een draft maakt dit een
  // persoon en een melding bij de beheerders.
  if (local) {
    const s0 = await admin.oaInvoiceSettings();
    ok(await admin.saveOaInvoiceSettings({ ...s0, oaView: true }));
    try {
      // Een firma ZONDER lidmaatschappen (een persoon van Proef Dak NV is via zijn firma al OA op P-B: rechten = som van persoon en firma, R2).
      let orgLos = (await admin.listOrgs(true)).find((o) => o.name === "Proef OA Los (review 2.12)");
      if (!orgLos) orgLos = ok(await admin.createOrg({ kind: { subcontractor: null }, name: "Proef OA Los (review 2.12)", kbo: [], vat: [], aliases: [], trades: [], address: [], notes: "verzonnen, zonder werven" }));
      const inv = ok(await admin.invitePerson({ name: "Proef OA zonder werf (review 2.12)", roles: [{ onderaannemer: null }], orgId: [orgLos.id], shortCode: [], lang: [], phone: [], workIds: [], validDays: 1n, tag: "review" }));
      const x = await freshBackend(cid);
      ok(await x.redeemCode(inv.code));
      check("(M4) OA zonder actief lidmaatschap: 'Mijn facturen' geweigerd en caps.myOaInvoices nee, ook met de schakelaar aan", (await denied(x.myOaInvoices())) && !(await x.me()).caps[0].myOaInvoices);
      const m = ok(await admin.addMembership(B, [inv.personId], [], { onderaannemer: null }, []));
      check("(M4) met een lidmaatschap op P-B: toegelaten (caps ja)", Array.isArray(await x.myOaInvoices()) && (await x.me()).caps[0].myOaInvoices);
      ok(await admin.endMembership(m));
      check("(M4) lidmaatschap beëindigd: meteen weer geweigerd (R31)", await denied(x.myOaInvoices()));
      ok(await admin.archivePerson(inv.personId));
    } finally {
      ok(await admin.saveOaInvoiceSettings(s0));
    }
  }
  // (M5) Mechanisch op de broncode: geen enkel bestand buiten lib/Rights.mo test zelf op een rol (architectuur §4.1).
  const { readdirSync, statSync } = await import("node:fs");
  const root = join(import.meta.dirname, "../src/backend");
  const files = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) { if (n !== "dist" && n !== ".most") walk(p); } else if (n.endsWith(".mo")) files.push(p); } };
  walk(root);
  const badRoles = files.filter((p) => !p.endsWith("/lib/Rights.mo") && /\broles\s*\.\s*(find|any|all|some)\s*\(\s*func\s+\w+\s*=\s*\w+\s*==\s*#/.test(readFileSync(p, "utf8"))).map((p) => p.slice(root.length + 1));
  check("(M5) geen enkel bestand buiten lib/Rights.mo test zelf op een rol (roles.find/any/all … == #rol)", files.length > 60 && badRoles.length === 0, badRoles.join(", ") || `${files.length} bestanden`);
}

// ── (B11) Pogingentellers worden opgeruimd door de timer (T11); enkel lokaal met de klok ──
if (local && !process.env.ZONDER_KLOK) {
  const before = (await admin.accessStats()).attemptsTracked;
  for (let i = 0; i < 3; i++) await (await freshBackend(cid)).redeemCode("BOW-ZZZZ-ZZZZ-ZZZ1");
  const mid = (await admin.accessStats()).attemptsTracked;
  check("(B11) drie vreemde principals met een foute code: drie tellers erbij", mid >= before + 3n, `${before} → ${mid}`);
  const netDir = process.env.BOWACO_NET || join(KEYDIR, "net");
  const d = JSON.parse(readFileSync(join(netDir, ".icp/cache/networks/local/descriptor.json"), "utf8"));
  const base = `http://127.0.0.1:${d["pocketic-config-port"]}/instances/${d["pocketic-instance-id"]}`;
  const now = BigInt((await (await fetch(`${base}/read/get_time`)).json()).nanos_since_epoch);
  // 2 uur verder (venster voorbij), daarna een paar tikken van de timer (elke 10 min) laten lopen.
  await fetch(`${base}/update/set_time`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nanos_since_epoch: Number(now + 2n * 3_600_000_000_000n) }) });
  await new Promise((r) => setTimeout(r, 1500));
  let after = mid;
  for (let i = 0; i < 6 && after >= mid; i++) {
    const t = BigInt((await (await fetch(`${base}/read/get_time`)).json()).nanos_since_epoch);
    await fetch(`${base}/update/set_time`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nanos_since_epoch: Number(t + 11n * 60_000_000_000n) }) });
    await new Promise((r) => setTimeout(r, 1500));
    const a = await backend("proef-admin", cid);
    await a.markNotificationsRead([]).catch(() => {}); // een update-call laat het net een ronde draaien
    after = (await a.accessStats()).attemptsTracked;
  }
  check("(B11) na 2 uur ruimt de timer de verlopen tellers op", after < mid, `${mid} → ${after}`);
}

console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
