// Bots via MCP (stap 3.4 + 3.13, bouwplan §6 "Bots via MCP" en "Autonomie per taak") op het EIGEN lokale net. Bewijst:
//   (1) enkel de beheerder beheert bots (fiche, koppelcode, koppelingen, intrekken, voorstellen, ongedaan maken, logboek);
//   (2) de fiche: enkel gekende tools en taken, Zelf doen enkel waar de taak het toelaat, Nooit vast, geen vertrouwelijke soort, rev;
//   (3) de koppelcode: eenmalig, nooit voor een identiteit van een persoon; een bot is nooit een persoon (redeemCode, claimBootstrap);
//   (4) OAuth: enkel een gekoppelde bot keurt goed, PKCE S256, zonder token 401;
//   (5) tools/list = de tools op de fiche; lezen enkel de werven en documentsoorten van de fiche, nooit bedragen of URL's;
//   (6) buiten de fiche = weigering (0 lekken), ook via een factuur van een andere werf;
//   (7) Voorstel → beslissen in Beheer; Zelf doen → meteen uitgevoerd en met één klik ongedaan; na een wijziging niet meer;
//   (8) factuurcontrole is hoogstens een voorstel en wijzigt niets aan de factuur;
//   (9) daglimiet; logboek zonder inhoud; intrekken (koppeling en bot) sluit meteen.
// Enkel VERZONNEN gegevens (P-MCP-…, Proef bot). Draait na tests/rollen.mjs en tests/oafactuur-draft.mjs (een OA-factuur).
//   node tests/mcp-3-13.mjs <canister-id>
import { backend, freshBackend } from "../tools/lib.mjs";
import { connect, FORBIDDEN, http, register, rpc, tool, pkce, REDIRECT } from "./mcp-lib.mjs";
import { makeHistory, passProof } from "./proef-lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/mcp-3-13.mjs <canister-id>");
const host = process.env.ICP_HOST || "";
if (!host.includes("localhost") && !host.includes("127.0.0.1")) throw new Error("tests/mcp-3-13.mjs enkel op het eigen lokale net");
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const S = (x) => JSON.stringify(x, big);
const ok = (r) => { if (r && typeof r === "object" && "err" in r) throw new Error(r.err); return r && typeof r === "object" && "ok" in r ? r.ok : r; };
const isOk = (r) => r && typeof r === "object" && "ok" in r;
const errOf = (r) => (r && typeof r === "object" && "err" in r ? r.err : "");
const denied = async (p) => { try { const r = await p; return !!(r && typeof r === "object" && "err" in r && /Geen toegang/.test(r.err)); } catch (e) { return /Geen toegang|trap|Reject/i.test(String(e)); } };
const fakeBlob = (c) => new TextEncoder().encode("!caf!sha256:" + c.repeat(64));
const sfx = Date.now().toString(36).slice(-5).toUpperCase();

const [admin, wl, calc, oa] = await Promise.all(["proef-admin", "proef-werfleider", "proef-calculator", "proef-oa2"].map((n) => backend(n, cid)));
const anon = await backend(null, cid);
// Elke ronde verse identiteiten voor de bots (een identiteit die ooit een bot was, blijft dat: nooit opnieuw te gebruiken).
const botA = await freshBackend(cid);
const botB = await freshBackend(cid);
const botX = await freshBackend(cid);
const MARK = "GEHEIM-" + Math.random().toString(36).slice(2, 10);

