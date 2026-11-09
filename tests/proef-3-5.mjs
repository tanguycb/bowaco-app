// Proefbank (stap 3.5, bouwplan §6 "Autonomie per taak"; ontwerp BOWACO_verslag_3.5.md §1) op het EIGEN lokale net. Bewijst:
//   (1) enkel de beheerder beheert de proefbank (sets, rondes, score, Caffeine-ronde);
//   (2) een testset uit de historiek: enkel wat een INTERNE persoon koppelde en zo bleef (geen bot-merk, niets vertrouwelijks);
//   (3) een ronde voor een bot: enkel gevallen binnen zijn fiche, minstens 50, één open ronde per bot, tool van de taak op de fiche;
//   (4) de proeftools: enkel tijdens de eigen open ronde in tools/list; een geval toont nooit id, werf, soort of URL;
//   (5) antwoorden: elk geval één keer, het antwoord zegt nooit juist of fout, er wordt niets uitgevoerd (geen document, actie, voorstel);
//   (6) score: geen antwoord = fout, vervallen telt niet; fouten per geval met de foute velden, zonder inhoud (enkel verwijzingen);
//   (7) drempel: Zelf doen pas na een geslaagde LAATSTE ronde (≥ 95 % op ≥ 50) met dezelfde labels; een wissel = opnieuw; bij het uitvoeren
//       geldt Zelf doen enkel met een geldige ronde (effectiveLevel);
//   (8) de Caffeine-weg: dezelfde set, één geval per oproep (testmodus droog; echt tegen de nep-inferentiedienst);
//   (9) logboek en audit zonder inhoud; een andere bot ziet de ronde niet; intrekken stopt de ronde.
// Enkel VERZONNEN gegevens (P-PB-…, pb-…). Draait na tests/mcp-3-13.mjs.
//   node tests/proef-3-5.mjs <canister-id>
import { backend, freshBackend } from "../tools/lib.mjs";
import { connect, FORBIDDEN, rpc, tool } from "./mcp-lib.mjs";
import { fakeBlob, makeHistory, playRound } from "./proef-lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/proef-3-5.mjs <canister-id>");
const host = process.env.ICP_HOST || "";
if (!host.includes("localhost") && !host.includes("127.0.0.1")) throw new Error("tests/proef-3-5.mjs enkel op het eigen lokale net");
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const S = (x) => JSON.stringify(x, big);
const ok = (r) => { if (r && typeof r === "object" && "err" in r) throw new Error(r.err); return r && typeof r === "object" && "ok" in r ? r.ok : r; };
const errOf = (r) => (r && typeof r === "object" && "err" in r ? r.err : "");
const denied = async (p) => { try { const r = await p; return !!(r && typeof r === "object" && "err" in r && /Geen toegang/.test(r.err)); } catch (e) { return /Geen toegang|trap|Reject/i.test(String(e)); } };
const sfx = Date.now().toString(36).slice(-5).toUpperCase();
const MARK = "GEHEIMPB" + Math.random().toString(36).slice(2, 8);

const [admin, wl, calc, oa] = await Promise.all(["proef-admin", "proef-werfleider", "proef-calculator", "proef-oa2"].map((n) => backend(n, cid)));
const anon = await backend(null, cid);
const botA = await freshBackend(cid);
const botB = await freshBackend(cid);

