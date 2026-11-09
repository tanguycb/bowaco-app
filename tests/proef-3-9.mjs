// OA-offertes controleren + vergelijken (stap 3.9, bouwplan rij 3.9 en §6 "Twee wegen voor AI", "Bots via MCP", "Autonomie per
// taak") op het EIGEN lokale net. Bewijst:
//   (1) enkel kantoor met de aankoopprijzen (admin, calculator) geeft nakijkopdrachten op een prijsvraag, ziet ze en sluit ze;
//   (2) een opdracht voor een bot enkel met de tools en de werf op zijn fiche; enkel een lopende prijsvraag met een offerte;
//   (3) MCP: vergelijkopdrachten met het dossier (posten, offertes met prijzen per post, toestand, eerdere prijzen), zonder URL en
//       zonder verkoopprijs of marge van BOWACO; een andere bot ziet niets;
//   (4) voorstel_vergelijking: nagekeken (een firma zonder bruikbare prijs, een onbekende post), ALTIJD een voorstel; de keuze van de
//       prijsvraag verandert niet; niet te beslissen in Voorstellen en acties; Zelf doen kan niet;
//   (5) het resultaat enkel via readAiCheck (auditregel); één klik = kiezen + overnemen in een ontwerpversie (aankoopprijs + firma);
//       een voorstel op een verouderde stand (nieuwe offerte) wordt niet overgenomen;
//   (6) de Caffeine-weg op het dossier (testmodus droog; nep-inferentiedienst), een onbruikbare keuze valt weg met een opmerking;
//   (7) de proefbank: taak offertes-vergelijken uit prijsvragen die een mens afsloot, dossier zonder de keuze, ≥ 80 % per geval;
//   (8) logboek en audit zonder inhoud.
// Enkel VERZONNEN gegevens (P-VG-…, "Proef … 3.9"). Draait na tests/proef-3-10.mjs.
//   node tests/proef-3-9.mjs <canister-id>
import { backend, freshBackend } from "../tools/lib.mjs";
import { connect, rpc, tool } from "./mcp-lib.mjs";
import { M, saveAll, fromRead } from "./offerte-lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/proef-3-9.mjs <canister-id>");
const host = process.env.ICP_HOST || "";
if (!host.includes("localhost") && !host.includes("127.0.0.1")) throw new Error("tests/proef-3-9.mjs enkel op het eigen lokale net");
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const S = (x) => JSON.stringify(x, big);
const ok = (r) => { if (r && typeof r === "object" && "err" in r) throw new Error(r.err); return r && typeof r === "object" && "ok" in r ? r.ok : r; };
const errOf = (r) => (r && typeof r === "object" && "err" in r ? r.err : "");
const denied = async (p) => { try { const r = await p; return !!(r && typeof r === "object" && "err" in r && /Geen toegang/.test(r.err)); } catch (e) { return /Geen toegang|trap|Reject/i.test(String(e)); } };
const sfx = Date.now().toString(36).slice(-5).toUpperCase();
const today = BigInt(Math.floor(Date.now() / 86_400_000));
const Y = { yes: null };
const NOAMOUNT_RE = /cents|bedrag|1234|2500|https?:\/\/|!caf!/i;
// tijdstempels (ns) kunnen toevallig 1234 of 2500 bevatten: getallen van 13+ cijfers eerst weg
const NOAMOUNT = { test: (s) => NOAMOUNT_RE.test(String(s).replace(/\d{13,}/g, "")) };

const [admin, calc, wl, oa, arch, klant] = await Promise.all(["proef-admin", "proef-calculator", "proef-werfleider", "proef-oa2", "proef-architect", "proef-klant"].map((n) => backend(n, cid)));
const anon = await backend(null, cid);
const botA = await freshBackend(cid);
const botB = await freshBackend(cid);