// ── Opzet: twee proefwerven, bestanden, een OA-factuur ─────────────────
const addr = { street: "Proefstraat", number: "1", zip: "9999", city: "Proefdorp", country: "BE" };
const mkWork = async (code, name) => ok(await admin.createWork({ code, name, address: addr, parentId: [], clientOrgId: [], architectOrgId: [], leaderPersonId: [], vatBp: 2100n })).id;
const W1 = await mkWork(`P-MCP-${sfx}-1`, "Proefwerf bot 3.13");
const W2 = await mkWork(`P-MCP-${sfx}-2`, `Proefwerf buiten fiche ${MARK}`);
const fOpen = ok(await calc.addFile("proef-plan-3-13.pdf", "application/pdf", 12_345n, fakeBlob("a"), [W1], false));
const fOpen2 = ok(await calc.addFile("proef-asbest-3-13.pdf", "application/pdf", 22_345n, fakeBlob("b"), [W1], false));
const fConf = ok(await calc.addFile(`proef-vertrouwelijk-${MARK}.pdf`, "application/pdf", 1_000n, fakeBlob("c"), [W1], true));
const fW2 = ok(await calc.addFile(`proef-w2-${MARK}.pdf`, "application/pdf", 1_000n, fakeBlob("d"), [W2], false));
const fOpen3 = ok(await calc.addFile("proef-derde-3-13.pdf", "application/pdf", 3_000n, fakeBlob("e"), [W1], false));
const invAll = await admin.listOaInvoices([], []);
const invOther = invAll.find((i) => i.workId !== W1);
check("opzet: twee proefwerven, vier losse bestanden (één vertrouwelijk), een OA-factuur van een andere werf", !!W1 && !!W2 && !!invOther, S({ W1, W2, inv: invOther?.id }));

// ── (1) Enkel de beheerder ──────────────────────────────────────────────
const F = (o = {}) => ({ id: [], rev: 0n, name: `Proef bot ${sfx}`, vendor: "Anthropic", model: "Claude (label)", tools: ["mijn_fiche", "werven", "werf_documenten", "oa_offertes", "oa_facturen", "document_koppelen", "voorstel_factuurcontrole"], allWorks: false, works: [W1], docKinds: ["plannen", "asbestinventaris", "plaatsbeschrijving", "verzekering"], callsPerDay: 200n, tasks: [], instruction: [], ...o });
for (const [n, x] of [["werfleider", wl], ["calculator", calc], ["OA", oa], ["anoniem", anon]]) {
  const rs = await Promise.all([x.listBots(), x.saveBot(F()), x.newBotCode(1n), x.revokeBot(1n), x.botActions(false), x.botLog(0n, 5n), x.mcpInfo(), x._caffeineMcpSetSignInOrigin("https://x.example"), x.botConnections(1n), x.decideBotAction(1n, true, ""), x.undoBotAction(1n)].map(denied));
  check(`(1) ${n} beheert geen bots`, rs.every(Boolean), S(rs));
}
const info = await admin.mcpInfo();
check("(1) mcpInfo: 17 tools (4.4: + maandagbriefing; 3.10: + controleopdrachten, controlebestand; 3.9 + 3.11: + vergelijkopdrachten, voorstel_vergelijking, naleesopdrachten, opmerkingen_offerte), 5 taken (document koppelen en OA-offerte inlezen (3.8) mogen Zelf doen, factuurcontrole niet), 5 Nooit-taken", info.tools.length === 17 && info.tasks.length === 5 && info.tasks.find((t) => t.key === "offertes-vergelijken")?.maxAuto === false && info.tasks.find((t) => t.key === "offerte-nalezen")?.maxAuto === false && info.tasks.find((t) => t.key === "oa-offerte-inlezen")?.maxAuto === true && info.tasks.find((t) => t.key === "document-koppelen")?.maxAuto === true && info.tasks.find((t) => t.key === "factuurcontrole")?.maxAuto === false && info.never.length === 5, S(info));
check("(1) inlogpagina: ongeldig adres geweigerd, https://host aanvaard", errOf(await admin._caffeineMcpSetSignInOrigin("https://x.example/pad")).includes("Ongeldig") && isOk(await admin._caffeineMcpSetSignInOrigin("https://proef-3-13.example")) && (await anon._caffeineMcpSignInOrigin())[0] === "https://proef-3-13.example");

