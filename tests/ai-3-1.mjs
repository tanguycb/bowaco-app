// De AI-connector (stap 3.1, ontwerp 3.1 §2, B1) op het EIGEN lokale net, tegen de nep-inferentiedienst (tests/net/nepinferentie.mjs)
// en een nagebootste gateway (deze proef speelt zelf de robot "ai"). Bewijst:
//   (1) rechten per rol: OA, klant, architect, VC en de robot starten nooit een AI-taak; budgetcijfers en beheer enkel admin;
//   (2) fiches: enkel gekende sleutels, enkel autonomie "voorstel", model uit de catalogus, terugvalmodel expliciet, rev-controle;
//   (3) de caffeine-weg: één outcall met de sleutel uit de omgeving, schema strict, temperatuur 0, voorstel "ai:<fiche>", kost uit de tokens;
//   (4) budget: drie oproepen binnen het budget slagen, de vierde weigert ("maandbudget op"), de reservering komt vrij na een fout;
//   (5) uitkomstklassen: 503 (1 × opnieuw), ongeldig, geweigerd, tegoed op, onzeker (geraamd op de reservering), te groot, model onbekend;
//   (6) terugval caffeine → gateway (ticket), de robot "ai" (checkTicket, submitProposal, reportAiUsage, failAiTicket), een robot zonder "ai";
//   (7) één lopende oproep per persoon; het logboek, de auditlog en de voorstellen zonder invoer, sleutel, opslag-URL of https://;
//   (8) testmodus (droog: geen outcall, kost 0), de proeftaak, export van fiches en logboek.
// Enkel VERZONNEN gegevens (W-901, Firma Voorbeeld bv). Vraagt NEPINF_PORT en NEPINF_KEY (tests/lokaal.sh).
//   node tests/ai-3-1.mjs <canister-id>
import { backend, identity, setCanisterEnv } from "../tools/lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/ai-3-1.mjs <canister-id>");
const host = process.env.ICP_HOST || "";
if (!host.includes("localhost") && !host.includes("127.0.0.1")) throw new Error("tests/ai-3-1.mjs enkel op het eigen lokale net");
const NP = process.env.NEPINF_PORT;
const NK = process.env.NEPINF_KEY;
if (!NP || !NK) throw new Error("NEPINF_PORT en NEPINF_KEY ontbreken (tests/lokaal.sh start de nep-inferentiedienst)");
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const S = (x) => JSON.stringify(x, big);
const ok = (r) => { if (r && typeof r === "object" && "err" in r) throw new Error(r.err); return r && typeof r === "object" && "ok" in r ? r.ok : r; };
const isOk = (r) => r && typeof r === "object" && "ok" in r;
const errOf = (r) => (r && typeof r === "object" && "err" in r ? r.err : "");
const denied = async (p) => { try { const r = await p; return !!(r && typeof r === "object" && "err" in r && /Geen toegang/.test(r.err)); } catch (e) { return /Geen toegang|trap|Reject/i.test(String(e)); } };
const un = (a) => (Array.isArray(a) && a.length ? a[0] : null);
const nepUrl = `http://127.0.0.1:${NP}`;
const nep = {
  modus: (modus, n = 1) => fetch(`${nepUrl}/nep/modus`, { method: "POST", body: JSON.stringify({ modus, n }) }),
  log: async () => (await fetch(`${nepUrl}/nep/log`)).json(),
  wis: () => fetch(`${nepUrl}/nep/wis`, { method: "POST" }),
};
const env = (extra = {}) => setCanisterEnv("proef-admin", cid, { ...(process.env.NEPMAIL ? { INTEGRATIONS_CANISTER_ID: process.env.NEPMAIL } : {}), CAFFEINE_INFERENCE_URL: nepUrl, CAFFEINE_INFERENCE_API_KEY: NK, ...extra });

