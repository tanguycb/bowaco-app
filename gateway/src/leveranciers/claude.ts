// Adapter Anthropic (Messages API, rechtstreeks met fetch: geen SDK-pakket in de gateway, zie open punten).
// - PDF als `document`-blok, afbeeldingen als `image`-blok (base64), CSV/XLSX als tekstblok, alle in het afgebakende
//   DOCUMENT-blok; de systeeminstructie zegt dat documenttekst nooit een opdracht is (ontwerp §5.1).
// - JSON via structured outputs (`output_config.format = json_schema`). Afwijking van het ontwerp (§3.4 zei "één
//   verplichte tool"): een geforceerde `tool_choice` geeft op de huidige modellen (Sonnet 5.5, Opus 5.5) een 400.
// - Geen `temperature`: API-versie 2026-10-21 weigert sampling-parameters op elk model.
// - Kost uit de prijstabel hieronder (per model, met datum), NIET uit het antwoord.
import type { Config } from "../config.ts";
import type { Sleutels } from "../sleutels.ts";
import { DOC_KOP, type Leverancier, type ModelInfo, type Taak, type Uitkomst, klasseVanNetfout, klasseVanStatus, kostUsdMicro } from "./leverancier.ts";

const BEELD = ["jpeg", "png", "webp"] as const;
export const CLAUDE_MODELLEN: ModelInfo[] = [
  { id: "claude/sonnet-5.5", apiId: "claude-sonnet-5-5", inUsdPerM: 2, uitUsdPerM: 10, bestanden: ["pdf", ...BEELD, "xlsx", "csv"], prijsDatum: "2026-10-06" },
  { id: "claude/haiku-5.5", apiId: "claude-haiku-5-5", inUsdPerM: 0.1, uitUsdPerM: 0.5, bestanden: ["pdf", ...BEELD, "xlsx", "csv"], prijsDatum: "2026-10-06" },
  { id: "claude/opus-5.5", apiId: "claude-opus-5-5", inUsdPerM: 4, uitUsdPerM: 20, bestanden: ["pdf", ...BEELD, "xlsx", "csv"], prijsDatum: "2026-10-06" },
];
export const ANTHROPIC_VERSIE = "2026-10-21";

export function maakClaude(cfg: Pick<Config, "basis">, sleutels: Sleutels, fetcher: typeof fetch = fetch): Leverancier {
  return {
    naam: "claude",
    ingesteld: () => sleutels.get("claude") !== null,
    modellen: async () => CLAUDE_MODELLEN,
    async run(t: Taak): Promise<Uitkomst> {
      const m = CLAUDE_MODELLEN.find((x) => x.id === t.model);
      if (!m) return { ok: false, klasse: "ongeldig", tekst: "model niet toegelaten" };
      const sleutel = sleutels.get("claude");
      if (!sleutel) return { ok: false, klasse: "sleutel", tekst: "claude niet ingesteld" };
      const inhoud: unknown[] = [];
      for (const b of t.bestanden) {
        if (b.soort === "pdf") inhoud.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b.bytes.toString("base64") } });
        else if (b.soort === "jpeg" || b.soort === "png" || b.soort === "webp") inhoud.push({ type: "image", source: { type: "base64", media_type: b.mime, data: b.bytes.toString("base64") } });
        else if (b.tekst !== undefined) inhoud.push({ type: "text", text: `${DOC_KOP}\n<<<\n${b.tekst}\n>>>` });
        else return { ok: false, klasse: "ongeldig", tekst: `bestandssoort ${b.soort} niet voor claude` };
      }
      inhoud.push({ type: "text", text: t.invoerTekst });
      const body = {
        model: m.apiId,
        max_tokens: t.maxUit,
        system: t.systeem,
        messages: [{ role: "user", content: inhoud }],
        output_config: { format: { type: "json_schema", schema: t.schema }, ...(t.inspanning ? { effort: t.inspanning } : {}) },
      };
      const start = Date.now();
      let res: Response;
      try {
        res = await fetcher(`${cfg.basis.claude}/v1/messages`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": sleutel, "anthropic-version": ANTHROPIC_VERSIE },
          body: JSON.stringify(body),
          signal: t.signal,
        });
      } catch (e) {
        return { ok: false, klasse: klasseVanNetfout(e), tekst: String((e as Error)?.message ?? e) };
      }
      const tekst = await res.text().catch(() => "");
      const duurMs = Date.now() - start;
      if (!res.ok) return { ok: false, klasse: klasseVanStatus(res.status, tekst), tekst: `claude ${res.status}: ${tekst}`, duurMs };
      let a: {
        stop_reason?: string;
        content?: { type: string; text?: string }[];
        usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
      };
      try {
        a = JSON.parse(tekst);
      } catch {
        return { ok: false, klasse: "ongeldig", tekst: "claude: antwoord geen JSON", duurMs };
      }
      const u = a.usage ?? {};
      const tokensCache = (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      const tokensIn = (u.input_tokens ?? 0) + tokensCache;
      const tokensUit = u.output_tokens ?? 0;
      const kost = kostUsdMicro(m, tokensIn, tokensUit);
      if (a.stop_reason === "refusal") return { ok: false, klasse: "ongeldig", tekst: "claude weigerde (refusal)", tokensIn, tokensUit, kostUsdMicro: kost, duurMs };
      if (a.stop_reason === "max_tokens") return { ok: false, klasse: "ongeldig", tekst: "claude: antwoord afgekapt (max_tokens)", tokensIn, tokensUit, kostUsdMicro: kost, duurMs };
      const txt = (a.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
      try {
        return { ok: true, json: JSON.parse(txt), tokensIn, tokensUit, tokensCache, kostUsdMicro: kost, duurMs, modelId: m.id };
      } catch {
        return { ok: false, klasse: "ongeldig", tekst: "claude: uitvoer geen JSON", tokensIn, tokensUit, kostUsdMicro: kost, duurMs };
      }
    },
  };
}
