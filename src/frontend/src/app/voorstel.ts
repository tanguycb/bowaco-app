// 4b.6 Voorstelscherm en "wie deed wat" (bouwplan §9 fase 4b, rij 4b.6). Zuivere kern zonder React en zonder backend-import, zodat
// tests/proef-4b-6.mjs ze rechtstreeks laadt (Node type-stripping: geen enums, geen parameter properties).
// Het model (lib/Tasks.mo) bewaart geen bedragen en geen tekst van een assistent; een punt met `secret` heeft er geen waarde. De
// waarden "nu" en "na" vult het scherm uit het DOSSIER (readOaRead, readAiCheck, readInvCheck: update-calls met auditregel en de
// rechten van het bronscherm) of uit het werkblad zelf (de huidige keuze bij vergelijken). Wie het dossier niet mag lezen, ziet
// "vertrouwelijk" of niets (listTasksFor geeft dan full = false: geen punten).

export type Punt = { key: string; now: string; after: string; source: string; secret: boolean; adjusted: boolean };
export type Gebeurtenis = { at: bigint; who: string; whoName: string; what: string };
export type Voorstel = { id: bigint; by: string; byName: string; at: bigint; auto: boolean; confidence?: bigint; points: Punt[]; actionId?: bigint; state: string; decidedBy: string; decidedByName: string; decidedAt?: bigint; undo: string };
export type Taak = { id: bigint; key: string; kind: string; name: string; workId?: bigint; workCode: string; subject: string; givenBy: string; givenByName: string; doer: string; doerName: string; createdAt: bigint; state: string; updatedAt: bigint; proposal?: Voorstel; events: Gebeurtenis[] };
export type Gezien = { task: Taak; full: boolean; subjectLabel: string };

// ── Woorden (nooit "AI"; een bot heet "assistent") ──────────────────────
export const TAAK_STAND: Record<string, string> = { wacht: "wacht", bezig: "bezig", voorstel: "voorstel klaar", klaar: "klaar", mislukt: "mislukt", geannuleerd: "geannuleerd" };
export const VOORSTEL_STAND: Record<string, string> = {
  open: "open", aanvaard: "aanvaard", aangepast: "aangepast aanvaard", geweigerd: "geweigerd", zelf: "zelf gedaan",
  ongedaan: "ongedaan gemaakt", vervallen: "vervallen", ingetrokken: "ingetrokken",
};
export const SOORT: Record<string, string> = {
  "oa-offerte-inlezen": "OA-offerte inlezen", "offertes-vergelijken": "OA-offertes vergelijken", "offerte-nalezen": "Offerte nalezen",
  factuurcontrole: "Factuurcontrole", "document-koppelen": "Document koppelen",
};
const PUNT: Record<string, string> = {
  regels: "Regels", datum: "Datum", "btw-verlegd": "Btw verlegd", totaal: "Totaal", oordeel: "Oordeel", keuzes: "Posten met een keuze",
  bevindingen: "Opmerkingen", soort: "Soort document", opmerkingen: "Opmerkingen", tool: "Handeling",
};
const OORDEEL: Record<string, string> = {
  keuze: "een firma per post", "geen-keuze": "geen keuze", in_orde: "in orde", opmerkingen: "met opmerkingen",
  goedkeuren: "goedkeuren", betwisten: "betwisten", nakijken: "nakijken", ander: "ander",
};

/** De regel van een tijdlijn in gewone taal: "voorstel:aanvaard" → "aanvaardde het voorstel". */
export function gebeurtenisTekst(what: string): string {
  const [soort, stand] = what.split(":");
  if (soort === "taak") {
    return ({ wacht: "gaf de taak", bezig: "begon eraan", klaar: "taak klaar", mislukt: "taak mislukt", geannuleerd: "annuleerde de taak", voorstel: "voorstel klaar" } as Record<string, string>)[stand] ?? `taak: ${stand}`;
  }
  if (soort === "voorstel") {
    return ({
      open: "deed een voorstel", aanvaard: "aanvaardde het voorstel", aangepast: "paste het voorstel aan en aanvaardde",
      geweigerd: "weigerde het voorstel", zelf: "deed het zelf (Zelf doen)", ongedaan: "maakte het ongedaan",
      vervallen: "voorstel vervallen", ingetrokken: "voorstel ingetrokken",
    } as Record<string, string>)[stand] ?? `voorstel: ${stand}`;
  }
  return what;
}

/** Wie: een assistent (bot of de Caffeine-weg) of een persoon. */
export function isAssistent(who: string): boolean { return who.startsWith("bot:") || who.startsWith("app:"); }

export function puntLabel(key: string, postNaam?: (itemId: string) => string): string {
  if (key.startsWith("post:")) return postNaam?.(key.slice(5)) ?? `Post ${key.slice(5)}`;
  return PUNT[key] ?? key;
}

