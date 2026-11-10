// OA-offertes vergelijken (3.9) en offerte nalezen (3.11) op een DRAFT, via de ECHTE HTTP-gateway van het IC
// (https://<backend>.icp0.io/mcp), zoals Claude het doet: een proefwerf P-VGD-…, twee verzonnen firma's, een offerte met 3 posten,
// een prijsvraag met twee offertes, een bot (wegwerp-identiteit) met de vier nakijktools, koppelen, vergelijkopdrachten met het dossier,
// voorstel_vergelijking, het resultaat lezen, één klik overnemen in de ontwerpversie, naleesopdrachten + opmerkingen_offerte, de
// Caffeine-weg in de testmodus (droog), intrekken. De proefwerf met een open voorstel (vergelijking) en open opmerkingen (nalezen)
// BLIJFT staan voor de testlijst van de eigenaar (§7 van het verslag). Enkel VERZONNEN gegevens.
//   node tests/proef-draft-3-9.mjs <backend-canister>
import { createHash, randomBytes } from "node:crypto";
import { backend, freshBackend, ok, weigerLive } from "../tools/lib.mjs";
import { M, saveAll, fromRead } from "./offerte-lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/proef-draft-3-9.mjs <backend-canister>");
weigerLive(cid, "de nakijkproef op de draft");
const base = process.env.MCP_BASE || `https://${cid}.icp0.io`;
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const S = (x) => JSON.stringify(x, big);
const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const sfx = Date.now().toString(36).slice(-4).toUpperCase();
const today = BigInt(Math.floor(Date.now() / 86_400_000));
const Y = { yes: null };

const admin = await backend("proef-admin", cid);
const bot = await freshBackend(cid);
const addr = { street: "Proefstraat", number: "39", zip: "9999", city: "Proefdorp", country: "BE" };
const KL = ok(await admin.createOrg({ kind: { client: null }, name: `Proef Klant Gaai draft ${sfx}`, kbo: [], vat: [], aliases: [], trades: [], address: [addr], notes: "Verzonnen proefklant (3.9 draft)" })).id;
const W = ok(await admin.createWork({ code: `P-VGD-${sfx}`, name: "Proefwerf vergelijken en nalezen draft", address: addr, parentId: [], clientOrgId: [KL], architectOrgId: [], leaderPersonId: [], vatBp: 600n })).id;
const orgOf = async (name) => ok(await admin.createOrg({ kind: { subcontractor: null }, name, kbo: [], vat: [], aliases: [], trades: [], address: [], notes: "Verzonnen proeffirma (3.9 draft)" })).id;
const ORA = await orgOf(`Proef Bouw Ekster draft ${sfx}`);
const ORB = await orgOf(`Proef Bouw Lijster draft ${sfx}`);
const q = ok(await admin.createQuote({ workId: W, number: "", title: "Proef 3.9 draft offerte" }));
{
  const m = fromRead(ok(await admin.readQuoteVersion(q.versionId)));
  const c1 = M.addChapter(m, { code: "07", title: "Proef ruwbouw" });
  M.addLine(m, c1.key, { title: "Proef metselwerk", qtyMilli: 20_000n, unit: "m2", form: "vh", price: M.emptyPrice() });
  M.addLine(m, c1.key, { title: "Proef lateien", qtyMilli: 4_000n, unit: "st", form: "vh", price: M.emptyPrice() });
  M.addLine(m, c1.key, { title: "Proef isolatie", qtyMilli: 20_000n, unit: "m2", form: "vh", price: M.emptyPrice() });
  const r = await saveAll(admin, m);
  if (r && "err" in r) throw new Error(r.err);
}
const rd = ok(await admin.readQuoteVersion(q.versionId));
const posts = rd.lines.filter((l) => !("text" in l.kind));
const T = ok(await admin.createTender({ versionId: q.versionId, lineIds: posts.map((l) => l.id), title: `Proef ruwbouw draft ${sfx}`, noteForOa: "", internalNote: "", deadlineDay: today + 10n, remindDays: 0n, fileIds: [], addressMode: { city: null }, firms: [ORA, ORB].map((o) => ({ orgId: o, contactPersonId: [] })) }));
const rnd = (u, x) => (u * x + 500n) / 1000n;
async function reg(orgId, number, prices) {
  const tv = ok(await admin.readTender(T));
  const inv = tv.invites.find((i) => i.orgId === orgId);
  const lines = tv.items.map((x, k) => ({ itemId: [x.id], description: x.title, unit: x.unit, qtyMilli: x.qtyMilli, unitCents: prices[k] === null ? [] : [prices[k]], included: prices[k] === null ? { no: null } : Y, remark: prices[k] === null ? "Niet inbegrepen (verzonnen voorbehoud)" : "" }));
  const net = tv.items.reduce((s, x, k) => s + (prices[k] === null ? 0n : rnd(prices[k], x.qtyMilli)), 0n);
  return ok(await admin.registerOaQuote({ inviteId: [inv.id], workId: W, orgId, source: { hand: null }, sheetKey: "", number, quoteDay: today, validUntil: [today + 30n], discountBp: [], reverse: true, prices: { lines }, remark: "", note: "", file: [] }, net));
}
const QA = await reg(ORA, `EKD-${sfx}`, [2500n, 1234n, null]);
const QB = await reg(ORB, `LYD-${sfx}`, [2700n, 1100n, 900n]);
check("(1) proefwerf, offerte met 3 posten, prijsvraag met twee verzonnen offertes", !!QA.oaQuoteId && !!QB.oaQuoteId);

