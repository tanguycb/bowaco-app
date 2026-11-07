// POST /v2/taak (ontwerp §3.5/§3.8). Volgorde: alles wat zonder ticket te controleren is (grootte, multipart,
// ticketvorm, invoer, bestandssoort op inhoud, hash) gebeurt VÓÓR checkTicket, zodat een fout van de browser het
// ticket niet verbruikt. Na checkTicket wordt elke fout ook aan de app gemeld (failAiTicket), zodat de reservering
// vrijkomt en het logboek van de app klopt; is er bij een leverancier gerekend, dan eerst reportAiUsage.
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { type Bestand, Weigering, controleer, invoerHash, leesBody, leesMultipart } from "./bestanden.ts";
import type { Budget } from "./budget.ts";
import type { Config } from "./config.ts";
import type { Robot, TicketInfo } from "./ic.ts";
import { type Leveranciers, levVan, modelInfo } from "./leveranciers/index.ts";
import type { Logboek, LogRegel } from "./logboek.ts";
import { scrub } from "./sleutels.ts";
import type { Taken } from "./taken/index.ts";
import { valideer } from "./taken/taak.ts";
import { type Resultaat, voerUit } from "./uitvoer.ts";

export type Stats = { tasks: number; refused: number; lastError: string | null };
export const newStats = (): Stats => ({ tasks: 0, refused: 0, lastError: null });

export type V2Deps = {
  cfg: Config;
  robot: Robot;
  leveranciers: Leveranciers;
  taken: Taken;
  budget: Budget;
  logboek: Logboek;
  stats: Stats;
};

// eslint-disable-next-line
export type Antwoord = { status: number; body: any };
const fout = (status: number, code: string, tekst: string): Antwoord => ({ status, body: { fout: scrub(tekst), code } });

type Invoer = { tekst: string; refs: string[]; instructieVersie: number; schemaVersie: number; sha256: string; model?: string; terugvalModel?: string };

function leesInvoer(s: string | undefined): Invoer {
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(s ?? "") as Record<string, unknown>;
  } catch {
    throw new Weigering(400, "json", "invoer moet JSON zijn");
  }
  const okStr = (x: unknown, max: number) => typeof x === "string" && x.length <= max;
  const okModel = (x: unknown) => x === undefined || (typeof x === "string" && /^[a-z]+\/[a-z0-9.\-]{1,40}$/.test(x));
  if (
    !v ||
    typeof v !== "object" ||
    typeof v.tekst !== "string" ||
    !Array.isArray(v.refs) ||
    v.refs.length > 20 ||
    !v.refs.every((r) => okStr(r, 64)) ||
    !Number.isInteger(v.instructieVersie) ||
    !Number.isInteger(v.schemaVersie) ||
    typeof v.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(v.sha256) ||
    !okModel(v.model) ||
    !okModel(v.terugvalModel)
  )
    throw new Weigering(400, "json", "invoer: { tekst, refs, instructieVersie, schemaVersie, sha256 } verwacht");
  return v as unknown as Invoer;
}

export class V2 {
  #lopend = 0;
  #personen = new Set<bigint>();
  private d: V2Deps;
  constructor(d: V2Deps) {
    this.d = d;
  }

  async taak(req: IncomingMessage): Promise<Antwoord> {
    const { robot } = this.d;
    const log: LogRegel = { ticketId: null, personId: null, workerKey: null, workId: null, leverancier: null, model: null, bestanden: { aantal: 0, bytes: 0, soorten: [] }, tokensIn: 0, tokensUit: 0, kostCent: 0, duurMs: 0, uitkomst: "ok", terugval: false, fout: null };
    const start = Date.now();
    let t: TicketInfo | null = null;
    let a: Antwoord;
    try {
      a = await this.#taak(req, log, (x) => (t = x));
    } catch (e) {
      a = e instanceof Weigering ? fout(e.status, e.code, e.message) : fout(500, "500", (e as Error)?.message ?? "fout");
      if (!(e instanceof Weigering)) this.d.stats.lastError = scrub((e as Error)?.message);
    }
    // Elke fout na checkTicket: de app krijgt failAiTicket (reservering vrij, AiCall op #failed).
    const tk = t as TicketInfo | null;
    if (tk && a.status !== 202) {
      const why = a.body.code === "tijd" ? "onzeker" : `${a.body.code}: ${a.body.fout}`;
      await this.#veilig(() => robot.failAiTicket(tk.ticketId, scrub(why, 200)));
    }
    if (a.status === 202) this.d.stats.tasks++;
    else this.d.stats.refused++;
    log.duurMs = Date.now() - start;
    log.uitkomst = a.status === 202 ? "ok" : String(a.body.code);
    log.fout = a.status === 202 ? null : String(a.body.fout ?? "");
    this.d.logboek.schrijf(log);
    return a;
  }