const [admin, wl, calc, arch, oa, klant, vc] = await Promise.all(["proef-admin", "proef-werfleider", "proef-calculator", "proef-architect", "proef-oa", "proef-klant", "proef-vc"].map((n) => backend(n, cid)));
const rAi = await backend("robot-ai-31", cid);
const rProef = await backend("robot-proef-31", cid);
const P = (n) => identity(n).getPrincipal();
await env();
await nep.wis();
// 3.12 (review L): de testmodus staat standaard AAN (zoals bij de mail). Voor de echte oproepen naar de nep-dienst zet de beheerder
// ze hier uitdrukkelijk uit; zonder die stap is elke oproep droog.
const dry0 = (await admin.aiOverview()).live;
if (!("ok" in (await admin.setAiSettings([], [], [false])))) throw new Error("testmodus uit lukte niet");
const MARK = "GEHEIM-INVOER-" + Math.random().toString(36).slice(2, 10);
const input = (text = `Offerte van Firma Voorbeeld bv voor W-901, ${MARK}`, extra = {}) => ({ text, refs: [], forceRoute: [], ...extra });
const ask = (who, worker = "routering", inp = input(), workId = []) => who.askAi(worker, workId, inp);

check("(0) de testmodus staat standaard aan: vóór ze uitdrukkelijk uit ging, belde deze canister niet echt (3.12)", dry0 === false || !!process.env.BOWACO_HERHAAL, String(dry0));
// ── (1) Rechten per rol ─────────────────────────────────────────────────
for (const [n, x] of [["OA", oa], ["klant", klant], ["architect", arch], ["VC", vc], ["robot", rAi]]) {
  check(`(1) ${n} start geen AI-taak, ziet geen fiches en geen eigen AI-oproepen`, (await denied(ask(x))) && (await denied(x.listAiWorkers())) && (await denied(x.myAiCalls())));
}
for (const [n, x] of [["werfleider", wl], ["calculator", calc]]) {
  const ws = await x.listAiWorkers();
  check(`(1) ${n} ziet de fiches zonder budgetcijfers, maar geen overzicht, logboek, beheer of proeftaak`, ws.length === 8 && ws.every((w) => w.budget.length === 0) && (await denied(x.aiOverview())) && (await denied(x.aiLog(0n, 10n))) && (await denied(x.refreshAiModels())) && (await denied(x.aiTestCall("routering"))) && (await denied(x.setAiSettings([], [], []))));
}
const me = await calc.me();
check("(1) caps: de calculator mag AI gebruiken, enkel de admin beheert", un(me.caps)?.ai === true && un(me.caps)?.manageAi === false && un((await admin.me()).caps)?.manageAi === true && (un((await oa.me()).caps)?.ai ?? false) === false);
check("(1) de robot kan geen kost melden zonder de soort 'ai' (nog geen robot)", errOf(await rAi.reportAiUsage(1n, { model: "x", promptTokens: 0n, completionTokens: 0n, cachedTokens: 0n, costCents: 0n, durationMs: 0n, outputSha256: [] })) === "Geen toegang");

// ── (2) Fiches ──────────────────────────────────────────────────────────
check("(2) een fiche die nog niet ingericht is: askAi weigert", errOf(await ask(calc)).includes("nog niet ingericht"));
const n0 = (await nep.log()).length;
const models = ok(await admin.refreshAiModels());
const ov0 = await admin.aiOverview();
const auto = ov0.models.find((m) => m.alias === "auto");
check("(2) catalogus opgehaald bij de (nep)dienst: 2 modellen, prijs × 10^10 (0,000001 $ = 10.000)", models === 2n && auto?.promptPer1e10 === 10000n && auto?.completionPer1e10 === 20000n && ov0.live === true && ov0.draft === false, S({ models, auto, live: ov0.live }));
const nl = (await nep.log()).slice(n0);
check("(2) één outcall naar /v1/models met de sleutel uit de omgeving", nl.length === 1 && nl[0].path === "/v1/models" && nl[0].authOk === true, S(nl));
const W = (o = {}) => ({ key: "routering", name: "Routering (proef)", route: { caffeine: null }, modelAlias: "auto", fallback: false, fallbackModel: [], budgetMonthCents: 15n, maxCallCents: 5n, clientData: false, autonomy: { proposal: null }, instructionVersion: 1n, enabled: true, rev: 0n, ...o });
check("(2) onbekende sleutel geweigerd", errOf(await admin.saveAiWorker(W({ key: "alles-doen" }))).includes("Onbekende"));
check("(2) autonomie 'auto' geweigerd (enkel voorstellen)", errOf(await admin.saveAiWorker(W({ autonomy: { auto: null } }))).includes("voorstel"));
check("(2) model buiten de catalogus geweigerd", errOf(await admin.saveAiWorker(W({ modelAlias: "bestaat-niet" }))).includes("catalogus"));
check("(2) terugval is geweigerd (3.12: de andere weg, de gateway, staat uit)", errOf(await admin.saveAiWorker(W({ fallback: true }))).includes("staat uit") && errOf(await admin.saveAiWorker(W({ fallback: true, fallbackModel: ["auto"] }))).includes("staat uit"));
check("(2) onbekende instructieversie en plafond boven het budget geweigerd", errOf(await admin.saveAiWorker(W({ instructionVersion: 9n }))).includes("instructieversie") && errOf(await admin.saveAiWorker(W({ maxCallCents: 50n }))).includes("plafond"));
check("(2) een fiche op de weg gateway is geweigerd (3.12: die weg staat uit)", errOf(await admin.saveAiWorker(W({ route: { gateway: null }, modelAlias: "sonnet" }))).includes("staat uit"));
check("(2) de calculator kan geen fiche bewaren", await denied(calc.saveAiWorker(W())));
check("(2) fiche routering bewaard (caffeine, auto, € 0,15 per maand, 5 cent per oproep)", isOk(await admin.saveAiWorker(W())));
check("(2) rev-controle: een tweede bewaring met rev 0 weigert", errOf(await admin.saveAiWorker(W())).includes("Iemand anders"));
const rev = () => admin.listAiWorkers().then((ws) => ws.find((w) => w.key === "routering").rev);

