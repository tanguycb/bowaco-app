// Securityreview 0.7/1.9: de aanvallen die de review opleverde, als vaste controle na tests/rollen.mjs en tests/lek.mjs
// op dezelfde canister (gebruikt diens werven P-A/P-B, firma's en testidentiteiten). Elke regel hier hoort bij een
// bevinding in BOWACO_securityreview_0.7_1.9.md (nummer tussen haakjes). Laat niets bruikbaars achter.
//   lokaal:  ICP_HOST=http://localhost:8041 node tests/review.mjs <canister-id>
//   draft:   node tests/review.mjs <canister-id>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { backend, freshBackend, identity, KEYDIR, nepmail, ok, setCanisterEnv } from "../tools/lib.mjs";
import { M, batchArgs, ensureProofClientAddress, expectRaw, fromRead, sameTotals, saveAll } from "./offerte-lib.mjs";

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