// ── (2) De fiche ────────────────────────────────────────────────────────
check("(2) onbekende tool geweigerd", errOf(await admin.saveBot(F({ tools: ["betalen"] }))).includes("Onbekende tool"));
check("(2) factuurcontrole op Zelf doen geweigerd (hoogstens Voorstel)", errOf(await admin.saveBot(F({ tasks: [["factuurcontrole", { auto: null }]] }))).includes("hoogstens Voorstel"));
check("(2) een Nooit-taak is niet in te stellen", errOf(await admin.saveBot(F({ tasks: [["betalen-goedkeuren", { proposal: null }]] }))).includes("Nooit"));
check("(2) een vertrouwelijke documentsoort kan nooit op de fiche", errOf(await admin.saveBot(F({ docKinds: ["contract"] }))).includes("vertrouwelijke"));
check("(2) onbekende werf en 0 oproepen per dag geweigerd", errOf(await admin.saveBot(F({ works: [999_999n] }))).includes("Onbekende werf") && errOf(await admin.saveBot(F({ callsPerDay: 0n }))).includes("Oproepen"));
const idA = ok(await admin.saveBot(F()));
let bA = (await admin.listBots()).find((b) => b.id === idA);
check("(2) fiche bewaard: nieuwe taken op Voorstel, niet gekoppeld", bA && bA.tasks.every(([, l]) => "proposal" in l) && bA.principal.length === 0 && !bA.codePending, S(bA));
check("(2) rev-controle", errOf(await admin.saveBot(F({ id: [idA], rev: 0n }))).includes("Intussen"));

// ── (3) Koppelcode ──────────────────────────────────────────────────────
const code = ok(await admin.newBotCode(idA));
check("(3) koppelcode BOT-XXXX-XXXX-XXXX-XXXX, 24 u", /^BOT(-[0-9A-Z]{4}){4}$/.test(code.code), code.code);
check("(3) een identiteit van een persoon kan geen bot worden", errOf(await wl.claimBotCode(code.code)).includes("persoon"));
check("(3) foute code geweigerd", errOf(await botA.claimBotCode("BOT-0000-0000-0000-0000")).includes("klopt niet"));
check("(3) de bot-identiteit koppelt met de code", "bot" in ok(await botA.claimBotCode(code.code)));
check("(3) de code is eenmalig", errOf(await botB.claimBotCode(code.code)).includes("klopt niet"));
check("(3) een gekoppelde bot krijgt geen tweede code", errOf(await admin.newBotCode(idA)).includes("al gekoppeld"));
check("(3) een bot is nooit een persoon: redeemCode en claimBootstrap weigeren", errOf(await botA.redeemCode("BOW-0000-0000-0000")) === "Geen toegang" && errOf(await botA.claimBootstrap("BOW-0000-0000-0000-0000", "x")) === "Geen toegang");
check("(3) de bot kan de gewone API niet gebruiken (werven, bestanden, facturen)", (await denied(botA.listWorks())) && (await denied(botA.listFiles([W1]))) && (await denied(botA.listOaInvoices([], []))));
check("(3) een bot-identiteit kan geen robot worden", errOf(await admin.addRobot((await botA.me()).principal, "Proef", ["proef"])) === "Deze sleutel hoort bij een bot");
check("(3) myBot: de bot, een persoon, een onbekende", "bot" in (await botA.myBot()) && "person" in (await wl.myBot()) && "none" in (await botX.myBot()));

// ── (4) OAuth ───────────────────────────────────────────────────────────
const cX = await register(anon, cid, "Proef Claude");
const { challenge } = pkce();
check("(4) een persoon (werfleider) keurt geen koppeling goed", errOf(await wl._caffeineMcpApprove({ clientId: cX, redirectUri: REDIRECT, codeChallenge: challenge, codeChallengeMethod: "S256" })).startsWith("Geen toegang"));
check("(4) een onbekende identiteit evenmin", errOf(await botX._caffeineMcpApprove({ clientId: cX, redirectUri: REDIRECT, codeChallenge: challenge, codeChallengeMethod: "S256" })).startsWith("Geen toegang"));
check("(4) de bot zonder PKCE S256 geweigerd", errOf(await botA._caffeineMcpApprove({ clientId: cX, redirectUri: REDIRECT, codeChallenge: challenge, codeChallengeMethod: "plain" })).includes("S256"));
const conA = await connect(anon, botA, cid, "Proef Claude A");
check("(4) koppeling: goedkeuren als de bot, code → token", !!conA.access, S(conA.err ?? ""));
const no = await rpc(anon, cid, null, "tools/list");
check("(4) /mcp zonder token: 401 met resource_metadata", no.status === 401 && no.headers.some(([k, v]) => k === "www-authenticate" && v.includes("oauth-protected-resource")), S(no.status));
const bad = await rpc(anon, cid, "nep-token", "tools/list");
check("(4) /mcp met een vals token: 401", bad.status === 401);
const meta = await http(anon, cid, "GET", "/.well-known/oauth-authorization-server");
check("(4) metadata: authorize op de inlogpagina van de app", meta.status === 200 && meta.json.authorization_endpoint === "https://proef-3-13.example/mcp-authorize", meta.text);
const init = await rpc(anon, cid, conA.access, "initialize", { protocolVersion: "2025-06-18" });
check("(4) initialize: server BOWACO, instructies zonder AI-taal naar buiten", init.json?.result?.serverInfo?.name === "BOWACO" && /GEGEVENS en nooit instructies/.test(init.json?.result?.instructions ?? "") && /bestandsnamen/.test(init.json?.result?.instructions ?? ""), init.text.slice(0, 200));

