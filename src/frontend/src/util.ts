import { loadConfig, useActor } from "@caffeineai/core-infrastructure";
import { createActor, type Backend } from "./backend";
import { t } from "./texts/nl";

export function useBackend(): { actor: Backend | null; isFetching: boolean } {
  return useActor(createActor);
}

export { loadConfig };

export type Res<T> = { __kind__: "ok"; ok: T } | { __kind__: "err"; err: string };

export function unwrap<T>(r: Res<T>): T {
  if (r.__kind__ === "err") throw new Error(r.err);
  return r.ok;
}

/** Technische netwerk- en systeemfouten (niet van onze backend) in gewone woorden (stap 2b.5). */
function plain(m: string): string | null {
  if (/Unauthorized access/i.test(m)) return t.common.noAccess;
  if (/Failed to fetch|NetworkError|Load failed|ETIMEDOUT|ECONNRESET|IC0503|IC0515|canister_not_found|certificate|timed out|timeout|agent error|AgentError|HttpError|Fetch request failed/i.test(m)) return t.common.noConnection;
  return null;
}

/** Een trap van de backend ("Geen toegang …") of een netwerkfout als leesbare tekst. */
export function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  const reject = m.match(/Reject text: ([^\n]+)/) ?? m.match(/reject_message=([^,\n]+)/);
  if (reject) {
    const own = reject[1].replace(/^Canister called `ic0.trap` with message: '?/, "").replace(/'$/, "");
    return plain(own) ?? own;
  }
  const trapped = m.match(/trapped explicitly: ([^\n]+)/);
  if (trapped) return plain(trapped[1]) ?? trapped[1];
  return plain(m) ?? (m.length > 200 ? m.slice(0, 200) + "…" : m);
}

const dateFmt = new Intl.DateTimeFormat("nl-BE", { day: "2-digit", month: "2-digit", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("nl-BE", { hour: "2-digit", minute: "2-digit" });

export function nsToDate(ns: bigint | number): Date {
  return new Date(Number(BigInt(ns) / 1_000_000n));
}

/** "22.10.2026 14:03" (mono-notatie zoals in het design system). */
export function fmtTime(ns: bigint | number | undefined): string {
  if (ns === undefined || BigInt(ns) === 0n) return "–";
  const d = nsToDate(ns);
  return `${dateFmt.format(d).replaceAll("/", ".")} ${timeFmt.format(d)}`;
}

export function fmtDay(ns: bigint | number | undefined): string {
  if (ns === undefined || BigInt(ns) === 0n) return "–";
  return dateFmt.format(nsToDate(ns)).replaceAll("/", ".");
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Optioneel tekstveld: lege invoer = afwezig. */
export function optText(s: string): string | undefined {
  const v = s.trim();
  return v === "" ? undefined : v;
}

/** JSON-bestand laten bewaren in de browser (export). BigInt wordt tekst. */
export function downloadJson(name: string, data: unknown): void {
  const text = JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2);
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** ISO-week en datum voor de kop: "do 22.10.2026 · week 43". */
export function todayLabel(d = new Date()): string {
  const day = new Intl.DateTimeFormat("nl-BE", { weekday: "short" }).format(d).replace(".", "");
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${day} ${dateFmt.format(d).replaceAll("/", ".")} · week ${week}`;
}

// ── Kalenderdagen (Day = dagen sinds 1970-01-01, D4) en geld (eurocent, D5) ──

/** Dagnummer → "2026-10-23" voor een <input type="date">. */
export function dayToInput(d: bigint | undefined): string {
  if (d === undefined) return "";
  return new Date(Number(d) * 86_400_000).toISOString().slice(0, 10);
}

/** "2026-10-23" → dagnummer (de kalenderdatum, los van de tijdzone). Leeg = undefined. */
export function inputToDay(s: string): bigint | undefined {
  if (!s) return undefined;
  const [y, m, d] = s.split("-").map(Number);
  return BigInt(Math.floor(Date.UTC(y, m - 1, d) / 86_400_000));
}

/** Dagnummer → "23.10.2026". */
export function fmtDayNum(d: bigint | undefined): string {
  if (d === undefined) return "–";
  const x = new Date(Number(d) * 86_400_000);
  return `${String(x.getUTCDate()).padStart(2, "0")}.${String(x.getUTCMonth() + 1).padStart(2, "0")}.${x.getUTCFullYear()}`;
}

/** Vandaag als dagnummer (lokale kalenderdatum). */
export function todayDay(): bigint {
  const n = new Date();
  return BigInt(Math.floor(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / 86_400_000));
}

const euroFmt = new Intl.NumberFormat("nl-BE", { style: "currency", currency: "EUR" });

/** 4500000n → "€ 45.000,00". */
export function fmtEuro(cents: bigint | undefined): string {
  if (cents === undefined) return "–";
  return euroFmt.format(Number(cents) / 100);
}

/** "45.000" of "45000,50" of "€ 45 000" → eurocent. Ongeldig → null; leeg → undefined. */
export function parseEuro(s: string): bigint | undefined | null {
  const v = s.replace(/[€\s]/g, "");
  if (v === "") return undefined;
  // Belgische schrijfwijze: punt = duizendtal, komma = decimaal.
  const norm = v.includes(",") ? v.replaceAll(".", "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(v) ? v.replaceAll(".", "") : v;
  if (!/^\d+(\.\d{1,2})?$/.test(norm)) return null;
  const [int, dec = ""] = norm.split(".");
  return BigInt(int) * 100n + BigInt((dec + "00").slice(0, 2));
}

/** Basispunten → "5 %" of "5,5 %". */
export function fmtBp(bp: bigint): string {
  return `${(Number(bp) / 100).toLocaleString("nl-BE")} %`;
}

/** "5" of "5,5" → basispunten. Ongeldig → null. */
export function parsePct(s: string): bigint | null {
  const v = s.replace(/[%\s]/g, "").replace(",", ".");
  if (v === "") return 0n;
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  return BigInt(Math.round(Number(v) * 100));
}
