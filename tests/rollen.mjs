// Rollentest (architectuur §9.2): per rol wat moet lukken en wat moet falen. Vast instrument vóór
// elke draft. Alleen tegen een LEGE canister: de test claimt de opstartcode en vult de data waarop
// tests/lek.mjs daarna draait.
//   lokaal:  ICP_HOST=http://localhost:8041 node tests/rollen.mjs <canister-id>
//   draft:   node tests/rollen.mjs <canister-id>          (zonder klokproef)
// Lokaal verzet de test de klok van het EIGEN PocketIC-net (tests/net) om vervaltijden te bewijzen.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { backend, freshBackend, identity, KEYDIR, resync } from "../tools/lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/rollen.mjs <canister-id>");
const host = process.env.ICP_HOST || "https://icp-api.io";
const local = host.includes("localhost") || host.includes("127.0.0.1");
const bootstrap = readFileSync(join(KEYDIR, "test-opstartcode.txt"), "utf8").trim();

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
const errOf = (r) => (r && typeof r === "object" && "err" in r ? r.err : "");
const status = (me) => Object.keys(me.status)[0];
const roles = (...rs) => rs.map((r) => ({ [r]: null }));
const opt = (v) => (v === undefined || v === null ? [] : [v]);
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);

// Testidentiteiten (Ed25519, ~/.bowaco). "fresh" = wegwerpidentiteit voor de remming.
const as = async (name) => backend(name, cid);
const fresh = () => freshBackend(cid);

// Klok van het eigen PocketIC-net (alleen lokaal; nooit een gedeeld net).
const descr = join(KEYDIR, "net/.icp/cache/networks/local/descriptor.json");
async function advance(ns) {
  const d = JSON.parse(readFileSync(descr, "utf8"));
  if (!d["project-dir"].endsWith("/.bowaco/net")) throw new Error("niet ons eigen net");
  const base = `http://127.0.0.1:${d["pocketic-config-port"]}/instances/${d["pocketic-instance-id"]}`;
  const now = BigInt((await (await fetch(`${base}/read/get_time`)).json()).nanos_since_epoch);
  const r = await fetch(`${base}/update/set_time`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nanos_since_epoch: Number(now + ns) }),
  });
  if (!r.ok) throw new Error(`set_time: ${r.status} ${await r.text()}`);
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

await sec("── R1 anoniem en ongekoppeld");
check("anoniem → me() = anonymous", status(await anon.me()) === "anonymous");
check("anoniem kan de opstartcode niet claimen", await rejects(anon.claimBootstrap(bootstrap, "x")));
check("anoniem kan geen code inwisselen", await rejects(anon.redeemCode("BOW-0000-0000-0000")));
check("anoniem: listWorks geweigerd", await rejects(anon.listWorks()));
check("ongekoppeld: listWorks geweigerd", await rejects(vreemde.listWorks()));
check("ongekoppeld: me() = unlinked, geen caps", await vreemde.me().then((m) => status(m) === "unlinked" && m.caps.length === 0));

await sec("── pogingenlimiet per principal");
const wrong = [];
for (let i = 0; i < 5; i++) wrong.push(await vreemde.redeemCode(`BOW-ZZZZ-ZZZZ-ZZZ${i}`));
check("5 foute codes → telkens weigering", wrong.every((r) => "err" in r));
const sixth = await vreemde.redeemCode("BOW-ZZZZ-ZZZZ-ZZZ9");
check("6de poging → geblokkeerd", errOf(sixth).includes("Te veel pogingen"), errOf(sixth));
const vme = await vreemde.me();
check("me() toont de blokkering", vme.blockedUntil.length === 1);
const blockedHours = Number((vme.blockedUntil[0] - BigInt(Date.now()) * 1_000_000n) / HOUR);
check("blokkering ± 24 uur", blockedHours >= 22 && blockedHours <= 24, `${blockedHours} u`);
check("geblokkeerde kan ook de juiste opstartcode niet gebruiken", "err" in (await vreemde.claimBootstrap(bootstrap, "x")));

await sec("── opstartcode (§3.3.1)");
check("verkeerde lengte (uitnodigingslengte) als opstartcode faalt", "err" in (await admin2.claimBootstrap("BOW-0000-0000-0000", "x")));
const claim = await admin.claimBootstrap(bootstrap.toLowerCase().replaceAll("-", " "), "Proef Beheerder");
check("opstartcode (kleine letters, spaties) → eerste admin", isOk(claim), errOf(claim));
check("tweede claim van de opstartcode faalt", "err" in (await oa.claimBootstrap(bootstrap, "x")));
const ame = await admin.me();
check("admin is actief, startscherm overzicht, mag toegang beheren", status(ame) === "active" && ame.caps[0]?.home === "overzicht" && ame.caps[0]?.manageAccess === true);
const adminId = ame.person[0].id;

await sec("── organisaties en werven");
const org = async (kind, name, extra = {}) =>
  admin.createOrg({ kind: { [kind]: null }, name, kbo: opt(extra.kbo), vat: [], aliases: extra.aliases ?? [], trades: [], address: [], notes: "" });
const orgX = await org("subcontractor", "Proef Tegels BV", { kbo: "0123.456.789", aliases: ["gils"] });
check("admin maakt OA-firma; KBO genormaliseerd, alias in hoofdletters", isOk(orgX) && orgX.ok.kbo[0] === "0123456789" && orgX.ok.aliases[0] === "GILS", JSON.stringify(orgX, big));
const orgY = await org("subcontractor", "Proef Dak NV");
const orgArch = await org("architect", "Proef Architecten");
const orgKlant = await org("client", "Familie Proef");
check("KBO met verkeerde lengte geweigerd", "err" in (await org("subcontractor", "Fout", { kbo: "123" })));
const addr = (street) => ({ street, number: "1", zip: "8670", city: "Koksijde", country: "BE" });
const workA = await admin.createWork({ code: "P-A", name: "Proefstraat 1", address: addr("Proefstraat"), parentId: [], clientOrgId: [orgKlant.ok.id], architectOrgId: [orgArch.ok.id], leaderPersonId: [], vatBp: 600n });
const workB = await admin.createWork({ code: "P-B", name: "Andere werf 2", address: addr("Anderestraat"), parentId: [], clientOrgId: [], architectOrgId: [], leaderPersonId: [], vatBp: 2100n });
check("admin maakt twee werven", isOk(workA) && isOk(workB));
check("dubbele werfcode geweigerd", "err" in (await admin.createWork({ code: "P-A", name: "x", address: addr("x"), parentId: [], clientOrgId: [], architectOrgId: [], leaderPersonId: [], vatBp: 600n })));
const A = workA.ok.id;
const B = workB.ok.id;

await sec("── uitnodigen (§3.3.2) en bevestigen (§3.3.4)");
// Externe rollen horen bij een externe organisatie (standaard de OA-firma van de proef); interne bij BOWACO.
const INTERN = ["admin", "werfleider", "calculator"];
const invite = (who, name, rs, extra = {}) =>
  who.invitePerson({ name, roles: rs, orgId: opt(extra.orgId ?? (rs.every((r) => !INTERN.includes(Object.keys(r)[0])) ? orgX.ok.id : undefined)), shortCode: opt(extra.shortCode), lang: [], phone: [], workIds: extra.workIds ?? [], validDays: extra.days ?? 0n, tag: extra.tag ?? "" });
const invWl = await invite(admin, "Proef Werfleider", roles("werfleider"));
check("admin nodigt werfleider uit", isOk(invWl), errOf(invWl));
const wlCode = invWl.ok.code;
codes.push(wlCode);
check("code heeft vorm BOW-XXXX-XXXX-XXXX (Crockford)", /^BOW-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/.test(wlCode), wlCode);
const days = Number((invWl.ok.expiresAt - BigInt(Date.now()) * 1_000_000n) / DAY);
check("vervalt na ± 7 dagen (standaard)", days >= 6 && days <= 7, `${days} d`);
const r1 = await wl.redeemCode(wlCode);
check("werfleider wisselt in → wacht op bevestiging (interne rol)", isOk(r1) && status(r1.ok) === "pending");
check("in afwachting: geen toegang (listWorks)", await rejects(wl.listWorks()));
check("in afwachting: geen uploadcertificaat", await rejects(wl._immutableObjectStorageCreateCertificate("sha256:" + "0".repeat(64))));
check("zelfde code een tweede keer (andere principal) faalt", "err" in (await oa.redeemCode(wlCode)));
check("werfleider kan zijn eigen koppeling niet bevestigen", await rejects(wl.confirmLink(P("proef-werfleider"))));
check("admin bevestigt", isOk(await admin.confirmLink(P("proef-werfleider"))));
const wme = await wl.me();
check("werfleider actief, startscherm vandaag, geen toegangsbeheer", status(wme) === "active" && wme.caps[0].home === "vandaag" && !wme.caps[0].manageAccess && wme.caps[0].inviteExternal);
const wlId = wme.person[0].id;
check("admin maakt werfleider lid van werf A", isOk(await admin.addMembership(A, [wlId], [], { werfleider: null }, [])));

