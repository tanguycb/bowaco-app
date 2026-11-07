// Nep-inferentiedienst voor het EIGEN lokale testnet (stap 3.1, nooit in de app, nooit op een draft): speelt
// inference.caffeine.ai na (OpenAI-vorm: GET /v1/models, POST /v1/chat/completions, met `usage`). De lokale canister krijgt
// CAFFEINE_INFERENCE_URL = http://127.0.0.1:<poort> en een wegwerpsleutel (CAFFEINE_INFERENCE_API_KEY) via de beheercanister,
// zoals Caffeine dat op een echte canister doet. Geen netwerk naar buiten, geen echte gegevens.
//   node tests/net/nepinferentie.mjs <poort> <sleutel>
// Bediening (enkel 127.0.0.1): POST /nep/modus { modus, n } zet de volgende n antwoorden op een foutklasse:
//   "" (gewoon) · "429-rate" (rate_limit_exceeded) · "429-cap" (cap_month) · "503" · "500" · "400-model" (model_not_found) ·
//   "ongeldig" (inhoud geen JSON) · "weiger" (refusal) · "groot" (antwoord > 10 kB) · "traag" (gewoon antwoord na 4 s)
// GET /nep/log → de oproepen (pad, model, sleutel juist, grootte, met schema), zonder de inhoud. POST /nep/wis → log leeg.
import { createServer } from "node:http";

const port = Number(process.argv[2] || 18471);
const key = process.argv[3] || process.env.NEP_SLEUTEL || "";
if (!key) throw new Error("gebruik: node tests/net/nepinferentie.mjs <poort> <sleutel>");
let modus = "";
let n = 0;
const log = [];
const send = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
const err = (res, code, type, codeText, msg) => send(res, code, { error: { message: msg, type, code: codeText, param: codeText === "model_not_found" ? "model" : null } });
const models = [
  { id: "auto", object: "model", owned_by: "caffeine", pricing: { prompt: "0.0000010000", completion: "0.0000020000", input_cache_read: "0.0000001000", input_cache_write: "0.0000012500" } },
  { id: "nep-groot", object: "model", owned_by: "caffeine", pricing: { prompt: "0.0000030000", completion: "0.0000150000", input_cache_read: "0.0000003000", input_cache_write: "0.0000037500" } },
];

createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/nep/modus" && req.method === "POST") { const x = JSON.parse(body || "{}"); modus = x.modus || ""; n = x.n ?? 1; return send(res, 200, { modus, n }); }
    if (url.pathname === "/nep/log") return send(res, 200, log);
    if (url.pathname === "/nep/wis" && req.method === "POST") { log.length = 0; return send(res, 200, { ok: true }); }
    const authOk = req.headers.authorization === `Bearer ${key}`;
    let parsed = null;
    try { parsed = body ? JSON.parse(body) : null; } catch {}
    log.push({ path: url.pathname, method: req.method, model: parsed?.model ?? null, authOk, bytes: body.length, schema: !!parsed?.response_format?.json_schema, strict: parsed?.response_format?.json_schema?.strict === true, temperature: parsed?.temperature ?? null, maxTokens: parsed?.max_completion_tokens ?? null, at: Date.now() });
    if (!authOk) return err(res, 401, "invalid_request_error", "invalid_api_key", "bad key");
    if (url.pathname === "/v1/models" && req.method === "GET") return send(res, 200, { object: "list", data: models });
    if (url.pathname !== "/v1/chat/completions" || req.method !== "POST") return err(res, 404, "invalid_request_error", "not_found", "no route");
    const m = n > 0 ? modus : "";
    if (n > 0) n--;
    if (m === "429-rate") return err(res, 429, "rate_limit_error", "rate_limit_exceeded", "slow down");
    if (m === "429-cap") return err(res, 429, "insufficient_quota", "cap_month", "cap reached for proef@nep.invalid");
    if (m === "503") return err(res, 503, "server_error", "authz_unavailable", "retry");
    if (m === "500") return err(res, 500, "server_error", "internal", "boom");
    if (m === "400-model") return err(res, 400, "invalid_request_error", "model_not_found", "unknown model");
    const usage = { prompt_tokens: 20000, completion_tokens: 10000, total_tokens: 30000, prompt_tokens_details: { cached_tokens: 0 } };
    let content = JSON.stringify({ werf: "W-901", documentsoort: "offerte-oa", firma: "Firma Voorbeeld bv", bedragCent: 123400, vertrouwen: 0.9 });
    if (parsed?.response_format?.json_schema?.name === "stub") content = JSON.stringify({ samenvatting: "nep" });
    if (m === "ongeldig") content = "dit is geen json";
    if (m === "groot") content = JSON.stringify({ werf: "W-901", documentsoort: "andere", firma: null, bedragCent: null, vertrouwen: 0.1, opvulling: "x".repeat(12000) });
    const message = m === "weiger" ? { role: "assistant", content: null, refusal: "nee" } : { role: "assistant", content };
    const answer = () => send(res, 200, { id: "chatcmpl-nep", object: "chat.completion", created: Math.floor(Date.now() / 1000), model: parsed?.model ?? "auto", choices: [{ index: 0, message, finish_reason: "stop" }], usage });
    if (m === "traag") setTimeout(answer, 4000); else answer();
  });
}).listen(port, "127.0.0.1", () => console.log(`nep-inferentie op 127.0.0.1:${port}`));