// ── Opzet: twee proefwerven met historiek (60 bestanden door een interne persoon), een bot-koppeling, een vertrouwelijk document ──
const addr = { street: "Proefstraat", number: "5", zip: "9999", city: "Proefdorp", country: "BE" };
const mkWork = async (code, name) => ok(await admin.createWork({ code, name, address: addr, parentId: [], clientOrgId: [], architectOrgId: [], leaderPersonId: [], vatBp: 2100n })).id;
const C1 = `P-PB-${sfx}-1`, C2 = `P-PB-${sfx}-2`, C3 = `P-PB-${sfx}-3`;
const W1 = await mkWork(C1, "Proefwerf proefbank 1");
const W2 = await mkWork(C2, "Proefwerf proefbank 2");
const W3 = await mkWork(C3, "Proefwerf buiten de fiche");
const KINDS = ["plannen", "plaatsbeschrijving", "verzekering"];
const hist = await makeHistory(calc, [{ id: W1, code: C1 }, { id: W2, code: C2 }], KINDS, 60, sfx, MARK);
const out3 = await makeHistory(calc, [{ id: W3, code: C3 }], KINDS, 3, sfx + "X", MARK);
// Een vertrouwelijk bestand aan een vertrouwelijk document (contract): nooit in een set.
const fConf = ok(await admin.addFile(`pb-${sfx}-${C1}-contract-${MARK}.pdf`, "application/pdf", 1_000n, fakeBlob("c"), [W1], true));
const confDoc = await admin.attachDocumentFile(W1, "contract", [], fConf);
const byName = new Map([...hist, ...out3].map((h) => [h.name, h]));
check("opzet: drie proefwerven, 63 bestanden aan documenten door een interne persoon, één vertrouwelijk", hist.length === 60 && out3.length === 3 && !!fConf, S({ confDoc }));

// ── (1) Enkel de beheerder ──────────────────────────────────────────────
for (const [n, x] of [["werfleider", wl], ["calculator", calc], ["OA", oa], ["anoniem", anon], ["bot (persoonsweg)", botA]]) {
  const rs = await Promise.all([x.proofInfo(), x.listProofSets(), x.proofSetCases(1n), x.listProofRounds(), x.proofRoundCases(1n), x.buildProofSet("document-koppelen", "x", 10n), x.archiveProofSet(1n), x.startProofRound(1n, { bot: 1n }), x.closeProofRound(1n, false), x.runProofAi(1n)].map(denied));
  check(`(1) ${n} beheert de proefbank niet`, rs.every(Boolean), S(rs));
}
const info = await admin.proofInfo();
check("(1) proofInfo: taak document-koppelen met velden werfId en soort, drempel 95 % op 50 (Config)", info.minPct === 95n && info.minCases === 50n && info.tasks.length === 2 && S(info.tasks[0].fields.map((f) => f.name)) === S(["werfId", "soort"]) && info.tasks[1].key === "oa-offerte-inlezen", S(info));

// ── (2) Testset uit de historiek ────────────────────────────────────────
check("(2) onbekende taak, 0 gevallen en te veel gevallen geweigerd", errOf(await admin.buildProofSet("betalen", "x", 10n)).includes("Onbekende") && errOf(await admin.buildProofSet("document-koppelen", "x", 0n)).includes("Aantal") && errOf(await admin.buildProofSet("document-koppelen", "x", 201n)).includes("Aantal"));
// Een bot met Voorstel koppelt één bestand, de beheerder aanvaardt: dat document heeft een bot-merk en hoort NIET in de set.
const F = (o = {}) => ({ id: [], rev: 0n, name: `Proef bot PB ${sfx}`, vendor: "Anthropic", model: "Proefmodel", tools: ["mijn_fiche", "werven", "werf_documenten", "document_koppelen"], allWorks: false, works: [W1, W2], docKinds: KINDS, callsPerDay: 500n, tasks: [], instruction: ["routine v1"], ...o });
const idA = ok(await admin.saveBot(F()));
ok(await botA.claimBotCode(ok(await admin.newBotCode(idA)).code));
const conA = await connect(anon, botA, cid, "Proef Claude PB");
const fLoose = ok(await calc.addFile(`pb-${sfx}-${C1}-plannen-los-${MARK}.pdf`, "application/pdf", 5_000n, fakeBlob("e"), [W1], false));
const vb = await tool(anon, cid, conA.access, "document_koppelen", { werfId: Number(W1), bestandId: Number(fLoose), soort: "plannen", reden: "proef" });
ok(await admin.decideBotAction(BigInt(vb.data.actie), true, ""));
const setId = ok(await admin.buildProofSet("document-koppelen", `Proefset ${sfx}`, 200n));
const cases = await admin.proofSetCases(setId);
const refs = new Set(cases.map((c) => c.ref));
check("(2) de set bevat de 63 bestanden die een mens koppelde, met het juiste antwoord (werf + soort)", [...hist, ...out3].every((h) => refs.has(`bestand #${h.fileId}`)) && hist.every((h) => { const c = cases.find((x) => x.ref === `bestand #${h.fileId}`); return c && c.workId[0] === h.workId && c.answer.find(([k]) => k === "soort")?.[1] === h.kind && c.answer.find(([k]) => k === "werfId")?.[1] === String(h.workId); }), `${cases.length} gevallen`);
check("(2) nooit het bestand dat een bot koppelde (bot-merk) en nooit iets vertrouwelijks", !refs.has(`bestand #${fLoose}`) && !refs.has(`bestand #${fConf}`));
check("(2) de set toont enkel verwijzingen, geen bestandsnamen of URL's", !S(cases).includes(MARK) && !/!caf!|https?:/.test(S(cases)));
const sets = await admin.listProofSets();
check("(2) listProofSets: de set met aantal gevallen en werven", sets.some((s) => s.id === setId && s.cases === BigInt(cases.length) && s.works >= 3n));