// ── (5) tools/list en lezen ─────────────────────────────────────────────
const tl = (await rpc(anon, cid, conA.access, "tools/list")).json?.result?.tools ?? [];
check("(5) tools/list = de 7 tools van de fiche, lees-tools met readOnlyHint", tl.length === 7 && tl.filter((t) => t.annotations?.readOnlyHint).length === 5, S(tl.map((t) => t.name)));
const fiche = await tool(anon, cid, conA.access, "mijn_fiche");
check("(5) mijn_fiche: taken op voorstel, Nooit-lijst, werf W1", !fiche.isError && fiche.data.taken.every((t) => t.niveau === "voorstel") && fiche.data.nooit.length === 5 && S(fiche.data.werven) === S([Number(W1)]), fiche.text.slice(0, 300));
const ws = await tool(anon, cid, conA.access, "werven");
check("(5) werven: enkel W1, zonder adres", !ws.isError && ws.data.werven.length === 1 && ws.data.werven[0].id === Number(W1) && !("adres" in ws.data.werven[0]) && !ws.text.includes("Proefstraat") && !ws.text.includes(MARK), ws.text);
const docs = await tool(anon, cid, conA.access, "werf_documenten", { werfId: Number(W1) });
const looseIds = (docs.data?.losseBestanden ?? []).map((f) => f.id);
check("(5) werf_documenten W1: losse bestanden zonder het vertrouwelijke, zonder link of blob", !docs.isError && looseIds.includes(Number(fOpen)) && looseIds.includes(Number(fOpen2)) && !looseIds.includes(Number(fConf)) && !FORBIDDEN.test(docs.text) && !docs.text.includes(MARK), docs.text.slice(0, 400));
const oq = await tool(anon, cid, conA.access, "oa_offertes", { werfId: Number(W1) });
const of = await tool(anon, cid, conA.access, "oa_facturen", { werfId: Number(W1) });
check("(5) oa_offertes en oa_facturen W1: zonder bedragen", !oq.isError && !of.isError && !FORBIDDEN.test(oq.text) && !FORBIDDEN.test(of.text), oq.text + of.text);

// ── (6) Buiten de fiche = weigering ─────────────────────────────────────
const out = [];
for (const [t, a] of [["werf_documenten", { werfId: Number(W2) }], ["oa_offertes", { werfId: Number(W2) }], ["oa_facturen", { werfId: Number(W2) }], ["document_koppelen", { werfId: Number(W2), bestandId: Number(fW2), soort: "plannen" }], ["voorstel_factuurcontrole", { factuurId: Number(invOther.id), oordeel: "in_orde" }], ["oa_facturen", { werfId: Number(invOther.workId) }], ["werf_documenten", {}], ["werf_documenten", { werfId: -1 }]]) {
  const r = await tool(anon, cid, conA.access, t, a);
  out.push([t, r.isError, r.text.includes(MARK)]);
}
check("(6) andere werf, factuur van een andere werf, geen of een foute werf: alles geweigerd, niets van W2 zichtbaar", out.every(([, e, m]) => e && !m), S(out));
const unk = await rpc(anon, cid, conA.access, "tools/call", { name: "betalen", arguments: {} });
check("(6) een tool die niet bestaat: fout", !!unk.json?.error);
check("(6) een vertrouwelijk bestand koppelen: geweigerd", (await tool(anon, cid, conA.access, "document_koppelen", { werfId: Number(W1), bestandId: Number(fConf), soort: "plannen" })).isError);
check("(6) een documentsoort buiten de fiche (lastenboek): geweigerd", (await tool(anon, cid, conA.access, "document_koppelen", { werfId: Number(W1), bestandId: Number(fOpen), soort: "lastenboek" })).text.includes("niet op je fiche"));

