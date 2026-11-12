// De balk (stap 4b.2): zoeken en doen in één venster, zonder taalmodel. Dit bestand = de zuivere kern (geen React): de index
// opbouwen uit wat de bestaande, rechtengebonden queries de beller geven, en zoeken in die index. Zo kan tests/proef-4b-2.mjs
// dezelfde code per rol tegen een echte canister draaien.
// Regels: (1) elke bron wordt enkel gevraagd als de rol (caps) ze mag lezen, en de backend weigert sowieso wat niet mag; een
// geweigerde bron geeft gewoon geen resultaten. (2) Een regel bewaart enkel soort, titel, ondertitel (code/naam/gemeente) en het
// adres van het scherm: GEEN bedragen, geen telefoon of e-mail, geen opslag-URL's, geen vertrouwelijke velden. (3) Een handeling
// opent het gewone scherm; niets wordt uitgevoerd zonder het gewone formulier en zijn bevestiging.
import type { backendInterface, Caps } from "../backend";
import { beheerTabs, hubTabs, navFor, pagesFor } from "../app/nav";
import { t } from "../texts/nl";

export type Soort = "handeling" | "scherm" | "werf" | "firma" | "persoon" | "offerte" | "factuur" | "document";
export type Regel = {
  soort: Soort;
  id: string;
  titel: string;
  sub: string;
  /** Het adres (hash zonder #/), of "verslag" voor de werfkeuze van het werfverslag. */
  to: string;
  /** Gevouwen zoektekst (zonder accenten, kleine letters). */
  hay: string;
};

const B = t.balk;
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const mk = (soort: Soort, id: string, titel: string, sub: string, to: string, extra: string[] = []): Regel => ({ soort, id: `${soort}:${id}`, titel, sub, to, hay: fold([titel, sub, ...extra].join(" ")) });

/** De schermen en handelingen van de rol: volgen uit dezelfde functies als het menu (nav.ts), dus nooit meer dan het menu. */
export function lokaleRegels(caps: Caps): Regel[] {
  const out: Regel[] = [];
  const seen = new Set<string>();
  const scherm = (titel: string, to: string, sub: string, extra: string[] = []) => {
    if (seen.has(to)) return;
    seen.add(to);
    out.push(mk("scherm", to, titel, sub, to, extra));
  };
  scherm(t.todo.title, "te-doen", B.scherm);
  if (caps.readTeam) scherm(t.assistenten.title, "assistenten", B.scherm, ["taak", "geven", "score"]);
  for (const g of navFor(caps)) for (const i of g.items) scherm(i.label, i.to, g.label ?? B.scherm);
  for (const key of pagesFor(caps)) for (const tb of hubTabs(key, caps)) scherm(tb.label, tb.to, B.scherm);
  for (const tb of beheerTabs(caps)) scherm(`${t.menu.beheer}: ${tb.label}`, tb.to, B.scherm);
  scherm(t.nav.login, "login", B.scherm);

  const doe = (id: string, titel: string, to: string, extra: string[] = []) => out.push(mk("handeling", id, titel, B.handeling, to, extra));
  if (caps.createWork) doe("nieuwe-werf", B.doe.nieuweWerf, "werven/nieuw", ["aanvraag", "werf", "toevoegen", "maken"]);
  if (caps.manageOrgs) doe("nieuwe-firma", B.doe.nieuweFirma, "adresboek/nieuw", ["onderaannemer", "klant", "toevoegen", "maken"]);
  if (caps.oaInvoices && caps.quotePrices) doe("nieuwe-oa-factuur", B.doe.nieuweOaFactuur, "oa-facturen/nieuw", ["onderaannemer", "factuur", "registreren"]);
  if (caps.purchases) doe("nieuwe-aankoop", B.doe.nieuweAankoop, "oa-facturen/aankoop/nieuw", ["aankoop", "factuur", "leverancier"]);
  if (caps.writeReports) doe("werfverslag", B.doe.werfverslag, "verslag", ["verslag", "schrijven", "vandaag", "foto"]);
  if (caps.quotes) doe("offertes", B.doe.offertes, "offertes", ["offerte", "openen"]);
  if (caps.tenders) doe("prijsvragen", B.doe.prijsvragen, "prijsvragen", ["prijsvraag", "openen"]);
  return out;
}

type Bron<T> = { naam: string; ok: boolean; vraag: () => Promise<T[]> };