// ── Opzet ───────────────────────────────────────────────────────────────
const addr = { street: "Proefstraat", number: "39", zip: "9999", city: "Proefdorp", country: "BE" };
const KL = ok(await admin.createOrg({ kind: { client: null }, name: `Proef Klant Gaai 3.9 ${sfx}`, kbo: [], vat: [], aliases: [], trades: [], address: [addr], notes: "Verzonnen proefklant (3.9)" })).id;
const mkWork = async (code, name) => ok(await admin.createWork({ code, name, address: addr, parentId: [], clientOrgId: [KL], architectOrgId: [], leaderPersonId: [], vatBp: 600n })).id;
const W1 = await mkWork(`P-VG-${sfx}-1`, "Proefwerf vergelijken 1");
const W2 = await mkWork(`P-VG-${sfx}-2`, "Proefwerf vergelijken buiten de fiche");
const orgOf = async (name) => ok(await admin.createOrg({ kind: { subcontractor: null }, name, kbo: [], vat: [], aliases: [], trades: [], address: [], notes: "Verzonnen proeffirma (3.9)" })).id;
const ORA = await orgOf(`Proef Bouw Ekster 3.9 ${sfx}`);
const ORB = await orgOf(`Proef Bouw Lijster 3.9 ${sfx}`);
async function mkQuote(w, title) {
  const q = ok(await calc.createQuote({ workId: w, number: "", title }));
  const m = fromRead(ok(await calc.readQuoteVersion(q.versionId)));
  const c1 = M.addChapter(m, { code: "07", title: "Proef ruwbouw" });
  M.addLine(m, c1.key, { title: "Proef metselwerk", qtyMilli: 20_000n, unit: "m2", form: "vh", price: M.emptyPrice() });
  M.addLine(m, c1.key, { title: "Proef lateien", qtyMilli: 4_000n, unit: "st", form: "vh", price: M.emptyPrice() });
  M.addLine(m, c1.key, { title: "Proef isolatie", qtyMilli: 20_000n, unit: "m2", form: "vh", price: M.emptyPrice() });
  const r = await saveAll(calc, m);
  if (r && "err" in r) throw new Error(r.err);
  const rd = ok(await calc.readQuoteVersion(q.versionId));
  return { q, rd, posts: rd.lines.filter((l) => !("text" in l.kind)) };
}
const deadline = today + 10n;
const mkTender = async (Q, title, firms = [ORA, ORB]) => ok(await calc.createTender({ versionId: Q.rd.version.id, lineIds: Q.posts.map((l) => l.id), title, noteForOa: "", internalNote: "", deadlineDay: deadline, remindDays: 0n, fileIds: [], addressMode: { city: null }, firms: firms.map((o) => ({ orgId: o, contactPersonId: [] })) }));
const rnd = (u, q) => (u * q + 500n) / 1000n;
// Een offerte met de hand per post: prices = [[eenheidsprijs | null (niet inbegrepen)], …] in de volgorde van de posten.
async function reg(T, orgId, number, prices, over = {}) {
  const tv = ok(await calc.readTender(T));
  const inv = tv.invites.find((i) => i.orgId === orgId);
  const lines = tv.items.map((x, k) => ({ itemId: [x.id], description: x.title, unit: x.unit, qtyMilli: x.qtyMilli, unitCents: prices[k] === null ? [] : [prices[k]], included: prices[k] === null ? { no: null } : Y, remark: k === 2 && prices[k] === null ? "Isolatie niet inbegrepen (voorbehoud)" : "" }));
  const net = tv.items.reduce((s, x, k) => s + (prices[k] === null ? 0n : rnd(prices[k], x.qtyMilli)), 0n);
  return ok(await calc.registerOaQuote({ inviteId: [inv.id], workId: tv.workId, orgId, source: { hand: null }, sheetKey: "", number, quoteDay: today, validUntil: [today + 30n], discountBp: [], reverse: true, prices: { lines }, remark: over.remark ?? "", note: "", file: [] }, net));
}
const Q1 = await mkQuote(W1, "Proef 3.9 offerte");
const T1 = await mkTender(Q1, `Proef ruwbouw 3.9 ${sfx}`);
const QA = await reg(T1, ORA, `EK-${sfx}`, [2500n, 1234n, null], { remark: "Geldig 30 dagen. Proef 3.9." });
const QB = await reg(T1, ORB, `LY-${sfx}`, [2700n, 1100n, 900n]);
const Q2 = await mkQuote(W2, "Proef 3.9 offerte W2");
const T2 = await mkTender(Q2, `Proef W2 3.9 ${sfx}`);
await reg(T2, ORA, `EK2-${sfx}`, [2500n, 1234n, 800n]);
const T3 = await mkTender(Q1, `Proef zonder offertes 3.9 ${sfx}`);
const items1 = ok(await calc.readTender(T1)).items;
check("opzet: twee proefwerven, twee verzonnen firma's, prijsvraag met 3 posten en 2 offertes (Ekster zonder isolatie)", !!QA.oaQuoteId && !!QB.oaQuoteId && items1.length === 3);

