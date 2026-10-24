// Securityreview 0.7/1.9: de aanvallen die de review opleverde, als vaste controle na tests/rollen.mjs en tests/lek.mjs
// op dezelfde canister (gebruikt diens werven P-A/P-B, firma's en testidentiteiten). Elke regel hier hoort bij een
// bevinding in BOWACO_securityreview_0.7_1.9.md (nummer tussen haakjes). Laat niets bruikbaars achter.
//   lokaal:  ICP_HOST=http://localhost:8041 node tests/review.mjs <canister-id>
//   draft:   node tests/review.mjs <canister-id>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { backend, freshBackend, identity, KEYDIR, ok } from "../tools/lib.mjs";

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