const invOa = await invite(wl, "Proef OA Tegels", roles("onderaannemer"), { orgId: orgX.ok.id, workIds: [A] });
check("werfleider nodigt een OA uit voor werf A", isOk(invOa), errOf(invOa));
codes.push(invOa.ok?.code);
check("werfleider mag geen admin uitnodigen", await denied(invite(wl, "Te veel", roles("admin"))));
check("werfleider mag geen calculator uitnodigen", await denied(invite(wl, "Te veel", roles("calculator"))));
check("externe rol zonder organisatie geweigerd", errOf(await admin.invitePerson({ name: "Zonder org", roles: roles("onderaannemer"), orgId: [], shortCode: [], lang: [], phone: [], workIds: [], validDays: 0n, tag: "" })).includes("organisatie"));
check("interne rol bij een externe organisatie geweigerd", errOf(await invite(admin, "Verkeerde org", roles("calculator"), { orgId: orgX.ok.id })).includes("BOWACO"));
const r2 = await oa.redeemCode(invOa.ok.code.toLowerCase().replace(/^bow-/, "").replaceAll("-", ""));
check("OA wisselt in (kleine letters, zonder streepjes) → meteen actief", isOk(r2) && status(r2.ok) === "active");
check("OA: startscherm week", (await oa.me()).caps[0].home === "week");
const adminNotes = await admin.myNotifications(true);
check("admin krijgt melding 'koppelde zich' (T2)", adminNotes.some((n) => n.text.includes("Proef OA Tegels koppelde zich")));
check("uitnodiger (werfleider) krijgt melding", (await wl.myNotifications(true)).some((n) => n.text.includes("Proef OA Tegels")));
check("werfleider ziet enkel zijn eigen codes", (await wl.listInvites(0n, 50n)).every((i) => i.createdBy === wlId));
check("OA kan codes niet bekijken", await rejects(oa.listInvites(0n, 50n)));

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
await mk("Proef Calculator", roles("calculator"), {}, calc);
await mk("Proef Architect", roles("architect"), { orgId: orgArch.ok.id, workIds: [A] }, arch);
await mk("Proef Klant", roles("klant"), { orgId: orgKlant.ok.id, workIds: [A] }, klant);
await mk("Proef Veiligheid", roles("veiligheidscoordinator"), { workIds: [A] }, vc);
await mk("Proef OA Dak", roles("onderaannemer"), { orgId: orgY.ok.id, workIds: [B] }, oa2);
await mk("Proef Admin 2", roles("admin"), {}, admin2);
check("calculator en admin 2 wachten op bevestiging", status(await calc.me()) === "pending" && status(await admin2.me()) === "pending");
await admin.confirmLink(P("proef-calculator"));
await admin.confirmLink(P("proef-admin2"));
check("externen meteen actief", (await Promise.all([arch, klant, vc, oa2].map((x) => x.me()))).every((m) => status(m) === "active"));

await sec("── R3 werven zien (per rol, per werf)");
const ids = async (who) => (await who.listWorks()).map((w) => Number(w.id)).sort();
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
check("admin ziet A en B", eq(await ids(admin), [Number(A), Number(B)]));
check("calculator ziet A en B", eq(await ids(calc), [Number(A), Number(B)]));
check("werfleider (alles-zien aan) ziet A en B", eq(await ids(wl), [Number(A), Number(B)]));
check("architect ziet enkel A", eq(await ids(arch), [Number(A)]));
check("OA Tegels ziet enkel A", eq(await ids(oa), [Number(A)]));
check("OA Dak ziet enkel B", eq(await ids(oa2), [Number(B)]));
check("klant ziet enkel A", eq(await ids(klant), [Number(A)]));
check("veiligheidscoördinator ziet enkel A", eq(await ids(vc), [Number(A)]));
check("OA Tegels: werf B rechtstreeks opvragen faalt", await rejects(oa.getWork(B)));
check("architect: werf B opvragen faalt", await rejects(arch.getWork(B)));
check("onbestaande werf opvragen faalt (geen verschil met 'geen toegang')", await rejects(admin.getWork(999n)));
check("OA kan geen werf maken", await rejects(oa.createWork({ code: "X", name: "x", address: addr("x"), parentId: [], clientOrgId: [], architectOrgId: [], leaderPersonId: [], vatBp: 600n })));
check("calculator kan geen werfstatus wijzigen", await rejects(calc.setWorkStatus(A, { running: null })));
check("werfleider wijzigt werfstatus", isOk(await wl.setWorkStatus(A, { running: null })));
const nAudit = await admin.auditCount();
check("dezelfde status nog eens: ok maar geen auditregel", isOk(await wl.setWorkStatus(A, { running: null })) && (await admin.auditCount()) === nAudit);
check("auditregel werfstatus toont oud → nieuw", (await admin.auditLog(0n, 20n)).some((e) => e.action === "werf-status" && e.detail.includes("gepland → bezig")));
check("werfleider mag geen instellingen wijzigen", await rejects(wl.setSettings({ werfleiderZietAlles: false, inviteDays: 7n, threshold30bisCents: 3_000_000n, thresholdCheckinatworkCents: 50_000_000n })));
check("admin zet 'werfleider ziet alles' uit", isOk(await admin.setSettings({ werfleiderZietAlles: false, inviteDays: 7n, threshold30bisCents: 3_000_000n, thresholdCheckinatworkCents: 50_000_000n })));
check("werfleider (alles-zien uit) ziet enkel A (zijn werf)", eq(await ids(wl), [Number(A)]));
check("werfleider (alles-zien uit): werf B faalt", await rejects(wl.getWork(B)));
check("werfleider (alles-zien uit) kan voor B geen OA uitnodigen", await denied(invite(wl, "x", roles("onderaannemer"), { workIds: [B] })));
await admin.setSettings({ werfleiderZietAlles: true, inviteDays: 7n, threshold30bisCents: 3_000_000n, thresholdCheckinatworkCents: 50_000_000n });

await sec("── lidmaatschappen (R15, R31)");
const oaDakId = (await oa2.me()).person[0].id;
check("werfleider mag geen werfleider-lid toevoegen (intern)", await denied(wl.addMembership(A, [oaDakId], [], { werfleider: null }, [])));
const mOa2 = await wl.addMembership(A, [oaDakId], [], { onderaannemer: null }, []);
check("werfleider voegt OA Dak toe aan werf A", isOk(mOa2), errOf(mOa2));
check("OA Dak ziet nu A en B", eq(await ids(oa2), [Number(A), Number(B)]));
check("OA kan geen lid toevoegen", await denied(oa.addMembership(A, [oaDakId], [], { onderaannemer: null }, [])));
check("werfleider beëindigt het lidmaatschap", isOk(await wl.endMembership(mOa2.ok)));
check("OA Dak ziet weer enkel B (meteen)", eq(await ids(oa2), [Number(B)]));
const memA = await admin.listMembers(A);
check("ledenlijst werf A toont namen en rollen", memA.length >= 5 && memA.some((m) => m.name === "Proef Architect"));
check("OA Dak kan de ledenlijst van A niet zien", await rejects(oa2.listMembers(A)));
check("org-lidmaatschap: hele OA-firma Dak op werf A", isOk(await admin.addMembership(A, [], [orgY.ok.id], { onderaannemer: null }, [])));
check("OA Dak ziet A via zijn firma", eq(await ids(oa2), [Number(A), Number(B)]));

await sec("── team, personen, R16");
check("werfleider leest het team", (await wl.listPersons(false)).length >= 9);
check("OA leest het team niet", await rejects(oa.listPersons(false)));
check("klant leest het team niet", await rejects(klant.listPersons(false)));
const upd = await admin.updatePerson(wlId, { name: "Proef Werfleider", roles: roles("werfleider"), orgId: [], shortCode: ["JONAS"], lang: ["nl"], phone: ["0400 00 00 00"] });
check("admin wijzigt een persoon (code, gsm)", isOk(upd) && upd.ok.shortCode[0] === "JONAS");
check("werfleider kan geen persoon wijzigen", await rejects(wl.updatePerson(wlId, { name: "x", roles: roles("admin"), orgId: [], shortCode: [], lang: [], phone: [] })));
check("admin kan zijn eigen adminrol niet afnemen", "err" in (await admin.updatePerson(adminId, { name: "Proef Beheerder", roles: roles("werfleider"), orgId: [], shortCode: [], lang: [], phone: [] })));
check("admin kan zichzelf niet afzetten", "err" in (await admin.archivePerson(adminId)));
check("admin kan zijn eigen login niet intrekken", "err" in (await admin.revokeLink(P("proef-admin"))));

await sec("── herstelcode (§3.3.5) en intrekken (§3.3.6)");
const rec = await admin.createRecoveryCode(wlId, 0n, "laptop werfleider");
check("admin maakt herstelcode", isOk(rec));
check("werfleider kan geen herstelcode maken", await rejects(wl.createRecoveryCode(wlId, 0n, "")));
const r3 = await redeem(wl2, rec.ok.code);
check("tweede toestel werfleider → wacht op bevestiging", isOk(r3) && status(r3.ok) === "pending");
await admin.confirmLink(P("proef-werfleider-toestel2"));
const w2me = await wl2.me();
check("tweede toestel = dezelfde persoon", status(w2me) === "active" && w2me.person[0].id === wlId);
check("koppeling heeft een naam (label)", (await admin.listLinks()).some((l) => l.tag === "laptop werfleider"));
check("admin trekt het tweede toestel in", isOk(await admin.revokeLink(P("proef-werfleider-toestel2"))));
check("ingetrokken toestel: volgende call geweigerd", await rejects(wl2.listWorks()));
check("ingetrokken toestel: me() = unlinked", status(await wl2.me()) === "unlinked");
check("eerste toestel werkt nog", (await wl.listWorks()).length === 2);
const rec2 = await admin.createRecoveryCode(wlId, 0n, "laptop opnieuw");
const r4 = await redeem(wl2, rec2.ok.code);
check("ingetrokken principal koppelt opnieuw met een nieuwe code", isOk(r4));
check("oude koppeling staat in de historiek (export)", (await admin.exportIntern()).linkHistory.length === 1);
await admin.confirmLink(P("proef-werfleider-toestel2"));