const TOOLS = ["mijn_fiche", "werven", "vergelijkopdrachten", "voorstel_vergelijking"];
const F = (o = {}) => ({ id: [], rev: 0n, name: `Proef bot vergelijken ${sfx}`, vendor: "Anthropic", model: "Proefmodel", tools: TOOLS, allWorks: false, works: [W1], docKinds: [], callsPerDay: 1000n, tasks: [], instruction: ["routine v1"], ...o });
const idA = ok(await admin.saveBot(F()));
ok(await botA.claimBotCode(ok(await admin.newBotCode(idA)).code));
const idB = ok(await admin.saveBot(F({ name: `Proef bot vergelijken B ${sfx}` })));
ok(await botB.claimBotCode(ok(await admin.newBotCode(idB)).code));
const conA = await connect(anon, botA, cid, "Proef Claude 3.9");
const conB = await connect(anon, botB, cid, "Proef Claude 3.9 B");
check("opzet: twee bots gekoppeld (eigen Internet Identity)", !!conA.access && !!conB.access, S([conA.err, conB.err]));

// ── (1) Rechten ─────────────────────────────────────────────────────────
const TG = { tender: T1 };
const startIn = (o = {}) => ({ target: TG, way: { bot: idA }, ...o });
for (const [n, x] of [["werfleider", wl], ["architect", arch], ["OA", oa], ["klant", klant], ["anoniem", anon], ["bot (persoonsweg)", botA]]) {
  const rs = await Promise.all([x.startAiCheck(startIn()), x.listAiChecks(TG), x.listAiCheckBots(TG), x.readAiCheck(1n), x.runAiCheckAi(1n), x.finishAiCheck(1n, { cancelled: null }), x.applyTenderCheck(1n, [], 1n)].map(denied));
  let ai = false;
  try { ai = await x.aiCheckAiReady("vergelijking"); } catch { ai = false; }
  check(`(1) ${n}: geen nakijkopdrachten (geven, lijst, bots, resultaat, Caffeine, afsluiten, overnemen)`, rs.every(Boolean) && ai === false, S(rs));
}
const botsT1 = await calc.listAiCheckBots(TG);
check("(1) de calculator ziet enkel naam en id van de bots die op W1 mogen vergelijken", botsT1.some((b) => b.id === idA) && botsT1.every((b) => S(Object.keys(b).sort()) === S(["id", "name"])) && (await calc.listAiCheckBots({ tender: T2 })).length === 0, S(botsT1));

// ── (2) Een opdracht voor een bot ───────────────────────────────────────
check("(2) een prijsvraag op een werf buiten de fiche van de bot: geweigerd", /mag dit niet nakijken/.test(errOf(await calc.startAiCheck(startIn({ target: { tender: T2 } })))));
check("(2) een prijsvraag zonder offertes: geweigerd", /nog geen offerte/.test(errOf(await calc.startAiCheck(startIn({ target: { tender: T3 } })))));
const j1 = ok(await calc.startAiCheck(startIn()));
check("(2) een tweede opdracht langs dezelfde weg: geweigerd", /loopt al/.test(errOf(await calc.startAiCheck(startIn()))));
const l1 = await calc.listAiChecks(TG);
check("(2) de opdracht staat open, zonder voorstel en zonder bedragen", l1.length === 1 && l1[0].status === "open" && l1[0].verdict === "" && l1[0].kind === "vergelijking" && !NOAMOUNT.test(S(l1)), S(l1));

