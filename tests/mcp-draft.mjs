// Bots via MCP (3.4 + 3.13) op een DRAFT, via de ECHTE HTTP-gateway van het IC (https://<backend>.icp0.io): de weg die Claude of Grok
// neemt. Http.upgrade() op de query-weg, /register, goedkeuren als de bot (Candid), /token, tools/list, een lees-tool, een weigering
// buiten de fiche, intrekken. Enkel VERZONNEN gegevens (P-MCPD-…, Proef bot draft); de bot wordt op het einde ingetrokken.
//   node tests/mcp-draft.mjs <backend-canister>
import { createHash, randomBytes } from "node:crypto";
import { backend, freshBackend, ok, weigerLive } from "../tools/lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/mcp-draft.mjs <backend-canister>");
weigerLive(cid, "de MCP-draftproef");
const base = process.env.MCP_BASE || `https://${cid}.icp0.io`;
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const sfx = Date.now().toString(36).slice(-5).toUpperCase();

const admin = await backend("proef-admin", cid);
const bot = await freshBackend(cid);
const addr = { street: "Proefstraat", number: "1", zip: "9999", city: "Proefdorp", country: "BE" };
const W = ok(await admin.createWork({ code: `P-MCPD-${sfx}`, name: "Proefwerf bot draft", address: addr, parentId: [], clientOrgId: [], architectOrgId: [], leaderPersonId: [], vatBp: 2100n })).id;
const origin0 = (await admin._caffeineMcpSignInOrigin())[0];
if (!origin0) console.log("· inlogpagina nog niet ingesteld: de proef zet de draft-URL niet zelf; zet ze in Beheer → AI-medewerkers → Bots");

const meta = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);
check("(1) /.well-known/oauth-protected-resource via de gateway: 200", meta.status === 200, String(meta.status));
const no = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
check("(1) /mcp zonder token: 401 met www-authenticate", no.status === 401 && (no.headers.get("www-authenticate") ?? "").includes("resource_metadata"), String(no.status));
const reg = await fetch(`${base}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: "Proef draft 3.13" }) });
const regJ = await reg.json().catch(() => ({}));
check("(2) /register via de gateway: 201 + client_id", reg.status === 201 && !!regJ.client_id, String(reg.status));

const id = ok(await admin.saveBot({ id: [], rev: 0n, name: `Proef bot draft ${sfx}`, vendor: "Proef", model: "", tools: ["mijn_fiche", "werven", "werf_documenten"], allWorks: false, works: [W], docKinds: ["plannen"], callsPerDay: 50n, tasks: [] }));
ok(await bot.claimBotCode(ok(await admin.newBotCode(id)).code));
const verifier = b64url(randomBytes(32));
const challenge = b64url(createHash("sha256").update(verifier).digest());
const code = ok(await bot._caffeineMcpApprove({ clientId: regJ.client_id, redirectUri: REDIRECT, codeChallenge: challenge, codeChallengeMethod: "S256" }));
const tok = await fetch(`${base}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: REDIRECT, client_id: regJ.client_id }).toString() });
const tokJ = await tok.json().catch(() => ({}));
check("(2) /token via de gateway: access- en refresh-token", tok.status === 200 && !!tokJ.access_token && !!tokJ.refresh_token, String(tok.status));
const call = async (method, params = {}) => {
  const r = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tokJ.access_token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: Math.floor(Math.random() * 1e6), method, params }) });
  return { status: r.status, j: await r.json().catch(() => null) };
};
const t0 = Date.now();
const tl = await call("tools/list");
check("(3) tools/list via de gateway: de 3 tools van de fiche", tl.status === 200 && tl.j?.result?.tools?.length === 3, `${Date.now() - t0} ms`);
const ws = await call("tools/call", { name: "werven", arguments: {} });
check("(3) werven: enkel de proefwerf", ws.j?.result?.structuredContent?.werven?.length === 1 && ws.j.result.structuredContent.werven[0].id === Number(W));
const out = await call("tools/call", { name: "oa_facturen", arguments: { werfId: Number(W) } });
check("(3) een tool buiten de fiche: fout", !!out.j?.error || out.j?.result?.isError === true);
ok(await admin.revokeBot(id));
check("(4) na intrekken: 401", (await call("tools/list")).status === 401);
console.log(`\n${pass} ✓ / ${fail} ✗`);
process.exit(fail ? 1 : 0);
