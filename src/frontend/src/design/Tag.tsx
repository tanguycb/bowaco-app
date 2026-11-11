import type { ReactNode } from "react";

/** v3 (4b.3): één tag voor een soort, een stand of een code; overal dezelfde vorm. Kleur nooit alleen: het woord zegt het. */
export type TagTone = "neutral" | "accent" | "warn" | "bad" | "ok";
export function Tag({ tone = "neutral", code, title, children }: { tone?: TagTone; code?: boolean; title?: string; children: ReactNode }) {
  const cls = ["bw-tag", tone !== "neutral" && `bw-tag--${tone}`, code && "bw-tag--code"].filter(Boolean).join(" ");
  return <span className={cls} title={title}>{children}</span>;
}