  async #veilig(f: () => Promise<{ ok: unknown } | { err: string }>) {
    try {
      const r = await f();
      if ("err" in r) this.d.stats.lastError = scrub(r.err);
    } catch (e) {
      this.d.stats.lastError = scrub((e as Error)?.message);
    }
  }

  async #taak(req: IncomingMessage, log: LogRegel, zetTicket: (t: TicketInfo) => void): Promise<Antwoord> {
    const { cfg, robot, taken, leveranciers, budget } = this.d;
    const g = cfg.grenzen;
    // 1. Zonder ticket: grootte, multipart, vorm, invoer, bestanden, hash.
    const ct = req.headers["content-type"] ?? "";
    if (!/^multipart\/form-data/i.test(ct)) return fout(400, "json", "multipart/form-data verwacht");
    const body = await leesBody(req, g.maxTotaal + g.maxTekst + 1024 * 1024);
    const mp = await leesMultipart(ct, body);
    const ticket = mp.velden.get("ticket") ?? "";
    if (!/^TK-[A-Za-z0-9-]{8,60}$/.test(ticket)) return fout(400, "ticket-vorm", "ongeldig ticket");
    const invoer = leesInvoer(mp.velden.get("invoer"));
    if (Buffer.byteLength(invoer.tekst) > g.maxTekst) return fout(413, "grootte", "tekst te groot");
    const bestanden: Bestand[] = controleer(mp.bestanden, g);
    log.bestanden = { aantal: bestanden.length, bytes: bestanden.reduce((n, b) => n + b.bytes.length, 0), soorten: [...new Set(bestanden.map((b) => b.soort))] };
    if (invoerHash(invoer.tekst, bestanden) !== invoer.sha256) return fout(400, "hash", "hash van de invoer klopt niet");

    // 2. Ticket (update-call, meteen verbruikt).
    const ck = await robot.checkTicket(ticket);
    if ("err" in ck) return fout(403, "ticket", ck.err);
    const t = ck.ok;
    zetTicket(t);
    log.ticketId = t.ticketId;
    log.personId = t.personId;
    log.workerKey = t.task;
    log.workId = t.workId[0] ?? null;

    // 3. Past de taak?
    const taak = taken.get(t.task);
    if (!taak || !taak.actief) return fout(422, "taak", `taak ${t.task} bestaat niet in de gateway`);
    const versie = taak.instructies[invoer.instructieVersie];
    if (!versie || versie.schemaVersie !== invoer.schemaVersie) return fout(422, "taak", "instructie- of schemaversie onbekend");
    if (bestanden.length > taak.bestanden.max || bestanden.some((b) => !taak.bestanden.soorten.includes(b.soort))) return fout(422, "bestanden", "aantal of soort bestanden past niet bij de taak");
    if (bestanden.some((b) => b.soort === "audio") && !taak.voorbewerking) return fout(422, "bestanden", "audio enkel voor taken met voorbewerking");

    // 3b. Proefbank: geen leverancier, de invoer is de samenvatting.
    if (taak.zonderLeverancier) {
      let json: unknown;
      try {
        json = JSON.parse(invoer.tekst);
      } catch {
        return fout(400, "json", "samenvatting moet JSON zijn");
      }
      const f = valideer(versie.schema, json);
      if (f) return fout(400, "json", `samenvatting past niet in het schema (${f})`);
      return this.#voorstel(t, taak.kind ?? `ai:${taak.key}`, json, null);
    }

    // 4. Model(len): de app (ticket) gaat vóór de browser (invoer), dan het standaardmodel van de taak.
    const vanTicket = t.model?.[0];
    const hoofd = vanTicket ?? invoer.model ?? taak.standaardModel;
    const terug = vanTicket ? t.fallbackModel?.[0] : invoer.terugvalModel;
    const toegelaten = (id: string) => {
      const m = modelInfo(id);
      return !!m && taak.modellen.includes(id) && (levVan(id) !== "nep" || cfg.nep);
    };
    const kan = (id: string) => bestanden.every((b) => modelInfo(id)!.bestanden.includes(b.soort));
    if (!toegelaten(hoofd)) return fout(422, "model", "model niet toegelaten voor deze taak");
    if (!kan(hoofd)) return fout(422, "bestanden", "dit model kan deze bestandssoort niet lezen");
    const modellen = [hoofd];
    if (terug && taak.terugval && terug !== hoofd && toegelaten(terug) && kan(terug) && levVan(terug) !== levVan(hoofd) && leveranciers[levVan(terug)]?.ingesteld()) modellen.push(terug);
    log.model = hoofd;
    log.leverancier = levVan(hoofd);
    if (!leveranciers[levVan(hoofd)]?.ingesteld()) return fout(503, "sleutel", `${levVan(hoofd)} niet ingesteld`);

    // 5. Gelijktijdigheid (zonder bij de leverancier te raken; het ticket is wél verbruikt).
    if (this.#lopend >= cfg.gelijktijdig || this.#personen.has(t.personId)) return fout(429, "bezet", "even geduld: er loopt al een taak");
    this.#lopend++;
    this.#personen.add(t.personId);
    let r: Resultaat;
    try {
      // 6. Uitvoeren met budget: ticketbudget (wat er over is) + plafonds van de gateway.
      let ticketOver = Number(t.budgetCents);
      r = await voerUit({
        taak,
        versie,
        modellen,
        invoerTekst: invoer.tekst,
        bestanden,
        leveranciers,
        tijdslimietMs: cfg.tijdslimietMs,
        usdEurMilli: cfg.usdEurMilli,
        maxBeeldPx: g.maxBeeldPx,
        budget: {
          voor: (lev, raming) => raming <= ticketOver && budget.reserveer(lev, raming),
          na: (lev, raming, kost, isFout) => {
            budget.vrij(lev, raming);
            budget.boek(lev, taak.key, kost, isFout);
            ticketOver -= kost;
          },
        },
      });
    } finally {
      this.#lopend--;
      this.#personen.delete(t.personId);
    }
    log.model = r.model;
    log.leverancier = r.leverancier;
    log.tokensIn = r.tokensIn;
    log.tokensUit = r.tokensUit;
    log.kostCent = r.kostCent;
    log.terugval = r.terugval;
    const usage = (outputSha256: [] | [string]) =>
      this.#veilig(() =>
        robot.reportAiUsage(t.ticketId, {
          model: r.model,
          promptTokens: BigInt(r.tokensIn),
          completionTokens: BigInt(r.tokensUit),
          cachedTokens: BigInt(r.tokensCache),
          costCents: BigInt(r.kostCent),
          durationMs: BigInt(r.duurMs),
          outputSha256,
        }),
      );
    if (!r.ok) {
      if (r.pogingen > 0) await usage([]);
      return fout(r.status, r.code, r.tekst || r.code);
    }
    const a = await this.#voorstel(t, taak.kind ?? `ai:${taak.key}`, r.json, r);
    await usage(a.status === 202 ? [createHash("sha256").update(JSON.stringify(r.json), "utf8").digest("hex")] : []);
    return a;
  }

  async #voorstel(t: TicketInfo, kind: string, json: unknown, r: Resultaat | null): Promise<Antwoord> {
    const content = JSON.stringify(json);
    if (Buffer.byteLength(content) > 10_000) return fout(502, "leverancier", "antwoord te groot voor een voorstel");
    const sp = await this.d.robot.submitProposal(t.ticketId, kind, content);
    if ("err" in sp) return fout(409, "voorstel", sp.err);
    return {
      status: 202,
      body: { callId: t.payloadRef?.[0] ?? null, voorstel: String(sp.ok), taak: t.task, kostCent: r?.kostCent ?? 0, tokens: { in: r?.tokensIn ?? 0, uit: r?.tokensUit ?? 0 }, model: r?.model ?? null, terugval: r?.terugval ?? false },
    };
  }

  // GET /v2/taken: wat de gateway kan (voor het scherm van 3.4). Geen geheimen.
  taken(): Antwoord {
    const { taken, leveranciers, cfg } = this.d;
    const lijst = [...taken.values()]
      .filter((t) => t.actief)
      .map((t) => ({
        key: t.key,
        bestanden: { max: t.bestanden.max, soorten: t.bestanden.soorten },
        modellen: t.modellen.filter((id) => levVan(id) !== "nep" || cfg.nep).map((id) => ({ id, beschikbaar: !!leveranciers[levVan(id)]?.ingesteld() })),
        versies: Object.keys(t.instructies).map(Number),
      }));
    return { status: 200, body: lijst };
  }
}