// ── (3) De caffeine-weg ─────────────────────────────────────────────────
await nep.wis();
const a1 = ok(await ask(calc));
const call1 = un(await calc.aiCall(a1.proposal?.callId ?? 0n));
const n1 = await nep.log();
check("(3) askAi → voorstel (caffeine-weg, in dezelfde update-call)", !!a1.proposal && !!call1 && "done" in call1.state, S(a1));
check("(3) één chat-oproep: sleutel juist, json_schema strict, temperatuur 0, tokenplafond", n1.length === 1 && n1[0].path === "/v1/chat/completions" && n1[0].authOk && n1[0].schema && n1[0].strict && n1[0].temperature === 0 && n1[0].maxTokens === 300 && n1[0].model === "auto", S(n1));
const prop1 = (await calc.myProposals()).find((p) => p.id === a1.proposal.proposalId);
check("(3) het voorstel: soort ai:routering, inhoud JSON met de werf, op naam van de calculator", !!prop1 && prop1.kind === "ai:routering" && JSON.parse(prop1.content).werf === "W-901" && un(prop1.personId) === un((await calc.me()).person)?.id, S(prop1));
check("(3) kost uit de tokens: 20.000 in × 1e-6 $ + 10.000 uit × 2e-6 $ = 0,04 $ → 4 cent (koers 1,000)", call1.costCents === 4n && call1.promptTokens === 20000n && call1.completionTokens === 10000n && call1.reservedCents === 5n, S(call1));
check("(3) de calculator ziet zijn oproep zonder invoerhash en zonder extra; de admin met", call1.inputSha256.length === 0 && call1.extra.length === 0 && un(un(await admin.aiCall(call1.id))?.inputSha256 ?? [])?.length === 64);
check("(3) de werfleider ziet de oproep van de calculator niet", (await wl.aiCall(call1.id)).length === 0);
check("(3) de beslissing gaat via het bestaande voorstel (decideProposal)", isOk(await calc.decideProposal(a1.proposal.proposalId, true, "proef: overgenomen")));

// ── (4) Budget ──────────────────────────────────────────────────────────
const a2 = await ask(calc);
const a3 = await ask(calc);
const a4 = await ask(calc);
check("(4) drie oproepen binnen het budget slagen, de vierde weigert (maandbudget op)", isOk(a2) && isOk(a3) && errOf(a4).includes("maandbudget"), S([a2, a3, a4]));
let ov = await admin.aiOverview();
let st = ov.workers.find((w) => w.key === "routering");
check("(4) overzicht: 12 cent verbruikt, niets meer gereserveerd, 3 oproepen deze maand", st.spentCents === 12n && st.reservedCents === 0n && st.calls === 3n, S(st));
const notes = await admin.myNotifications(false);
check("(4) de admins kregen een melding 'budget op' en een melding '80 %'", notes.some((n) => n.text.includes("maandbudget") && n.text.includes("op")) && notes.some((n) => n.text.includes("80 %")));
check("(4) auditregel ai-budget-op", (await admin.auditLog(0n, 100n)).some((e) => e.action === "ai-budget-op"));
check("(2) budget verhoogd naar € 5 per maand (rev " + (await rev()) + ")", isOk(await admin.saveAiWorker(W({ budgetMonthCents: 500n, maxCallCents: 20n, rev: await rev() }))));