// ── (3) Een ronde voor een bot ──────────────────────────────────────────
const idX = ok(await admin.saveBot(F({ name: `Proef bot PB niet gekoppeld ${sfx}` })));
check("(3) een bot die niet gekoppeld is: geen ronde", errOf(await admin.startProofRound(setId, { bot: idX })).includes("niet gekoppeld"));
let bA = (await admin.listBots()).find((b) => b.id === idA);
ok(await admin.saveBot(F({ id: [idA], rev: bA.rev, tools: ["mijn_fiche", "werven"] })));
check("(3) zonder de tool van de taak op de fiche: geen ronde", errOf(await admin.startProofRound(setId, { bot: idA })).includes("tool"));
bA = (await admin.listBots()).find((b) => b.id === idA);
ok(await admin.saveBot(F({ id: [idA], rev: bA.rev, works: [W2] })));
check("(3) te weinig gevallen binnen de fiche (enkel W2 = 30): geen ronde", errOf(await admin.startProofRound(setId, { bot: idA })).includes("Te weinig"));
bA = (await admin.listBots()).find((b) => b.id === idA);
ok(await admin.saveBot(F({ id: [idA], rev: bA.rev })));
const r1 = ok(await admin.startProofRound(setId, { bot: idA }));
check("(3) één open ronde per bot", errOf(await admin.startProofRound(setId, { bot: idA })).includes("loopt al"));
let R1 = (await admin.listProofRounds()).find((r) => r.id === r1);
check("(3) de ronde: enkel de 60 gevallen binnen de fiche (W3 en andere werven vallen weg), labels van nu", R1.cases === 60n && R1.vendor === "Anthropic" && R1.model === "Proefmodel" && R1.instruction === "routine v1" && "open" in R1.state, S(R1));

// ── (4) De proeftools ───────────────────────────────────────────────────
const tl = ((await rpc(anon, cid, conA.access, "tools/list")).json?.result?.tools ?? []).map((t) => t.name);
check("(4) tools/list: de proeftools staan erbij zolang de ronde loopt", tl.includes("proef_gevallen") && tl.includes("proef_antwoorden"), S(tl));
const g1 = await tool(anon, cid, conA.access, "proef_gevallen");
const first = g1.data?.gevallen ?? [];
const caseKeys = new Set(first.flatMap((c) => Object.keys(c)));
check("(4) proef_gevallen: 20 gevallen met enkel geval-nummer en invoer (naam, type, grootte)", !g1.isError && first.length === 20 && S([...caseKeys].sort()) === S(["geval", "invoer"]) && first.every((c) => S(Object.keys(c.invoer.bestand).sort()) === S(["grootte", "naam", "type"])), g1.text.slice(0, 300));
check("(4) een geval toont nooit het bestand-id, de werf, de soort of een URL", first.every((c) => { const h = byName.get(c.invoer.bestand.naam); return h && !S(c).includes(`"${h.fileId}"`) && !/werfId|soort|bestandId|"id"/.test(S(c)); }) && !FORBIDDEN.test(g1.text.replace(/"type":"application\/pdf"/g, "")) && g1.data.antwoordvelden.length === 2);
check("(4) de geval-nummers zijn plaatsen in de ronde (1…60), geen ids", first.every((c) => c.geval >= 1 && c.geval <= 60));

