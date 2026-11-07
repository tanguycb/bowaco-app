// Stubs voor de fase-3-taken (3.6, 3.8–3.11): de plaats, de bestanden en de modellen staan er; `actief: false` tot
// de stap zelf de instructie en het schema bouwt (dan weigert de gateway ze met 422 taak). De sleutels moeten gelijk
// zijn aan Config.aiWorkerKeys() in de app (open punt: afstemmen met B1).
import type { Soort } from "../bestanden.ts";
import type { TaakDef } from "./taak.ts";

const DOCS: Soort[] = ["pdf", "jpeg", "png", "webp", "xlsx", "csv"];
const CLAUDE = ["claude/sonnet-5.5", "claude/opus-5.5", "claude/haiku-5.5"];
const leeg = { type: "object", additionalProperties: false, required: [], properties: {} };

const stub = (key: string, bestanden: TaakDef["bestanden"], extra: Partial<TaakDef> = {}): TaakDef => ({
  key,
  actief: false,
  bestanden,
  modellen: [...CLAUDE, "grok/grok-4", "nep/echo"],
  standaardModel: "claude/sonnet-5.5",
  terugval: false,
  instructies: { 1: { schemaVersie: 1, maxUit: 4_000, systeem: "(nog niet gebouwd)", schema: leeg } },
  voorbeeld: {},
  ...extra,
});

export const stubs: TaakDef[] = [
  // 3.6: spraak → werfverslag. Audio gaat eerst door een transcriptie-adapter (voorbewerking, niet in 3.1).
  stub("werfverslag-spraak", { max: 3, soorten: ["audio"] }, {
    voorbewerking: async () => {
      throw new Error("transcriptie-adapter komt in 3.6");
    },
  }),
  stub("oa-offerte-inlezen", { max: 5, soorten: DOCS }), // 3.8
  stub("oa-offertes-vergelijken", { max: 10, soorten: DOCS }), // 3.9
  stub("oa-factuurcontrole", { max: 5, soorten: DOCS }), // 3.10
  stub("offerte-review", { max: 3, soorten: DOCS }), // 3.11
  stub("prijsvraag-opstellen", { max: 5, soorten: DOCS }), // 3.11
];