// ── (7) Voorstel → beslissen; Zelf doen → ongedaan maken ────────────────
const v1 = await tool(anon, cid, conA.access, "document_koppelen", { werfId: Number(W1), bestandId: Number(fOpen), soort: "plannen", reden: `Proefreden ${MARK}` });
check("(7) Voorstel: document_koppelen wordt een voorstel, niets gewijzigd", !v1.isError && v1.data.stand === "voorstel" && !(await admin.getDossier(W1)).documents.some((d) => d.kind === "plannen"), v1.text);
let acts = await admin.botActions(true);
const a1 = acts.find((a) => Number(a.id) === v1.data.actie);
check("(7) Beheer ziet het open voorstel met bestand en reden", !!a1 && "docLink" in a1.detail && a1.detail.docLink.fileId === fOpen && a1.reason.includes("Proefreden"), S(a1));
ok(await admin.decideBotAction(a1.id, true, "proef aanvaard"));
const d1 = (await admin.getDossier(W1)).documents.find((d) => d.kind === "plannen");
check("(7) aanvaard: het bestand hangt aan een document Plannen (ontvangen)", !!d1 && "received" in d1.status, S(d1?.status));
check("(7) een beslist voorstel kan niet opnieuw beslist worden", errOf(await admin.decideBotAction(a1.id, false, "")).includes("Al beslist"));
ok(await admin.undoBotAction(a1.id));
check("(7) een aanvaarde koppeling ongedaan maken: het document is weg", !(await admin.getDossier(W1)).documents.some((d) => d.id === d1.id));
bA = (await admin.listBots()).find((b) => b.id === idA);
// 3.5: Zelf doen vraagt eerst een geslaagde proefronde (≥ 95 % op ≥ 50 gevallen) met dezelfde labels.
check("(7) Zelf doen zonder proefronde: geweigerd (3.5)", errOf(await admin.saveBot(F({ id: [idA], rev: bA.rev, tasks: [["document-koppelen", { auto: null }]] }))).includes("proefronde"));
const W3code = `P-MCP-${sfx}-3`;
const W3 = await mkWork(W3code, "Proefwerf historiek 3.5");
const hist = await makeHistory(calc, [{ id: W3, code: W3code }], ["plannen", "plaatsbeschrijving", "verzekering"], 52, sfx);
ok(await admin.saveBot(F({ id: [idA], rev: bA.rev, works: [W1, W3] })));
const pp = await passProof(admin, anon, cid, conA.access, idA, hist, `Proefset mcp ${sfx}`);
check("(7) proefronde via de proeftools: geslaagd (3.5)", !!pp.round?.passed && pp.round.counted >= 50n, S({ round: pp.round, err: pp.play.error }));
bA = (await admin.listBots()).find((b) => b.id === idA);
ok(await admin.saveBot(F({ id: [idA], rev: bA.rev, works: [W1, W3], tasks: [["document-koppelen", { auto: null }]] })));
const ze = await tool(anon, cid, conA.access, "document_koppelen", { werfId: Number(W1), bestandId: Number(fOpen2), soort: "asbestinventaris", reden: "proef extern" });
check("(7) Zelf doen voor een soort die externen zien of leveren (asbestinventaris): toch een voorstel (review M1)", !ze.isError && ze.data.stand === "voorstel", ze.text);
ok(await admin.decideBotAction(BigInt(ze.data.actie), false, "proef geweigerd"));
const z1 = await tool(anon, cid, conA.access, "document_koppelen", { werfId: Number(W1), bestandId: Number(fOpen2), soort: "plaatsbeschrijving", reden: "proef zelf doen" });
const dz = (await admin.getDossier(W1)).documents.find((d) => d.kind === "plaatsbeschrijving");
check("(7) Zelf doen (interne soort): meteen uitgevoerd, document Plaatsbeschrijving (ontvangen)", !z1.isError && z1.data.stand === "uitgevoerd" && !!dz && "received" in dz.status, z1.text);
acts = await admin.botActions(false);
const az = acts.find((a) => Number(a.id) === z1.data.actie);
check("(7) in Beheer: 'zelf gedaan' met de knop ongedaan maken", !!az && "done" in az.state && az.canUndo === true, S(az?.state));
ok(await admin.undoBotAction(az.id));
check("(7) ongedaan met één klik: het document is weg, de actie staat op ongedaan", !(await admin.getDossier(W1)).documents.some((d) => d.id === dz.id) && "undone" in (await admin.botActions(false)).find((a) => a.id === az.id).state);
check("(7) twee keer ongedaan maken kan niet", errOf(await admin.undoBotAction(az.id)).includes("Niets"));
// Na een menselijke wijziging: niet meer ongedaan.
const z2 = await tool(anon, cid, conA.access, "document_koppelen", { werfId: Number(W1), bestandId: Number(fOpen3), soort: "verzekering" });
const dz2 = (await admin.getDossier(W1)).documents.find((d) => d.kind === "verzekering");
ok(await admin.setDocumentStatus(dz2.id, { approved: null }, "proef goedgekeurd door een mens"));
check("(7) na een wijziging door een mens: niet meer ongedaan te maken", errOf(await admin.undoBotAction(BigInt(z2.data.actie))).includes("intussen gewijzigd"));