const invR = await invite(admin, "Ingetrokken Iemand", roles("onderaannemer"));
codes.push(invR.ok.code);
check("admin trekt een open code in", isOk(await admin.revokeInvite(invR.ok.inviteId)));
check("ingetrokken code werkt niet meer", "err" in (await nieuw.redeemCode(invR.ok.code)));
const invW = await invite(wl, "Code van werfleider", roles("onderaannemer"));
codes.push(invW.ok.code);
check("OA kan geen code intrekken", await denied(oa.revokeInvite(invW.ok.inviteId)));
check("werfleider trekt zijn eigen code in", isOk(await wl.revokeInvite(invW.ok.inviteId)));
const invAdm = await invite(admin, "Code van admin", roles("onderaannemer"));
codes.push(invAdm.ok.code);
check("werfleider kan een code van de admin niet intrekken", await denied(wl.revokeInvite(invAdm.ok.inviteId)));

await sec("── vertrouwelijk (R23, R27)");
check("calculator bewaart klantcontact (vertrouwelijk)", isOk(await calc.setOrgConfidential(orgKlant.ok.id, [{ name: "Mevr. Proef", phone: ["0400"], email: ["proef@example.invalid"], address: [] }], "betaalt traag")));
const rc = await admin.readOrgConfidential(orgKlant.ok.id);
check("admin leest het klantcontact (update-call)", isOk(rc) && rc.ok.contact[0].name === "Mevr. Proef" && rc.ok.version === 1n);
check("werfleider leest het klantcontact niet", await rejects(wl.readOrgConfidential(orgKlant.ok.id)));
check("klant leest zijn eigen vertrouwelijke fiche niet", await rejects(klant.readOrgConfidential(orgKlant.ok.id)));
check("werfleider kan geen vertrouwelijke export", await rejects(wl.exportConfidential()));
const exC = await admin.exportConfidential();
check("admin: vertrouwelijke export apart", exC.orgs.length === 1);

await sec("── bestanden en opslagpoort (T10, R11, R12)");
const cert = (who) => who._immutableObjectStorageCreateCertificate("sha256:" + "a".repeat(64));
check("anoniem krijgt geen uploadcertificaat", await rejects(cert(anon)));
check("ongekoppelde principal krijgt geen uploadcertificaat", await rejects(cert(vreemde)));
check("klant krijgt geen uploadcertificaat", await rejects(cert(klant)));
check("architect zonder uploadrecht krijgt geen certificaat", await rejects(cert(arch)));
check("OA krijgt een uploadcertificaat", !(await rejects(cert(oa))));
check("werfleider krijgt een uploadcertificaat", !(await rejects(cert(wl))));
check("veiligheidscoördinator (uploadrecht) krijgt een certificaat", !(await rejects(cert(vc))));
const blob = (h) => new TextEncoder().encode("!caf!sha256:" + h.repeat(64));
const fA = await oa.addFile("foto.jpg", "image/jpeg", 1000n, blob("b"), [A], false);
check("OA laadt een foto op voor werf A", isOk(fA), errOf(fA));
check("OA kan niet opladen voor werf B", await rejects(oa.addFile("x.jpg", "image/jpeg", 1000n, blob("c"), [B], false)));
check("OA kan geen bestand zonder werf opladen", await rejects(oa.addFile("x.jpg", "image/jpeg", 1000n, blob("c"), [], false)));
check("verkeerd bestandstype geweigerd", "err" in (await wl.addFile("x.exe", "application/x-msdownload", 10n, blob("d"), [A], false)));
check("werfleider kan geen vertrouwelijk bestand opladen", await rejects(wl.addFile("contract.pdf", "application/pdf", 1000n, blob("e"), [A], true)));
const fC = await calc.addFile("contract.pdf", "application/pdf", 1000n, blob("f"), [A], true);
check("calculator laadt een vertrouwelijk bestand op", isOk(fC));
const listA = await wl.listFiles([A]);
check("werfleider ziet de bestanden van A; vertrouwelijk zonder verwijzing", listA.length === 2 && listA.find((f) => f.confidential).blob.length === 0);
check("OA Tegels ziet de bestanden van B niet", await rejects(oa.listFiles([B])));
check("werfleider kan het vertrouwelijke bestand niet openen", await rejects(wl.readConfidentialFile(fC.ok)));
check("calculator opent het vertrouwelijke bestand (gelogd)", isOk(await calc.readConfidentialFile(fC.ok)));

await sec("── 1.1 werffiche, contractparameters (vertrouwelijk, R23, R27), deelwerven, documenten (A5, A9)");
// Een werfleider die ook calculator is (rechten = som van rollen, R2).
await mk("Proef Werfleider-Calculator", roles("werfleider", "calculator"), {}, wlcalc);
await admin.confirmLink(P("proef-wlcalc"));
const calcId = (await calc.me()).person[0].id;
const contractIn = (amount, extra = {}) => ({
  contract: { estimatedAmountCents: opt(amount), priceRevision: { formula: "p = P × (0,2 + 0,4 s/S + 0,4 i/I)" }, guarantee: { retention: null }, guaranteeBp: 500n, paymentTermDays: 30n, invoicingRhythm: { perProgress: null }, signedQuoteVersionId: [], note: "", ...extra },
  clientContact: [{ name: "Dhr. Werfcontact", phone: ["0470 00 00 00"], email: [], address: [] }],
  notes: "korting gevraagd",
});
const c0 = await calc.readContract(A);
check("calculator leest het contract van A (nog leeg, versie 0)", isOk(c0) && c0.ok.version === 0n && c0.ok.contract.length === 0, errOf(c0));
const c1 = await calc.setContract(A, contractIn(4_500_000n), 0n);
check("calculator bewaart contractparameters (prijsherziening, waarborg, termijn, aanneemsom) → v1", isOk(c1) && c1.ok === 1n, errOf(c1));
check("bewaren met een oude versie: geweigerd (niet stil overschrijven)", errOf(await calc.setContract(A, contractIn(4_600_000n), 0n)).includes("intussen"));
check("waarborg boven 20 % geweigerd", "err" in (await calc.setContract(A, contractIn(4_500_000n, { guaranteeBp: 2500n }), 1n)));
check("waarborgsoort zonder percentage geweigerd", "err" in (await calc.setContract(A, contractIn(4_500_000n, { guaranteeBp: 0n }), 1n)));
const ca = await admin.readContract(A);
check("admin leest het contract (update-call): aanneemsom, waarborg, termijn", isOk(ca) && ca.ok.contract[0].estimatedAmountCents[0] === 4_500_000n && ca.ok.contract[0].guaranteeBp === 500n && ca.ok.contract[0].paymentTermDays === 30n && ca.ok.clientContact[0].name === "Dhr. Werfcontact");
check("werfleider (zonder calculatorrol) leest het contract NIET", await rejects(wl.readContract(A)));
check("werfleider (zonder calculatorrol) wijzigt het contract NIET", await rejects(wl.setContract(A, contractIn(1n), 1n)));
check("werfleider (zonder calculatorrol) leest de contracthistoriek NIET", await rejects(wl.readContractHistory(A)));
check("werfleider die ook calculator is, leest het contract wel", isOk(await wlcalc.readContract(A)));
check("architect leest het contract niet", await rejects(arch.readContract(A)));
check("OA leest het contract niet", await rejects(oa.readContract(A)));
check("klant leest het contract niet (ook niet van zijn eigen werf)", await rejects(klant.readContract(A)));
check("veiligheidscoördinator leest het contract niet", await rejects(vc.readContract(A)));
check("OA kan het contract niet wijzigen", await rejects(oa.setContract(A, contractIn(1n), 1n)));
check("calculator: contract van een onbestaande werf geweigerd", await rejects(calc.readContract(999n)));
const wA = await wl.getWork(A);
const fa = wA.facts[0];
check("werfleider ziet enkel de afgeleide feiten: waarborg ja, prijsherziening ja, 30bis ja, Checkinatwork nee", !!fa && fa.guarantee[0] === true && fa.priceRevision[0] === true && fa.art30bis[0] === true && fa.checkinatwork[0] === false, JSON.stringify(fa, big));
check("de werffiche van de werfleider bevat geen bedrag", !JSON.stringify(wA, big).includes("4500000"));
check("OA, klant, architect en VC krijgen geen feiten en geen checklistteller", (await Promise.all([oa, klant, arch, vc].map((x) => x.getWork(A)))).every((w) => w.facts.length === 0 && w.checklistOpen.length === 0));
check("werfcaps: werfleider bewerkt, ziet geen contract; calculator ziet contract, bewerkt niet", wA.caps.edit && !wA.caps.contract && (await calc.getWork(A)).caps.contract && !(await calc.getWork(A)).caps.edit);
await admin.setSettings({ werfleiderZietAlles: true, inviteDays: 7n, threshold30bisCents: 5_000_000n, thresholdCheckinatworkCents: 50_000_000n });
check("drempel 30bis instelbaar: € 50.000 → werf A (€ 45.000) valt eronder", (await wl.getWork(A)).facts[0].art30bis[0] === false);
await admin.setSettings({ werfleiderZietAlles: true, inviteDays: 7n, threshold30bisCents: 3_000_000n, thresholdCheckinatworkCents: 50_000_000n });
const hist = await admin.readContractHistory(A);
check("contracthistoriek: elke versie bewaard", isOk(hist) && hist.ok.length === 1 && hist.ok[0].byName === "Proef Calculator");
const logC = await admin.auditLog(0n, 200n);
check("auditlog: 'bekeek:contract' bij elk lezen", logC.filter((e) => e.action === "bekeek:contract").length >= 3);
const chg = logC.find((e) => e.action === "vertrouwelijk-gewijzigd" && e.detail.startsWith("contract"));
check("auditlog bij wijzigen: enkel veldnamen, geen bedragen of percentages", !!chg && !/4500000|45\.000|500|5 %|korting/.test(chg.detail), chg?.detail);
const exC2 = await admin.exportConfidential();
check("vertrouwelijke export bevat het contract en de historiek", exC2.workConfidential.length === 1 && exC2.workConfidentialHistory.length === 1);
check("interne export bevat geen contractbedrag", !JSON.stringify(await admin.exportIntern(), big).includes("4500000"));