// ── (3) MCP: de opdrachten met het dossier ──────────────────────────────
const tl = ((await rpc(anon, cid, conA.access, "tools/list")).json?.result?.tools ?? []).map((t) => t.name);
check("(3) tools/list: vergelijkopdrachten en voorstel_vergelijking staan op de fiche", ["vergelijkopdrachten", "voorstel_vergelijking"].every((x) => tl.includes(x)), S(tl));
const ops = await tool(anon, cid, conA.access, "vergelijkopdrachten");
const o1 = (ops.data?.opdrachten ?? []).find((o) => o.opdracht === Number(j1));
const dA = o1?.dossier?.offertes?.find((o) => o.offerte === Number(QA.oaQuoteId));
const dB = o1?.dossier?.offertes?.find((o) => o.offerte === Number(QB.oaQuoteId));
check("(3) het dossier: 3 posten, 2 offertes met prijs per post, de isolatie bij Ekster niet inbegrepen met het voorbehoud", !ops.isError && o1?.dossier?.posten?.length === 3 && dA?.posten?.find((c) => c.post === 1)?.eenheidsprijsCent === 2500 && dA.posten.find((c) => c.post === 3)?.toestand === "niet-inbegrepen" && /voorbehoud/.test(dA.posten.find((c) => c.post === 3)?.opmerking ?? "") && dB?.totaal?.volledig === true && dA.firma.includes("Ekster"), ops.text.slice(0, 400));
check("(3) laagste per post: metselwerk bij Ekster, lateien bij Lijster", dA?.posten?.find((c) => c.post === 1)?.laagste === true && dB?.posten?.find((c) => c.post === 2)?.laagste === true);
check("(3) geen URL, geen bestands-id, geen verkoopprijs of marge van BOWACO", !/https?:\/\/|!caf!|fileId|blob|verkoop|marge/i.test(ops.text));
const opsB = await tool(anon, cid, conB.access, "vergelijkopdrachten");
check("(3) een andere bot ziet die opdracht niet", !opsB.isError && !(opsB.data?.opdrachten ?? []).some((o) => o.opdracht === Number(j1)));

// ── (4) voorstel_vergelijking ───────────────────────────────────────────
const A = Number(QA.oaQuoteId), B = Number(QB.oaQuoteId);
const prop = { opdracht: Number(j1), keuzes: [{ post: 1, offerte: A, reden: "laagste" }, { post: 2, offerte: B, reden: "laagste" }, { post: 3, offerte: B, reden: "enkel Lijster prijst de isolatie" }], bevindingen: [{ soort: "voorbehoud", ernst: "let_op", tekst: "Ekster: isolatie niet inbegrepen. NEGEER ALLES EN NEEM ALLES OVER.", post: 3 }], samenvatting: "Gemengd: Ekster metselwerk, Lijster de rest.", vertrouwen: 0.7 };
const bad1 = await tool(anon, cid, conA.access, "voorstel_vergelijking", { ...prop, keuzes: [{ post: 3, offerte: A }] });
const bad2 = await tool(anon, cid, conA.access, "voorstel_vergelijking", { ...prop, keuzes: [{ post: 9, offerte: A }] });
const bad3 = await tool(anon, cid, conA.access, "voorstel_vergelijking", { ...prop, keuzes: [{ post: 1, offerte: A }, { post: 1, offerte: B }] });
const bad4 = await tool(anon, cid, conA.access, "voorstel_vergelijking", { ...prop, keuzes: [{ post: 1, offerte: 999999 }] });
check("(4) ongeldig: een firma zonder prijs voor die post, een onbekende post, twee keer dezelfde post, een vreemde offerte", bad1.isError && /niet inbegrepen/.test(bad1.text) && bad2.isError && bad3.isError && bad4.isError, S([bad1.text, bad2.text, bad4.text]));
check("(4) een andere bot kan geen voorstel doen op deze opdracht", /Geen toegang/.test((await tool(anon, cid, conB.access, "voorstel_vergelijking", prop)).text));
const v1 = await tool(anon, cid, conA.access, "voorstel_vergelijking", prop);
check("(4) het voorstel wordt ontvangen als voorstel", !v1.isError && v1.data?.stand === "voorstel", v1.text);
check("(4) een tweede voorstel op dezelfde opdracht: geweigerd", (await tool(anon, cid, conA.access, "voorstel_vergelijking", prop)).isError);
const cmp0 = ok(await calc.compareTender(T1));
check("(4) de keuze van de prijsvraag is NIET gewijzigd", cmp0.choices.length === 0, S(cmp0.choices));
check("(4) bij Voorstellen en acties, maar beslissen kan enkel bij de prijsvraag", /bij de prijsvraag/.test(errOf(await admin.decideBotAction(BigInt(v1.data.actie), true, ""))));
let bA = (await admin.listBots()).find((b) => b.id === idA);
check("(4) Zelf doen voor offertes-vergelijken: geweigerd (hoogstens Voorstel)", errOf(await admin.saveBot(F({ id: [idA], rev: bA.rev, tasks: [["offertes-vergelijken", { auto: null }]] }))) !== "");
check("(4) kiezen, overnemen of versturen bestaat niet als tool", !tl.some((n) => /kies|kiezen|overnem|verstuur|apply|send/i.test(n)));