// ── (5) Uitkomstklassen ─────────────────────────────────────────────────
const stateOf = async (pred) => (await admin.aiLog(0n, 1n))[0];
const spent = async () => (await admin.aiOverview()).workers.find((w) => w.key === "routering");
await nep.wis();
await nep.modus("503", 2);
const b503 = await ask(calc);
let last = await stateOf();
check("(5) 503 twee keer: één herhaling in dezelfde oproep, dan mislukt (geen terugval: uit)", errOf(b503).includes("niet beschikbaar") && (await nep.log()).length === 2 && "failed" in last.state, S([b503, last.state]));
st = await spent();
check("(5) na de fout is de reservering vrij en niets aangerekend", st.reservedCents === 0n && st.spentCents === 12n && last.costCents === 0n, S(st));
await nep.modus("503", 1);
const b503b = await ask(calc);
check("(5) 503 één keer: de herhaling slaagt", isOk(b503b) && !!b503b.ok.proposal, S(b503b));
await nep.modus("429-rate", 1);
check("(5) 429 rate_limit_exceeded één keer: opnieuw en geslaagd", isOk(await ask(calc)));
const before = (await spent()).spentCents;
await nep.modus("ongeldig", 1);
const bInv = await ask(calc);
last = await stateOf();
check("(5) antwoord geen JSON: ongeldig, geen voorstel, de kost (tokens) wel geboekt", errOf(bInv).includes("ongeldig") && "invalid" in last.state && last.proposalId.length === 0 && last.costCents === 4n && (await spent()).spentCents === before + 4n, S([bInv, last.state, last.costCents]));
await nep.modus("groot", 1);
const bBig = await ask(calc);
last = await stateOf();
check("(5) antwoord groter dan 10 kB: ongeldig (te groot), geen voorstel", errOf(bBig).includes("ongeldig") && "invalid" in last.state && last.state.invalid.includes("te groot"), S(last.state));
await nep.modus("weiger", 1);
const bRef = await ask(calc);
last = await stateOf();
check("(5) het model weigert: 'refused', geen voorstel", errOf(bRef).includes("weigerde") && "refused" in last.state, S(last.state));
await nep.modus("429-cap", 1);
const bCap = await ask(calc);
last = await stateOf();
check("(5) 429 cap_month: tegoed op, geen herhaling, niets aangerekend, melding zonder adres", errOf(bCap).includes("tegoed") && "failed" in last.state && last.costCents === 0n && !last.state.failed.includes("@"), S([bCap, last.state]));
await nep.modus("500", 1);
const s500 = (await spent()).spentCents;
const b500 = await ask(calc);
last = await stateOf();
check("(5) 500: onzeker, nooit vanzelf opnieuw, geraamd op de reservering (20 cent)", errOf(b500).includes("zeker") && "unsure" in last.state && last.costCents === 20n && (await spent()).spentCents === s500 + 20n, S([b500, last.state, last.costCents]));
await nep.modus("400-model", 1);
const bMod = await ask(calc);
last = await stateOf();
check("(5) 400 model_not_found: mislukt (model onbekend), geen terugval zolang die uit staat", errOf(bMod).includes("niet beschikbaar") && "failed" in last.state && last.state.failed.includes("model onbekend"), S([bMod, last.state]));
await env({ CAFFEINE_INFERENCE_API_KEY: "verkeerd-" + NK.slice(0, 4) });
const bKey = await ask(calc);
last = await stateOf();
check("(5) sleutel geweigerd (401): ongeldig, de sleutel zelf nergens in de melding", errOf(bKey).includes("weigerde") && "invalid" in last.state && !S(last).includes("verkeerd-"), S(last.state));
await setCanisterEnv("proef-admin", cid, { ...(process.env.NEPMAIL ? { INTEGRATIONS_CANISTER_ID: process.env.NEPMAIL } : {}), CAFFEINE_INFERENCE_URL: nepUrl });
const nNoKey = (await nep.log()).length;
const bNoKey = await ask(calc);
check("(5) geen sleutel in de omgeving: geen outcall, duidelijke fout", errOf(bNoKey).includes("niet beschikbaar") && (await nep.log()).length === nNoKey, errOf(bNoKey));
await env();

