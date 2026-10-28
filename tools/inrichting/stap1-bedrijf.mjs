// Stap 2b.6 stap 1: bedrijf en tellers (plan van tools/inrichting/lees-bedrijf.py). Idempotent: elke instelling wordt
// enkel gezet als ze verschilt; de voorwaarden komen er enkel bij als dezelfde tekst er nog niet staat. Enkel de
// beheerder (manageSettings, editLibrary).
import { fold, ok, NAKIJKEN } from "./lib.mjs";
import { hoofdstukkenZeker } from "./stap4-posten.mjs";

export async function stap1({ actor, plan, echt, verslag, zou }) {
  const S = 1;
  const doc = await actor.getQuoteDocSettings();
  // Enkel zetten zolang de app nog de standaard heeft (de ingebouwde afzender met "[…in te vullen…]" en 30 dagen); wat
  // de beheerder intussen aanpaste, zet een nieuwe run niet terug.
  const standaard = /\[.*in te vullen/i.test(doc.issuer) && Number(doc.paymentDays) === 30;
  if (doc.issuer.trim() === plan.afzender.trim() && Number(doc.paymentDays) === plan.betaaltermijn) verslag.add(S, "afzender en betaaltermijn", "offerte", "", "overgeslagen", "al ingesteld");
  else if (!standaard) verslag.add(S, "afzender en betaaltermijn", "offerte", "", "conflict", "al aangepast in de app: niet overschreven (verschil nakijken in Beheer)");
  else {
    if (echt) ok(await actor.setQuoteDocSettings({ issuer: plan.afzender, paymentDays: BigInt(plan.betaaltermijn) }), "afzender");
    verslag.add(S, "afzender en betaaltermijn", "offerte", "", "bijgewerkt", `afzender (${Object.entries(plan.afzenderGevonden).filter(([, v]) => v).map(([k]) => k).join(", ")}); betaaltermijn ${plan.betaaltermijn} dagen (${NAKIJKEN.toLowerCase()}, vraag D4)`);
  }
  for (const [k, v] of Object.entries(plan.afzenderGevonden)) if (!v) verslag.add(S, "afzender", k, "", "conflict", "niet gevonden in het sjabloon: in te vullen in Instellingen");

  const v = plan.voorwaarden;
  const zelfde = doc.terms.find((t) => fold(t.text) === fold(v.tekst));
  if (zelfde) verslag.add(S, "voorwaarden", `versie ${zelfde.version}`, v.titel, "overgeslagen", "dezelfde tekst staat er al");
  else {
    let nr = "?";
    if (echt) nr = String(ok(await actor.addQuoteTerms({ title: v.titel, text: v.tekst, provisional: v.nakijken, note: v.notitie }), "voorwaarden"));
    verslag.add(S, "voorwaarden", `versie ${nr}`, v.titel, "aangemaakt", `${v.tekst.length} tekens; ${v.notitie}`);
  }

  const { jaar, laatste } = plan.offertenummer;
  const nu = Number(await actor.quoteSequence(BigInt(jaar)));
  if (nu >= laatste) verslag.add(S, "offertenummer", String(jaar), `laatste ${nu}`, "overgeslagen", `al op ${nu} of hoger`);
  else {
    if (echt) ok(await actor.setQuoteSequence(BigInt(jaar), BigInt(laatste)), "offertenummer");
    verslag.add(S, "offertenummer", String(jaar), `laatste ${laatste}`, "bijgewerkt", `volgende offerte ${jaar}/${laatste + 1}; de nummering loopt door over de jaren (${NAKIJKEN.toLowerCase()}, vraag D1)`);
  }

  const units = await actor.libraryUnits(true);
  const max = units.reduce((m, u) => (u.order > m ? u.order : m), 0n);
  let i = 0;
  for (const e of plan.eenheden) {
    if (units.some((u) => u.key === e.key)) { verslag.add(S, "eenheid", e.key, e.naam, "overgeslagen", "bestaat al"); continue; }
    i++;
    if (echt) {
      const r = await actor.setLibraryUnit({ key: e.key, name: e.naam, order: max + BigInt(i * 10), archived: false });
      if ("err" in r) { verslag.add(S, "eenheid", e.key, e.naam, "fout", r.err); continue; }
    } else zou?.eenheden.add(e.key);
    verslag.add(S, "eenheid", e.key, e.naam, "aangemaakt", `${e.gebruik} posten in de offertes; ${NAKIJKEN.toLowerCase()} (vraag D10)`);
  }

  await hoofdstukkenZeker(actor, plan.hoofdstukken, echt, verslag, S, `${NAKIJKEN} (vraag D6): hoofdstuklijst uit de offertes van 2023–2026`, zou);

  const std = ok(await actor.readLibraryPrices([])).standardMarginBp;
  if (Number(std) === plan.margeBp) verslag.add(S, "standaardmarge", "marge", `${plan.margeBp / 100} %`, "overgeslagen", "al ingesteld");
  else if (Number(std) !== 2000) verslag.add(S, "standaardmarge", "marge", `${Number(std) / 100} %`, "conflict", "al aangepast in de app: niet overschreven");
  else {
    if (echt) ok(await actor.setLibraryMargin(BigInt(plan.margeBp)), "marge");
    verslag.add(S, "standaardmarge", "marge", `${plan.margeBp / 100} %`, "bijgewerkt", "aankoopprijs / 0,8 in 56 % van de lijnen (vraag D5)");
  }
}
