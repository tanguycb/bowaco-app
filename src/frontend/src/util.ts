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

export function fmtTime(ns: bigint | number): string {
  const ms = Number(BigInt(ns) / 1_000_000n);
  if (!ms) return "–";
  return new Date(ms).toLocaleString("nl-BE");
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