// ── (6) De gateway-weg staat UIT (3.12, review M4; eigenaar 08-11: de externe AI via een eigen gateway viel af) ──
// Geen adres, geen fiche op die weg, geen terugval, geen ticket, geen robot "ai", geen kostmelding. Enkel Config.aiGatewayEnabled zet
// dit weer aan, en tools/meetlat.mjs weigert een upload daarmee.
const USE = { model: "nep/echo", promptTokens: 1n, completionTokens: 1n, cachedTokens: 0n, costCents: 1n, durationMs: 1n, outputSha256: [] };
check("(6) een gateway-adres instellen is geweigerd; de koers bewaren kan; het overzicht draagt geen adres", errOf(await admin.setAiSettings(["https://gateway.voorbeeld.invalid"], [], [])).includes("staat uit") && isOk(await admin.setAiSettings([], [920n], [])) && (await admin.aiOverview()).gatewayUrl.length === 0);
check("(6) een fiche op de weg gateway of met terugval is geweigerd", errOf(await admin.saveAiWorker(W({ route: { gateway: null }, modelAlias: "nep/echo", rev: await rev() }))).includes("staat uit") && errOf(await admin.saveAiWorker(W({ fallback: true, fallbackModel: ["nep/echo"], rev: await rev() }))).includes("staat uit") && errOf(await admin.saveAiWorker(W({ fallbackModel: ["nep/echo"], rev: await rev() }))).includes("staat uit"));
check("(6) fiche met een ruimer budget bewaard (caffeine, zonder terugval)", isOk(await admin.saveAiWorker(W({ budgetMonthCents: 500n, maxCallCents: 20n, rev: await rev() }))));
const nLog0 = (await admin.aiLog(0n, 500n)).length;
const forced = await ask(calc, "routering", input(undefined, { forceRoute: [{ gateway: null }] }));
check("(6) forceRoute naar de gateway: geweigerd, geen ticket en geen oproep in het logboek", "err" in forced && !S(forced).includes("TK-") && (await admin.aiLog(0n, 500n)).length === nLog0, S(forced));
await nep.modus("503", 2);
const g1 = await ask(calc);
const logs = await admin.aiLog(0n, 3n);
check("(6) 503 twee keer: geen terugval, een duidelijke fout en geen ticket", errOf(g1).includes("niet beschikbaar") && !S(g1).includes("TK-") && logs.every((l) => "caffeine" in l.route && !l.fellBack), S([g1, logs.map((l) => [l.route, l.state, l.fellBack])]));
check("(6) een robot met de soort 'ai' kan niet meer gemaakt worden; de soort 'proef' wel", errOf(await admin.addRobot(P("robot-ai-31"), "Gateway AI (proef)", ["ai"])) !== "" && !(await admin.listRobots()).some((r) => r.kinds.includes("ai")) && isOk(await admin.addRobot(P("robot-proef-31"), "Gateway proef", ["proef"])));
check("(6) kost melden of een AI-ticket laten mislukken: geen toegang (robot zonder 'ai', gewone login, onbekende sleutel)", (await denied(rProef.reportAiUsage(1n, USE))) && (await denied(calc.reportAiUsage(1n, USE))) && (await denied(rAi.reportAiUsage(1n, USE))) && (await denied(rProef.failAiTicket(1n, "proef"))) && (await denied(rAi.failAiTicket(1n, "proef"))));
check("(6) geen enkele oproep in het logboek liep via de gateway", (await admin.aiLog(0n, 500n)).every((l) => "caffeine" in l.route && l.ticketId.length === 0));