export function waardeTekst(key: string, v: string): string {
  if (v === "") return "—";
  if (key === "oordeel" || key === "soort") return OORDEEL[v] ?? v;
  if (key === "btw-verlegd") return v === "ja" ? "ja" : v === "nee" ? "nee" : v;
  return v;
}

/** De bron van een punt in woorden ("bestand", "OA-offerte van Firma X", "factuur"). */
export function bronTekst(source: string, firmaVan?: (oaQuoteId: string) => string | undefined): string {
  const [soort, id] = source.split(":");
  switch (soort) {
    case "bestand": return "het ingelezen bestand";
    case "tekst": return "de geplakte tekst";
    case "prijsvraag": return "de prijsvraag";
    case "offerteversie": return "de offerteversie";
    case "oa-offerte": { const f = firmaVan?.(id); return f ? `OA-offerte van ${f}` : "een OA-offerte"; }
    case "oa-factuur": return "de OA-factuur";
    case "document": return "het document";
    case "firma": return "de firma";
    case "": return "—";
    default: return soort;
  }
}

export type Regel = { key: string; label: string; nu: string; na: string; bron: string; geheim: boolean; aangepast: boolean };

/** De punten van een voorstel als regels "nu → na aanvaarden". `nu`/`na` uit het dossier of het werkblad overschrijven het model
 *  (dat geen bedragen kent); een geheim punt zonder dossierwaarde blijft "vertrouwelijk". */
export function regels(t: Taak, o: {
  postNaam?: (itemId: string) => string;
  firmaVan?: (oaQuoteId: string) => string | undefined;
  nu?: (key: string) => string | undefined;
  na?: (key: string) => string | undefined;
} = {}): Regel[] {
  const p = t.proposal;
  if (!p) return [];
  return p.points.map((x) => {
    const naDossier = o.na?.(x.key);
    const nuDossier = o.nu?.(x.key);
    const na = naDossier ?? (x.secret ? "vertrouwelijk" : x.key.startsWith("post:") ? (x.after === "" ? "geen firma" : o.firmaVan?.(x.after) ?? `OA-offerte ${x.after}`) : waardeTekst(x.key, x.after));
    const nu = nuDossier ?? (x.secret ? "vertrouwelijk" : x.now === "" ? "—" : waardeTekst(x.key, x.now));
    return { key: x.key, label: puntLabel(x.key, o.postNaam), nu, na, bron: bronTekst(x.source, o.firmaVan), geheim: x.secret && naDossier === undefined, aangepast: x.adjusted };
  });
}

/** Mag de kijker beslissen? Enkel met de volle rechten van het bronscherm en een open voorstel. */
export function kanBeslissen(g: Gezien): boolean { return g.full && g.task.state === "voorstel" && g.task.proposal?.state === "open"; }
/** Ongedaan maken: het model zegt welke handeling ("intrekken", "ontkoppelen"); enkel met de volle rechten. */
export function ongedaanHandeling(g: Gezien): string { return g.full ? g.task.proposal?.undo ?? "" : ""; }

export type TijdRegel = { at: bigint; key: string; taak: string; stuk: string; wie: string; assistent: boolean; wat: string };

/** Wie deed wat over een reeks taken (per werf of per stuk): nieuwste eerst. */
export function wieDeedWat(items: Gezien[]): TijdRegel[] {
  const out: TijdRegel[] = [];
  for (const g of items) {
    for (const e of g.task.events) {
      out.push({ at: e.at, key: g.task.key, taak: SOORT[g.task.kind] ?? g.task.name, stuk: g.subjectLabel, wie: e.whoName || (isAssistent(e.who) ? g.task.name : "BOWACO"), assistent: isAssistent(e.who), wat: gebeurtenisTekst(e.what) });
    }
  }
  return out.sort((a, b) => (a.at === b.at ? (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) : a.at > b.at ? -1 : 1));
}

/** Het meest relevante voorstel over een stuk: een open voorstel eerst, anders het nieuwste. */
export function huidige(items: Gezien[], kind?: string): Gezien | undefined {
  const xs = items.filter((g) => !kind || g.task.kind === kind);
  return xs.find((g) => g.task.state === "voorstel") ?? xs.find((g) => g.task.proposal !== undefined) ?? xs[0];
}

/** De bron van een taak ("check:12" → {soort: "check", id: 12n}). */
export function bronVan(key: string): { soort: string; id: bigint } | null {
  const i = key.indexOf(":");
  if (i < 0) return null;
  const n = key.slice(i + 1);
  return /^\d+$/.test(n) ? { soort: key.slice(0, i), id: BigInt(n) } : null;
}