// ── (5) Antwoorden ──────────────────────────────────────────────────────
const docsBefore = S((await admin.getDossier(W1)).documents.map((d) => [d.id, d.fileIds, d.status])) + S((await admin.getDossier(W2)).documents.map((d) => [d.id, d.fileIds, d.status]));
const actsBefore = (await admin.botActions(false)).length;
const truth = (n) => { const h = byName.get(n); return h ? { werfId: Number(h.workId), soort: h.kind } : null; };
const c0 = first[0], c1 = first[1];
const h1 = byName.get(c1.invoer.bestand.naam);
const aRight = await tool(anon, cid, conA.access, "proef_antwoorden", { antwoorden: [{ geval: c0.geval, ...truth(c0.invoer.bestand.naam) }] });
const aWrong = await tool(anon, cid, conA.access, "proef_antwoorden", { antwoorden: [{ geval: c1.geval, werfId: Number(h1.workId === W1 ? W2 : W1), soort: h1.kind }] });
const shape = (r) => S({ ...r.data, open: 0 });
check("(5) het antwoord van de app zegt nooit juist of fout (een juist en een fout antwoord geven hetzelfde)", !aRight.isError && !aWrong.isError && shape(aRight) === shape(aWrong) && !/juist|fout|right|wrong|score/i.test(aRight.text + aWrong.text), aRight.text);
const again = await tool(anon, cid, conA.access, "proef_antwoorden", { antwoorden: [{ geval: c0.geval, werfId: 1, soort: "x" }, { geval: 999, werfId: 1, soort: "x" }] });
check("(5) elk geval één keer; een onbekend geval wordt niet verwerkt", !again.isError && again.data.ontvangen === 0 && again.data.nietVerwerkt.length === 2, again.text);
check("(5) hoogstens 25 antwoorden per keer", (await tool(anon, cid, conA.access, "proef_antwoorden", { antwoorden: Array.from({ length: 26 }, (_, i) => ({ geval: i + 1, werfId: 1, soort: "x" })) })).isError);
// De rest: 47 juist, 11 overgeslagen (geen antwoord = fout) → 48 / 60 = 80 %: onder de drempel.
let skip = 11;
const p1 = await playRound(anon, cid, conA.access, (n) => { if (skip > 0) { skip--; return null; } return truth(n); });
check("(5) de bot speelt de ronde via zijn tools (met overgeslagen gevallen)", !p1.error && p1.open === 11, S({ e: p1.error, open: p1.open }));
const docsAfter = S((await admin.getDossier(W1)).documents.map((d) => [d.id, d.fileIds, d.status])) + S((await admin.getDossier(W2)).documents.map((d) => [d.id, d.fileIds, d.status]));
check("(5) proefmodus voert niets uit: geen document, geen bestand gekoppeld, geen actie of voorstel", docsBefore === docsAfter && (await admin.botActions(false)).length === actsBefore);
// Vervallen: een bestand van een open geval wordt intussen gearchiveerd → telt niet mee.
const openCase = (await admin.proofRoundCases(r1)).find((c) => c.outcome.length === 0);
const voidFile = BigInt(openCase.ref.replace("bestand #", ""));
ok(await calc.archiveFile(voidFile));
ok(await admin.closeProofRound(r1, false));
R1 = (await admin.listProofRounds()).find((r) => r.id === r1);
check("(6) gesloten: geen antwoord = fout, het gearchiveerde geval vervalt (48 / 59)", R1.right === 48n && R1.counted === 59n && !R1.passed && R1.latest, S(R1));
const rc = await admin.proofRoundCases(r1);
const wrongC = rc.find((c) => c.outcome[0] && "wrong" in c.outcome[0]);
check("(6) fouten per geval: de foute velden, verwacht en gegeven met een leesbare werfcode", !!wrongC && S(wrongC.outcome[0].wrong) === S(["werfId"]) && wrongC.expected.some((v) => v.field === "werfId" && (v.shown === C1 || v.shown === C2)) && wrongC.given.some((v) => v.field === "werfId"), S(wrongC));
check("(6) 10 zonder antwoord en 1 vervallen", rc.filter((c) => c.outcome[0] && "none" in c.outcome[0]).length === 10 && rc.filter((c) => c.outcome[0] && "void" in c.outcome[0]).length === 1);
check("(6) de gevallen van een ronde zonder inhoud: enkel verwijzingen (geen bestandsnaam)", !S(rc).includes(MARK) && !S(await admin.listProofRounds()).includes(MARK));
check("(4) na het sluiten: geen proeftools meer, proef_gevallen geweigerd", !((await rpc(anon, cid, conA.access, "tools/list")).json?.result?.tools ?? []).some((t) => t.name.startsWith("proef_")) && (await tool(anon, cid, conA.access, "proef_gevallen")).isError);

