// Stap 0.2 — doorlopende proef van toegang (a), tickets (d), timer (g) en vetKeys (h).
// Gebruik (lokaal):  ICP_HOST=http://localhost:8041 node tools/proef.mjs <canister-id>
// Alleen tegen een LEGE canister: de proef claimt de opstartcode.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { backend, identity, KEYDIR } from "./lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tools/proef.mjs <canister-id>");
const bootstrap = readFileSync(join(KEYDIR, "test-opstartcode.txt"), "utf8").trim();

let pass = 0;
let fail = 0;
function check(name, cond, extra = "") {
  if (cond) pass++;
  else fail++;
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
const isOk = (r) => r && "ok" in r;
const status = (me) => Object.keys(me.status)[0];

const anon = await backend(null, cid);
const admin = await backend("proef-admin", cid);
const wl = await backend("proef-werfleider", cid);
const wl2 = await backend("proef-werfleider-toestel2", cid);
const oa = await backend("proef-oa", cid);
const vreemde = await backend("proef-vreemde", cid);
const robot = await backend("robot-test", cid);
const t0 = Date.now();

console.log("── (a) toegang");
check("anoniem → status anonymous", status(await anon.me()) === "anonymous");
check("anoniem kan opstartcode niet claimen", await rejects(anon.claimBootstrap(bootstrap, "x")));
check("anoniem kan geen code inwisselen", await rejects(anon.redeemCode("BOW-0000-0000-0000")));

const wrong = [];
for (let i = 0; i < 5; i++) wrong.push(await vreemde.redeemCode(`BOW-ZZZZ-ZZZZ-ZZZ${i}`));
check("5 foute codes → telkens weigering", wrong.every((r) => "err" in r));
const sixth = await vreemde.redeemCode("BOW-ZZZZ-ZZZZ-ZZZ9");
check("6de poging → geblokkeerd", "err" in sixth && sixth.err.includes("geblokkeerd"), sixth.err);
const vme = await vreemde.me();
check("me() toont blokkering", vme.blockedUntil.length === 1);
const blockedHours = Number((vme.blockedUntil[0] - BigInt(Date.now()) * 1_000_000n) / 3_600_000_000_000n);
check("blokkering ± 24 uur", blockedHours >= 23 && blockedHours <= 24, `${blockedHours} u`);
check("geblokkeerde kan ook de juiste opstartcode niet gebruiken", "err" in (await vreemde.claimBootstrap(bootstrap, "x")));

const claim = await admin.claimBootstrap(bootstrap.toLowerCase().replaceAll("-", " "), "Proef Beheerder");
check("opstartcode (kleine letters, spaties) → eerste admin", isOk(claim), JSON.stringify(claim.err ?? ""));
check("tweede claim van de opstartcode faalt", "err" in (await oa.claimBootstrap(bootstrap, "x")));
check("admin is actief", status(await admin.me()) === "active");

const invWl = await admin.invitePerson("Proef Werfleider", [{ werfleider: null }], 7n);
check("admin maakt uitnodiging werfleider", isOk(invWl));
const wlCode = invWl.ok.code;
check("code heeft vorm BOW-XXXX-XXXX-XXXX", /^BOW-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/.test(wlCode), wlCode);
const vervalDagen = Number((invWl.ok.expiresAt - BigInt(Date.now()) * 1_000_000n) / 86_400_000_000_000n);
check("vervalt na ± 7 dagen", vervalDagen >= 6 && vervalDagen <= 7, `${vervalDagen} d`);

const r1 = await wl.redeemCode(wlCode);
check("werfleider wisselt code in → wacht op bevestiging (interne rol)", isOk(r1) && status(r1.ok) === "pending");
check("werfleider in afwachting heeft nog geen toegang", await rejects(wl.listFiles()));
check("zelfde code een tweede keer (andere principal) faalt", "err" in (await oa.redeemCode(wlCode)));
check("admin bevestigt", isOk(await admin.confirmLink(identity("proef-werfleider").getPrincipal())));
check("werfleider nu actief", status(await wl.me()) === "active");

const invOaByWl = await wl.invitePerson("Proef OA Tegels", [{ onderaannemer: null }], 7n);
check("werfleider mag een OA uitnodigen", isOk(invOaByWl));
check("werfleider mag geen admin uitnodigen", "err" in (await wl.invitePerson("Te veel", [{ admin: null }], 7n)));
const oaCode = invOaByWl.ok.code.toLowerCase().replace(/^bow-/, "").replaceAll("-", "");
const r2 = await oa.redeemCode(oaCode);
check("OA wisselt code in (kleine letters, zonder streepjes) → meteen actief", isOk(r2) && status(r2.ok) === "active");
const wlInvites = await wl.listInvites();
check("werfleider ziet enkel zijn eigen codes", wlInvites.length === 1 && wlInvites[0].personName === "Proef OA Tegels");
check("OA ziet de auditlog niet", await rejects(oa.auditLog(10n)));

const invRev = await admin.invitePerson("Proef Ingetrokken", [{ architect: null }], 7n);
check("admin trekt een code in", isOk(await admin.revokeInvite(invRev.ok.inviteId)));
const fresh = await backend("proef-nieuw", cid);
check("ingetrokken code werkt niet (nieuwe principal)", "err" in (await fresh.redeemCode(invRev.ok.code)));

const rec = await admin.createRecoveryCode(r1.ok.person[0].id, 7n);
check("admin maakt herstelcode voor de werfleider", isOk(rec));
const r3 = await wl2.redeemCode(rec.ok.code);
check("tweede toestel wisselt herstelcode in → wacht (intern)", isOk(r3) && status(r3.ok) === "pending");
await admin.confirmLink(identity("proef-werfleider-toestel2").getPrincipal());
const me2 = await wl2.me();
check("tweede toestel = dezelfde persoon", status(me2) === "active" && me2.person[0].id === r1.ok.person[0].id);

console.log("── (d) ticketpatroon");
const tk = await wl.createTicket("proef-voorstel", "Proefwerf");
check("werfleider maakt ticket", isOk(tk));
check("ticket = 128 bit", /^TK-[0-9a-f]{32}$/.test(tk.ok.ticket), tk.ok.ticket);
check("niet-robot mag checkTicket niet", await rejects(admin.checkTicket(tk.ok.ticket)));
check("anoniem mag checkTicket niet", await rejects(anon.checkTicket(tk.ok.ticket)));
check("robot: voorstel vóór controle geweigerd", "err" in (await robot.submitProposal(tk.ok.ticketId, "x")));
const c1 = await robot.checkTicket(tk.ok.ticket);
check("robot controleert ticket", isOk(c1) && c1.ok.personName === "Proef Werfleider" && c1.ok.task === "proef-voorstel");
check("tweede controle van hetzelfde ticket faalt", "err" in (await robot.checkTicket(tk.ok.ticket)));
check("onbekend ticket faalt", "err" in (await robot.checkTicket("TK-00000000000000000000000000000000")));
const sp = await robot.submitProposal(tk.ok.ticketId, "Voorstel van de robot (proef)");
check("robot schrijft voorstel", isOk(sp));
check("tweede voorstel op hetzelfde ticket faalt", "err" in (await robot.submitProposal(tk.ok.ticketId, "nog eens")));
check("niet-robot mag geen voorstel schrijven", await rejects(oa.submitProposal(tk.ok.ticketId, "x")));
const props = await wl.myProposals();
check("werfleider ziet het voorstel", props.length === 1 && props[0].content.includes("robot"));
check("OA ziet het voorstel van de werfleider niet", (await oa.myProposals()).length === 0);

console.log("── (a) intrekken");
const oaPrincipal = identity("proef-oa").getPrincipal();
check("admin zet OA af", isOk(await admin.revokeLink(oaPrincipal)));
check("volgende call van de OA wordt geweigerd", await rejects(oa.listFiles()));
check("OA is weer 'unlinked'", status(await oa.me()) === "unlinked");
const tk2 = await wl.createTicket("na-afzetten", "Proefwerf");
await admin.revokeLink(identity("proef-werfleider").getPrincipal());
await admin.revokeLink(identity("proef-werfleider-toestel2").getPrincipal());
check("ticket van een afgezette persoon wordt niet meer aanvaard", "err" in (await robot.checkTicket(tk2.ok.ticket)));

const audit = await admin.auditLog(200n);
const codesInAudit = [bootstrap, wlCode, invOaByWl.ok.code, invRev.ok.code, rec.ok.code].filter((c) =>
  audit.some((a) => a.detail.includes(c) || a.detail.includes(c.replaceAll("-", "").replace(/^BOW/, ""))),
);
check("auditlog bevat geen enkele volledige code", codesInAudit.length === 0);
check("auditlog heeft regels", audit.length >= 15, `${audit.length} regels`);
const acts = [...new Set(audit.map((a) => a.action))].join(", ");
console.log(`   acties: ${acts}`);

console.log("── (h) vetkd_public_key + (g) timer");
const vk = await admin.probeVetkd();
console.log(`   ${vk}`);
const st = await admin.probeStatus();
console.log(`   versie ${st.version}, timer-tikken ${st.timerTicks}, env: ${st.envNames.join(", ") || "(geen)"}`);

console.log(`\n${pass} ✓  ${fail} ✗  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
if (fail) process.exitCode = 1;
