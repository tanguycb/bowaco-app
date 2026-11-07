// Leverancierssleutels (ontwerp §3.6). Staan ENKEL op de server in /etc/bowaco-postbode/sleutels.env (root:root 0600),
// systemd leest dat bestand als root vóór het de rechten laat vallen. Hier worden ze één keer uit de omgeving gelezen
// en daarna uit process.env gewist (main.ts), zodat geen foutdump of kindproces ze nog ziet.
//
// Rotatie zonder gat: nieuwe sleutel bij de leverancier → als <NAAM>_VOLGENDE zetten → restart → /health meldt
// "volgende actief" → oude sleutel intrekken bij de leverancier → _VOLGENDE naar de hoofdnaam, restart.
//
// Nooit de waarde, de lengte of een stuk ervan naar buiten: toJSON en inspect tonen enkel de stand.
import { inspect } from "node:util";

export type LevNaam = "claude" | "grok";
export type SleutelStand = "hoofd" | "volgende actief" | "geen";

const NAMEN: Record<LevNaam, string> = { claude: "ANTHROPIC_API_KEY", grok: "XAI_API_KEY" };
export const SLEUTEL_VARIABELEN = Object.values(NAMEN).flatMap((n) => [n, `${n}_VOLGENDE`]);

export class Sleutels {
  #waarde = new Map<LevNaam, string>();
  #stand = new Map<LevNaam, SleutelStand>();

  constructor(env: NodeJS.ProcessEnv) {
    for (const [lev, naam] of Object.entries(NAMEN) as [LevNaam, string][]) {
      const volgende = env[`${naam}_VOLGENDE`]?.trim();
      const hoofd = env[naam]?.trim();
      if (volgende) {
        this.#waarde.set(lev, volgende);
        this.#stand.set(lev, "volgende actief");
      } else if (hoofd) {
        this.#waarde.set(lev, hoofd);
        this.#stand.set(lev, "hoofd");
      } else this.#stand.set(lev, "geen");
    }
  }

  get(lev: LevNaam): string | null {
    return this.#waarde.get(lev) ?? null;
  }

  stand(): Record<LevNaam, SleutelStand> {
    return { claude: this.#stand.get("claude") ?? "geen", grok: this.#stand.get("grok") ?? "geen" };
  }

  // Voor scrub(): alle gekende waarden, ook de niet-actieve hoofdsleutel tijdens een rotatie.
  geheimen(env?: NodeJS.ProcessEnv): string[] {
    const s = [...this.#waarde.values()];
    if (env) for (const k of SLEUTEL_VARIABELEN) if (env[k]?.trim()) s.push(env[k]!.trim());
    return s;
  }

  toJSON() {
    return this.stand();
  }

  [inspect.custom]() {
    return `Sleutels(${JSON.stringify(this.stand())})`;
  }
}

// Wist de sleutels uit de omgeving van het proces (na het lezen); geeft de waarden terug voor scrub.
export function wisUitOmgeving(env: NodeJS.ProcessEnv = process.env): string[] {
  const weg: string[] = [];
  for (const k of SLEUTEL_VARIABELEN) {
    if (env[k]?.trim()) weg.push(env[k]!.trim());
    delete env[k];
  }
  return weg;
}

// Opschonen van elke tekst die naar buiten kan (fout aan de browser, logregel, failAiTicket, /health):
// gekende sleutels, alles wat op een sleutel lijkt, Bearer-tokens en e-mailadressen; daarna ingekort.
let gekend: string[] = [];
export function registreerGeheimen(g: string[]) {
  gekend = [...new Set([...gekend, ...g.filter((x) => x.length >= 8)])];
}

export function scrub(tekst: unknown, max = 200): string {
  let t = String(tekst ?? "");
  for (const g of gekend) t = t.split(g).join("[sleutel]");
  t = t
    .replace(/\b(sk-[A-Za-z0-9_\-]{6,}|xai-[A-Za-z0-9_\-]{6,})/g, "[sleutel]")
    .replace(/\bBearer\s+[^\s"',;]+/gi, "Bearer [sleutel]")
    .replace(/(x-api-key|authorization|api[_-]?key)(["']?\s*[:=]\s*["']?)(?!Bearer\b|\[sleutel\])[^\s"',;}]+/gi, "$1$2[sleutel]")
    .replace(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g, "[adres]")
    .replace(/[\u0000-\u001f]+/g, " ");
  return t.length > max ? t.slice(0, max) : t;
}
