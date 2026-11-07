// Adapter xAI (Grok, OpenAI-compatibele chat): `response_format json_schema` (strict), afbeeldingen als `image_url`
// met data:-URI, CSV/XLSX als tekst in het DOCUMENT-blok. PDF niet rechtstreeks: "tekst eerst" vraagt een
// PDF-tekstbibliotheek die er in 3.1 niet is → een taak met PDF krijgt op grok `422 bestanden`.
// PRIJZEN EN MODELNAMEN NAKIJKEN bij xAI vóór de eerste echte oproep (open punt); ze staan bewust aan de hoge kant,
// zodat de raming eerder te veel dan te weinig reserveert.
import type { Config } from "../config.ts";
import type { Sleutels } from "../sleutels.ts";
import { DOC_KOP, type Leverancier, type ModelInfo, type Taak, type Uitkomst, klasseVanNetfout, klasseVanStatus, kostUsdMicro } from "./leverancier.ts";

export const GROK_MODELLEN: ModelInfo[] = [
  { id: "grok/grok-4", apiId: "grok-4", inUsdPerM: 3, uitUsdPerM: 15, bestanden: ["jpeg", "png", "webp", "xlsx", "csv"], prijsDatum: "nakijken" },
  { id: "grok/grok-4-mini", apiId: "grok-4-mini", inUsdPerM: 0.6, uitUsdPerM: 4, bestanden: ["jpeg", "png", "webp", "xlsx", "csv"], prijsDatum: "nakijken" },
];

export function maakGrok(cfg: Pick<Config, "basis">, sleutels: Sleutels, fetcher: typeof fetch = fetch): Leverancier {
  return {
    naam: "grok",
    ingesteld: () => sleutels.get("grok") !== null,
    modellen: async () => GROK_MODELLEN,
    async run(t: Taak): Promise<Uitkomst> {
      const m = GROK_MODELLEN.find((x) => x.id === t.model);
      if (!m) return { ok: false, klasse: "ongeldig", tekst: "model niet toegelaten" };
      const sleutel = sleutels.get("grok");
      if (!sleutel) return { ok: false, klasse: "sleutel", tekst: "grok niet ingesteld" };
      const inhoud: unknown[] = [];
      for (const b of t.bestanden) {
        if (b.soort === "jpeg" || b.soort === "png" || b.soort === "webp") inhoud.push({ type: "image_url", image_url: { url: `data:${b.mime};base64,${b.bytes.toString("base64")}` } });
        else if (b.tekst !== undefined) inhoud.push({ type: "text", text: `${DOC_KOP}\n<<<\n${b.tekst}\n>>>` });
        else return { ok: false, klasse: "ongeldig", tekst: `bestandssoort ${b.soort} niet voor grok` };
      }
      inhoud.push({ type: "text", text: t.invoerTekst });
      const body = {
        model: m.apiId,
        max_tokens: t.maxUit,
        messages: [
          { role: "system", content: t.systeem },
          { role: "user", content: inhoud },
        ],
        response_format: { type: "json_schema", json_schema: { name: "antwoord", schema: t.schema, strict: true } },
      };
      const start = Date.now();
      let res: Response;
      try {
        res = await fetcher(`${cfg.basis.grok}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${sleutel}` },
          body: JSON.stringify(body),
          signal: t.signal,
        });
      } catch (e) {
        return { ok: false, klasse: klasseVanNetfout(e), tekst: String((e as Error)?.message ?? e) };
      }
      const tekst = await res.text().catch(() => "");
      const duurMs = Date.now() - start;
      if (!res.ok) return { ok: false, klasse: klasseVanStatus(res.status, tekst), tekst: `grok ${res.status}: ${tekst}`, duurMs };
      let a: {
        choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
      };
      try {
        a = JSON.parse(tekst);
      } catch {
        return { ok: false, klasse: "ongeldig", tekst: "grok: antwoord geen JSON", duurMs };
      }
      const tokensIn = a.usage?.prompt_tokens ?? 0;
      const tokensUit = a.usage?.completion_tokens ?? 0;
      const kost = kostUsdMicro(m, tokensIn, tokensUit);
      const c = a.choices?.[0];
      if (c?.message?.refusal) return { ok: false, klasse: "ongeldig", tekst: "grok weigerde (refusal)", tokensIn, tokensUit, kostUsdMicro: kost, duurMs };
      if (c?.finish_reason === "length") return { ok: false, klasse: "ongeldig", tekst: "grok: antwoord afgekapt", tokensIn, tokensUit, kostUsdMicro: kost, duurMs };
      try {
        return { ok: true, json: JSON.parse(c?.message?.content ?? ""), tokensIn, tokensUit, tokensCache: a.usage?.prompt_tokens_details?.cached_tokens ?? 0, kostUsdMicro: kost, duurMs, modelId: m.id };
      } catch {
        return { ok: false, klasse: "ongeldig", tekst: "grok: uitvoer geen JSON", tokensIn, tokensUit, kostUsdMicro: kost, duurMs };
      }
    },
  };
}