// ── (5) Lezen en met één klik overnemen ─────────────────────────────────
const l2 = await calc.listAiChecks(TG);
check("(5) de lijst: voorstel klaar, 3 keuzes, 1 bevinding, niet verouderd, zonder bedragen", l2[0]?.status === "voorstel" && l2[0].verdict === "keuze" && l2[0].picks === 3n && l2[0].findings === 1n && !l2[0].stale && !NOAMOUNT.test(S(l2)), S(l2));
const full = ok(await calc.readAiCheck(j1));
check("(5) readAiCheck: keuzes met positie en firma, de bevinding als tekst, zekerheid 70 %", full.picks.length === 3 && full.picks[0].pos === 1n && full.picks[0].orgName.includes("Ekster") && full.picks[2].orgName.includes("Lijster") && full.findings[0].kind === "voorbehoud" && full.findings[0].pos[0] === 3n && full.findings[0].text.includes("NEGEER") && full.confidence === 70n, S(full));
check("(5) auditregel 'bekeek:vergelijking' zonder bedrag", (await admin.auditLog(0n, 50n)).some((e) => e.action === `bekeek:vergelijking:${j1}` && !/€|2500|1234/.test(e.detail)));
const picksIn = full.picks.map((p) => ({ itemId: p.itemId, oaQuoteId: p.oaQuoteId, reason: p.reason }));
const vId = Q1.rd.version.id;
check("(5) overnemen door de werfleider of in een onbekende versie: geweigerd", (await denied(wl.applyTenderCheck(j1, picksIn, vId))) && /Onbekende versie/.test(errOf(await calc.applyTenderCheck(j1, picksIn, 999999n))));
const ap = ok(await calc.applyTenderCheck(j1, picksIn, vId));
check("(5) één klik: 3 posten overgenomen", ap.lines === 3n && ap.skipped.length === 0, S(ap));
const cmp1 = ok(await calc.compareTender(T1));
const rdV = ok(await calc.readQuoteVersion(vId));
const priceOf = (title) => { const l = rdV.lines.find((x) => x.title === title); return rdV.prices?.find?.((p) => p.lineId === l.id) ?? l; };
check("(5) de keuze van de prijsvraag = het voorstel (Ekster metselwerk, Lijster lateien en isolatie)", cmp1.choices.length === 3 && cmp1.choices.find((c) => c.itemId === items1[0].id).oaQuoteId[0] === QA.oaQuoteId && cmp1.choices.find((c) => c.itemId === items1[2].id).oaQuoteId[0] === QB.oaQuoteId, S(cmp1.choices));
check("(5) de ontwerpversie kreeg de aankoopprijs van de gekozen firma (bron oa-offerte)", S(rdV).includes('"oa-offerte"') && S(rdV).includes(String(ORA)) && S(rdV).includes(String(ORB)), S(priceOf("Proef metselwerk")).slice(0, 300));
const l3 = await calc.listAiChecks(TG);
check("(5) de opdracht is afgesloten (overgenomen), het voorstel bij Voorstellen en acties aanvaard", l3[0].status === "afgesloten" && l3[0].reason === "overgenomen" && "accepted" in (await admin.botActions(false)).find((a) => a.id === BigInt(v1.data.actie)).state);
// Verouderd: een nieuwe opdracht, een voorstel, dan dient Lijster een nieuwe versie in.
const j2 = ok(await calc.startAiCheck(startIn()));
const v2 = await tool(anon, cid, conA.access, "voorstel_vergelijking", { opdracht: Number(j2), keuzes: [{ post: 1, offerte: A }], bevindingen: [], samenvatting: "kort", vertrouwen: 0.5 });
check("(5) een tweede opdracht krijgt een voorstel", !v2.isError, v2.text);
const QB2 = await reg(T1, ORB, `LY-${sfx}-v2`, [2400n, 1100n, 900n]);
const l4 = (await calc.listAiChecks(TG)).find((r) => r.id === j2);
check("(5) na een nieuwe offerte van Lijster: het voorstel staat als verouderd en wordt niet overgenomen", !!QB2.oaQuoteId && l4.stale && /nieuwe offerte/.test(errOf(await calc.applyTenderCheck(j2, [{ itemId: items1[0].id, oaQuoteId: [QA.oaQuoteId], reason: "" }], vId))), S(l4));
ok(await calc.finishAiCheck(j2, { cancelled: null }));
check("(5) annuleren: afgesloten, het voorstel geweigerd", (await calc.listAiChecks(TG)).find((r) => r.id === j2).status === "geannuleerd" && "rejected" in (await admin.botActions(false)).find((a) => a.id === BigInt(v2.data.actie)).state);

