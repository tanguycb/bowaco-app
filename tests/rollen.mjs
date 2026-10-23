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
const nieuw = await as("proef-nieuw");
const robot = await as("robot-test");
const everyone = [anon, admin, admin2, wl, wl2, calc, arch, oa, oa2, klant, vc, vreemde, nieuw, robot];
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
check("werfleider mag geen instellingen wijzigen", await rejects(wl.setSettings({ werfleiderZietAlles: false, inviteDays: 7n })));
check("admin zet 'werfleider ziet alles' uit", isOk(await admin.setSettings({ werfleiderZietAlles: false, inviteDays: 7n })));
check("werfleider (alles-zien uit) ziet enkel A (zijn werf)", eq(await ids(wl), [Number(A)]));
check("werfleider (alles-zien uit): werf B faalt", await rejects(wl.getWork(B)));
check("werfleider (alles-zien uit) kan voor B geen OA uitnodigen", await denied(invite(wl, "x", roles("onderaannemer"), { workIds: [B] })));
await admin.setSettings({ werfleiderZietAlles: true, inviteDays: 7n });

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
check("admin: interne export met personen, codes zonder hash, werven", ex.persons.length >= 10 && ex.invites.length >= 10 && !("hash" in ex.invites[0]) && ex.works.length === 2);
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