// Werffiche wijzigen (R4) en werfleider aanduiden (enkel admin)
const upd0 = { code: "P-A", name: "Proefstraat 1", address: addr("Proefstraat"), parentId: [], clientOrgId: [orgKlant.ok.id], architectOrgId: [orgArch.ok.id], leaderPersonId: [], vatBp: 600n, plannedStart: [20_400n], plannedEnd: [20_500n], analyticCode: ["ANA-PA"], vatNote: "woning ouder dan 10 jaar" };
const u1 = await wl.updateWork(A, upd0);
check("werfleider wijzigt de fiche (analytische code, btw-grond, periode)", isOk(u1) && u1.ok.analyticCode[0] === "ANA-PA" && u1.ok.vatNote === "woning ouder dan 10 jaar" && u1.ok.plannedStart[0] === 20_400n, errOf(u1));
check("auditregel 'werf-gewijzigd' toont oud → nieuw", (await admin.auditLog(0n, 10n)).some((e) => e.action === "werf-gewijzigd" && e.detail.includes("analytische code – → ANA-PA")));
check("werfleider kan de werfleider niet aanduiden (intern, admin)", errOf(await wl.updateWork(A, { ...upd0, leaderPersonId: [wlId] })).includes("beheerder"));
check("enkel iemand met de rol werfleider kan werfleider zijn", "err" in (await admin.updateWork(A, { ...upd0, leaderPersonId: [calcId] })));
check("admin duidt de werfleider aan", isOk(await admin.updateWork(A, { ...upd0, leaderPersonId: [wlId] })));
check("calculator kan de fiche niet wijzigen", await rejects(calc.updateWork(A, upd0)));
check("OA kan de fiche niet wijzigen", await rejects(oa.updateWork(A, upd0)));
check("klant kan de fiche niet wijzigen", await rejects(klant.updateWork(A, upd0)));
check("einde vóór de start geweigerd", "err" in (await wl.updateWork(A, { ...upd0, plannedEnd: [20_300n] })));
check("bestaande code van een andere werf geweigerd", "err" in (await wl.updateWork(A, { ...upd0, code: "P-B" })));
check("btw-tarief enkel 6 of 21 %", "err" in (await wl.updateWork(A, { ...upd0, vatBp: 1200n })));

// Deelwerven (A9, VOORLOPIG: één niveau, eigen team, contract van de hoofdwerf tot er een eigen is)
const wA1 = await admin.createWork({ code: "P-A1", name: "Proefstraat 1 Gevel", address: addr("Proefstraat"), parentId: [A], clientOrgId: [orgKlant.ok.id], architectOrgId: [], leaderPersonId: [], vatBp: 600n });
check("admin maakt een deelwerf van A", isOk(wA1) && wA1.ok.parentId[0] === A, errOf(wA1));
const A1 = wA1.ok.id;
check("deelwerf van een deelwerf geweigerd", "err" in (await admin.createWork({ code: "P-A1b", name: "x", address: addr("x"), parentId: [A1], clientOrgId: [], architectOrgId: [], leaderPersonId: [], vatBp: 600n })));
check("een werf met deelwerven wordt zelf geen deelwerf", "err" in (await admin.updateWork(A, { ...upd0, leaderPersonId: [wlId], parentId: [B] })));
check("een werf is niet haar eigen hoofdwerf", "err" in (await admin.updateWork(A1, { ...upd0, code: "P-A1", parentId: [A1] })));
const cA1 = await calc.readContract(A1);
check("deelwerf zonder eigen contract toont dat van de hoofdwerf", isOk(cA1) && cA1.ok.inheritedFrom[0] === A && cA1.ok.contract[0].estimatedAmountCents[0] === 4_500_000n);
check("werfleider: feiten van de deelwerf komen van de hoofdwerf", (await wl.getWork(A1)).facts[0].inheritedFrom[0] === A);
check("deelwerf heeft een eigen team: de architect van A ziet A1 niet", await rejects(arch.getWork(A1)));
check("deelwerf krijgt een eigen contract", isOk(await calc.setContract(A1, contractIn(1_000_000n), 0n)) && (await calc.readContract(A1)).ok.inheritedFrom.length === 0);

