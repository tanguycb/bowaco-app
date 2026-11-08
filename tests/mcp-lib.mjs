// Hulp voor de proeven van de MCP-server (stap 3.4 + 3.13): een MCP-klant zoals Claude, maar rechtstreeks via http_request_update
// (dezelfde ingang die de HTTP-gateway van het IC na Http.upgrade() gebruikt). Registreren (/register), goedkeuren als de bot
// (_caffeineMcpApprove, PKCE S256), token (/token), daarna JSON-RPC op /mcp. Enkel VERZONNEN gegevens.
import { createHash, randomBytes } from "node:crypto";

export const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function req(cid, method, path, body = "", headers = []) {
  return {
    method,
    url: path,
    headers: [["host", `${cid}.icp0.io`], ...headers],
    body: new TextEncoder().encode(body),
    certificate_version: [],
  };
}

export async function http(actor, cid, method, path, body = "", headers = []) {
  const r = await actor.http_request_update(req(cid, method, path, body, headers));
  const text = new TextDecoder().decode(Uint8Array.from(r.body));
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: Number(r.status_code), headers: r.headers, text, json };
}

// Een klant registreren (zoals Claude bij "Connector toevoegen").
export async function register(anon, cid, name = "Proefklant 3.13") {
  const r = await http(anon, cid, "POST", "/register", JSON.stringify({ redirect_uris: [REDIRECT], client_name: name }), [["content-type", "application/json"]]);
  if (r.status !== 201) throw new Error(`register ${r.status}: ${r.text}`);
  return r.json.client_id;
}

export function pkce() {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

// Volledige koppeling: registreren, goedkeuren als `botActor`, code inwisselen. Geeft het access- en refresh-token.
export async function connect(anon, botActor, cid, name) {
  const clientId = await register(anon, cid, name);
  const { verifier, challenge } = pkce();
  const ap = await botActor._caffeineMcpApprove({ clientId, redirectUri: REDIRECT, codeChallenge: challenge, codeChallengeMethod: "S256" });
  if (!("ok" in ap)) return { err: ap.err, clientId };
  const form = new URLSearchParams({ grant_type: "authorization_code", code: ap.ok, code_verifier: verifier, redirect_uri: REDIRECT, client_id: clientId }).toString();
  const t = await http(anon, cid, "POST", "/token", form, [["content-type", "application/x-www-form-urlencoded"]]);
  if (t.status !== 200) return { err: `token ${t.status}: ${t.text}`, clientId };
  return { clientId, access: t.json.access_token, refresh: t.json.refresh_token, verifier, challenge };
}

let rpcId = 1;
export async function rpc(anon, cid, token, method, params = {}) {
  const headers = [["content-type", "application/json"], ...(token ? [["authorization", `Bearer ${token}`]] : [])];
  return http(anon, cid, "POST", "/mcp", JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params }), headers);
}

// tools/call → { isError, data (structuredContent of de tekst), text }
export async function tool(anon, cid, token, name, args = {}) {
  const r = await rpc(anon, cid, token, "tools/call", { name, arguments: args });
  const res = r.json?.result;
  if (!res) return { isError: true, rpcError: r.json?.error?.message ?? r.text, status: r.status, text: r.text };
  const text = res.content?.[0]?.text ?? "";
  return { isError: !!res.isError, data: res.structuredContent ?? null, text, status: r.status };
}

// Woorden die NOOIT in een antwoord van een bot mogen staan (bedragen, prijzen, opslag-URL's, vertrouwelijk).
export const FORBIDDEN = /cents|amount|bedrag|prijs|price|marge|margin|!caf!|https?:\/\/|blob|vertrouwelijk|confidential|contract/i;