// ── (6) De Caffeine-weg (dossier) ───────────────────────────────────────
const wk = (await admin.listAiWorkers()).find((w) => w.key === "oa-offertes-vergelijken");
ok(await admin.saveAiWorker({ key: "oa-offertes-vergelijken", name: "Offertes vergelijken (proef)", route: { caffeine: null }, modelAlias: "auto", fallback: false, fallbackModel: [], budgetMonthCents: 2000n, maxCallCents: 50n, clientData: false, autonomy: { proposal: null }, instructionVersion: 1n, enabled: true, rev: wk.rev }));
await admin.refreshAiModels();
check("(6) Caffeine klaar voor de calculator (enkel ja/nee)", (await calc.aiCheckAiReady("vergelijking")) === true);
ok(await admin.setAiSettings([], [], [true]));
const jd = ok(await calc.startAiCheck(startIn({ way: { ai: null } })));
const sd = ok(await calc.runAiCheckAi(jd));
const rd = ok(await calc.readAiCheck(jd));
check("(6) testmodus: er vertrekt niets, het droge voorbeeld wordt een voorstel zonder keuze", sd.dry && sd.status === "voorstel" && rd.brief.verdict === "geen-keuze" && /droog/.test(rd.summary) && rd.dry, S(sd));
ok(await calc.finishAiCheck(jd, { cancelled: null }));
ok(await admin.setAiSettings([], [], [false]));
const ja = ok(await calc.startAiCheck(startIn({ way: { ai: null } })));
const sa = ok(await calc.runAiCheckAi(ja));
const ra = ok(await calc.readAiCheck(ja));
check("(6) via de (nep)dienst: het dossier kwam mee (prijsvraag in de bevinding); de onbruikbare keuze (isolatie bij Ekster) viel weg met een opmerking", !sa.dry && sa.status === "voorstel" && ra.picks.length === 2 && ra.findings.some((f) => f.kind === "voorbehoud" && f.text.includes("PV ")) && ra.findings.some((f) => f.kind === "ongeldige-keuze" && f.pos[0] === 3n), S(ra));
check("(6) een tweede keer kan niet", /al een voorstel/.test(errOf(await calc.runAiCheckAi(ja))));
const log = await admin.aiLog(0n, 20n);
check("(6) het AI-logboek heeft de oproep zonder inhoud", log.some((c) => c.workerKey === "oa-offertes-vergelijken") && !S(log).includes(`EK-${sfx}`) && !S(log).includes("Ekster"));
ok(await calc.finishAiCheck(ja, { seen: null }));

