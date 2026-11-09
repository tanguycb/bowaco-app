// Proefbank (3.5) op een DRAFT, via de ECHTE HTTP-gateway van het IC (https://<backend>.icp0.io), zoals Claude het doet:
// verzonnen historiek op twee proefwerven (P-PBD-…: 60 bestanden die de testbeheerder aan documenten hangt), een testset, een bot
// (wegwerp-identiteit), koppelen, een proefronde met de proeftools, de score, Zelf doen pas daarna, intrekken. De proefwerven en de
// set BLIJVEN staan voor de testlijst van de eigenaar (§7 van het verslag); de bot wordt ingetrokken. Enkel VERZONNEN gegevens.
//   node tests/proef-draft.mjs <backend-canister>
import { createHash, randomBytes } from "node:crypto";
import { backend, freshBackend, ok, weigerLive } from "../tools/lib.mjs";
import { makeHistory } from "./proef-lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/proef-draft.mjs <backend-canister>");
weigerLive(cid, "de proefbank-draftproef");
const base = process.env.MCP_BASE || `https://${cid}.icp0.io`;
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const S = (x) => JSON.stringify(x, big);
const errOf = (r) => (r && typeof r === "object" && "err" in r ? r.err : "");
const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const sfx = Date.now().toString(36).slice(-4).toUpperCase();

const admin = await backend("proef-admin", cid);
const bot = await freshBackend(cid);
const addr = { street: "Proefstraat", number: "7", zip: "9999", city: "Proefdorp", country: "BE" };
const mk = async (code, name) => ok(await admin.createWork({ code, name, address: addr, parentId: [], clientOrgId: [], architectOrgId: [], leaderPersonId: [], vatBp: 2100n })).id;
const C1 = `P-PBD-${sfx}-1`, C2 = `P-PBD-${sfx}-2`;
const W1 = await mk(C1, "Proefwerf proefbank draft 1");
const W2 = await mk(C2, "Proefwerf proefbank draft 2");
const KINDS = ["plannen", "plaatsbeschrijving", "verzekering"];
const t0 = Date.now();
const hist = await makeHistory(admin, [{ id: W1, code: C1 }, { id: W2, code: C2 }], KINDS, 60, sfx);
check("(1) historiek: 60 verzonnen bestanden aan documenten op twee proefwerven", hist.filter(Boolean).length === 60, `${Math.round((Date.now() - t0) / 1000)} s`);
const setId = ok(await admin.buildProofSet("document-koppelen", `Proefset draft ${sfx}`, 200n));
const set = (await admin.listProofSets()).find((s) => s.id === setId);
check("(1) testset uit de historiek", set && set.cases >= 60n, S(set));

// Bot en koppeling via de gateway.
const reg = await fetch(`${base}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: "Proef draft 3.5" }) });
const regJ = await reg.json().catch(() => ({}));
const F = (o = {}) => ({ id: [], rev: 0n, name: `Proef bot proefbank ${sfx}`, vendor: "Anthropic", model: "Proefmodel", tools: ["mijn_fiche", "werven", "werf_documenten", "document_koppelen"], allWorks: false, works: [W1, W2], docKinds: KINDS, callsPerDay: 200n, tasks: [], instruction: ["routine v1"], ...o });
const id = ok(await admin.saveBot(F()));
ok(await bot.claimBotCode(ok(await admin.newBotCode(id)).code));
const verifier = b64url(randomBytes(32));
const challenge = b64url(createHash("sha256").update(verifier).digest());
const code = ok(await bot._caffeineMcpApprove({ clientId: regJ.client_id, redirectUri: REDIRECT, codeChallenge: challenge, codeChallengeMethod: "S256" }));
const tok = await fetch(`${base}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: REDIRECT, client_id: regJ.client_id }).toString() });
const tokJ = await tok.json().catch(() => ({}));
check("(2) bot gekoppeld via de gateway", tok.status === 200 && !!tokJ.access_token, String(tok.status));
const call = async (name, args = {}) => {
  const r = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tokJ.access_token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: Math.floor(Math.random() * 1e6), method: "tools/call", params: { name, arguments: args } }) });
  const j = await r.json().catch(() => null);
  return { status: r.status, isError: !!j?.error || j?.result?.isError === true, data: j?.result?.structuredContent ?? null, text: j?.result?.content?.[0]?.text ?? JSON.stringify(j?.error ?? "") };
};
check("(2) Zelf doen zonder proefronde: geweigerd", errOf(await admin.saveBot(F({ id: [id], rev: (await admin.listBots()).find((b) => b.id === id).rev, tasks: [["document-koppelen", { auto: null }]] }))).includes("proefronde"));

// Proefronde.
const rid = ok(await admin.startProofRound(setId, { bot: id }));
const round0 = (await admin.listProofRounds()).find((r) => r.id === rid);
const docsBefore = S((await admin.getDossier(W1)).documents.length) + S((await admin.getDossier(W2)).documents.length);
const byName = new Map(hist.map((h) => [h.name, h]));
let loops = 0, answered = 0, sawSecret = false;
for (; loops < 20; loops++) {
  const g = await call("proef_gevallen");
  if (g.isError) break;
  const todo = g.data?.gevallen ?? [];
  if (todo.length === 0) break;
  if (/bestandId|werfId|soort/.test(S(todo))) sawSecret = true;
  const ans = todo.map((c) => { const h = byName.get(c.invoer.bestand.naam); return { geval: c.geval, werfId: h ? Number(h.workId) : 0, soort: h ? h.kind : "onbekend" }; });
  for (let i = 0; i < ans.length; i += 25) { const r = await call("proef_antwoorden", { antwoorden: ans.slice(i, i + 25) }); if (!r.isError) answered += r.data.ontvangen; }
}
const round = (await admin.listProofRounds()).find((r) => r.id === rid);
check("(3) proefronde via de gateway: alle gevallen beantwoord, nooit id/werf/soort in een geval", round.answered === round0.cases && !sawSecret, S({ answered, cases: round0.cases, loops }));
check("(3) vanzelf gesloten, geslaagd (alles juist)", "closed" in round.state && round.passed && round.right === round.counted, S(round));
check("(3) niets uitgevoerd (geen document erbij)", docsBefore === S((await admin.getDossier(W1)).documents.length) + S((await admin.getDossier(W2)).documents.length));
const bv = (await admin.listBots()).find((b) => b.id === id);
const saved = await admin.saveBot(F({ id: [id], rev: bv.rev, tasks: [["document-koppelen", { auto: null }]] }));
check("(4) na de geslaagde ronde: Zelf doen bewaard", "ok" in saved, errOf(saved));
ok(await admin.revokeBot(id));
check("(4) bot ingetrokken: 401 op /mcp", (await call("mijn_fiche")).status === 401);
console.log(`· proefwerven ${C1} en ${C2} en de set "Proefset draft ${sfx}" blijven staan voor de testlijst van de eigenaar`);
console.log(`\n${pass} ✓ / ${fail} ✗`);
process.exit(fail ? 1 : 0);
