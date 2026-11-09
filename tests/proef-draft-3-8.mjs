// OA-offerte inlezen (3.8) op een DRAFT, via de ECHTE HTTP-gateway van het IC (https://<backend>.icp0.io/mcp), zoals Claude het doet:
// een proefwerf P-ORD-…, een verzonnen firma, een bot (wegwerp-identiteit) met de inleestools, koppelen, twee opdrachten (een kleine PDF
// en een grote van ± 1,3 MB: past het antwoord door de gateway?), inleesbestand als bijlage, voorstel_oa_offerte, het voorstel lezen,
// overnemen in een losse offerte, de Caffeine-weg in de testmodus (droog), intrekken. De proefwerf en een open opdracht met voorstel
// BLIJVEN staan voor de testlijst van de eigenaar (§7 van het verslag); de bot wordt ingetrokken. Enkel VERZONNEN gegevens.
//   node tests/proef-draft-3-8.mjs <backend-canister>
import { createHash, randomBytes } from "node:crypto";
import { backend, freshBackend, ok, weigerLive } from "../tools/lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/proef-draft-3-8.mjs <backend-canister>");
weigerLive(cid, "de inleesproef op de draft");
const base = process.env.MCP_BASE || `https://${cid}.icp0.io`;
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const S = (x) => JSON.stringify(x, big);
const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const sfx = Date.now().toString(36).slice(-4).toUpperCase();
const pdfBytes = (n, tag) => { const b = new Uint8Array(n); const h = new TextEncoder().encode(`%PDF-1.4 proef ${tag} `); b.set(h); for (let i = h.length; i < n; i++) b[i] = 32 + (i % 90); return b; };

const admin = await backend("proef-admin", cid);
const bot = await freshBackend(cid);
const addr = { street: "Proefstraat", number: "9", zip: "9999", city: "Proefdorp", country: "BE" };
const W = ok(await admin.createWork({ code: `P-ORD-${sfx}`, name: "Proefwerf inlezen draft", address: addr, parentId: [], clientOrgId: [], architectOrgId: [], leaderPersonId: [], vatBp: 2100n })).id;
const ORG = ok(await admin.createOrg({ kind: { subcontractor: null }, name: `Proef Bouw Wouw draft ${sfx}`, kbo: [], vat: [], aliases: [], trades: [], address: [], notes: "Verzonnen proeffirma (3.8 draft)" })).id;
check("(1) proefwerf en verzonnen firma", !!W && !!ORG);

