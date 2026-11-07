// De kern van een AI-taak, gedeeld door /v2/taak en de proefbank: model(len) proberen met tijdslimiet, uitvoer
// tegen het schema, kost in eurocent, en terugval naar een 2e leverancier ENKEL bij klasse "opnieuw" en enkel als de
// aanroeper een terugvalmodel meegaf (fiche.fallback + taak.terugval). Nooit terugval bij ongeldig (zelfde invoer geeft
// wellicht hetzelfde), onzeker (misschien al betaald), budget of sleutel (ontwerp §2.6).
import type { Bestand } from "./bestanden.ts";
import { type Leveranciers, levVan, modelInfo } from "./leveranciers/index.ts";
import { type Klasse, type LevNaam, kostUsdMicro, metTijdslimiet, naarCent, ramingTokensIn } from "./leveranciers/leverancier.ts";
import { type InstructieVersie, type TaakDef, valideer } from "./taken/taak.ts";

export type Resultaat = {
  ok: boolean;
  json?: unknown;
  status: number;
  code: string;
  tekst: string;
  klasse?: Klasse;
  model: string;
  leverancier: LevNaam | null;
  tokensIn: number;
  tokensUit: number;
  tokensCache: number;
  kostCent: number;
  duurMs: number;
  terugval: boolean;
  pogingen: number; // aantal echte oproepen bij een leverancier
};

export type BudgetHaak = {
  voor(lev: LevNaam, ramingCent: number): boolean; // false = 429 budget
  na(lev: LevNaam, ramingCent: number, kostCent: number, fout: boolean): void;
};

export const STATUS_VAN_KLASSE: Record<Klasse, [number, string]> = {
  ongeldig: [502, "leverancier"],
  opnieuw: [502, "leverancier"],
  onzeker: [504, "tijd"],
  budget: [429, "budget"],
  sleutel: [503, "sleutel"],
};

export async function voerUit(o: {
  taak: TaakDef;
  versie: InstructieVersie;
  modellen: string[]; // [hoofdmodel, terugvalmodel?]
  invoerTekst: string;
  bestanden: Bestand[];
  leveranciers: Leveranciers;
  tijdslimietMs: number;
  usdEurMilli: number;
  maxBeeldPx: number;
  budget?: BudgetHaak;
}): Promise<Resultaat> {
  const r: Resultaat = { ok: false, status: 500, code: "500", tekst: "", model: o.modellen[0] ?? "", leverancier: null, tokensIn: 0, tokensUit: 0, tokensCache: 0, kostCent: 0, duurMs: 0, terugval: false, pogingen: 0 };
  const start = Date.now();
  for (const [i, id] of o.modellen.entries()) {
    const info = modelInfo(id);
    const lev = o.leveranciers[levVan(id)];
    r.model = id;
    r.leverancier = lev?.naam ?? null;
    r.terugval = i > 0;
    if (!info || !lev) return { ...r, status: 422, code: "model", tekst: "model onbekend" };
    if (!lev.ingesteld()) return { ...r, status: 503, code: "sleutel", tekst: `${lev.naam} niet ingesteld` };
    const taak = { model: id, systeem: o.versie.systeem, invoerTekst: o.invoerTekst, bestanden: o.bestanden, schema: o.versie.schema, maxUit: o.versie.maxUit, tijdslimietMs: o.tijdslimietMs, inspanning: o.versie.inspanning, voorbeeld: o.taak.voorbeeld };
    const raming = naarCent(kostUsdMicro(info, ramingTokensIn(taak, o.maxBeeldPx), o.versie.maxUit), o.usdEurMilli);
    if (o.budget && !o.budget.voor(lev.naam, raming)) return { ...r, status: 429, code: "budget", tekst: "budget op (ticket of plafond van de gateway)", duurMs: Date.now() - start };
    r.pogingen++;
    const u = await metTijdslimiet(lev, taak);
    const kost = u.ok || u.kostUsdMicro !== undefined ? naarCent(u.kostUsdMicro ?? 0, o.usdEurMilli) : u.klasse === "onzeker" ? raming : 0;
    o.budget?.na(lev.naam, raming, kost, !u.ok);
    r.kostCent += kost;
    r.tokensIn += u.tokensIn ?? 0;
    r.tokensUit += u.tokensUit ?? 0;
    if (u.ok) {
      r.tokensCache += u.tokensCache;
      const fout = valideer(o.versie.schema, u.json);
      if (fout) return { ...r, status: 502, code: "leverancier", klasse: "ongeldig", tekst: `uitvoer past niet in het schema (${fout})`, duurMs: Date.now() - start };
      return { ...r, ok: true, json: u.json, status: 202, code: "ok", tekst: "", duurMs: Date.now() - start };
    }
    r.klasse = u.klasse;
    r.tekst = u.tekst;
    if (u.klasse === "opnieuw" && i + 1 < o.modellen.length) continue;
    const [status, code] = STATUS_VAN_KLASSE[u.klasse];
    return { ...r, status, code, duurMs: Date.now() - start };
  }
  return { ...r, status: 422, code: "model", tekst: "geen model", duurMs: Date.now() - start };
}
