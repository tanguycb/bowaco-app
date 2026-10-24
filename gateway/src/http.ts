// HTTP van de postbode (achter Caddy met HTTPS op de server; luistert zelf enkel op 127.0.0.1):
//   GET  /health  → status, versie, publieke robotprincipal, laatste ronde (geen geheimen, geen inhoud)
//   POST /task    → { ticket } : controleert het ticket bij de app (checkTicket) en schrijft één voorstel terug
//                   (submitProposal). In 1b.3 enkel de proeftaak "proef"; AI-taken komen in fase 3 (3.1).
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Config } from "./config.ts";
import type { Robot } from "./ic.ts";
import type { Stats } from "./worker.ts";

const MAX_BODY = 64 * 1024;

function body(req: IncomingMessage): Promise<string> {
  return new Promise((ok, err) => {
    let n = 0;
    const parts: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      n += c.length;
      if (n > MAX_BODY) {
        err(new Error("te groot"));
        req.destroy();
      } else parts.push(c);
    });
    req.on("end", () => ok(Buffer.concat(parts).toString("utf8")));
    req.on("error", err);
  });
}

export function startHttp(cfg: Config, robot: Robot, principal: string, stats: Stats, journalSize: () => number): Server {
  const server = createServer(async (req, res) => {
    const send = (code: number, data: unknown) => {
      const h: Record<string, string> = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
      if (cfg.allowOrigin) {
        h["access-control-allow-origin"] = cfg.allowOrigin;
        h["vary"] = "origin";
      }
      res.writeHead(code, h);
      res.end(JSON.stringify(data));
    };
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "OPTIONS" && cfg.allowOrigin) {
        res.writeHead(204, { "access-control-allow-origin": cfg.allowOrigin, "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type", "access-control-max-age": "600" });
        return res.end();
      }
      if (req.method === "GET" && url.pathname === "/health") {
        return send(200, { status: "ok", dienst: "bowaco-postbode", versie: cfg.version, robot: principal, maildienst: cfg.provider, testmodus: cfg.provider === "bestand" || cfg.brevoSandbox, rondes: stats.rounds, verstuurd: stats.sent, mislukt: stats.failed, laatsteRonde: stats.lastRound, laatsteFout: stats.lastError ? stats.lastError.slice(0, 120) : null, logboek: journalSize() });
      }
      if (req.method === "POST" && url.pathname === "/task") {
        let ticket = "";
        try {
          ticket = String((JSON.parse(await body(req)) as { ticket?: unknown }).ticket ?? "");
        } catch {
          return send(400, { fout: "JSON met { ticket } verwacht" });
        }
        if (!/^TK-[A-Za-z0-9-]{8,60}$/.test(ticket)) return send(400, { fout: "ongeldig ticket" });
        const ck = await robot.checkTicket(ticket);
        if ("err" in ck) return send(403, { fout: ck.err });
        const t = ck.ok;
        // 1b.3: enkel de proeftaak. Elke andere taak: een voorstel "fout" zodat de gebruiker het ziet (§6.1 regel 6).
        const known = t.task === "proef";
        const content = known ? JSON.stringify({ echo: "de postbode ontving je ticket", task: t.task }) : JSON.stringify({ fout: `taak ${t.task} bestaat nog niet in de postbode (fase 3)` });
        const sp = await robot.submitProposal(t.ticketId, known ? "proef" : "fout", content);
        if ("err" in sp) return send(409, { fout: sp.err });
        return send(202, { voorstel: String(sp.ok), taak: t.task });
      }
      send(404, { fout: "onbekend" });
    } catch (e) {
      send(500, { fout: (e as Error).message.slice(0, 120) });
    }
  });
  server.listen(cfg.httpPort, cfg.httpHost);
  return server;
}