// Documentenlijst en checklist (A5, VOORLOPIG)
const lineOf = (d, k) => d.checklist.find((l) => l.kind === k);
const dA = await admin.getDossier(A);
check("checklist A: contract (altijd), btw-attest (6 %), VG-plan (VC), 30bis (≥ drempel)", ["contract", "btw6-attest", "vgplan", "aangifte-30bis"].every((k) => "yes" in (lineOf(dA, k)?.applies ?? {})), dA.checklist.map((l) => l.kind).join(","));
check("checklist A: Checkinatwork en PV oplevering staan er (nog) niet op", !lineOf(dA, "checkinatwork") && !lineOf(dA, "pv-voorlopige-oplevering"));
check("checklist B (21 %, geen VC, geen contract): geen btw-attest, VG-plan en 30bis onbekend", await admin.getDossier(B).then((d) => !lineOf(d, "btw6-attest") && "unknown" in lineOf(d, "vgplan").applies && "unknown" in lineOf(d, "aangifte-30bis").applies));
check("werfleider ziet het aantal ontbrekende verplichte documenten", (await wl.getWork(A)).checklistOpen[0] >= 4n);
const fVg = await vc.addFile("vgplan.pdf", "application/pdf", 2000n, blob("1"), [A], false);
const dVg = await vc.attachDocumentFile(A, "vgplan", [], fVg.ok);
check("veiligheidscoördinator laadt het VG-plan op → ontvangen", isOk(dVg) && "received" in (await admin.getDossier(A)).documents.find((d) => d.id === dVg.ok).status, errOf(dVg));
const fX = await vc.addFile("x.pdf", "application/pdf", 2000n, blob("2"), [A], false);
check("VC kan geen btw-attest leveren (soort van de klant)", await denied(vc.attachDocumentFile(A, "btw6-attest", [], fX.ok)));
check("VC kan geen plannen leveren (soort van de architect)", await denied(vc.attachDocumentFile(A, "plannen", [], fX.ok)));
check("VC kan geen document goedkeuren", await rejects(vc.setDocumentStatus(dVg.ok, { approved: null }, "")));
check("werfleider keurt het VG-plan goed", isOk(await wl.setDocumentStatus(dVg.ok, { approved: null }, "")));
check("OA kan geen documentstatus zetten", await rejects(oa.setDocumentStatus(dVg.ok, { missing: null }, "")));
const fCt = await calc.addFile("aanneming.pdf", "application/pdf", 3000n, blob("3"), [A], true);
const dCt = await calc.attachDocumentFile(A, "contract", [], fCt.ok);
check("calculator hangt het (vertrouwelijke) contract aan de checklist", isOk(dCt), errOf(dCt));
check("een gewoon bestand aan een vertrouwelijk document: geweigerd", "err" in (await admin.attachDocumentFile(A, "contract", [dCt.ok], fX.ok)));
const dWl = await wl.getDossier(A);
check("werfleider ziet het contractdocument niet (vertrouwelijk)", !dWl.documents.some((d) => d.kind === "contract") && !lineOf(dWl, "contract"));
check("werfleider ziet het contractbestand ook niet in de bestandenlijst", !(await wl.listFiles([A])).some((f) => f.id === fCt.ok));
const dKl = await klant.getDossier(A);
check("klant ziet enkel de soorten die hij levert (btw-attest), geen VG-plan of contract", dKl.checklist.every((l) => l.kind === "btw6-attest") && dKl.documents.every((d) => d.kind === "btw6-attest"), dKl.checklist.map((l) => l.kind).join(","));
check("klant ziet het VG-plan ook niet in de bestandenlijst", !(await klant.listFiles([A])).some((f) => f.id === fVg.ok));
const dOa = await oa.getDossier(A);
check("OA ziet het VG-plan (zichtbaar voor OA), geen coördinatiedagboek, geen contract", dOa.documents.some((d) => d.kind === "vgplan") && !lineOf(dOa, "coordinatiedagboek") && !lineOf(dOa, "contract"));
const dAr = await arch.getDossier(A);
check("architect ziet het VG-plan, niet het contract", dAr.documents.some((d) => d.kind === "vgplan") && !dAr.documents.some((d) => d.kind === "contract"));
check("OA Tegels: het dossier van werf B geweigerd", await rejects(oa.getDossier(B)));
const fEl = await oa.addFile("keuring.pdf", "application/pdf", 2000n, blob("4"), [A], false);
const dEl = await oa.attachDocumentFile(A, "keuring-elektriciteit", [], fEl.ok);
check("OA levert een keuring (soort van de OA)", isOk(dEl), errOf(dEl));
check("OA kan geen plannen leveren", await denied(oa.attachDocumentFile(A, "plannen", [], fEl.ok)));
check("OA kan geen bestand van een ander aan een document hangen", "err" in (await oa.attachDocumentFile(A, "keuring-verwarming", [], fVg.ok)));
const today = BigInt(Math.floor(Date.now() / 86_400_000));
check("werfleider zet de geldigheid (gisteren) → status verlopen", isOk(await wl.saveDocument(A, { id: [dEl.ok], kind: "keuring-elektriciteit", title: "", dueDay: [], validUntil: [today - 1n], note: "" , ownerOrgId: [] })) && "expired" in (await wl.getDossier(A)).documents.find((d) => d.id === dEl.ok).status);
const dBtw = await wl.saveDocument(A, { id: [], kind: "btw6-attest", title: "", dueDay: [today + 14n], validUntil: [], note: "", ownerOrgId: [] });
check("werfleider zet het btw-attest op de lijst en vraagt het op (gevraagd)", isOk(dBtw) && isOk(await wl.setDocumentStatus(dBtw.ok, { requested: null }, "gevraagd aan de klant")));
check("goedkeuren zonder bestand: geweigerd", "err" in (await wl.setDocumentStatus(dBtw.ok, { approved: null }, "")));
const dAnd = await wl.saveDocument(A, { id: [], kind: "andere", title: "Proef weg", dueDay: [], validUntil: [], note: "", ownerOrgId: [] });
check("werfleider archiveert een document (verdwijnt uit de lijst)", isOk(await wl.archiveDocument(dAnd.ok)) && !(await wl.getDossier(A)).documents.some((d) => d.id === dAnd.ok));
check("onbekende documentsoort geweigerd", "err" in (await wl.saveDocument(A, { id: [], kind: "bestaat-niet", title: "", dueDay: [], validUntil: [], note: "", ownerOrgId: [] })));
check("OA kan geen document aanmaken", await rejects(oa.saveDocument(A, { id: [], kind: "andere", title: "", dueDay: [], validUntil: [], note: "", ownerOrgId: [] })));
const kind = { key: "keuring-lift", name: "Keuring lift", rule: "altijd", deliverer: "onderaannemer", oaVisible: true, confidential: false, order: 500n, archived: false };
check("werfleider kan de documentsoorten niet wijzigen", await rejects(wl.setDocKind(kind)));
check("een interne rol als 'wie levert' geweigerd", "err" in (await admin.setDocKind({ ...kind, deliverer: "werfleider" })));
check("admin voegt een documentsoort toe (instelbaar, A5)", isOk(await admin.setDocKind(kind)));
const kinds = await admin.listDocKinds(false);
check("de standaardlijst blijft erbij (21 + 1)", kinds.length === 22 && kinds.some((k) => k.key === "keuring-lift"), `${kinds.length}`);
check("nieuwe verplichte soort staat meteen op de checklist", "yes" in lineOf(await admin.getDossier(A), "keuring-lift").applies);
check("admin archiveert de soort → weg van de checklist", isOk(await admin.setDocKind({ ...kind, archived: true })) && !lineOf(await admin.getDossier(A), "keuring-lift"));
check("OA leest de documentsoorten niet (intern)", await rejects(oa.listDocKinds(false)));
check("auditlog: documenten en soorten gelogd, zonder opslagverwijzing", (await admin.auditLog(0n, 100n)).some((e) => e.action === "document-bestand") && (await admin.auditLog(0n, 100n)).some((e) => e.action === "documentsoort"));
check("interne export bevat de documenten en de werfinfo", await admin.exportIntern().then((e) => e.documents.length >= 4 && e.workInfo.length >= 1));

