// 3.1-B2: de gateway-weg in de browser (ontwerp 3.1 §2.2.2, §3.5, §3.8). askAi vraagt de app om een ticket (rechten, fiche aan,
// budget gereserveerd); de browser stuurt ticket + invoer + bestanden als multipart rechtstreeks naar <gateway>/v2/taak en pollt
// daarna aiCall(callId) tot de oproep klaar is. Bestanden gaan als BYTES mee, nooit als opslag-URL: de gateway leest niets uit de
// app of uit de opslag. Bestandsnamen gaan niet mee (ze kunnen een klantnaam dragen). Op de caffeine-weg antwoordt askAi meteen
// met een voorstel; dan is er niets naar de gateway.
import type { AiCallView, AiInput, Backend } from "./backend";
import { AiRoute } from "./backend";

/**
 * De invoerhash zoals de gateway ze narekent (gateway/src/bestanden.ts, invoerHash): SHA-256 over UTF-8(tekst), en dan voor elk
 * bestand in volgorde één byte 0x1E gevolgd door de ruwe bytes. Resultaat in kleine hex (64 tekens).
 */
export async function invoerHash(tekst: string, bestanden: readonly Uint8Array[]): Promise<string> {
  const t = new TextEncoder().encode(tekst);
  let n = t.length;
  for (const b of bestanden) n += 1 + b.length;
  const all = new Uint8Array(n);
  all.set(t, 0);
  let at = t.length;
  for (const b of bestanden) {
    all[at++] = 0x1e;
    all.set(b, at);
    at += b.length;
  }
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", all));
  return Array.from(d, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Het adres van de gateway: enkel https://, of http op de eigen machine (lokaal net). Geen pad, geen query. */
export function gatewayBase(url: string): string {
  let u: URL;
  try { u = new URL(url); } catch { throw new GatewayFout(0, "adres", "Ongeldig adres van de gateway"); }
  const local = u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]");
  if (u.protocol !== "https:" && !local) throw new GatewayFout(0, "adres", "Het adres van de gateway moet met https:// beginnen");
  if (u.username || u.password || u.search || u.hash) throw new GatewayFout(0, "adres", "Ongeldig adres van de gateway");
  return u.origin + u.pathname.replace(/\/+$/, "");
}

export class GatewayFout extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, msg: string) {
    super(msg);
    this.status = status;
    this.code = code;
  }
}

/** Vaste teksten per foutcode van de gateway (§3.8); de tekst van de gateway zelf komt erachter als die er is. */
const FOUTEN: Record<string, string> = {
  json: "De gateway kon de invoer niet lezen",
  hash: "De invoer veranderde onderweg (hash klopt niet)",
  "ticket-vorm": "Ongeldig ticket",
  ticket: "Het ticket is ongeldig, al gebruikt of verlopen",
  voorstel: "Voor dit ticket is er al een voorstel",
  grootte: "De bestanden zijn te groot",
  bestand: "Deze soort bestand is niet toegelaten",
  taak: "De gateway kent deze taak of instructieversie niet",
  model: "De gateway kent dit model niet",
  bestanden: "Aantal of soort bestanden past niet bij deze taak",
  budget: "Het budget voor deze taak is op",
  bezet: "De gateway is bezet; probeer zo meteen opnieuw",
  leverancier: "De AI-leverancier gaf een fout; probeer later opnieuw",
  sleutel: "De gateway is voor deze leverancier niet ingesteld",
  tijd: "De AI-leverancier antwoordde niet op tijd (misschien toch gerekend; niet automatisch herhaald)",
  origin: "De gateway aanvaardt dit adres van de app niet",
};

export type Bestand = Blob | Uint8Array;
export type GatewayAntwoord = { callId: string | null; voorstel: string; taak: string; kostCent: number; tokens: { in: number; uit: number }; model: string | null; terugval: boolean };

export type TaakInvoer = {
  tekst: string;
  refs?: string[];
  /** Ruwe bytes van de bestanden (de browser haalde ze zelf op). Nooit een URL. */
  bestanden?: Bestand[];
  instructieVersie: number;
  schemaVersie?: number;
};

const bytesOf = async (b: Bestand): Promise<Uint8Array> => (b instanceof Uint8Array ? b : new Uint8Array(await b.arrayBuffer()));

