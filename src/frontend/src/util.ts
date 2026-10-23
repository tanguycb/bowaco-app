import { loadConfig, useActor } from "@caffeineai/core-infrastructure";
import { createActor, type Backend } from "./backend";

export function useBackend(): { actor: Backend | null; isFetching: boolean } {
  return useActor(createActor);
}

export { loadConfig };

export type Res<T> = { __kind__: "ok"; ok: T } | { __kind__: "err"; err: string };

export function unwrap<T>(r: Res<T>): T {
  if (r.__kind__ === "err") throw new Error(r.err);
  return r.ok;
}

/** Een trap van de backend ("Geen toegang …") of een netwerkfout als leesbare tekst. */
export function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  const reject = m.match(/Reject text: ([^\n]+)/) ?? m.match(/reject_message=([^,\n]+)/);
  if (reject) return reject[1].replace(/^Canister called `ic0.trap` with message: '?/, "").replace(/'$/, "");
  if (/trapped explicitly: ([^\n]+)/.test(m)) return m.match(/trapped explicitly: ([^\n]+)/)![1];
  return m.length > 200 ? m.slice(0, 200) + "…" : m;
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