const regC = await fetch(`${base}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: "Proef draft 3.9" }) });
const regJ = await regC.json().catch(() => ({}));
const id = ok(await admin.saveBot({ id: [], rev: 0n, name: `Proef bot nakijken draft ${sfx}`, vendor: "Anthropic", model: "Proefmodel", tools: ["mijn_fiche", "werven", "vergelijkopdrachten", "voorstel_vergelijking", "naleesopdrachten", "opmerkingen_offerte"], allWorks: false, works: [W], docKinds: [], callsPerDay: 200n, tasks: [], instruction: ["proef draft 3.9"] }));
ok(await bot.claimBotCode(ok(await admin.newBotCode(id)).code));
const verifier = b64url(randomBytes(32));
const challenge = b64url(createHash("sha256").update(verifier).digest());
const code = ok(await bot._caffeineMcpApprove({ clientId: regJ.client_id, redirectUri: REDIRECT, codeChallenge: challenge, codeChallengeMethod: "S256" }));
const tok = await fetch(`${base}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: REDIRECT, client_id: regJ.client_id }).toString() });
const tokJ = await tok.json().catch(() => ({}));
check("(2) bot gekoppeld via de gateway", tok.status === 200 && !!tokJ.access_token, String(tok.status));
let rid = 1;
const call = async (name, args = {}) => {
  const r = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tokJ.access_token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: rid++, method: "tools/call", params: { name, arguments: args } }) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: r.status, json, size: text.length };
};

// 3.9
const j1 = ok(await admin.startAiCheck({ target: { tender: T }, way: { bot: id } }));
const ops = await call("vergelijkopdrachten");
const o1 = ops.json?.result?.structuredContent?.opdrachten?.find((o) => o.opdracht === Number(j1));
check("(3) vergelijkopdrachten via de gateway: het dossier met 3 posten en 2 offertes, geen URL, geen verkoopprijs", ops.status === 200 && o1?.dossier?.posten?.length === 3 && o1.dossier.offertes?.length === 2 && !/https?:\/\/|verkoop|marge/i.test(JSON.stringify(o1)), `${ops.status} ${ops.size}`);
const A = Number(QA.oaQuoteId), B = Number(QB.oaQuoteId);
const prop = { opdracht: Number(j1), keuzes: [{ post: 1, offerte: A, reden: "laagste (proef)" }, { post: 2, offerte: B, reden: "laagste (proef)" }, { post: 3, offerte: B, reden: "enkel Lijster (proef)" }], bevindingen: [{ soort: "voorbehoud", ernst: "let_op", tekst: "Ekster: isolatie niet inbegrepen (verzonnen proef).", post: 3 }], samenvatting: "Verzonnen proefvergelijking.", vertrouwen: 0.7 };
const v1 = await call("voorstel_vergelijking", prop);
check("(4) voorstel_vergelijking: een voorstel; de keuze van de prijsvraag blijft leeg", v1.json?.result?.structuredContent?.stand === "voorstel" && ok(await admin.compareTender(T)).choices.length === 0, JSON.stringify(v1.json?.result).slice(0, 200));
const full = ok(await admin.readAiCheck(j1));
check("(4) readAiCheck: 3 keuzes en 1 bevinding", full.picks.length === 3 && full.findings.length === 1);
const ap = ok(await admin.applyTenderCheck(j1, full.picks.map((p) => ({ itemId: p.itemId, oaQuoteId: p.oaQuoteId, reason: p.reason })), q.versionId));
check("(5) één klik: 3 posten in de ontwerpversie, de keuze staat, de opdracht is afgesloten", ap.lines === 3n && ok(await admin.compareTender(T)).choices.length === 3 && (await admin.listAiChecks({ tender: T }))[0]?.reason === "overgenomen", S(ap));
// Een tweede opdracht met voorstel BLIJFT open voor de testlijst.
const j2 = ok(await admin.startAiCheck({ target: { tender: T }, way: { bot: id } }));
await call("vergelijkopdrachten"); // 3.12: een voorstel draagt de stand van het dossier dat de bot kreeg (eerst ophalen)
const v2 = await call("voorstel_vergelijking", { ...prop, opdracht: Number(j2), keuzes: [{ post: 1, offerte: B, reden: "volledige offerte (proef)" }, { post: 2, offerte: B, reden: "laagste (proef)" }, { post: 3, offerte: B, reden: "enkel Lijster (proef)" }] });
check("(5) tweede opdracht: voorstel klaar (blijft staan)", v2.json?.result?.structuredContent?.stand === "voorstel");

