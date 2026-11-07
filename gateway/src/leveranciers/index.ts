// Alle adapters samen + de allowlist van modellen (in code: een onbekend model → 422 model).
import type { Config } from "../config.ts";
import type { Sleutels } from "../sleutels.ts";
import { CLAUDE_MODELLEN, maakClaude } from "./claude.ts";
import { GROK_MODELLEN, maakGrok } from "./grok.ts";
import type { LevNaam, Leverancier, ModelInfo } from "./leverancier.ts";
import { NEP_MODELLEN, maakNep } from "./nep.ts";

export type Leveranciers = Record<LevNaam, Leverancier>;

export const ALLE_MODELLEN: ModelInfo[] = [...CLAUDE_MODELLEN, ...GROK_MODELLEN, ...NEP_MODELLEN];
export const modelInfo = (id: string) => ALLE_MODELLEN.find((m) => m.id === id) ?? null;
export const levVan = (id: string) => (id.split("/")[0] as LevNaam) ?? null;

export function maakLeveranciers(cfg: Pick<Config, "basis" | "nep">, sleutels: Sleutels, fetcher: typeof fetch = fetch): Leveranciers {
  return { claude: maakClaude(cfg, sleutels, fetcher), grok: maakGrok(cfg, sleutels, fetcher), nep: maakNep(cfg.nep) };
}