// ── (8) Factuurcontrole ─────────────────────────────────────────────────
const W1inv = invAll.find((i) => i.workId === W1);
// Een factuur op een werf van de fiche: zet de werf van een bestaande proeffactuur op de fiche.
bA = (await admin.listBots()).find((b) => b.id === idA);
ok(await admin.saveBot(F({ id: [idA], rev: bA.rev, works: [W1, invOther.workId], tasks: [] })));
const inv0 = (await admin.listOaInvoices([invOther.workId], [])).find((i) => i.id === invOther.id);
const fc = await tool(anon, cid, conA.access, "voorstel_factuurcontrole", { factuurId: Number(invOther.id), oordeel: "afwijking", opmerkingen: [`Proef: ${MARK}`, "uren kloppen niet"] });
const inv1 = (await admin.listOaInvoices([invOther.workId], [])).find((i) => i.id === invOther.id);
check("(8) factuurcontrole: altijd een voorstel, de factuur blijft onveranderd", !fc.isError && fc.data.stand === "voorstel" && S(inv0.status) === S(inv1.status), fc.text);
const fa = (await admin.botActions(true)).find((a) => Number(a.id) === fc.data.actie);
check("(8) Beheer toont oordeel en opmerkingen", fa && "invoiceCheck" in fa.detail && fa.detail.invoiceCheck.verdict === "afwijking" && fa.detail.invoiceCheck.remarks.length === 2);
check("(8) oordeel buiten de lijst en te veel opmerkingen geweigerd", (await tool(anon, cid, conA.access, "voorstel_factuurcontrole", { factuurId: Number(invOther.id), oordeel: "goedkeuren" })).isError && (await tool(anon, cid, conA.access, "voorstel_factuurcontrole", { factuurId: Number(invOther.id), oordeel: "in_orde", opmerkingen: Array(21).fill("x") })).isError);
ok(await admin.decideBotAction(fa.id, true, ""));
check("(8) aanvaard: de factuur blijft onveranderd (goedkeuren = een mens in OA-facturen)", S((await admin.listOaInvoices([invOther.workId], [])).find((i) => i.id === invOther.id).status) === S(inv0.status));
void W1inv;