/** Eén begrensde doorloop van de bestaande lijst-queries die de rol mag. Elke bron die faalt of geweigerd wordt, telt gewoon niet mee. */
export async function laadIndex(actor: backendInterface, caps: Caps): Promise<Regel[]> {
  const stad = (a: { street: string; number: string; city: string }) => a.city;
  const werven: Bron<Regel> = {
    naam: "werven", ok: true,
    vraag: async () => {
      const ws = await actor.listWorks();
      return ws.flatMap((w) => [
        mk("werf", String(w.id), `${w.code} · ${w.name}`, [stad(w.address), B.soort.werf].filter(Boolean).join(" · "), `werven/${w.id}`, [w.address.street, w.address.zip]),
        mk("document", String(w.id), `${B.documentenVan} ${w.code}`, w.name, `werven/${w.id}/documenten`, [w.code, w.name, "dossier", "bestand", "document", "bijlage"]),
      ]);
    },
  };
  const firmas: Bron<Regel> = {
    naam: "firmas", ok: caps.readTeam || caps.readOa,
    vraag: async () => (await actor.listOrgs(false)).filter((o) => o.kind !== "bowaco").map((o) => mk("firma", String(o.id), o.name, [o.address?.city, B.soort.firma].filter(Boolean).join(" · "), `adresboek/${o.id}`, o.aliases)),
  };
  const personen: Bron<Regel> = {
    naam: "personen", ok: caps.readTeam,
    vraag: async () => (await actor.listPersons(false)).map((p) => mk("persoon", String(p.id), p.name, B.soort.persoon, p.orgId !== undefined ? `adresboek/${p.orgId}` : "team", p.shortCode !== undefined ? [p.shortCode] : [])),
  };
  // Let op: listQuotes geeft hoogstens Config.maxQuoteRead (400) offertes, de nieuwste eerst; oudere zoek je via de werf.
  const offertes: Bron<Regel> = {
    naam: "offertes", ok: caps.quotes,
    vraag: async () => (await actor.listQuotes(null, false)).map((q) => mk("offerte", String(q.id), `${q.number} · ${q.title}`, [q.workCode, q.clientName].filter(Boolean).join(" · "), `werven/${q.workId}/offerte`, [q.workName])),
  };
  const facturen: Bron<Regel> = {
    naam: "facturen", ok: caps.oaInvoices,
    vraag: async () => (await actor.listOaInvoices(null, null)).map((i) => mk("factuur", String(i.id), `${i.number} · ${i.orgName}`, [i.workCode, B.soort.factuur].join(" · "), `oa-facturen/${i.id}`, [i.workName])),
  };
  const regels = lokaleRegels(caps);
  const res = await Promise.all([werven, firmas, personen, offertes, facturen].map(async (b) => {
    if (!b.ok) return [] as Regel[];
    try { return await b.vraag(); } catch { return [] as Regel[]; }
  }));
  const seen = new Set<string>();
  return [...regels, ...res.flat()].filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

const VOLGORDE: Soort[] = ["handeling", "scherm", "werf", "firma", "persoon", "offerte", "factuur", "document"];
const PER_SOORT = 5;

/** Zoeken op woorden (alle woorden moeten voorkomen); begin van de titel of van een woord weegt zwaarder. Zonder tekst: de handelingen en de schermen. */
export function zoek(index: Regel[], tekst: string): Regel[] {
  const q = fold(tekst).trim();
  if (q === "") return [...index.filter((r) => r.soort === "handeling"), ...index.filter((r) => r.soort === "scherm")].slice(0, 12);
  const woorden = q.split(/\s+/).filter(Boolean);
  const scored: { r: Regel; s: number }[] = [];
  for (const r of index) {
    let s = 0;
    const tit = fold(r.titel);
    let all = true;
    for (const w of woorden) {
      if (!r.hay.includes(w)) { all = false; break; }
      s += tit.startsWith(w) ? 30 : tit.includes(` ${w}`) || tit.includes(`· ${w}`) ? 20 : tit.includes(w) ? 10 : 3;
    }
    if (!all) continue;
    if (tit === q) s += 50;
    scored.push({ r, s });
  }
  scored.sort((a, b) => b.s - a.s || a.r.titel.localeCompare(b.r.titel, "nl"));
  const out: Regel[] = [];
  for (const soort of VOLGORDE) out.push(...scored.filter((x) => x.r.soort === soort).slice(0, PER_SOORT).map((x) => x.r));
  return out;
}