// ── (7) Drempel ─────────────────────────────────────────────────────────
bA = (await admin.listBots()).find((b) => b.id === idA);
check("(7) Zelf doen na een ronde onder de drempel: geweigerd", errOf(await admin.saveBot(F({ id: [idA], rev: bA.rev, tasks: [["document-koppelen", { auto: null }]] }))).includes("drempel"));
check("(7) de fiche toont de stand: 48 / 59, niet geslaagd", bA.proof[0].roundId[0] === r1 && bA.proof[0].right === 48n && !bA.proof[0].autoAllowed, S(bA.proof));
// Ronde 2: 57 juist van 59 (2 fout) = 96 % → geslaagd.
const r2 = ok(await admin.startProofRound(setId, { bot: idA }));
let bad = 2;
const p2 = await playRound(anon, cid, conA.access, (n) => { const t = truth(n); if (t && bad > 0) { bad--; return { ...t, soort: "verkeerd" }; } return t; });
const R2 = (await admin.listProofRounds()).find((r) => r.id === r2);
check("(7) ronde 2: alle gevallen beantwoord, vanzelf gesloten, 57 / 59 = 96 % geslaagd", p2.done && "closed" in R2.state && R2.right === 57n && R2.counted === 59n && R2.passed && R2.latest, S({ R2, e: p2.error }));
check("(7) de laatste ronde telt (ronde 1 telt niet meer)", !(await admin.listProofRounds()).find((r) => r.id === r1).latest);
bA = (await admin.listBots()).find((b) => b.id === idA);
check("(7) model wisselen en meteen Zelf doen: geweigerd", errOf(await admin.saveBot(F({ id: [idA], rev: bA.rev, model: "Ander model", tasks: [["document-koppelen", { auto: null }]] }))).includes("wijzigde"));
check("(7) instructieversie wisselen en meteen Zelf doen: geweigerd", errOf(await admin.saveBot(F({ id: [idA], rev: bA.rev, instruction: ["routine v2"], tasks: [["document-koppelen", { auto: null }]] }))).includes("wijzigde"));
ok(await admin.saveBot(F({ id: [idA], rev: bA.rev, tasks: [["document-koppelen", { auto: null }]] })));
bA = (await admin.listBots()).find((b) => b.id === idA);
check("(7) met dezelfde labels: Zelf doen bewaard en geldig", bA.tasks.some(([k, l]) => k === "document-koppelen" && "auto" in l) && bA.effective.some(([k, l]) => k === "document-koppelen" && "auto" in l) && bA.proof[0].autoAllowed);
const fz = ok(await calc.addFile(`pb-${sfx}-${C1}-plannen-zelf.pdf`, "application/pdf", 4_000n, fakeBlob("f"), [W1], false));
const z1 = await tool(anon, cid, conA.access, "document_koppelen", { werfId: Number(W1), bestandId: Number(fz), soort: "plaatsbeschrijving" });
check("(7) Zelf doen werkt na de geslaagde ronde", !z1.isError && z1.data.stand === "uitgevoerd", z1.text);
ok(await admin.undoBotAction(BigInt(z1.data.actie)));
// Ronde 3 onder de drempel: Zelf doen blijft op de fiche, maar geldt bij het uitvoeren als Voorstel.
const r3 = ok(await admin.startProofRound(setId, { bot: idA }));
await playRound(anon, cid, conA.access, () => ({ werfId: 0, soort: "onbekend" }));
bA = (await admin.listBots()).find((b) => b.id === idA);
check("(7) na een slechte laatste ronde: op de fiche Zelf doen, maar geldig = Voorstel", bA.tasks.some(([k, l]) => k === "document-koppelen" && "auto" in l) && bA.effective.some(([k, l]) => k === "document-koppelen" && "proposal" in l) && !bA.proof[0].autoAllowed, S({ t: bA.tasks, e: bA.effective, r3 }));
const z2 = await tool(anon, cid, conA.access, "document_koppelen", { werfId: Number(W1), bestandId: Number(fz), soort: "plaatsbeschrijving" });
const fiche = await tool(anon, cid, conA.access, "mijn_fiche");
check("(7) bij het uitvoeren: een voorstel, en mijn_fiche zegt voorstel", !z2.isError && z2.data.stand === "voorstel" && fiche.data.taken.find((t) => t.taak === "document-koppelen")?.niveau === "voorstel", z2.text);
ok(await admin.decideBotAction(BigInt(z2.data.actie), false, ""));
check("(7) factuurcontrole blijft hoogstens Voorstel en de Nooit-lijst blijft vast", errOf(await admin.saveBot(F({ id: [idA], rev: bA.rev, tasks: [["factuurcontrole", { auto: null }]] }))).includes("hoogstens Voorstel") && errOf(await admin.saveBot(F({ id: [idA], rev: bA.rev, tasks: [["versturen", { proposal: null }]] }))).includes("Nooit"));
check("(7) een nieuwe bot kan niet meteen op Zelf doen", errOf(await admin.saveBot(F({ name: `Proef bot PB nieuw ${sfx}`, tasks: [["document-koppelen", { auto: null }]] }))).includes("proefronde"));