// ── (7) Eén lopende oproep per persoon; geen inhoud in logboek, audit of voorstellen ──
await nep.modus("traag", 1);
const [c1, c2] = await Promise.all([ask(wl), (async () => { await new Promise((r) => setTimeout(r, 1500)); return ask(wl); })()]);
check("(7) tweede oproep van dezelfde persoon terwijl de eerste loopt: geweigerd", (isOk(c1) && errOf(c2).includes("al een AI-oproep")) || (isOk(c2) && errOf(c1).includes("al een AI-oproep")), S([c1, c2]));
const allLog = S(await admin.aiLog(0n, 500n));
const allAudit = S(await admin.auditLog(0n, 500n));
const allProps = S(await admin.myProposals());
check("(7) logboek zonder invoertekst, sleutel, opslag-URL of https://", !allLog.includes(MARK) && !allLog.includes(NK) && !allLog.includes("!caf!") && !allLog.includes("https://") && !allLog.includes("@"));
check("(7) auditlog zonder invoertekst of sleutel", !allAudit.includes(MARK) && !allAudit.includes(NK));
check("(7) voorstellen zonder invoertekst of sleutel (enkel het antwoord)", !allProps.includes(MARK) && !allProps.includes(NK));
check("(7) ongeldige verwijzing (opslag-URL) en te grote invoer geweigerd", errOf(await ask(calc, "routering", input("x", { refs: ["!caf!sha256:abc"] }))).includes("verwijzing") && errOf(await ask(calc, "routering", input("x".repeat(200_001)))).includes("te groot"));
check("(7) een taak met eigen rechten: werfverslag-spraak vraagt een werf", errOf(await ask(calc, "werfverslag-spraak")).includes("werf"));
const mine = await calc.myAiCalls();
const calcId = un((await calc.me()).person)?.id;
check("(7) Mijn AI-oproepen: enkel die van de calculator", mine.length > 5 && mine.every((c) => un(c.personId) === calcId));

// ── (8) Testmodus, proeftaak, export ───────────────────────────────────
check("(8) testmodus aan (ook een livecanister antwoordt dan droog)", isOk(await admin.setAiSettings([], [], [true])) && (await admin.aiOverview()).live === false);
const nDry = (await nep.log()).length;
const sDry = (await spent()).spentCents;
const d1 = ok(await ask(calc));
const dc = un(await calc.aiCall(d1.proposal.callId));
const dp = (await calc.myProposals()).find((p) => p.id === d1.proposal.proposalId);
check("(8) testmodus: GEEN outcall, voorstel met het vaste voorbeeld (droog), kost 0, staat dryRun", (await nep.log()).length === nDry && "dryRun" in dc.state && dc.costCents === 0n && JSON.parse(dp.content).droog === true && (await spent()).spentCents === sDry, S(dc.state));
check("(8) catalogus in de testmodus: niets opgehaald, de prijzen blijven", ok(await admin.refreshAiModels()) === 2n && (await nep.log()).length === nDry && (await admin.aiOverview()).models.find((m) => m.alias === "auto")?.promptPer1e10 === 10000n);
check("(8) testmodus uit", isOk(await admin.setAiSettings([], [], [false])) && (await admin.aiOverview()).live === true);
const t1 = await admin.aiTestCall("routering");
const tc = isOk(t1) ? un(await admin.aiCall(t1.ok)) : null;
check("(8) proeftaak (admin): vaste verzonnen tekst, een voorstel", isOk(t1) && !!tc && "done" in tc.state && tc.proposalId.length === 1, S(t1));
const xw = ok(await admin.exportChunk("aiWorkers", 0n, 100n));
const xl = ok(await admin.exportChunk("aiLog", 0n, 500n));
check("(8) export: de fiche en het logboek (met invoerhash, zonder inhoud)", xw.aiWorkers?.some((w) => w.key === "routering") && xl.aiLog?.length > 10 && xl.aiLog.every((c) => c.inputSha256.length === 64) && !S(xl).includes(MARK) && !S(xl).includes(NK));
check("(8) de calculator kan niet exporteren", await denied(calc.exportChunk("aiLog", 0n, 10n)));
check("(8) Config: drafts en uploads bellen nooit echt (aiLiveBackends leeg, aiLiveAnyCanister false in de bron)", await (async () => { const { readFileSync } = await import("node:fs"); const c = readFileSync(new URL("../src/backend/lib/Config.mo", import.meta.url), "utf8"); return /public func aiLiveBackends\(\) : \[Text\] \{ \[\] \};/.test(c) && /public let aiLiveAnyCanister : Bool = false;/.test(c) && /public func mailLiveBackends\(\) : \[Text\] \{ \[\] \};/.test(c); })());

console.log(`\n${pass} ✓ ${fail} ✗`);
process.exit(fail ? 1 : 0);