/** Eén multipart-verzoek naar /v2/taak. Exporteerbaar voor de test; de echte weg gaat via runAi. */
export async function sendTask(gatewayUrl: string, ticket: string, inv: TaakInvoer, fetchImpl: typeof fetch = fetch): Promise<GatewayAntwoord> {
  const base = gatewayBase(gatewayUrl);
  const files = await Promise.all((inv.bestanden ?? []).map(bytesOf));
  const sha256 = await invoerHash(inv.tekst, files);
  const fd = new FormData();
  fd.set("ticket", ticket);
  fd.set("invoer", JSON.stringify({ tekst: inv.tekst, refs: inv.refs ?? [], instructieVersie: inv.instructieVersie, schemaVersie: inv.schemaVersie ?? 1, sha256 }));
  // De soort bepaalt de gateway op de inhoud (magic bytes); de naam is neutraal.
  files.forEach((b, i) => fd.append("bestand", new Blob([b as BlobPart], { type: "application/octet-stream" }), `bestand-${i + 1}`));
  let res: Response;
  try {
    res = await fetchImpl(`${base}/v2/taak`, { method: "POST", body: fd, credentials: "omit", mode: "cors", cache: "no-store", referrerPolicy: "no-referrer" });
  } catch {
    throw new GatewayFout(0, "net", "De gateway is niet bereikbaar");
  }
  let body: Record<string, unknown> = {};
  try { body = (await res.json()) as Record<string, unknown>; } catch { /* geen JSON */ }
  if (res.status !== 202) {
    const code = typeof body.code === "string" ? body.code : String(res.status);
    const extra = typeof body.fout === "string" && body.fout ? ` (${body.fout.slice(0, 200)})` : "";
    throw new GatewayFout(res.status, code, (FOUTEN[code] ?? "De gateway weigerde de taak") + extra);
  }
  return body as unknown as GatewayAntwoord;
}

const KLAAR = new Set(["done", "failed", "invalid", "unsure", "refused", "dropped", "dryRun"]);

/** Pollt aiCall(id) tot de oproep niet meer loopt (of tot de tijd op is: dan de laatste stand). */
export async function waitCall(actor: Backend, callId: bigint, maxMs = 30_000, everyMs = 1_000): Promise<AiCallView | null> {
  const end = Date.now() + maxMs;
  let last: AiCallView | null = null;
  for (;;) {
    last = await actor.aiCall(callId);
    if (last && KLAAR.has(last.state.__kind__)) return last;
    if (Date.now() >= end) return last;
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

export type AiRun = { callId: bigint; route: AiRoute; call: AiCallView | null; gateway?: GatewayAntwoord; fellBack: boolean };

/**
 * Een AI-taak via de connector: askAi; op de gateway-weg ticket → /v2/taak → pollen. Met `terugval` en zonder bestanden: bij een
 * leveranciersfout van de gateway één keer askAi met forceRoute = caffeine (de app laat dat enkel toe als de fiche het toestaat).
 */
export async function runAi(
  actor: Backend,
  worker: string,
  workId: bigint | null,
  inv: TaakInvoer & { terugval?: boolean },
  fetchImpl: typeof fetch = fetch,
): Promise<AiRun> {
  const input: AiInput = { text: inv.tekst, refs: inv.refs ?? [] };
  const r = await actor.askAi(worker, workId, input);
  if (r.__kind__ === "err") throw new Error(r.err);
  const a = r.ok;
  if (a.__kind__ === "proposal") {
    return { callId: a.proposal.callId, route: AiRoute.caffeine, call: await actor.aiCall(a.proposal.callId), fellBack: false };
  }
  const tk = a.ticket;
  try {
    const g = await sendTask(tk.gatewayUrl, tk.ticket, inv, fetchImpl);
    return { callId: tk.callId, route: AiRoute.gateway, call: await waitCall(actor, tk.callId), gateway: g, fellBack: false };
  } catch (e) {
    const supplier = e instanceof GatewayFout && (e.code === "leverancier" || e.code === "sleutel");
    if (!(supplier && inv.terugval && (inv.bestanden ?? []).length === 0)) throw e;
    const r2 = await actor.askAi(worker, workId, { ...input, forceRoute: AiRoute.caffeine });
    if (r2.__kind__ === "err") throw new Error(r2.err);
    if (r2.ok.__kind__ !== "proposal") throw e;
    const id = r2.ok.proposal.callId;
    return { callId: id, route: AiRoute.caffeine, call: await actor.aiCall(id), fellBack: true };
  }
}