// ── (8) De Caffeine-weg ─────────────────────────────────────────────────
check("(8) een ronde voor een AI-fiche die niet bestaat of niet bij de taak hoort: geweigerd", errOf(await admin.startProofRound(setId, { ai: "routering" })).includes("hoort niet") && (errOf(await admin.startProofRound(setId, { ai: "document-koppelen" })).includes("ingericht") || (await admin.listAiWorkers()).some((w) => w.key === "document-koppelen" && w.configured)));
await admin.refreshAiModels();
const wk = (await admin.listAiWorkers()).find((w) => w.key === "document-koppelen");
ok(await admin.saveAiWorker({ key: "document-koppelen", name: "Document koppelen (proef)", route: { caffeine: null }, modelAlias: "auto", fallback: false, fallbackModel: [], budgetMonthCents: 2000n, maxCallCents: 20n, clientData: false, autonomy: { proposal: null }, instructionVersion: 1n, enabled: true, rev: wk.rev }));
// a. testmodus: droog, er vertrekt niets, alles fout.
ok(await admin.setAiSettings([], [], [true]));
// Een eigen set van de 63 nieuwste gevallen (= de proefbestanden hierboven, op één na misschien).
const setAi = ok(await admin.buildProofSet("document-koppelen", `Proefset Caffeine ${sfx}`, 63n));
const ra = ok(await admin.startProofRound(setAi, { ai: "document-koppelen" }));
let step, n = 0;
do { step = ok(await admin.runProofAi(ra)); n++; } while (!step.closed && n < 80);
const RA = (await admin.listProofRounds()).find((r) => r.id === ra);
check("(8) Caffeine in de testmodus: droog, één geval per oproep, alles fout (0 %)", step.dry && "closed" in RA.state && RA.right === 0n && RA.counted >= 50n && RA.vendor === "Caffeine" && RA.model === "auto" && RA.instruction === "v1", S(RA));
// b. echt (testbouw: de nep-inferentiedienst op 127.0.0.1 leest de werfcode en soort uit de bestandsnaam).
ok(await admin.setAiSettings([], [], [false]));
const logBefore = (await admin.aiLog(0n, 200n)).length;
const rb = ok(await admin.startProofRound(setAi, { ai: "document-koppelen" }));
n = 0;
do { step = ok(await admin.runProofAi(rb)); n++; } while (!step.closed && n < 80);
const RB = (await admin.listProofRounds()).find((r) => r.id === rb);
const aiLog = await admin.aiLog(0n, 200n);
check("(8) Caffeine echt (nep-dienst): elk geval een oproep, hoge score", !step.dry && "closed" in RB.state && RB.counted >= 50n && RB.right * 100n >= 95n * RB.counted, S(RB));
check("(8) elke proefoproep staat in het AI-logboek, zonder inhoud", aiLog.length - logBefore >= Number(RB.counted) - 1 && !S(aiLog).includes(MARK) && !S(aiLog).includes("pb-"), `${aiLog.length - logBefore} oproepen`);
check("(8) een tweede open ronde voor dezelfde AI-fiche: geweigerd; een botronde is geen Caffeine-ronde", (ok(await admin.startProofRound(setAi, { ai: "document-koppelen" })), errOf(await admin.startProofRound(setAi, { ai: "document-koppelen" })).includes("loopt al")) && errOf(await admin.runProofAi(r2)).includes("al gesloten"));
const rOpen = (await admin.listProofRounds()).find((r) => "open" in r.state && "ai" in r.subject);
ok(await admin.closeProofRound(rOpen.id, true));
check("(8) een gestopte ronde telt niet (de laatste gesloten blijft de echte)", (await admin.listProofRounds()).find((r) => r.id === rb).latest && "cancelled" in (await admin.listProofRounds()).find((r) => r.id === rOpen.id).state);
ok(await admin.setAiSettings([], [], [true]));

