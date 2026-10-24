// Securityreview 0.7/1.9: de aanvallen die de review opleverde, als vaste controle na tests/rollen.mjs en tests/lek.mjs
// op dezelfde canister (gebruikt diens werven P-A/P-B, firma's en testidentiteiten). Elke regel hier hoort bij een
// bevinding in BOWACO_securityreview_0.7_1.9.md (nummer tussen haakjes). Laat niets bruikbaars achter.
//   lokaal:  ICP_HOST=http://localhost:8041 node tests/review.mjs <canister-id>
//   draft:   node tests/review.mjs <canister-id>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { backend, freshBackend, identity, KEYDIR, nepmail, ok, setCanisterEnv } from "../tools/lib.mjs";

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
  const draftCid = cid === "w5pbr-raaaa-aaaal-qs3aq-cai";
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
