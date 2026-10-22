// BOWACO design system (stap 0.5) — dezelfde afspraken als tokens.css, voor code die ze nodig heeft.

/** De vijf statussen van de hele app (bouwplan §8.1 regel 5; Motoko TaskStatus in architectuur §2.5). */
export type Status = "planned" | "busy" | "delayed" | "done" | "blocked";

export const STATUSES: Status[] = ["planned", "busy", "delayed", "done", "blocked"];

/** Vast woord per status. Komt in 0.6 in texts/nl.ts; hier staat de afspraak. */
export const STATUS_WORD: Record<Status, string> = {
  planned: "gepland",
  busy: "bezig",
  delayed: "vertraagd",
  done: "klaar",
  blocked: "geblokkeerd",
};

/** Vaste vorm per status, zodat de status ook zonder kleur leesbaar is (kleurenblind, zon). */
export const STATUS_ICON = {
  planned: "st-planned",
  busy: "st-busy",
  delayed: "st-delayed",
  done: "st-done",
  blocked: "st-blocked",
} as const;

/** Mapping naar de Motoko-variant (#planned …) voor 0.6. */
export const STATUS_FROM_MOTOKO = (v: Record<string, unknown>): Status =>
  (Object.keys(v)[0] as Status) ?? "planned";

export const TAP = 48; // px, minimum aanraakvlak
export const TAP_LG = 60; // px, hoofdknop op de werf

export type Theme = "system" | "light" | "dark";

/** Zet het thema op <html>; "system" volgt het toestel. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}
