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

// Opent bytes (bv. een PDF) in een nieuw tabblad, in de eigen weergave van het toestel.
// Het tabblad gaat open vóór het wachten, anders blokkeert de browser het als pop-up.
export async function openInNewTab(getBytes: () => Promise<Uint8Array>, mime: string): Promise<void> {
  const win = window.open("", "_blank");
  try {
    const bytes = await getBytes();
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }));
    if (win) win.location.href = url;
    else window.location.href = url;
  } catch (e) {
    win?.close();
    throw e;
  }
}

// Op een gsm toont een ingebedde PDF vaak maar één pagina; daar liever het eigen PDF-scherm.
export const isPhone = () => window.matchMedia("(max-width: 767px)").matches;
