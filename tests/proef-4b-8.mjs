// Tools herschikken en uitbreiden (stap 4b.8) op het eigen lokale net, na de proeven van 3.4–4b.7. Bewijst:
//   A (zonder net) de nieuwe tools staan in Config (taken, voorstel, te_doen, planning, werf_stand, facturen_wachten; vrije taak
//     hoogstens Voorstel; facturen_wachten enkel voor de assistent van de zaakvoerder), de rekenmodules en de proefbank zijn byte-gelijk
//     aan 4b.7, geen "AI" in de nieuwe schermteksten;
//   B op het net, via de MCP-ingang zoals Claude:
//     (1) elke nieuwe leestool binnen de fiche: geen bedragen, kort en uitgebreid, paginering (totaal · vanaf · volgende), foutmeldingen
//         die zeggen hoe het wel moet;
//     (2) buiten de fiche: een tool die niet op de fiche staat (protocolfout "Unknown tool" + "Wat wel mag" + een regel in het logboek),
//         een werf buiten de fiche (de werven die wel mogen), een taak van een andere bot (dezelfde weigering: geen orakel);
//     (3) taken + voorstel op een opdracht (OA-offerte inlezen): de taak staat in de lijst, het dossier met de antwoordvelden, het
//         voorstel komt in het model (meteen, zonder volledige gelijkzetting) en in het logboek; een tweede antwoord wordt geweigerd;
//     (4) een vrije taak aan een assistent (vraag E-1 van 4b.7): enkel de beheerder geeft ze, de assistent leest ze (bezig), antwoordt
//         (voorstel), Te doen van de beheerder toont het, aanvaarden = klaar, weigeren = wacht opnieuw; het antwoord staat bij de taak;
//     (5) de assistent van de zaakvoerder: bredere leesfiche (facturen_wachten), schrijft enkel voorstellen, nooit Zelf doen, geen
//         persoon (een persoon koppelt nooit als bot);
//     (6) de maandagbriefing kort en uitgebreid.
// Enkel VERZONNEN gegevens: "Proef … 4b8", werven P-4B8-….
//   node tests/proef-4b-8.mjs <canister-id>      (zonder canister: enkel deel A)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const cid = process.argv[2];
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const S = (x) => JSON.stringify(x, big);

