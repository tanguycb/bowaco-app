// HTTP van de gateway (achter Caddy met HTTPS op de server; luistert zelf enkel op 127.0.0.1), ontwerp §3.8:
//   GET  /health   → status, versie, robotprincipal, adapters ja/nee, stand van de sleutels (nooit waarde of lengte),
//                    tellers van de lopende maand. Geen geheimen, geen inhoud.
//   POST /task     → { ticket } : de proeftaak van 1b.3 (blijft tot 3.4 het scherm heeft).
//   POST /v2/taak  → multipart (ticket, invoer, bestand×n) : AI-taak, zie v2.ts.
//   GET  /v2/taken → wat de gateway kan.
// Origin: voor /v2/* moet de Origin exact ALLOW_ORIGIN zijn (anders 403 origin, zonder CORS-headers). CORS-headers
// enkel als de Origin overeenkomt; geen credentials. De server-side controle is de echte grens, CORS de browsergrens.
import { type IncomingMessage, type Server, createServer } from "node:http";
import { Budget } from "./budget.ts";
import type { Config } from "./config.ts";
import type { Robot } from "./ic.ts";
import { type Leveranciers, maakLeveranciers } from "./leveranciers/index.ts";
import { Logboek } from "./logboek.ts";
import { Sleutels, scrub } from "./sleutels.ts";
import { type Taken, standaardTaken } from "./taken/index.ts";
import { type Stats, V2, newStats } from "./v2.ts";

export { newStats, type Stats };

const MAX_BODY_TASK = 64 * 1024;

function bodyKlein(req: IncomingMessage): Promise<string> {
  return new Promise((ok, err) => {
    let n = 0;
    const parts: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      n += c.length;
      if (n > MAX_BODY_TASK) {
        err(new Error("te groot"));
        req.destroy();
      } else parts.push(c);
    });
    req.on("end", () => ok(Buffer.concat(parts).toString("utf8")));
    req.on("error", err);
  });
}

export type GatewayOpties = {
  cfg: Config;
  robot: Robot;
  principal: string;
  stats?: Stats;
  sleutels?: Sleutels;
  leveranciers?: Leveranciers;
  taken?: Taken;
  budget?: Budget;
  logboek?: Logboek;
};

export function startHttp(o: GatewayOpties): Server {
  const { cfg, robot, principal } = o;
  const stats = o.stats ?? newStats();
  const sleutels = o.sleutels ?? new Sleutels({});
  const leveranciers = o.leveranciers ?? maakLeveranciers(cfg, sleutels);
  const budget = o.budget ?? new Budget(cfg.staatDir, cfg.plafond);
  const logboek = o.logboek ?? new Logboek(cfg.staatDir);
  const v2 = new V2({ cfg, robot, leveranciers, taken: o.taken ?? standaardTaken(), budget, logboek, stats });

  const server = createServer(async (req, res) => {
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : null;
    const originOk = !!cfg.allowOrigin && origin === cfg.allowOrigin;
    const cors = (): Record<string, string> =>
      originOk ? { "access-control-allow-origin": cfg.allowOrigin!, vary: "Origin", "access-control-allow-methods": "POST, GET", "access-control-allow-headers": "content-type", "access-control-max-age": "600" } : { vary: "Origin" };
    const send = (code: number, data: unknown) => {
      if (res.headersSent) return;
      res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...cors() });
      res.end(JSON.stringify(data));
    };
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const p = url.pathname;
      const isV2 = p.startsWith("/v2/");
      if (req.method === "OPTIONS") {
        if (!originOk) return send(403, { fout: "origin niet toegelaten", code: "origin" });
        res.writeHead(204, cors());
        return res.end();
      }
      // /v2/*: een POST moet een Origin hebben die klopt; een GET zonder Origin (curl, /v2/taken) mag, een vreemde niet.
      if (isV2 && (origin !== null || req.method === "POST") && !originOk) {
        stats.refused++;
        req.resume();
        return send(403, { fout: "origin niet toegelaten", code: "origin" });
      }
      if (req.method === "GET" && p === "/health") {
        const s = budget.stand();
        return send(200, {
          status: "ok",
          dienst: "bowaco-gateway",
          versie: cfg.version,
          robot: principal,
          adapters: { claude: leveranciers.claude.ingesteld(), grok: leveranciers.grok.ingesteld(), nep: leveranciers.nep.ingesteld() },
          sleutel: sleutels.stand(),
          maand: { cent: s.cent, taken: s.taken, fouten: s.fouten },
          leveranciers: s.leveranciers,
          proeftaken: stats.tasks,
          geweigerd: stats.refused,
          laatsteFout: stats.lastError ? scrub(stats.lastError, 120) : null,
        });
      }
      if (req.method === "GET" && p === "/v2/taken") {
        const a = v2.taken();
        return send(a.status, a.body);
      }
      if (req.method === "POST" && p === "/v2/taak") {
        const a = await v2.taak(req);
        return send(a.status, a.body);
      }
      if (req.method === "POST" && p === "/task") {
        let ticket = "";
        try {
          ticket = String((JSON.parse(await bodyKlein(req)) as { ticket?: unknown }).ticket ?? "");
        } catch {
          return send(400, { fout: "JSON met { ticket } verwacht", code: "json" });
        }
        if (!/^TK-[A-Za-z0-9-]{8,60}$/.test(ticket)) return send(400, { fout: "ongeldig ticket", code: "ticket-vorm" });
        const ck = await robot.checkTicket(ticket);
        if ("err" in ck) {
          stats.refused++;
          return send(403, { fout: ck.err, code: "ticket" });
        }
        const t = ck.ok;
        // 1b.3: enkel de proeftaak. Elke andere taak: een voorstel "fout" zodat de gebruiker het ziet (§6.1 regel 6).
        const known = t.task === "proef";
        const content = known ? JSON.stringify({ echo: "de postbode ontving je ticket", task: t.task }) : JSON.stringify({ fout: `taak ${t.task} hoort bij /v2/taak` });
        const sp = await robot.submitProposal(t.ticketId, known ? "proef" : "fout", content);
        if ("err" in sp) return send(409, { fout: sp.err, code: "voorstel" });
        stats.tasks++;
        return send(202, { voorstel: String(sp.ok), taak: t.task });
      }
      req.resume();
      send(404, { fout: "onbekend", code: "onbekend" });
    } catch (e) {
      stats.lastError = scrub((e as Error).message);
      send(500, { fout: scrub((e as Error).message, 120), code: "500" });
    }
  });
  server.requestTimeout = cfg.antwoordMs;
  server.headersTimeout = Math.min(60_000, cfg.antwoordMs);
  server.listen(cfg.httpPort, cfg.httpHost);
  return server;
}
