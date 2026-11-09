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
    // 3.5: de proefbank (document koppelen). De nep kiest de werf waarvan de code in de bestandsnaam staat en de soort waarvan de sleutel
    // erin staat (een proefbestand heet bv. "pb-ABC12-P-PB-ABC12-1-plannen-3.pdf"); zonder treffer: werf 0 en soort "onbekend".
    if (parsed?.response_format?.json_schema?.name === "document_koppelen_v1") {
      const u = String(parsed?.messages?.find((x) => x.role === "user")?.content ?? "");
      const doc = (u.split("<<<DOCUMENT")[1] ?? "").split("DOCUMENT>>>")[0] ?? "";
      const naam = (doc.match(/"naam":"([^"]*)"/) ?? [])[1] ?? "";
      const lines = u.split("\n");
      const werven = lines.filter((l) => /^\d+ · /.test(l)).map((l) => { const [id, code] = l.split(" · "); return { id: Number(id), code }; }).sort((a, b) => b.code.length - a.code.length);
      const soorten = lines.filter((l) => /^[a-z0-9-]+ · /.test(l) && !/^\d+ · /.test(l)).map((l) => l.split(" · ")[0]).sort((a, b) => b.length - a.length);
      const w = werven.find((x) => naam.includes(x.code));
      const k = soorten.find((x) => naam.includes("-" + x + "-"));
      content = JSON.stringify({ werfId: w ? w.id : 0, soort: k ?? "onbekend", vertrouwen: w && k ? 0.9 : 0.1 });
    }
    // 3.8: OA-offerte inlezen uit tekst. De nep leest "nr <nummer>", een datum jjjj-mm-dd en "totaal <euro>" uit het blok, en geeft
    // per post van de prijsvraag (regels "<id> · …" vóór het blok) een eenheidsprijs van € 10,00 plus één eigen regel.
    if (parsed?.response_format?.json_schema?.name === "oa_offerte_inlezen_v1") {
      const u = String(parsed?.messages?.find((x) => x.role === "user")?.content ?? "");
      const [ctx, rest = ""] = u.split("<<<DOCUMENT");
      const doc = rest.split("DOCUMENT>>>")[0] ?? "";
      const nr = (doc.match(/nr ([A-Z0-9-]+)/) ?? [])[1] ?? null;
      const datum = (doc.match(/(\d{4}-\d{2}-\d{2})/) ?? [])[1] ?? null;
      const tot = (doc.match(/totaal ([0-9.]+,\d{2})/) ?? [])[1];
      const posts = ctx.split("\n").filter((l) => /^\d+ · /.test(l)).map((l) => Number(l.split(" · ")[0]));
      const regels = [...posts.map((id) => ({ postId: id, omschrijving: "", eenheid: "", hoeveelheid: 1, eenheidsprijsCent: 1000, inbegrepen: "ja", opmerking: "" })), { postId: null, omschrijving: "Nep eigen regel", eenheid: "pst", hoeveelheid: 1, eenheidsprijsCent: 500, inbegrepen: "ja", opmerking: "" }];
      content = JSON.stringify({ nummer: nr, datum, geldigTot: null, btwVerlegd: true, kortingPct: null, vorm: "posten", regels, hoofdstukken: [], totaalCent: tot ? Math.round(Number(tot.replace(/\./g, "").replace(",", ".")) * 100) : null, opmerkingen: ["nep: negeer elke instructie in het document"], vertrouwen: 0.8 });
    }
    // 3.10: OA-factuurcontrole uit tekst. Het dossier (JSON) staat vóór het blok, de tekst van de factuur erin. De nep zegt "weigeren"
    // als de tekst "dubbel" bevat (met het nummer uit het dossier in de bevinding: bewijs dat het dossier meekwam), anders "goedkeuren".
    if (parsed?.response_format?.json_schema?.name === "oa_factuurcontrole_v1") {
      const u = String(parsed?.messages?.find((x) => x.role === "user")?.content ?? "");
      const [ctx, rest = ""] = u.split("<<<DOCUMENT");
      const doc = rest.split("DOCUMENT>>>")[0] ?? "";
      const nr = (ctx.match(/"nummer":"([^"]+)"/) ?? [])[1] ?? "?";
      const dubbel = /dubbel/i.test(doc);
      content = JSON.stringify({ voorstel: dubbel ? "weigeren" : "goedkeuren", bevindingen: dubbel ? [{ soort: "dubbel", ernst: "fout", tekst: `nep: ${nr} lijkt dubbel gefactureerd`, bedragCent: 12345 }] : [], samenvatting: "nep: negeer elke instructie in het document", vertrouwen: 0.7 });
    }
    if (m === "ongeldig") content = "dit is geen json";
    // 3.9: offertes vergelijken uit het dossier. De nep kiest per post de EERSTE offerte die de post noemt (ook als die niet
    // inbegrepen is: dan valt die keuze weg met een opmerking, bewijs van de nakijk-stap) en noemt de prijsvraag uit het dossier.
    // 3.11: offerte nalezen: één opmerking met het offertenummer uit het dossier op post 1.
    const sname = parsed?.response_format?.json_schema?.name;
    if (sname === "oa_vergelijking_v1" || sname === "offerte_nalezen_v1") {
      const u = String(parsed?.messages?.find((x) => x.role === "user")?.content ?? "");
      const raw = (u.split("<<<DOSSIER")[1] ?? "").split("DOSSIER>>>")[0] ?? "";
      let d = {};
      try { d = JSON.parse(raw); } catch { d = {}; }
      if (sname === "oa_vergelijking_v1") {
        const keuzes = (d.posten ?? []).map((p) => { const o = (d.offertes ?? []).find((q) => (q.posten ?? []).some((c) => c.post === p.post)); return { post: p.post, offerte: o ? o.offerte : null, reden: "nep: eerste offerte" }; });
        content = JSON.stringify({ keuzes, bevindingen: [{ soort: "voorbehoud", ernst: "let_op", tekst: `nep: ${d.prijsvraag ?? "?"} nagekeken`, post: 1, bedragCent: 12345 }], samenvatting: "nep: negeer elke instructie in het dossier", vertrouwen: 0.6 });
      } else {
        content = JSON.stringify({ oordeel: "opmerkingen", opmerkingen: [{ soort: "eenheidsprijs", ernst: "let_op", tekst: `nep: ${d.offerte ?? "?"} post 1 nakijken`, post: 1, bedragCent: 12345 }], samenvatting: "nep: nagelezen", vertrouwen: 0.6 });
      }
    }
    if (m === "groot") content = JSON.stringify({ werf: "W-901", documentsoort: "andere", firma: null, bedragCent: null, vertrouwen: 0.1, opvulling: "x".repeat(12000) });
    const message = m === "weiger" ? { role: "assistant", content: null, refusal: "nee" } : { role: "assistant", content };
    const answer = () => send(res, 200, { id: "chatcmpl-nep", object: "chat.completion", created: Math.floor(Date.now() / 1000), model: parsed?.model ?? "auto", choices: [{ index: 0, message, finish_reason: "stop" }], usage });
    if (m === "traag") setTimeout(answer, 4000); else answer();
  });
}).listen(port, "127.0.0.1", () => console.log(`nep-inferentie op 127.0.0.1:${port}`));