// ── (9) Logboek, andere bot, intrekken ──────────────────────────────────
const log = await admin.botLog(0n, 200n);
const proofCalls = log.filter((c) => c.tool.startsWith("proef_"));
check("(9) elke proefoproep in het logboek: tool, controlegetal, uitkomst, geen werf en geen inhoud", proofCalls.length >= 10 && proofCalls.every((c) => /^[0-9a-f]{64}$/.test(c.argsSha256) && c.workId.length === 0) && !S(log).includes(MARK) && !S(log).includes("pb-"), `${proofCalls.length} oproepen`);
const audit = S((await admin.auditLog(0n, 500n)).filter((a) => a.action.startsWith("proef")));
check("(9) auditlog: set, rondes, sluiten, zonder inhoud", audit.includes("proef-set") && audit.includes("proef-ronde") && !audit.includes(MARK) && !audit.includes("pb-"));
const idB = ok(await admin.saveBot(F({ name: `Proef bot PB B ${sfx}`, vendor: "xAI", works: [W1, W2] })));
ok(await botB.claimBotCode(ok(await admin.newBotCode(idB)).code));
const conB = await connect(anon, botB, cid, "Proef Grok PB");
const r4 = ok(await admin.startProofRound(setId, { bot: idA }));
const gB = await tool(anon, cid, conB.access, "proef_gevallen");
const tlB2 = ((await rpc(anon, cid, conB.access, "tools/list")).json?.result?.tools ?? []).map((t) => t.name);
check("(9) een andere bot ziet de ronde van bot A niet (geen proeftools, geweigerd)", gB.isError && !tlB2.some((t) => t.startsWith("proef_")), gB.text);
bA = (await admin.listBots()).find((b) => b.id === idA);
ok(await admin.saveBot(F({ id: [idA], rev: bA.rev, tools: ["mijn_fiche", "werven"], tasks: [] })));
check("(9) tool van de taak van de fiche gehaald tijdens de ronde: proef_gevallen geweigerd", (await tool(anon, cid, conA.access, "proef_gevallen")).isError);
ok(await admin.revokeBot(idA));
check("(9) de bot intrekken: zijn open ronde stopt", "cancelled" in (await admin.listProofRounds()).find((r) => r.id === r4).state);
check("(9) archiveren: een set zonder open ronde", isOkArchive(await admin.archiveProofSet(setId)) && errOf(await admin.startProofRound(setId, { bot: idB })).includes("gearchiveerd"));
ok(await admin.revokeBot(idB));
function isOkArchive(r) { return r && "ok" in r; }

console.log(`\n${pass} ✓ / ${fail} ✗`);
process.exit(fail ? 1 : 0);