// ── (9) Daglimiet, logboek, intrekken ───────────────────────────────────
bA = (await admin.listBots()).find((b) => b.id === idA);
const today = bA.callsToday;
ok(await admin.saveBot(F({ id: [idA], rev: bA.rev, works: [W1], callsPerDay: today + 2n })));
const l1 = await tool(anon, cid, conA.access, "mijn_fiche");
const l2 = await tool(anon, cid, conA.access, "werven");
const l3 = await tool(anon, cid, conA.access, "werven");
check("(9) daglimiet: na de limiet weigert de app", !l1.isError && !l2.isError && l3.isError && l3.text.includes("Daglimiet"), S([l1.isError, l2.isError, l3.text]));
const log = await admin.botLog(0n, 200n);
const logText = S(log);
check("(9) logboek: elke oproep (ok, geweigerd, limiet) met een sha256 van de argumenten, zonder inhoud", log.some((c) => "limit" in c.outcome) && log.some((c) => "refused" in c.outcome) && log.some((c) => "ok" in c.outcome) && log.every((c) => /^[0-9a-f]{64}$/.test(c.argsSha256)) && !logText.includes(MARK) && !logText.includes("Proefreden"), log.length);
const botAudit = (await admin.auditLog(0n, 500n)).filter((a) => a.action.startsWith("bot-"));
const auditText = S(botAudit);
check("(9) auditlog: bot-acties zonder inhoud", auditText.includes("bot-voorstel") && auditText.includes("bot-zelf") && !auditText.includes(MARK) && !auditText.includes("Proefreden"), botAudit.length);
ok(await admin.saveBot(F({ id: [idA], rev: (await admin.listBots()).find((b) => b.id === idA).rev, works: [W1], callsPerDay: 200n })));
// Tweede koppeling, daarna enkel die intrekken.
const conA2 = await connect(anon, botA, cid, "Proef Claude A tweede");
let cons = await admin.botConnections(idA);
check("(9) Beheer ziet twee koppelingen", cons.length === 2, S(cons.map((c) => c.clientName)));
const second = cons.find((c) => c.clientName === "Proef Claude A tweede");
ok(await admin.revokeBotConnection(idA, second.id));
check("(9) één koppeling intrekken: dat token werkt niet meer (401), het andere wel", (await rpc(anon, cid, conA2.access, "tools/list")).status === 401 && (await rpc(anon, cid, conA.access, "tools/list")).status === 200);
ok(await admin.revokeBot(idA));
check("(9) de bot intrekken: alle koppelingen weg, geen tools meer", (await rpc(anon, cid, conA.access, "tools/list")).status === 401 && (await admin.botConnections(idA)).length === 0 && "revoked" in (await botA.myBot()));
check("(9) een ingetrokken bot: geen fiche wijzigen, geen code, geen koppeling, en nog altijd geen persoon", errOf(await admin.saveBot(F({ id: [idA], rev: 99n }))).includes("ingetrokken") && errOf(await admin.newBotCode(idA)).includes("ingetrokken") && errOf(await botA._caffeineMcpApprove({ clientId: cX, redirectUri: REDIRECT, codeChallenge: challenge, codeChallengeMethod: "S256" })).startsWith("Geen toegang") && errOf(await botA.redeemCode("BOW-0000-0000-0000")) === "Geen toegang");
// Een tweede bot met enkel mijn_fiche: tools/list toont één tool.
const idB = ok(await admin.saveBot(F({ name: `Proef bot B ${sfx}`, vendor: "xAI", tools: ["mijn_fiche"], works: [], docKinds: [] })));
ok(await botB.claimBotCode(ok(await admin.newBotCode(idB)).code));
const conB = await connect(anon, botB, cid, "Proef Grok B");
const tlB = (await rpc(anon, cid, conB.access, "tools/list")).json?.result?.tools ?? [];
const wB = await tool(anon, cid, conB.access, "werven");
check("(9) bot B (enkel mijn_fiche): één tool in de lijst, werven geweigerd", tlB.length === 1 && tlB[0].name === "mijn_fiche" && wB.isError, S(tlB.map((t) => t.name)));
ok(await admin.revokeBot(idB));

console.log(`\n${pass} ✓ / ${fail} ✗`);
process.exit(fail ? 1 : 0);