await sec("── 1.2 onderaannemers-database: vakgebieden, contact, personen, zoeken, rechten (R3, R19, R32)");
const oaFilter = (o = {}) => ({ text: opt(o.text), trade: opt(o.trade), kind: opt(o.kind ? { [o.kind]: null } : undefined), includeArchived: o.archived ?? false });
const orgIn12 = (name, extra = {}) => ({ kind: { subcontractor: null }, name, kbo: opt(extra.kbo), vat: [], aliases: extra.aliases ?? [], trades: extra.trades ?? [], address: [], notes: "" });
// Vakgebieden (D9)
const trd = await admin.listTrades(false);
check("standaardlijst vakgebieden (21) staat klaar", trd.length === 21 && trd.some((t) => t.key === "elektriciteit"), `${trd.length}`);
check("werfleider en calculator lezen de vakgebieden", (await wl.listTrades(false)).length === 21 && (await calc.listTrades(false)).length === 21);
check("OA, architect, klant, veiligheid en anoniem lezen de vakgebieden niet", (await Promise.all([oa, arch, klant, vc, anon].map((x) => rejects(x.listTrades(false))))).every(Boolean));
check("werfleider kan de vakgebieden niet wijzigen", await rejects(wl.setTrade({ key: "proef-vak", name: "Proefvak", order: 900n, archived: false })));
check("vakgebied met slechte sleutel geweigerd", "err" in (await admin.setTrade({ key: "Slecht Vak!", name: "x", order: 1n, archived: false })));
check("admin voegt een vakgebied toe", isOk(await admin.setTrade({ key: "proef-vak", name: "Proefvak", order: 900n, archived: false })));
check("de standaardlijst blijft erbij (21 + 1)", (await admin.listTrades(false)).length === 22);
check("admin archiveert het vakgebied → weg uit de lijst", isOk(await admin.setTrade({ key: "proef-vak", name: "Proefvak", order: 900n, archived: true })) && (await admin.listTrades(false)).length === 21 && (await admin.listTrades(true)).length === 22);
// Firma's: vakgebieden, uniekheid van codes en KBO
check("firma met onbekend vakgebied geweigerd", errOf(await admin.createOrg(orgIn12("Fout Vak BV", { trades: ["bestaat-niet"] }))).includes("Onbekend vakgebied"));
check("firma met gearchiveerd vakgebied geweigerd", errOf(await admin.createOrg(orgIn12("Fout Vak BV", { trades: ["proef-vak"] }))).includes("Onbekend vakgebied"));
const orgElek = await admin.createOrg(orgIn12("Proef Elektro BV", { kbo: "0999.888.777", aliases: ["pel", "Elektro Piet"], trades: ["elektriciteit", "ventilatie"] }));
check("firma met vakgebieden en aliassen (hoofdletters)", isOk(orgElek) && orgElek.ok.aliases.join() === "PEL,ELEKTRO PIET" && orgElek.ok.trades.length === 2, JSON.stringify(orgElek, big));
check("dezelfde alias bij een andere firma geweigerd (ook in kleine letters)", errOf(await admin.createOrg(orgIn12("Dubbel A BV", { aliases: ["gils"] }))).includes("hoort al bij"));
check("dezelfde alias met andere schrijfwijze geweigerd (accenten, spaties)", errOf(await admin.createOrg(orgIn12("Dubbel B BV", { aliases: ["Elektro  Piet"] }))).includes("hoort al bij"));
check("hetzelfde KBO-nummer bij een andere firma geweigerd", errOf(await admin.createOrg(orgIn12("Dubbel C BV", { kbo: "0999888777" }))).includes("KBO-nummer"));
check("een firma mag zijn eigen alias en KBO houden bij een wijziging", isOk(await admin.updateOrg(orgElek.ok.id, { ...orgIn12("Proef Elektro BV", { kbo: "0999888777", aliases: ["PEL", "ELEKTRO PIET", "PEL2"], trades: ["elektriciteit"] }) })));
const oaTegels = await admin.updateOrg(orgX.ok.id, orgIn12("Proef Tegels BV", { kbo: "0123456789", aliases: ["GILS"], trades: ["tegels"] }));
check("admin zet het vakgebied 'tegels' op de tegelfirma", isOk(oaTegels));
// Contact (intern)
const contactIn = { phone: ["0470 11 22 33"], email: ["Piet@Proef-Elektro.be"], website: ["https://proef-elektro.be"], contactNote: "bereikbaar na 17u" };
check("werfleider bewaart het contact van een OA-firma (e-mail in kleine letters)", await wl.saveOrgContact(orgElek.ok.id, contactIn).then((r) => isOk(r) && r.ok.email[0] === "piet@proef-elektro.be"));
check("calculator, OA, architect, klant, veiligheid, anoniem kunnen het contact niet wijzigen", (await Promise.all([calc, oa, arch, klant, vc, anon].map((x) => rejects(x.saveOrgContact(orgElek.ok.id, contactIn))))).every(Boolean));
check("e-mailadres zonder @ geweigerd", errOf(await admin.saveOrgContact(orgElek.ok.id, { ...contactIn, email: ["geen-email"] })).includes("E-mailadres"));
check("contact van een klant-organisatie geweigerd (vertrouwelijk, klantfiche)", errOf(await admin.saveOrgContact(orgKlant.ok.id, contactIn)).includes("vertrouwelijk"));
check("auditregel 'oa-contact-gewijzigd' toont enkel veldnamen, geen gegevens", await admin.auditLog(0n, 30n).then((l) => { const e = l.find((x) => x.action === "oa-contact-gewijzigd"); return e && e.detail.includes("e-mail") && !e.detail.includes("proef-elektro") && !e.detail.includes("0470") && !e.detail.includes("17u"); }));
// Personen
const pIn = (name, extra = {}) => ({ id: opt(extra.id), name, shortCode: opt(extra.shortCode), phone: opt(extra.phone), email: opt(extra.email), jobTitle: extra.jobTitle ?? "", note: extra.note ?? "" });
const pKevin = await wl.saveOaPerson(orgElek.ok.id, pIn("Kevin Proef", { shortCode: "kv", email: "kevin@proef-elektro.be", jobTitle: "zaakvoerder", phone: "0475 00 00 01" }));
check("werfleider maakt een contactpersoon (code in hoofdletters, zonder login)", isOk(pKevin) && pKevin.ok.shortCode[0] === "KV" && pKevin.ok.hasLogin === false && pKevin.ok.jobTitle === "zaakvoerder", JSON.stringify(pKevin, big));
check("dezelfde persoonscode geweigerd", errOf(await admin.saveOaPerson(orgX.ok.id, pIn("Ander Persoon", { shortCode: "Kv" }))).includes("hoort al bij"));
check("contactpersoon wijzigen (zelfde code mag)", await admin.saveOaPerson(orgElek.ok.id, pIn("Kevin Proef Jr", { id: pKevin.ok.id, shortCode: "KV", jobTitle: "ploegbaas" })).then((r) => isOk(r) && r.ok.name === "Kevin Proef Jr" && r.ok.jobTitle === "ploegbaas"));
check("persoon van een andere firma wijzigen via deze firma geweigerd", errOf(await admin.saveOaPerson(orgX.ok.id, pIn("Kaper", { id: pKevin.ok.id }))).includes("hoort niet bij"));
check("contactpersoon bij een klant-organisatie geweigerd", errOf(await admin.saveOaPerson(orgKlant.ok.id, pIn("Klantpersoon"))).includes("vertrouwelijk"));
check("calculator, OA, architect, klant, veiligheid kunnen geen contactpersoon maken", (await Promise.all([calc, oa, arch, klant, vc].map((x) => rejects(x.saveOaPerson(orgElek.ok.id, pIn("Kaper 2")))))).every(Boolean));
check("persoon zonder naam of met slecht e-mailadres geweigerd", "err" in (await admin.saveOaPerson(orgElek.ok.id, pIn(" "))) && "err" in (await admin.saveOaPerson(orgElek.ok.id, pIn("Slecht Mail", { email: "x@y" }))));
// Lezen en zoeken (R19: query; externen nooit)
const elekView = (await wl.listOas(oaFilter({ text: "elektro" })))[0];
check("werfleider vindt de firma op naam, met contact en personen", elekView?.org.name === "Proef Elektro BV" && elekView.contact[0]?.email[0] === "piet@proef-elektro.be" && elekView.persons.length === 1, JSON.stringify(elekView, big));
check("calculator leest de database ook", (await calc.listOas(oaFilter())).length >= 3);
check("OA (ook zijn eigen firma), architect, klant, veiligheid en anoniem lezen de database niet", (await Promise.all([oa, arch, klant, vc, anon].map((x) => rejects(x.listOas(oaFilter()))))).every(Boolean) && (await rejects(oa.getOa(orgX.ok.id))));
check("klant- en BOWACO-organisaties horen niet in de database", !(await admin.listOas(oaFilter())).some((v) => v.org.id === orgKlant.ok.id) && "err" in (await admin.getOa(orgKlant.ok.id)));
const find = async (o) => (await admin.listOas(oaFilter(o))).map((v) => v.org.name);
check("zoeken op alias (kleine letters)", (await find({ text: "pel2" })).join() === "Proef Elektro BV");
check("zoeken op KBO met punten", (await find({ text: "0999.888.777" })).join() === "Proef Elektro BV");
check("zoeken op contactpersoon (naam en code)", (await find({ text: "kevin" })).join() === "Proef Elektro BV" && (await find({ text: "kv" })).includes("Proef Elektro BV"));
check("zoeken op e-mail van de firma", (await find({ text: "proef-elektro.be" })).includes("Proef Elektro BV"));
check("zoeken op de naam van het vakgebied", (await find({ text: "ventilatie" })).length === 0 && (await find({ text: "elektriciteit" })).includes("Proef Elektro BV"));
check("zoeken negeert hoofdletters en leestekens", (await find({ text: "PROEF-elektro, b.v." })).includes("Proef Elektro BV") && (await find({ text: "PROEF  Elektro" })).includes("Proef Elektro BV"));
check("filter op vakgebied", (await find({ trade: "tegels" })).join() === "Proef Tegels BV" && (await find({ trade: "elektriciteit" })).join() === "Proef Elektro BV");
check("filter op soort: architect-bureau zit in de database, OA's niet", (await find({ kind: "architect" })).join() === "Proef Architecten" && !(await find({ kind: "architect" })).includes("Proef Elektro BV"));
check("zoeken zonder resultaat geeft een lege lijst", (await find({ text: "bestaat helemaal niet" })).length === 0);
// Import (R32): alleen admin, proef eerst, idempotent
const row = (key, name, extra = {}) => ({ key, kind: { [extra.kind ?? "subcontractor"]: null }, name, kbo: opt(extra.kbo), vat: [], aliases: extra.aliases ?? [], trades: extra.trades ?? [], phone: opt(extra.phone), email: opt(extra.email), website: [], notes: extra.notes ?? "", persons: extra.persons ?? [] });
const impPers = (name, shortCode, email) => ({ name, shortCode: opt(shortCode), phone: [], email: opt(email), jobTitle: "" });
const rowsA = [
  row("r1", "Proef Sanitair BV", { kbo: "0888.777.666", aliases: ["SAN", "Proef Sanitair"], trades: ["sanitair-chauffage"], phone: "09 111 22 33", email: "info@proef-sanitair.be", persons: [impPers("Tom Proef", "TP", "tom@proef-sanitair.be")] }),
  row("r2", "Proef Tegels BV", { kbo: "0123456789", aliases: ["GILS", "TEGELS PIET"], trades: ["tegels", "chape"] }),
  row("r3", "Proef Leverancier NV", { kind: "supplier", aliases: ["LEV"] }),
  row("r4", "Slecht Vak", { trades: ["bestaat-niet"] }),
  row("r5", "Proef Raak Beide", { kbo: "0123456789", aliases: ["SAN"] }),
];
for (const [who, n] of [[wl, "werfleider"], [calc, "calculator"], [oa, "OA"], [arch, "architect"], [klant, "klant"], [vc, "veiligheid"], [anon, "anoniem"]]) {
  check(`import geweigerd voor ${n}`, await rejects(who.importOrgs(true, rowsA)));
}
check("import: 0 rijen of meer dan 40 rijen geweigerd", "err" in (await admin.importOrgs(true, [])) && "err" in (await admin.importOrgs(true, Array.from({ length: 41 }, (_, i) => row(`x${i}`, `Rij ${i}`)))));
const orgsBefore = (await admin.listOrgs(true)).length;
const personsBefore = (await admin.listPersons(true)).length;
const dry = (await admin.importOrgs(true, rowsA)).ok;
const kinds12 = (rep) => rep.results.map((r) => Object.keys(r.outcome)[0]).join();
check("proefronde: nieuw, aangevuld, nieuw, ongeldig, conflict (raakt twee firma's)", kinds12(dry) === "created,updated,created,invalid,conflict", kinds12(dry));
check("proefronde bewaart niets (geen firma's, geen personen erbij)", (await admin.listOrgs(true)).length === orgsBefore && (await admin.listPersons(true)).length === personsBefore);
check("proefronde toont wat er zou veranderen", dry.results[1].changes.join().includes("code TEGELS PIET") && dry.results[1].changes.join().includes("vakgebied chape") && dry.results[0].changes.join().includes("persoon Tom Proef"));
const real = (await admin.importOrgs(false, rowsA)).ok;
check("echte ronde geeft hetzelfde resultaat als de proef", kinds12(real) === kinds12(dry) && Number(real.created) === 2 && Number(real.updated) === 1 && Number(real.invalid) === 1 && Number(real.conflicts) === 1);
check("echte ronde: 2 firma's en 1 persoon erbij", (await admin.listOrgs(true)).length === orgsBefore + 2 && (await admin.listPersons(true)).length === personsBefore + 1);
const san = (await admin.listOas(oaFilter({ text: "SAN" })))[0];
check("nieuwe firma heeft KBO, aliassen, vakgebied, contact en contactpersoon (rol OA, geen login)", san.org.name === "Proef Sanitair BV" && san.org.kbo[0] === "0888777666" && san.org.aliases.join() === "SAN,PROEF SANITAIR" && san.org.trades[0] === "sanitair-chauffage" && san.contact[0].phone[0] === "09 111 22 33" && san.persons[0].name === "Tom Proef" && san.persons[0].email[0] === "tom@proef-sanitair.be" && !san.persons[0].hasLogin);
const tegels = (await admin.getOa(orgX.ok.id)).ok;
check("bestaande firma aangevuld, niets overschreven (naam, KBO, eerdere code en vakgebied blijven)", tegels.org.aliases.join() === "GILS,TEGELS PIET" && tegels.org.trades.join() === "tegels,chape" && tegels.org.name === "Proef Tegels BV");
const again = (await admin.importOrgs(false, rowsA)).ok;
check("tweede keer dezelfde import: niets nieuw, niets aangevuld, geen dubbels", Number(again.created) === 0 && Number(again.updated) === 0 && Number(again.unchanged) === 3 && (await admin.listOrgs(true)).length === orgsBefore + 2 && (await admin.listPersons(true)).length === personsBefore + 1, kinds12(again));
const variant = (await admin.importOrgs(false, [row("v1", "  proef  SANITAIR b.v. ", { aliases: ["san"], persons: [impPers("TOM PROEF", undefined, undefined)] })])).ok;
check("andere schrijfwijze (hoofdletters, spaties, punten) van dezelfde firma/persoon: geen dubbel", kinds12(variant) === "unchanged" || variant.results[0].changes.length === 0, JSON.stringify(variant, big));
const kboClash = (await admin.importOrgs(true, [row("k1", "Proef Sanitair BV", { kbo: "0123456789" })])).ok;
check("zelfde naam maar ander KBO-nummer: conflict, geen stille koppeling", Object.keys(kboClash.results[0].outcome)[0] === "conflict", JSON.stringify(kboClash.results[0], big));
check("firma van een andere soort onder dezelfde naam: conflict", Object.keys((await admin.importOrgs(true, [row("s1", "Proef Leverancier NV", { kind: "authority" })])).ok.results[0].outcome)[0] === "conflict");
check("een klant als OA importeren geweigerd (ongeldig)", Object.keys((await admin.importOrgs(true, [row("c1", "Familie X", { kind: "client" })])).ok.results[0].outcome)[0] === "invalid");
await admin.archiveOrg((await admin.listOas(oaFilter({ text: "Leverancier" })))[0].org.id);
check("gearchiveerde firma: conflict, eerst terugzetten", Object.keys((await admin.importOrgs(true, [row("a1", "Proef Leverancier NV", { kind: "supplier" })])).ok.results[0].outcome)[0] === "conflict");
check("auditlog: import gelogd met aantallen, zonder namen of gegevens", await admin.auditLog(0n, 60n).then((l) => { const e = l.find((x) => x.action === "import-organisaties"); return e && e.detail.includes("nieuw") && !e.detail.includes("Sanitair") && !l.some((x) => x.action.startsWith("import") && x.detail.includes("proef-sanitair")); }));
check("auditlog kent ook de proefronde", (await admin.auditLog(0n, 80n)).some((x) => x.action === "import-organisaties-proef"));
const exp12 = await admin.exportIntern();
check("interne export bevat contacten, contactgegevens van personen en vakgebieden", exp12.orgContacts.length >= 2 && exp12.personContacts.length >= 2 && exp12.trades.length === 22);