const reg = await fetch(`${base}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: "Proef draft 3.8" }) });
const regJ = await reg.json().catch(() => ({}));
const id = ok(await admin.saveBot({ id: [], rev: 0n, name: `Proef bot inlezen draft ${sfx}`, vendor: "Anthropic", model: "Proefmodel", tools: ["mijn_fiche", "werven", "inleesopdrachten", "inleesbestand", "voorstel_oa_offerte"], allWorks: false, works: [W], docKinds: [], callsPerDay: 200n, tasks: [], instruction: ["routine v1"] }));
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

const small = pdfBytes(6000, "klein " + sfx);
const large = pdfBytes(1_300_000, "groot " + sfx);
const st = (content, name) => ({ workId: W, orgId: ORG, inviteId: [], way: { bot: id }, name, mime: "application/pdf", content, blob: [] });
const j1 = ok(await admin.startOaRead(st(small, `proef-offerte-${sfx}.pdf`)));
const j2 = ok(await admin.startOaRead(st(large, `proef-groot-${sfx}.pdf`)));
check("(3) twee opdrachten gegeven (6 kB en 1,3 MB)", !!j1 && !!j2);
const ops = await call("inleesopdrachten");
check("(3) inleesopdrachten via de gateway: beide opdrachten, zonder bedragen", ops.status === 200 && [j1, j2].every((j) => ops.json?.result?.structuredContent?.opdrachten?.some((o) => o.opdracht === Number(j))) && !/cents|bedrag|https?:\/\//i.test(JSON.stringify(ops.json?.result?.structuredContent)));
const f1 = await call("inleesbestand", { opdracht: Number(j1) });
const p1 = f1.json?.result?.content?.[1];
check("(4) inleesbestand (6 kB) als resource, byte voor byte gelijk", f1.status === 200 && p1?.type === "resource" && Buffer.from(p1.resource.blob, "base64").equals(Buffer.from(small)), `${f1.status} ${f1.size} tekens`);
const f2 = await call("inleesbestand", { opdracht: Number(j2) });
const p2 = f2.json?.result?.content?.[1];
check("(4) inleesbestand (1,3 MB) past door de gateway, byte voor byte gelijk", f2.status === 200 && p2?.type === "resource" && Buffer.from(p2.resource.blob, "base64").equals(Buffer.from(large)), `${f2.status} ${f2.size} tekens`);
const prop = { opdracht: Number(j1), nummer: `PRF-D-${sfx}`, datum: "2026-11-05", btwVerlegd: true, vorm: "posten", regels: [{ omschrijving: "Proef metselwerk", eenheid: "m2", hoeveelheid: 10, eenheidsprijsCent: 4500, inbegrepen: "ja", opmerking: "" }], totaalCent: 45000, opmerkingen: ["Verzonnen proefofferte"], vertrouwen: 0.8 };
const v1 = await call("voorstel_oa_offerte", prop);
check("(5) voorstel_oa_offerte: een voorstel (niets geregistreerd)", v1.json?.result?.structuredContent?.stand === "voorstel" && (await admin.listOaQuotes(W)).length === 0, JSON.stringify(v1.json?.result).slice(0, 200));
const full = ok(await admin.readOaRead(j1));
check("(5) readOaRead: het voorstel met nummer en regel", full.proposal[0]?.number === `PRF-D-${sfx}` && full.proposal[0].lines.length === 1);
const q = ok(await admin.applyOaRead(j1, { inviteId: [], workId: W, orgId: ORG, source: { hand: null }, sheetKey: "", number: full.proposal[0].number, quoteDay: full.proposal[0].quoteDay[0], validUntil: [], discountBp: [], reverse: true, prices: { lines: full.proposal[0].lines.map((l) => ({ itemId: [], description: l.description, unit: l.unit, qtyMilli: l.qtyMilli, unitCents: l.unitCents, included: l.included, remark: l.remark })) }, remark: "", note: "", file: [] }, 45_000n));
check("(6) overgenomen: geregistreerd, opdracht gesloten", (await admin.listOaReads(W)).find((r) => r.id === j1)?.status === "geregistreerd");
// De tweede opdracht blijft open met een voorstel voor de testlijst.
const v2 = await call("voorstel_oa_offerte", { ...prop, opdracht: Number(j2), nummer: `PRF-G-${sfx}` });
check("(6) tweede opdracht: voorstel klaar (blijft staan voor de testlijst)", v2.json?.result?.structuredContent?.stand === "voorstel");
// Caffeine-weg op de draft: testmodus, er vertrekt niets.
const ws = await admin.listAiWorkers();
const wk = ws.find((w) => w.key === "oa-offerte-inlezen");
if (wk && !wk.enabled) ok(await admin.saveAiWorker({ key: "oa-offerte-inlezen", name: wk.name || "OA-offerte inlezen", route: { caffeine: null }, modelAlias: wk.modelAlias || "auto", fallback: false, fallbackModel: [], budgetMonthCents: 500n, maxCallCents: 20n, clientData: false, autonomy: { proposal: null }, instructionVersion: 1n, enabled: true, rev: wk.rev }));
const ja = ok(await admin.startOaRead({ workId: W, orgId: ORG, inviteId: [], way: { ai: null }, name: "tekst", mime: "text/plain", content: new TextEncoder().encode(`Verzonnen offerte nr NEP-${sfx}, totaal 1.000,00`), blob: [] }));
const ra = await admin.runOaReadAi(ja);
check("(7) Caffeine-weg op de draft: testmodus (droog), er vertrekt niets", "ok" in ra && ra.ok.dry === true, S(ra));
ok(await admin.finishOaRead(ja, { cancelled: null }));
ok(await admin.revokeBot(id));
const after = await call("inleesopdrachten");
check("(8) na intrekken: de bot kan niets meer", after.status === 401 || after.json?.result?.isError === true || !!after.json?.error, String(after.status));
console.log(`\nproef-draft-3-8: ${pass} geslaagd, ${fail} mislukt (proefwerf P-ORD-${sfx})`);
process.exit(fail ? 1 : 0);