// 3.11
const j3 = ok(await admin.startAiCheck({ target: { quote: q.versionId }, way: { bot: id } }));
const nl = await call("naleesopdrachten");
const n1 = nl.json?.result?.structuredContent?.opdrachten?.find((o) => o.opdracht === Number(j3));
check("(6) naleesopdrachten via de gateway: posten met aankoop en verkoop, totalen", nl.status === 200 && n1?.dossier?.posten?.length === 3 && typeof n1.dossier.totalen?.totaalCent === "number" && n1.dossier.posten.some((p) => typeof p.aankoopCent === "number"), `${nl.status}`);
const v3 = await call("opmerkingen_offerte", { opdracht: Number(j3), oordeel: "opmerkingen", opmerkingen: [{ soort: "vergeten-post", ernst: "info", tekst: "Geen post voor afvoer van puin (verzonnen proef)." }, { soort: "eenheidsprijs", ernst: "let_op", tekst: "Metselwerk: kijk de marge na (verzonnen proef).", post: 1 }], samenvatting: "Verzonnen proefopmerkingen.", vertrouwen: 0.6 });
check("(6) opmerkingen_offerte: voorstel; de versie blijft een ontwerp (blijft staan voor de testlijst)", v3.json?.result?.structuredContent?.stand === "voorstel" && "draft" in ok(await admin.readQuoteVersion(q.versionId)).version.status);

// Caffeine-weg: testmodus, er vertrekt niets.
for (const key of ["oa-offertes-vergelijken", "offerte-review"]) {
  const wk = (await admin.listAiWorkers()).find((w) => w.key === key);
  if (wk && !wk.enabled) ok(await admin.saveAiWorker({ key, name: wk.name || key, route: { caffeine: null }, modelAlias: wk.modelAlias || "auto", fallback: false, fallbackModel: [], budgetMonthCents: 500n, maxCallCents: 20n, clientData: false, autonomy: { proposal: null }, instructionVersion: 1n, enabled: true, rev: wk.rev }));
}
const ja = ok(await admin.startAiCheck({ target: { tender: T }, way: { ai: null } }));
const ra = await admin.runAiCheckAi(ja);
const jb = ok(await admin.startAiCheck({ target: { quote: q.versionId }, way: { ai: null } }));
const rb = await admin.runAiCheckAi(jb);
check("(7) Caffeine-weg op de draft (vergelijken en nalezen): testmodus (droog), er vertrekt niets", "ok" in ra && ra.ok.dry === true && "ok" in rb && rb.ok.dry === true, S([ra, rb]));
ok(await admin.finishAiCheck(ja, { cancelled: null }));
ok(await admin.finishAiCheck(jb, { cancelled: null }));
// 3.12 (review M3): de bot intrekken sluit nu ook zijn open opdrachten en voorstellen. Het voorstel moet hier blijven staan voor de
// testlijst van de eigenaar: daarom enkel de KOPPELING intrekken (het token is dood, de bot en zijn voorstel blijven).
for (const c of await admin.botConnections(id)) ok(await admin.revokeBotConnection(id, c.id));
const after = await call("vergelijkopdrachten");
check("(8) na het intrekken van de koppeling: de bot kan niets meer (401)", after.status === 401, String(after.status));
console.log(`\nproef-draft-3-9: ${pass} geslaagd, ${fail} mislukt (proefwerf P-VGD-${sfx})`);
process.exit(fail ? 1 : 0);