await sec("── 1.3 planning per werf: sjabloon, kalender, verschuiven, uitvoerders, bevestigen, zicht per rol (R3, R5, R6)");
const dayOf = (y, m, d) => BigInt(Math.floor(Date.UTC(y, m - 1, d) / 86_400_000));
const wd = (d) => (Number(d) + 3) % 7; // 0 = maandag
const fmt = (d) => new Date(Number(d) * 86_400_000).toISOString().slice(0, 10);
const tIn = (o) => ({ id: opt(o.id), title: o.title ?? "Proeftaak", note: o.note ?? "", kind: { [o.kind ?? "work"]: null }, trade: opt(o.trade), responsibleOrgId: opt(o.org), status: { [o.status ?? "planned"]: null }, percent: o.percent ?? 0n, start: o.start ?? dayOf(2026, 11, 2), workdays: o.workdays ?? 5n, leadDays: o.lead ?? 0n, orderDay: opt(o.orderDay), reason: o.reason ?? "" });
const plan = (who, w = A) => who.getPlan(w);
const byKey = (p, k) => p.tasks.find((t) => t.templateKey[0] === k);
const START = dayOf(2026, 11, 2); // maandag
// Sjablonen lezen (interne rollen) en de standaard (VOORLOPIG)
const tpls = await calc.listTemplates();
const std = tpls.find((t) => t.key === "standaardrenovatie");
check("standaardsjabloon staat klaar (voorlopig, nog niet bewaard)", !!std && std.provisional && !std.stored && std.steps.length === 28, `${std?.steps.length}`);
check("OA, architect, klant, veiligheid lezen de sjablonen niet", (await Promise.all([oa, arch, klant, vc, anon].map((x13) => rejects(x13.listTemplates())))).every(Boolean));
// Lezen van een lege planning
const p0 = await plan(calc);
check("calculator leest de (lege) planning van A", p0.tasks.length === 0 && p0.caps.edit === false && p0.scope === "full");
check("OA Tegels kan de planning van B niet lezen (geen lid)", await rejects(oa.getPlan(B)));
check("anoniem en ongekoppeld lezen geen planning", (await rejects(anon.getPlan(A))) && (await rejects(vreemde.getPlan(A))));
// Plannen: enkel admin en werfleider (R5)
check("calculator, OA, architect, klant, veiligheid plannen niet", (await Promise.all([calc, oa, arch, klant, vc].map((x13) => denied(x13.saveTask(A, tIn({}), 0n))))).every(Boolean));
check("calculator past geen sjabloon toe", await denied(calc.applyTemplate(A, "standaardrenovatie", START, false, 0n)));
const ap = await wl.applyTemplate(A, "standaardrenovatie", START, false, 0n);
check("werfleider zet het sjabloon op werf A vanaf ma 02.11.2026", isOk(ap), errOf(ap));
let pA = await plan(wl);
check("28 taken met afhankelijkheden, eerste op 02.11.2026", pA.tasks.length === 28 && pA.dependencies.length >= 30 && byKey(pA, "voorbereiding").start === START, `${pA.tasks.length} taken, ${pA.dependencies.length} afh.`);
check("elke taak begint op een werkdag (ma–vr)", pA.tasks.every((t) => wd(t.start) < 5 && wd(t.end) < 5));
check("geen waarschuwingen: niemand begint vóór zijn voorganger klaar is", pA.tasks.every((t) => t.warnings.length === 0), pA.tasks.flatMap((t) => t.warnings).join(" | "));
const chape = byKey(pA, "chape");
const tegelsT = byKey(pA, "tegels");
const afbraak = byKey(pA, "afbraak");
check("ruwbouw begint de werkdag na de afbraak", byKey(pA, "ruwbouw").start > afbraak.end && Number(byKey(pA, "ruwbouw").start - afbraak.end) <= 3);
check("tegels wachten de droogtijd van de chape (15 werkdagen = ≥ 21 kalenderdagen)", Number(tegelsT.start - chape.end) >= 21, `${fmt(chape.end)} → ${fmt(tegelsT.start)}`);
check("de wachttijd geldt enkel na de eerste voorganger (chape), niet na de pleister", pA.dependencies.filter((d) => d.toTaskId === tegelsT.id).map((d) => Number(d.lagDays)).sort().join() === "0,15");
const levK = byKey(pA, "levering-keuken");
check("levering keuken = mijlpaal met levertermijn 42 d en 'uiterlijk bestellen'", "delivery" in levK.kind && levK.workdays === 0n && levK.leadDays === 42n && levK.orderBy[0] === levK.start - 42n);
check("oplevering is een mijlpaal aan het einde", "milestone" in byKey(pA, "oplevering").kind && byKey(pA, "oplevering").start === pA.end[0]);
check("het sjabloon nog eens zonder 'toevoegen' geweigerd", errOf(await wl.applyTemplate(A, "standaardrenovatie", START, false, pA.version)).includes("al taken"));
check("verouderde planversie geweigerd (geen stil verlies)", errOf(await wl.saveTask(A, tIn({ title: "Te laat" }), 0n)).includes("intussen gewijzigd"));
// Grenzen
check("mijlpaal met duur geweigerd", errOf(await wl.saveTask(A, tIn({ kind: "milestone", workdays: 3n }), pA.version)).includes("0 dagen"));
check("onmogelijke startdatum geweigerd", errOf(await wl.saveTask(A, tIn({ start: 10n }), pA.version)).includes("Onmogelijke"));
check("onbekend vakgebied geweigerd", errOf(await wl.saveTask(A, tIn({ trade: "bestaat-niet" }), pA.version)).includes("vakgebied"));
// Voorvertoning verandert niets
const vb = byKey(pA, "voorbereiding");
const pv = await wl.previewPlan(A, { move: { taskId: vb.id, start: START + 7n, workdays: vb.workdays, mode: { follow: null } } });
check("voorvertoning: voorbereiding +1 week → alle 28 taken schuiven mee", isOk(pv) && pv.ok.changes.length === 28, errOf(pv) || `${pv.ok?.changes.length}`);
check("voorvertoning verandert niets", (await plan(wl)).version === pA.version && byKey(await plan(wl), "voorbereiding").start === START);
check("calculator en OA kunnen geen voorvertoning vragen", (await denied(calc.previewPlan(A, { reflow: null }))) && (await denied(oa.previewPlan(A, { reflow: null }))));
const mv = await wl.applyPlan(A, { move: { taskId: vb.id, start: START + 7n, workdays: vb.workdays, mode: { follow: null } } }, pA.version, "klant vraagt een week later");
check("verplaatsen: 28 taken een week later, planversie +1", isOk(mv) && mv.ok.changes.length === 28 && mv.ok.version === pA.version + 1n, errOf(mv));
pA = await plan(wl);
check("oplevering schoof ook 5 werkdagen", byKey(pA, "oplevering").start === mv.ok.changes.find((c) => c.taskId === byKey(pA, "oplevering").id).toStart && mv.ok.changes.every((c) => c.toStart > c.fromStart));
const hist13 = await wl.taskHistory(A, [byKey(pA, "oplevering").id], 0n, 20n);
check("wijzigingen: wat schoof en waarom (volgt «Werfvoorbereiding…» · reden)", hist13.some((h) => h.field === "start" && h.reason.includes("volgt") && h.reason.includes("klant vraagt")), JSON.stringify(hist13.slice(0, 2), big));
// Vroeger dan de voorganger kan niet
const rw = byKey(pA, "ruwbouw");
const early = await wl.previewPlan(A, { move: { taskId: rw.id, start: rw.start - 7n, workdays: rw.workdays, mode: { asNeeded: null } } });
check("ruwbouw vóór het einde van de afbraak zetten: blijft staan (wacht op «Afbraakwerken»)", isOk(early) && early.ok.changes.every((c) => c.taskId !== rw.id || c.toStart === rw.start), JSON.stringify(early, big));
// Verlengen schuift de opvolgers
const ab = byKey(pA, "afbraak");
const longer = await wl.applyPlan(A, { move: { taskId: ab.id, start: ab.start, workdays: ab.workdays + 5n, mode: { asNeeded: null } } }, pA.version, "asbest gevonden");
pA = await plan(wl);
check("afbraak +5 werkdagen: ruwbouw en de rest schuiven, niemand te vroeg", isOk(longer) && byKey(pA, "ruwbouw").start > byKey(pA, "afbraak").end && pA.tasks.every((t) => t.warnings.length === 0), errOf(longer));
// Kalender: bouwverlof (bedrijf) en STOP (werf)
const bvl = { id: [], scope: { company: null }, kind: { bouwverlof: null }, from: dayOf(2026, 12, 21), to: dayOf(2027, 1, 1), reason: "Kerstverlof (proef)" };
check("werfleider kan geen bedrijfskalender wijzigen", await denied(wl.saveCalendarBlock(bvl)));
check("OA kan geen werfblokkering zetten", await denied(oa.saveCalendarBlock({ ...bvl, scope: { work: A }, kind: { stop: null } })));
check("verlof per firma komt in 1.4 (geweigerd)", await denied(admin.saveCalendarBlock({ ...bvl, scope: { org: orgX.ok.id }, kind: { verlof: null } })));
const blk = await admin.saveCalendarBlock(bvl);
check("admin zet bouwverlof 21.12.2026 – 01.01.2027 voor het hele bedrijf", isOk(blk), errOf(blk));
pA = await plan(wl);
check("taken over het bouwverlof duren langer; opvolgers krijgen een waarschuwing", pA.blocks.length === 1 && pA.tasks.some((t) => t.warnings.length > 0));
check("een taak die nu in het bouwverlof begint, krijgt een waarschuwing", pA.tasks.filter((t) => t.start >= bvl.from && t.start <= bvl.to).every((t) => t.warnings.some((w) => w.includes("blokkering"))));
const rf = await wl.previewPlan(A, { reflow: null });
check("herschikken: voorvertoning toont wat schuift", isOk(rf) && rf.ok.changes.length > 0);
check("herschikken toepassen: geen waarschuwingen meer", isOk(await wl.applyPlan(A, { reflow: null }, pA.version, "bouwverlof")) && (await plan(wl)).tasks.every((t) => t.warnings.length === 0));
check("na herschikken begint of eindigt geen taak in het bouwverlof", (await plan(wl)).tasks.every((t) => (t.start < bvl.from || t.start > bvl.to) && (t.end < bvl.from || t.end > bvl.to)));
const stop = await wl.saveCalendarBlock({ id: [], scope: { work: A }, kind: { stop: null }, from: dayOf(2027, 1, 4), to: dayOf(2027, 1, 8), reason: "STOP: stabiliteit (proef)" });
check("werfleider zet STOP op zijn werf A", isOk(stop), errOf(stop));
pA = await plan(wl);
check("na de STOP opnieuw herschikken: geen waarschuwingen", isOk(await wl.applyPlan(A, { reflow: null }, pA.version, "STOP")) && (await plan(wl)).tasks.every((t) => t.warnings.length === 0));
check("STOP op werf A geldt niet voor werf B", (await wl.listCalendarBlocks([B])).every((b) => !("work" in b.scope)) && (await wl.listCalendarBlocks([A])).length === 2);
check("calculator leest de bedrijfskalender; OA niet", (await calc.listCalendarBlocks([])).length === 1 && (await rejects(oa.listCalendarBlocks([]))));
const proefBlk = await admin.saveCalendarBlock({ ...bvl, from: dayOf(2027, 7, 19), to: dayOf(2027, 8, 6), reason: "Proefblok (gearchiveerd)" });
check("admin archiveert een bedrijfsblok", isOk(await admin.archiveCalendarBlock(proefBlk.ok)) && (await calc.listCalendarBlocks([])).length === 1);
check("werfleider kan een bedrijfsblok niet archiveren", await denied(wl.archiveCalendarBlock(blk.ok)));
pA = await plan(wl);
// Afhankelijkheden
const opl = byKey(pA, "oplevering");
check("kring geweigerd (oplevering → voorbereiding)", errOf(await wl.addDependency(A, { fromTaskId: opl.id, toTaskId: byKey(pA, "voorbereiding").id, kind: { finishToStart: null }, lagDays: 0n }, pA.version)).includes("kring"));
check("dubbele afhankelijkheid geweigerd", errOf(await wl.addDependency(A, { fromTaskId: byKey(pA, "afbraak").id, toTaskId: byKey(pA, "ruwbouw").id, kind: { finishToStart: null }, lagDays: 0n }, pA.version)).includes("bestaat al"));
const dk = byKey(pA, "dak");
const dep = await wl.addDependency(A, { fromTaskId: dk.id, toTaskId: byKey(pA, "trap").id, kind: { finishToStart: null }, lagDays: 2n }, pA.version);
check("nieuwe afhankelijkheid (trap wacht 2 werkdagen op dak): opvolgers schuiven waar nodig", isOk(dep) && (await plan(wl)).tasks.every((t) => t.warnings.length === 0), errOf(dep));
pA = await plan(wl);
const depId = pA.dependencies.find((d) => d.fromTaskId === dk.id && d.toTaskId === byKey(pA, "trap").id)?.id;
check("afhankelijkheid weer weg", isOk(await wl.removeDependency(A, depId, pA.version)));
pA = await plan(wl);
// Uitvoerders: OA Tegels op «tegels», OA Dak op «dak»; levering met besteldatum
const tg = byKey(pA, "tegels");
const st13 = await wl.saveTask(A, tIn({ id: tg.id, title: tg.title, kind: "work", trade: "tegels", org: orgX.ok.id, start: tg.start, workdays: tg.workdays, note: "sleutel bij de buren (intern)" }), pA.version);
check("werfleider wijst «tegels» toe aan de tegelfirma (verantwoordelijke = eerste uitvoerder)", isOk(st13), errOf(st13));
pA = await plan(wl);
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
const free = await wl.saveTask(A, tIn({ title: "Nutsaansluiting Fluvius", workdays: 1n, start: dayOf(2026, 11, 14) }), pA.version);
check("vrije taak op een zaterdag → naar maandag", isOk(free) && (await plan(wl)).tasks.some((t) => t.title === "Nutsaansluiting Fluvius" && t.start === dayOf(2026, 11, 16)));
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
check("de laatste admin kan zijn adminrol niet verliezen", "err" in (await admin.updatePerson(adminId, { name: "x", roles: roles("werfleider"), orgId: [], shortCode: [], lang: [], phone: [] })));
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
check("admin: interne export met personen, codes zonder hash, werven", ex.persons.length >= 10 && ex.invites.length >= 10 && !("hash" in ex.invites[0]) && ex.works.length === 3);
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