// ── (7) Proefbank ───────────────────────────────────────────────────────
// Historiek: 52 prijsvragen (op een eigen offerte) die de calculator afsloot met een keuze per post.
const QH = await mkQuote(W1, "Proef 3.9 historiek");
const HN = 52;
const truth = new Map();
for (let i = 0; i < HN; i += 4) {
  await Promise.all(Array.from({ length: Math.min(4, HN - i) }, async (_, k) => {
    const n = i + k;
    const T = await mkTender(QH, `Proef historiek ${n} 3.9 ${sfx}`);
    const a = await reg(T, ORA, `HA-${sfx}-${n}`, [2000n + BigInt(n), 1200n, n % 3 === 0 ? null : 950n]);
    const b = await reg(T, ORB, `HB-${sfx}-${n}`, [2100n, 1000n + BigInt(n), 900n]);
    const tv = ok(await calc.readTender(T));
    // De mens kiest: metselwerk bij Ekster, lateien en isolatie bij Lijster.
    const picks = [[0, a.oaQuoteId], [1, b.oaQuoteId], [2, b.oaQuoteId]];
    ok(await calc.saveTenderChoices(T, picks.map(([k, q]) => ({ itemId: tv.items[k].id, oaQuoteId: [q], reason: "proef 3.9" }))));
    ok(await calc.updateTender(T, ok(await calc.readTender(T)).rev, { close: [] }));
    truth.set(tv.code, picks.map(([k, q]) => [k + 1, Number(q)]));
  }));
}
const setId = ok(await admin.buildProofSet("offertes-vergelijken", `Proefset vergelijken ${sfx}`, 200n));
const cases = await admin.proofSetCases(setId);
check("(7) de set: de afgesloten prijsvragen met een keuze; nooit een lopende", cases.length >= HN && !cases.some((c) => c.ref === `prijsvraag:${T1}`), `${cases.length} gevallen`);
check("(7) het juiste antwoord = de keuze van de mens (post=offerte)", cases.every((c) => /^\d+=\d+(;\d+=\d+)*$/.test(c.answer.find(([k]) => k === "keuzes")?.[1] ?? "")));
check("(7) geen Caffeine-ronde voor deze taak", errOf(await admin.startProofRound(setId, { ai: "oa-offertes-vergelijken" })) !== "");
const r1 = ok(await admin.startProofRound(setId, { bot: idA }));
let leak = false;
let withDossier = true;
for (let loop = 0; loop < 12; loop++) {
  const g = await tool(anon, cid, conA.access, "proef_gevallen");
  const todo = g.data?.gevallen ?? [];
  if (todo.length === 0) break;
  if (/keuze|gekozen|prijsvraag:|https?:|!caf!/.test(S(todo.map((c) => c.invoer)))) leak = true;
  const ans = [];
  for (const c of todo) {
    const d = c.invoer.dossier;
    if (!d?.posten?.length || !d.offertes?.length) { withDossier = false; continue; }
    // Een "goede" bot: de keuze van de mens (uit de proefgegevens van deze test), één post anders bij elk vijfde geval (2/3 = 67 % → fout).
    const t = truth.get(d.prijsvraag);
    if (!t) continue;
    const keuzes = t.map(([post, offerte], k) => ({ post, offerte: c.geval % 5 === 0 && k === 0 ? (t[1][1]) : offerte }));
    ans.push({ geval: c.geval, keuzes });
  }
  for (let i = 0; i < ans.length; i += 25) await tool(anon, cid, conA.access, "proef_antwoorden", { antwoorden: ans.slice(i, i + 25) });
}
check("(7) een geval heeft het dossier, nooit de keuze of het id van de prijsvraag", !leak && withDossier);
const R1 = (await admin.listProofRounds()).find((r) => r.id === r1);
const expectWrong = BigInt([...Array(Number(R1.counted)).keys()].map((i) => i + 1).filter((g) => g % 5 === 0).length);
check("(7) de ronde: juist = ≥ 80 % van de posten gelijk; één afwijking op drie posten = fout", "closed" in R1.state && R1.counted >= 50n && R1.counted - R1.right === expectWrong, S(R1));
bA = (await admin.listBots()).find((b) => b.id === idA);
check("(7) ook na een ronde: geen Zelf doen voor offertes-vergelijken", errOf(await admin.saveBot(F({ id: [idA], rev: bA.rev, tasks: [["offertes-vergelijken", { auto: null }]] }))) !== "");

// ── (8) Logboek en audit zonder inhoud ──────────────────────────────────
const bl = await admin.botLog(0n, 300n);
check("(8) logboek: vergelijkopdrachten en voorstel_vergelijking met een controlegetal, zonder inhoud", ["vergelijkopdrachten", "voorstel_vergelijking"].every((t) => bl.some((c) => c.tool === t)) && !S(bl).includes(`EK-${sfx}`) && !S(bl).includes("Ekster"));
const au = await admin.auditLog(0n, 600n);
check("(8) audit zonder bedragen", au.filter((e) => /vergelijking/.test(e.action) || /vergelijking/.test(e.detail)).every((e) => !/€|2500|1234/.test(e.detail)));

ok(await admin.revokeBot(idA));
ok(await admin.revokeBot(idB));
console.log(`\nproef-3-9: ${pass} geslaagd, ${fail} mislukt`);
process.exit(fail ? 1 : 0);