// ── A. Zonder net ────────────────────────────────────────────────────────
{
  const cfg = readFileSync(join(repo, "src/backend/lib/Config.mo"), "utf8");
  const tools = ["taken", "voorstel", "te_doen", "planning", "werf_stand", "facturen_wachten"];
  check("A1 de zes nieuwe tools staan in Config.botTools als leestool of algemene ingang (taak \"\")", tools.every((t) => cfg.includes(`("${t}", "")`)));
  check("A2 een vrije taak kan hoogstens Voorstel; facturen_wachten enkel bij de assistent van de zaakvoerder", /\("vrije-taak", #proposal\)/.test(cfg) && /botOwnerTools\(\) : \[Text\] \{ \["facturen_wachten"\] \}/.test(cfg));
  check("A3 oude acties van bots na 400 dagen weg (vraag E-2), begrensd per ronde", /botActionKeepDays : Nat = 400/.test(cfg) && /botActionPrunePerRound : Nat = 200/.test(cfg));
  let same = true;
  try { execFileSync("git", ["diff", "--quiet", "37954ad", "--", "src/frontend/src/quote/calc.ts", "src/frontend/src/tender/compare.ts", "src/frontend/src/tender/calc.ts", "src/backend/lib/QuoteCalc.mo", "src/backend/lib/TenderCompare.mo", "src/backend/lib/OaQuotes.mo", "src/backend/lib/OaRead.mo", "src/backend/lib/InvCheck.mo", "src/backend/lib/AiCheck.mo", "src/backend/lib/Proof.mo", "src/backend/lib/Rights.mo", "src/backend/.most/backend.most"], { cwd: repo }); } catch { same = false; }
  check("A4 rekenmodules, proefbank (Proof.mo), rechten (Rights.mo) en de stabiele signatuur byte-gelijk aan 4b.7", same);
  const nl = readFileSync(join(repo, "src/frontend/src/texts/nl.ts"), "utf8");
  const i = nl.indexOf("\n  assistenten: {");
  const blok = nl.slice(i, nl.indexOf("\n  voorstel: {", i));
  check("A5 de nieuwe schermteksten (vrije taak aan een assistent) zonder \"AI\", leverancier of fiche", /vrijUitleg/.test(blok) && !/\bAI\b|Claude|Grok|\bfiche\b/i.test(blok));
}

if (!cid) {
  console.log(`\nproef-4b-8 (enkel deel A): ${pass} ✓ ${fail} ✗`);
  process.exit(fail ? 1 : 0);
}

// ── B. Op het eigen net ─────────────────────────────────────────────────
const host = process.env.ICP_HOST || "";
if (!host.includes("localhost") && !host.includes("127.0.0.1")) throw new Error("tests/proef-4b-8.mjs enkel op het eigen lokale net");
const { backend, freshBackend } = await import("../tools/lib.mjs");
const { connect, rpc, tool } = await import("./mcp-lib.mjs");
const ok = (r) => { if (r && typeof r === "object" && "err" in r) throw new Error(r.err); return r && typeof r === "object" && "ok" in r ? r.ok : r; };
const errOf = (r) => (r && typeof r === "object" && "err" in r ? r.err : "");
const denied = async (p) => { try { const r = await p; return !!(r && typeof r === "object" && "err" in r && /Geen toegang/.test(r.err)); } catch (e) { return /Geen toegang|trap|Reject|Unauthorized/i.test(String(e)); } };
// Geen bedragen in een leestool: geen euroteken, geen centen, geen marge, geen adres van een bestand.
const AMOUNTS = /€|cents|bedragCent|totaalCent|prijsCent|eenheidsprijsCent|aankoopprijs|verkoopprijs|marge|margin|https?:\/\/|"blob"/i;

const [admin, calc, wl] = await Promise.all(["proef-admin", "proef-calculator", "proef-werfleider"].map((n) => backend(n, cid)));
const anon = await backend(null, cid);
const cDay = BigInt(Math.floor(Number((await admin.auditLog(0n, 1n))[0].at / 1_000_000n) / 86_400_000));
const iso = (d) => new Date(Number(d) * 86_400_000).toISOString().slice(0, 10);
const sfx = Date.now().toString(36).slice(-5).toUpperCase();
const addr = { street: "Proefstraat", number: "48", zip: "9999", city: "Proefdorp", country: "BE" };
const mkWork = async (code, name) => ok(await admin.createWork({ code, name, address: addr, parentId: [], clientOrgId: [], architectOrgId: [], leaderPersonId: [], vatBp: 2100n })).id;
const WA = await mkWork(`P-4B8-${sfx}-A`, "Proefwerf tools 4b8 A");
const WB = await mkWork(`P-4B8-${sfx}-B`, "Proefwerf tools 4b8 buiten de fiche");
const ORG = ok(await admin.createOrg({ kind: { subcontractor: null }, name: `Proef Bouw Specht 4b8 ${sfx}`, kbo: [], vat: [], aliases: [], trades: [], address: [], notes: "Verzonnen proeffirma (4b.8)" })).id;
// Een planning op WA (het standaardsjabloon vanaf vandaag), zodat planning en werf_stand iets tonen.
const pv = (await admin.getPlan(WA)).version;
const applied = await admin.applyTemplate(WA, "standaardrenovatie", cDay, false, pv);
check("opzet: twee proefwerven, een verzonnen firma en een planning op werf A", !!WA && !!WB && !!ORG && "ok" in applied, errOf(applied));

ok(await admin._caffeineMcpSetSignInOrigin("https://proef-4b8.example"));
ok(await admin.setMcpRedirectHosts([]));
const KINDS = ["plannen"];
const F = (o = {}) => ({ id: [], rev: 0n, name: `Proef assistent 4b8 ${sfx}`, vendor: "Proef", model: "Proefmodel", tools: ["mijn_fiche", "werven"], allWorks: false, works: [WA], docKinds: KINDS, callsPerDay: 1000n, tasks: [], instruction: ["routine v1"], ...o });
const mkBot = async (o) => {
  const id = ok(await admin.saveBot(F(o)));
  const actor = await freshBackend(cid);
  ok(await actor.claimBotCode(ok(await admin.newBotCode(id)).code));
  const con = await connect(anon, actor, cid, `Proef ${o.name ?? "assistent"}`);
  return { id, actor, t: con.access, err: con.err };
};
const READ = ["mijn_fiche", "werven", "werf_documenten", "te_doen", "planning", "werf_stand", "maandagbriefing", "taken", "voorstel", "inleesopdrachten", "inleesbestand", "voorstel_oa_offerte"];
const R = await mkBot({ name: `Proef lezer 4b8 ${sfx}`, tools: READ, works: [WA] });
const N = await mkBot({ name: `Proef smal 4b8 ${sfx}`, tools: ["mijn_fiche", "werven"], works: [WA] });
check("opzet: twee assistenten gekoppeld (eigen Internet Identity)", !!R.t && !!N.t, S([R.err, N.err]));
const T = (b, name, args = {}) => tool(anon, cid, b.t, name, args);

// ── (1) Binnen de fiche ─────────────────────────────────────────────────
const tl = (await rpc(anon, cid, R.t, "tools/list")).json?.result?.tools ?? [];
const names = tl.map((x) => x.name);
check("(1) tools/list toont de nieuwe tools van de fiche (taken, voorstel, te_doen, planning, werf_stand) en niet facturen_wachten", ["taken", "voorstel", "te_doen", "planning", "werf_stand"].every((n) => names.includes(n)) && !names.includes("facturen_wachten"), names.join(","));
check("(1) leestools staan als alleen-lezen aangeduid (readOnlyHint), voorstel niet", ["taken", "te_doen", "planning", "werf_stand"].every((n) => tl.find((x) => x.name === n)?.annotations?.readOnlyHint === true) && tl.find((x) => x.name === "voorstel")?.annotations?.readOnlyHint === false);
check("(1) de lijsten bieden vanaf, aantal en vorm", ["taken", "te_doen", "planning", "werven"].every((n) => { const p = tl.find((x) => x.name === n)?.inputSchema?.properties ?? {}; return p.vanaf && p.aantal && p.vorm; }));
const td = await T(R, "te_doen");
check("(1) te_doen: punten met werf, onderdeel, titel, dagen; onderdelen met totaal; geen bedragen", !td.isError && Array.isArray(td.data?.punten) && Array.isArray(td.data?.onderdelen) && td.data.onderdelen.length === 5 && typeof td.data.totaal === "number" && !AMOUNTS.test(td.text), td.text.slice(0, 200));
const pl = await T(R, "planning", { werfId: Number(WA) });
check("(1) planning kort: taken van werf A met start, einde, status; geen notities, geen bedragen", !pl.isError && pl.data?.taken?.length > 0 && pl.data.taken.every((x) => x.start && x.einde && x.status && !("uitvoerders" in x)) && !AMOUNTS.test(pl.text), pl.text.slice(0, 200));
const plL = await T(R, "planning", { werfId: Number(WA), vorm: "uitgebreid", aantal: 3 });
check("(1) planning uitgebreid: soort, vak, procent, uitvoerders (firma + bevestiging, geen persoon); paginering", !plL.isError && plL.data.taken.length <= 3 && plL.data.taken.every((x) => "procent" in x && Array.isArray(x.uitvoerders) && x.uitvoerders.every((u) => Object.keys(u).sort().join() === "bevestiging,firma,tot,van")) && (plL.data.totaal <= 3 || plL.data.volgende === 3) && plL.data.vorm === "uitgebreid", plL.text.slice(0, 200));
if (plL.data?.volgende) {
  const p2 = await T(R, "planning", { werfId: Number(WA), vanaf: plL.data.volgende, aantal: 3 });
  check("(1) planning pagina 2 begint waar pagina 1 stopte", !p2.isError && p2.data.vanaf === 3 && p2.data.taken[0]?.taak !== undefined);
}
const st = await T(R, "werf_stand", { werfId: Number(WA) });
const stL = await T(R, "werf_stand", { werfId: Number(WA), vorm: "uitgebreid" });
check("(1) werf_stand kort: werf, planning (tellingen, 3 volgende), documenten, taken van assistenten; geen bedragen", !st.isError && st.data?.werf?.code === `P-4B8-${sfx}-A` && st.data.planning.taken > 0 && st.data.planning.volgende.length <= 3 && st.data.documentenOpen === null && !AMOUNTS.test(st.text), st.text.slice(0, 200));
check("(1) werf_stand uitgebreid: tot 10 volgende stappen en de open documenten", !stL.isError && stL.data.planning.volgende.length <= 10 && Array.isArray(stL.data.documentenOpen) && !AMOUNTS.test(stL.text));
const wk = await T(R, "werven", { vorm: "kort" });
const wu = await T(R, "werven");
check("(1) werven: standaard uitgebreid zoals vroeger (status, gemeente), kort enkel id · code · naam; totaal en volgende", !wk.isError && wk.data.werven.every((w) => Object.keys(w).sort().join() === "code,id,naam") && wu.data.werven.every((w) => "status" in w && "gemeente" in w) && wk.data.totaal === 1 && wk.data.volgende === null, wk.text.slice(0, 160));
const fouten = [
  [await T(R, "te_doen", { aantal: 0 }), /aantal: 1 tot 100/],
  [await T(R, "te_doen", { aantal: 101 }), /aantal: 1 tot 100/],
  [await T(R, "werven", { vorm: "lang" }), /vorm: "kort" of "uitgebreid"/],
  [await T(R, "planning", { van: "12-11-2026" }), /van: een datum jjjj-mm-dd/],
  [await T(R, "planning", { van: iso(cDay), tot: iso(cDay + 400n) }), /hoogstens 366 dagen/],
  [await T(R, "werf_stand", {}), /Geef werfId.*Wat wel mag: de werven P-4B8-/],
];
check("(1) foutmeldingen zeggen hoe het wel moet (aantal, vorm, datum, bereik, werfId met de werven die mogen)", fouten.every(([r, re]) => r.isError && re.test(r.text)), S(fouten.map(([r]) => r.text.slice(0, 90))));

// ── (2) Buiten de fiche ─────────────────────────────────────────────────
const un = await T(N, "te_doen");
check("(2) een tool die niet op de fiche staat: protocolfout Unknown tool + wat wel mag (de eigen tools)", un.isError && /Unknown tool: te_doen/.test(un.rpcError ?? "") && /Wat wel mag: de tools mijn_fiche, werven/.test(un.rpcError ?? ""), un.rpcError ?? un.text);
const lg = (await admin.botLog(0n, 20n)).filter((c) => c.botId === N.id);
check("(2) en die oproep staat in het logboek (geweigerd, fiche) — vraag E9 van 3.12", lg.some((c) => c.tool === "te_doen" && "refused" in c.outcome && c.outcome.refused === "fiche"), S(lg.slice(0, 3)));
const out = await T(R, "werf_stand", { werfId: Number(WB) });
const out2 = await T(R, "planning", { werfId: Number(WB) });
const out3 = await T(R, "werf_stand", { werfId: 999999 });
check("(2) een werf buiten de fiche (of onbestaand): dezelfde weigering met de werven die wel mogen (geen orakel)", out.isError && out2.isError && out3.isError && out.text === out3.text && /Geen toegang.*Wat wel mag: de werven P-4B8-[A-Z0-9]+-A/.test(out.text) && !out.text.includes("-B"), out.text);
const n1 = await T(N, "werven");
check("(2) de smalle assistent ziet enkel zijn werf", !n1.isError && n1.data.werven.length === 1 && n1.data.werven[0].id === Number(WA));

// ── (3) taken + voorstel op een opdracht ───────────────────────────────
const pdf = new TextEncoder().encode(`%PDF-1.4 proef 4b8 ${sfx} ` + "x".repeat(3000));
const job = ok(await calc.startOaRead({ workId: WA, orgId: ORG, inviteId: [], way: { bot: R.id }, name: `proef-4b8-${sfx}.pdf`, mime: "application/pdf", content: pdf, blob: [] }));
const jobId = typeof job === "bigint" ? job : job.id;
const key = `oaread:${jobId}`;
const tk = await T(R, "taken");
const row = tk.data?.taken?.find((x) => x.taak === key);
check("(3) taken: de opdracht staat erin (sleutel oaread:<id>, soort, werf, titel), de oudste eerst, met paginering", !tk.isError && !!row && row.soort === "oa-offerte-inlezen" && row.werf === `P-4B8-${sfx}-A` && typeof tk.data.totaal === "number" && "volgende" in tk.data, tk.text.slice(0, 200));
const tkS = await T(R, "taken", { soort: "factuurcontrole" });
check("(3) taken met een soort filtert (geen inleesopdracht bij factuurcontrole); een onbekende soort zegt welke er zijn", !tkS.isError && !tkS.data.taken.some((x) => x.taak === key) && /soort: een van/.test((await T(R, "taken", { soort: "x" })).text));
const det = await T(R, "taken", { taak: key });
check("(3) taken met taak: het dossier (posten, firma) en de antwoordvelden (vorm, regels, totaalCent; zonder opdracht) + hoe het bestand te halen", !det.isError && det.data?.dossier?.opdracht === Number(jobId) && det.data.antwoord?.tool === "voorstel" && "vorm" in (det.data.antwoord.velden ?? {}) && !("opdracht" in det.data.antwoord.velden) && /inleesbestand/.test(det.data.bestand ?? ""), det.text.slice(0, 240));
const vs = await T(R, "voorstel", { taak: key, inhoud: { vorm: "totaal", nummer: `P-${sfx}`, datum: iso(cDay), totaalCent: 123400, vertrouwen: 0.9 } });
check("(3) voorstel op de opdracht: een voorstel (BOWACO kijkt na), met een actie", !vs.isError && vs.data?.stand === "voorstel" && typeof vs.data.actie === "number", vs.text.slice(0, 200));
const model = (await admin.listTasksFor({ workId: [], key, subject: "", openOnly: false, kind: "", offset: 0n, limit: 1n })).items[0];
check("(3) het model van taak en voorstel staat meteen gelijk (taak voorstel, voorstel open, door de bot) — review M2", model?.task.state === "voorstel" && model.task.proposal[0]?.state === "open" && model.task.proposal[0]?.by === `bot:${R.id}`, S(model?.task.state));
const lg2 = (await admin.botLog(0n, 10n)).filter((c) => c.botId === R.id);
check("(3) het logboek: voorstel met de werf en de actie, zonder inhoud", lg2.some((c) => c.tool === "voorstel" && "ok" in c.outcome && c.workId[0] === WA && c.actionId.length === 1 && c.argsSha256.length === 64));
const vs2 = await T(R, "voorstel", { taak: key, inhoud: { vorm: "totaal", totaalCent: 1 } });
check("(3) een tweede antwoord op dezelfde taak: geweigerd, met wat wel mag (de eigen open taken)", vs2.isError && /Wat wel mag: je eigen open taken uit de tool taken/.test(vs2.text), vs2.text);
const zon = await T(R, "voorstel", { taak: key });
check("(3) voorstel zonder inhoud zegt waar de velden staan (of weigert de beantwoorde taak)", zon.isError && /inhoud|Wat wel mag/.test(zon.text));
const job2 = ok(await calc.startOaRead({ workId: WA, orgId: ORG, inviteId: [], way: { bot: R.id }, name: `proef-4b8b-${sfx}.pdf`, mime: "application/pdf", content: pdf, blob: [] }));
const key2 = `oaread:${typeof job2 === "bigint" ? job2 : job2.id}`;
const fout1 = await T(R, "voorstel", { taak: key2, inhoud: { vorm: "raar" } });
check("(3) een ongeldig antwoord: de fout van het dossier (zoals voorstel_oa_offerte), de taak blijft open", fout1.isError && (await T(R, "taken")).data.taken.some((x) => x.taak === key2), fout1.text.slice(0, 120));

// ── (4) Een vrije taak aan een assistent ───────────────────────────────
const tb = await admin.listTaskBots();
check("(4) listTaskBots: de assistent met taken en voorstel, niet de smalle; enkel de beheerder", tb.some((b) => b.id === R.id) && !tb.some((b) => b.id === N.id) && /\(assistent\)$/.test(tb.find((b) => b.id === R.id)?.name ?? "") && (await denied(calc.listTaskBots())) && (await denied(wl.listTaskBots())));
const TXT = `Proef: zet de volgende stappen van werf A op een rij 4b8 ${sfx}`;
check("(4) enkel de beheerder geeft een vrije taak; niet aan een assistent zonder taken; niet op een werf buiten zijn fiche", (await denied(calc.giveBotTask({ botId: R.id, workId: [WA], title: TXT, dueDay: [] }))) && /kan geen vrije taak/.test(errOf(await admin.giveBotTask({ botId: N.id, workId: [], title: TXT, dueDay: [] }))) && /niet op de fiche/.test(errOf(await admin.giveBotTask({ botId: R.id, workId: [WB], title: TXT, dueDay: [] }))));
const ft = ok(await admin.giveBotTask({ botId: R.id, workId: [WA], title: TXT, dueDay: [cDay + 3n] }));
const fkey = `taak:${ft}`;
const fl = await T(R, "taken", { soort: "vrije-taak" });
check("(4) de assistent ziet de vrije taak in taken (titel, werf, uiterlijk in uitgebreid)", !fl.isError && fl.data.taken.some((x) => x.taak === fkey && x.titel === TXT), fl.text.slice(0, 200));
const fd = await T(R, "taken", { taak: fkey });
const one = async (k) => (await admin.listTasksFor({ workId: [], key: k, subject: "", openOnly: false, kind: "", offset: 0n, limit: 1n })).items[0];
check("(4) taken met de vrije taak: titel, antwoordvelden uitkomst en antwoord; de taak staat nu op bezig", !fd.isError && fd.data.dossier.titel === TXT && fd.data.antwoord.verplicht.join() === "uitkomst,antwoord" && (await one(fkey)).task.state === "bezig", fd.text.slice(0, 200));
check("(4) een ongeldige uitkomst zegt welke wel mogen", /inhoud.uitkomst: "klaar" of "kan_niet"/.test((await T(R, "voorstel", { taak: fkey, inhoud: { uitkomst: "ja", antwoord: "x" } })).text));
const fa = await T(R, "voorstel", { taak: fkey, inhoud: { uitkomst: "klaar", antwoord: "Proef: drie stappen op een rij gezet." } });
let m1 = await one(fkey);
check("(4) het antwoord: een voorstel (taak voorstel klaar, punt uitkomst = klaar), het antwoord staat bij de taak (reden)", !fa.isError && m1.task.state === "voorstel" && m1.task.proposal[0].points[0].after === "klaar" && m1.task.reason === "Proef: drie stappen op een rij gezet." && m1.task.doerName.endsWith("(assistent)"), S([fa.text.slice(0, 100), m1.task.state]));
const todo = (await admin.myTodo({ day: cDay, offset: 0n, limit: 200n, snoozed: false, kind: "" })).items.find((x) => x.key === `bot:${fa.data.actie}`);
check("(4) Te doen van de beheerder: \"Klaar: <taak>\" met Aanvaarden en Weigeren", !!todo && todo.title.startsWith("Klaar: Proef") && todo.acts.map((a) => a.kind).join() === "bot-aanvaarden,bot-weigeren", S(todo));
ok(await admin.decideBotAction(BigInt(fa.data.actie), true, ""));
m1 = await one(fkey);
check("(4) aanvaard: de taak is klaar; tijdlijn wacht · bezig · voorstel open · aanvaard · klaar", m1.task.state === "klaar" && m1.task.proposal[0].state === "aanvaard" && S(m1.task.events.map((e) => e.what)) === S(["taak:wacht", "taak:bezig", "voorstel:open", "voorstel:aanvaard", "taak:klaar"]), S(m1.task.events.map((e) => e.what)));
check("(4) een afgesloten vrije taak: niet meer in taken, een nieuw antwoord geweigerd", !(await T(R, "taken")).data.taken.some((x) => x.taak === fkey) && (await T(R, "voorstel", { taak: fkey, inhoud: { uitkomst: "klaar", antwoord: "x" } })).isError);
const ft2 = ok(await admin.giveBotTask({ botId: R.id, workId: [], title: `Proef zonder werf 4b8 ${sfx}`, dueDay: [] }));
const fb = await T(R, "voorstel", { taak: `taak:${ft2}`, inhoud: { uitkomst: "kan_niet", antwoord: "Proef: daarvoor heb ik geen gegevens." } });
ok(await admin.decideBotAction(BigInt(fb.data.actie), false, ""));
const m2 = await one(`taak:${ft2}`);
check("(4) kan niet → geweigerd: de taak wacht opnieuw (de assistent kan opnieuw antwoorden)", m2.task.state === "wacht" && m2.task.proposal[0].state === "geweigerd" && (await T(R, "taken")).data.taken.some((x) => x.taak === `taak:${ft2}`), m2.task.state);
check("(4) een andere assistent kan die vrije taak niet lezen of beantwoorden (dezelfde weigering)", (await T(N, "taken", { taak: `taak:${ft2}` })).isError);
// Review 4b.8 M3: annuleren met een open antwoord, en intrekken van de assistent: niets blijft hangen.
const ft3 = ok(await admin.giveBotTask({ botId: R.id, workId: [], title: `Proef annuleren 4b8 ${sfx}`, dueDay: [] }));
const fc = await T(R, "voorstel", { taak: `taak:${ft3}`, inhoud: { uitkomst: "klaar", antwoord: "Proef: gedaan." } });
ok(await admin.stepTask(ft3, { cancel: null }, ""));
const m3 = await one(`taak:${ft3}`);
const todo3 = (await admin.myTodo({ day: cDay, offset: 0n, limit: 200n, snoozed: false, kind: "" })).items.find((x) => x.key === `bot:${fc.data.actie}`);
check("(4) annuleren terwijl het antwoord open staat: taak geannuleerd, voorstel ingetrokken, niet meer in Te doen", m3.task.state === "geannuleerd" && m3.task.proposal[0].state === "ingetrokken" && !todo3, S([m3.task.state, m3.task.proposal[0]?.state, !!todo3]));
const R2 = await mkBot({ name: `Proef intrekken 4b8 ${sfx}`, tools: ["mijn_fiche", "taken", "voorstel"], works: [WA] });
const ft4 = ok(await admin.giveBotTask({ botId: R2.id, workId: [WA], title: `Proef intrekken 4b8 ${sfx}`, dueDay: [] }));
ok(await admin.revokeBot(R2.id));
check("(4) een assistent intrekken: zijn open vrije taken gaan dicht (geannuleerd)", (await one(`taak:${ft4}`)).task.state === "geannuleerd");
const wlSees = (await wl.listTasksFor({ workId: [WA], key: "", subject: "", openOnly: false, kind: "", offset: 0n, limit: 100n })).items.filter((g) => g.task.doer.startsWith("bot:") && g.task.kind === "taak");
check("(4) de werfleider ziet een vrije taak van een assistent enkel kort (geen titel, geen antwoord)", wlSees.every((g) => !g.full && g.task.title === "" && g.task.reason === ""), S(wlSees.map((g) => g.full)));

// ── (5) De assistent van de zaakvoerder ─────────────────────────────────
check("(5) facturen_wachten kan niet op de fiche van een gewone assistent", /enkel bij de assistent van de zaakvoerder/.test(errOf(await admin.saveBot(F({ name: `Proef x 4b8 ${sfx}`, tools: ["mijn_fiche", "facturen_wachten"] })))));
const oid = ok(await admin.saveBot(F({ name: `Proef zaakvoerder 4b8 ${sfx}`, tools: ["mijn_fiche", "werven", "document_koppelen", "te_doen"], allWorks: true, tasks: [] })));
let ob = (await admin.listBots()).find((b) => b.id === oid);
ok(await admin.setBotKind(oid, ob.rev, true));
ob = (await admin.listBots()).find((b) => b.id === oid);
check("(5) setBotKind: soort zaakvoerder; de tool die iets doet (document_koppelen) gaat van de fiche", ob.kind === "zaakvoerder" && !ob.tools.includes("document_koppelen") && ob.tools.includes("te_doen"), S(ob.tools));
check("(5) setBotKind enkel door de beheerder, met de rev", (await denied(calc.setBotKind(oid, ob.rev, false))) && /Intussen gewijzigd/.test(errOf(await admin.setBotKind(oid, 0n, false))));
const OT = ["mijn_fiche", "werven", "werf_documenten", "te_doen", "planning", "werf_stand", "maandagbriefing", "facturen_wachten", "taken", "voorstel"];
check("(5) de zaakvoerder-assistent: geen tool die iets doet, nooit Zelf doen", /leest en stelt enkel voor/.test(errOf(await admin.saveBot(F({ id: [oid], rev: ob.rev, name: ob.name, tools: [...OT, "voorstel_oa_offerte"], allWorks: true })))) && /doet nooit zelf iets/.test(errOf(await admin.saveBot(F({ id: [oid], rev: ob.rev, name: ob.name, tools: OT, allWorks: true, tasks: [["document-koppelen", { auto: null }]] })))));
ok(await admin.saveBot(F({ id: [oid], rev: ob.rev, name: ob.name, tools: OT, allWorks: true, docKinds: KINDS })));
const oActor = await freshBackend(cid);
ok(await oActor.claimBotCode(ok(await admin.newBotCode(oid)).code));
const O = { id: oid, t: (await connect(anon, oActor, cid, "Proef zaakvoerder")).access };
const of = await T(O, "mijn_fiche");
check("(5) mijn_fiche: soort assistent van de zaakvoerder, alle werven, elke taak hoogstens voorstel", !of.isError && of.data.soort === "assistent van de zaakvoerder" && of.data.werven === "alle" && of.data.taken.every((t) => t.niveau !== "zelf"), of.text.slice(0, 160));
const fw = await T(O, "facturen_wachten", { vorm: "uitgebreid" });
check("(5) facturen_wachten: de facturen die wachten (werf, firma, nummer, vervaldag, controle), geen bedragen", !fw.isError && Array.isArray(fw.data.facturen) && fw.data.facturen.every((x) => x.werf && "controle" in x && !("bedrag" in x)) && !AMOUNTS.test(fw.text), fw.text.slice(0, 200));
const leaks = [];
for (const [n, a] of [["te_doen", { vorm: "uitgebreid", aantal: 100 }], ["planning", { vorm: "uitgebreid", aantal: 100 }], ["werven", {}], ["maandagbriefing", {}], ["facturen_wachten", { vorm: "uitgebreid", aantal: 100 }], ["taken", { vorm: "uitgebreid" }]]) {
  const r = await T(O, n, a);
  if (r.isError || AMOUNTS.test(r.text)) leaks.push(`${n}: ${r.text.slice(0, 80)}`);
}
check("(5) alle leestools over alle werven: geen bedragen, geen adres van een bestand", leaks.length === 0, leaks.join(" | "));
check("(5) Claude koppelt nooit als persoon: een persoon kan geen bot worden (claimBotCode) en geen koppeling goedkeuren", /hoort bij een persoon/.test(errOf(await wl.claimBotCode(ok(await admin.newBotCode(ok(await admin.saveBot(F({ name: `Proef persoon 4b8 ${sfx}` }))))).code))) && /^Geen toegang/.test(errOf(await wl._caffeineMcpApprove({ clientId: "x", redirectUri: "https://claude.ai/api/mcp/auth_callback", codeChallenge: "x", codeChallengeMethod: "S256" }))));

// ── (6) De maandagbriefing kort en uitgebreid ───────────────────────────
const bk = await T(R, "maandagbriefing", { vorm: "kort" });
const bu = await T(R, "maandagbriefing");
check("(6) maandagbriefing: standaard uitgebreid (zoals 4.4), kort = per onderdeel hoogstens 3 punten zonder detail", !bk.isError && !bu.isError && bk.data.onderdelen.every((o) => o.punten.length <= 3 && o.punten.every((p) => !("detail" in p))) && bu.data.onderdelen.every((o) => o.punten.every((p) => "detail" in p)));

console.log(`\nproef-4b-8: ${pass} ✓ ${fail} ✗`);
process.exit(fail ? 1 : 0);
