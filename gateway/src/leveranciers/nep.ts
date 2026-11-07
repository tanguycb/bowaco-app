// Nep-leverancier (ontwerp §3.4): geen netwerk. Geeft het vaste voorbeeld-JSON van de taak terug, telt tokens als
// bytes/4, rekent een nep-tarief, en faalt op commando zodat de tests elke uitkomstklasse en de terugval bewijzen.
// Enkel toegelaten met GATEWAY_NEP=1 (nooit op de echte server).
import type { Leverancier, ModelInfo, Taak, Uitkomst } from "./leverancier.ts";
import { kostUsdMicro } from "./leverancier.ts";

const ALLES = ["pdf", "jpeg", "png", "webp", "xlsx", "csv", "audio"] as const;
const nep = (naam: string): ModelInfo => ({ id: `nep/${naam}`, apiId: naam, inUsdPerM: 1, uitUsdPerM: 5, bestanden: [...ALLES], prijsDatum: "nep" });
export const NEP_MODELLEN: ModelInfo[] = ["echo", "tekst", "fout-opnieuw", "fout-ongeldig", "fout-schema", "fout-lek", "traag"].map(nep);

export const NEP_TRAAG_MS = 70_000;

export function maakNep(aan: boolean, lekSleutel = "sk-ant-nep-0000000000000000"): Leverancier {
  return {
    naam: "nep",
    ingesteld: () => aan,
    modellen: async () => NEP_MODELLEN,
    async run(t: Taak): Promise<Uitkomst> {
      if (!aan) return { ok: false, klasse: "sleutel", tekst: "nep niet toegelaten (GATEWAY_NEP)" };
      const m = NEP_MODELLEN.find((x) => x.id === t.model);
      if (!m) return { ok: false, klasse: "ongeldig", tekst: "model niet toegelaten" };
      const bytes = Buffer.byteLength(t.systeem) + Buffer.byteLength(t.invoerTekst) + t.bestanden.reduce((n, b) => n + b.bytes.length, 0);
      const tokensIn = Math.ceil(bytes / 4);
      const json = t.voorbeeld ?? { echo: true };
      const tokensUit = Math.ceil(JSON.stringify(json).length / 4);
      const kost = kostUsdMicro(m, tokensIn, tokensUit);
      switch (m.apiId) {
        case "fout-opnieuw":
          return { ok: false, klasse: "opnieuw", tekst: "nep: 503 overbelast" };
        case "fout-ongeldig":
          return { ok: false, klasse: "ongeldig", tekst: "nep: 400 ongeldig verzoek", tokensIn, tokensUit: 0, kostUsdMicro: kostUsdMicro(m, tokensIn, 0) };
        case "fout-lek":
          // Een leverancier die (fout) de sleutel in zijn foutmelding terugstuurt: scrub moet die eruit halen.
          return { ok: false, klasse: "opnieuw", tekst: `nep: 500 interne fout, key=${lekSleutel} Authorization: Bearer ${lekSleutel}` };
        case "fout-schema":
          return { ok: true, json: { iets: "anders" }, tokensIn, tokensUit, tokensCache: 0, kostUsdMicro: kost, duurMs: 1, modelId: m.id };
        case "tekst":
          return { ok: true, json: { ...(json as object), invoerLengte: t.invoerTekst.length }, tokensIn, tokensUit, tokensCache: 0, kostUsdMicro: kost, duurMs: 1, modelId: m.id };
        case "traag":
          await new Promise<void>((ok) => {
            const h = setTimeout(ok, NEP_TRAAG_MS);
            t.signal?.addEventListener("abort", () => (clearTimeout(h), ok()), { once: true });
          });
          if (t.signal?.aborted) return { ok: false, klasse: "onzeker", tekst: "nep: afgebroken" };
          return { ok: true, json, tokensIn, tokensUit, tokensCache: 0, kostUsdMicro: kost, duurMs: NEP_TRAAG_MS, modelId: m.id };
        default:
          return { ok: true, json, tokensIn, tokensUit, tokensCache: 0, kostUsdMicro: kost, duurMs: 1, modelId: m.id };
      }
    },
  };
}
