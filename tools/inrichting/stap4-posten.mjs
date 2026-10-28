// Stap 2b.6 stap 4: de postenbibliotheek uit de oude offertes (plan van tools/inrichting/offerte-lezer.py).
// Idempotent: een post wordt teruggevonden op zijn importsleutel (titel + eenheid), een aankoopprijs op zijn verwijzing
// ("offerte 2025/180"); een tweede run maakt niets dubbel. R32: enkel de beheerder (editLibrary, readCosts, readSellPrices).
import { bibliotheek, fold, ok, pool, dagNr, NAKIJKEN } from "./lib.mjs";

export async function hoofdstukkenZeker(actor, lijst, echt, verslag, stap, notitie, zou) {
  const bestaand = await actor.libraryChapters(true);
  const id = new Map();
  for (const h of lijst) {
    // Op code: een hoofdstuk dat de beheerder hernoemde, blijft hetzelfde hoofdstuk (geen tweede "01").
    const hit = bestaand.find((c) => c.code === h.code && !c.archived) ?? bestaand.find((c) => c.code === h.code);
    if (hit) { id.set(h.code, hit.id); verslag.add(stap, "hoofdstuk", h.code, h.titel, "overgeslagen", fold(hit.title) === fold(h.titel) ? "bestaat al" : `bestaat al als «${hit.title}»`); continue; }
    if (echt) id.set(h.code, ok(await actor.saveLibraryChapter({ id: [], code: h.code, title: h.titel, order: BigInt(h.volgorde), note: notitie }), `hoofdstuk ${h.code}`));
    else if (zou?.hoofdstukken.has(h.code)) { id.set(h.code, -1n); continue; } // al geteld in stap 1 van deze droogloop
    else { id.set(h.code, -1n); zou?.hoofdstukken.add(h.code); }
    verslag.add(stap, "hoofdstuk", h.code, h.titel, "aangemaakt", notitie);
  }
  return id;
}

const pct = (bp) => `${(Number(bp) / 100).toLocaleString("nl-BE")} %`;

// Een aankoopprijs alleen toevoegen als die verwijzing er voor deze post nog niet staat.
async function kostenErbij(actor, itemId, kosten, bestond, echt, verslag, stap, naam, bron) {
  let refs = new Set();
  if (bestond && kosten.length) refs = new Set(ok(await actor.readLibraryPriceHistory(itemId)).costs.map((c) => c.ref));
  for (const k of kosten) {
    const ref = `offerte ${k.offerte}`;
    if (refs.has(ref)) { verslag.add(stap, "aankoopprijs", `${itemId}:${ref}`, naam, "overgeslagen", "staat er al"); continue; }
    refs.add(ref);
    const note = `${bron}${k.margeBp !== null && k.margeBp !== undefined ? `; marge in die offerte ${pct(k.margeBp)}` : ""}`;
    if (echt) {
      const r = await actor.addLibraryCost(itemId, { orgId: [], day: dagNr(k.dag), costCents: BigInt(k.cents), source: "offerte", ref, note });
      if ("err" in r) { verslag.add(stap, "aankoopprijs", `${itemId}:${ref}`, naam, "fout", r.err); continue; }
    }
    verslag.add(stap, "aankoopprijs", `${itemId}:${ref}`, naam, "aangemaakt", "");
  }
}

export async function stap4({ actor, plan, echt, verslag, gelijktijdig = 8, zou }) {
  const S = 4;
  const hid = await hoofdstukkenZeker(actor, plan.hoofdstukken, echt, verslag, S, `${NAKIJKEN} (vraag D6): hoofdstuklijst uit de offertes van 2023–2026`, zou);
  const units = new Set([...(await actor.libraryUnits(true)).map((u) => u.key), ...(zou?.eenheden ?? [])]);
  const { perSleutel } = await bibliotheek(actor);
  const std = echt ? ok(await actor.readLibraryPrices([])).standardMarginBp : 2000n;
  const zonderEenheid = new Map();
  const nieuw = new Map(); // sleutel → id (in deze run gemaakt)

  await pool(plan.posten, gelijktijdig, async (p) => {
    if (!units.has(p.eenheid)) {
      zonderEenheid.set(p.eenheid, (zonderEenheid.get(p.eenheid) ?? 0) + 1);
      verslag.add(S, "post", p.key, p.titel, "conflict", `eenheid "${p.eenheid}" staat niet in de lijst (eerst stap 1)`);
      return;
    }
    const hit = perSleutel.get(p.key);
    let id = hit?.id;
    if (hit) verslag.add(S, "post", p.key, p.titel, "overgeslagen", "bestaat al (zelfde titel en eenheid)");
    else {
      const chapterId = hid.get(p.hoofdstuk) ?? hid.get("99");
      if (echt) {
        const r = await actor.saveLibraryItem({ id: [], chapterId, code: "", title: p.titel, text: p.tekst, unit: p.eenheid, form: { [p.vorm]: null }, trade: [], orgId: [], durationDays: [], perDayMilli: [], planStepKey: [], keywords: [], importKey: [p.key] }, 0n);
        if ("err" in r) { verslag.add(S, "post", p.key, p.titel, "fout", r.err); return; }
        id = r.ok.id;
        nieuw.set(p.key, id);
      }
      verslag.add(S, "post", p.key, p.titel, "aangemaakt", `in ${p.offertes.length} offerte(s)`);
    }
    if (id === undefined) { // droogloop: een nieuwe post heeft nog geen id; tel wat er mee zou komen
      for (const k of p.kosten) verslag.add(S, "aankoopprijs", `${p.key}:offerte ${k.offerte}`, p.titel, "aangemaakt", "");
      if ((p.margeBp !== null && BigInt(p.margeBp) !== std) || (p.margeBp === null && p.verkoopCents !== null && p.verkoopCents !== undefined)) verslag.add(S, "verkoopregel", p.key, p.titel, "aangemaakt", "");
      return;
    }
    await kostenErbij(actor, id, p.kosten, !!hit, echt, verslag, S, p.titel, "uit de oude offerte");
    // Verkoopregel enkel bij een nieuwe post (een bestaande kan de calculator al aangepast hebben).
    if (hit) return;
    let rule = null, reden = "";
    if (p.margeBp !== null && BigInt(p.margeBp) !== std) { rule = { margin: BigInt(p.margeBp) }; reden = `marge ${pct(p.margeBp)} zoals in de oude offertes; ${NAKIJKEN.toLowerCase()} (vraag D5)`; }
    else if (p.verkoopCents !== null && p.verkoopCents !== undefined) { rule = { price: BigInt(p.verkoopCents) }; reden = `vaste verkoopprijs in de oude offertes (zonder aankoopprijs); ${NAKIJKEN.toLowerCase()}`; }
    if (!rule) return;
    if (echt) {
      const r = await actor.setLibrarySell(id, { rule: [rule], reason: reden }, 0n);
      if ("err" in r) { verslag.add(S, "verkoopregel", p.key, p.titel, "fout", r.err); return; }
    }
    verslag.add(S, "verkoopregel", p.key, p.titel, "aangemaakt", reden);
  });

  // Prijsgeheugen (platte offertes, vraag D7): enkel een aankoopprijs bij een post die er al is.
  const perPost = new Map();
  for (const k of plan.prijsgeheugen ?? []) perPost.set(k.post, [...(perPost.get(k.post) ?? []), k]);
  await pool([...perPost.entries()], gelijktijdig, async ([key, kosten]) => {
    const id = perSleutel.get(key)?.id ?? nieuw.get(key);
    if (id === undefined) { for (const k of kosten) verslag.add(S, "aankoopprijs", `${key}:offerte ${k.offerte}`, key, echt ? "conflict" : "aangemaakt", echt ? "post niet gevonden" : "bij een post uit deze run"); return; }
    await kostenErbij(actor, id, kosten, true, echt, verslag, S, key, `prijsgeheugen (platte offerte); ${NAKIJKEN.toLowerCase()} (vraag D7)`);
  });
  for (const [u, n] of zonderEenheid) verslag.noteer(S, `eenheid "${u}" ontbreekt: ${n} posten wachten op stap 1`);
  for (const b of plan.bevindingen ?? []) verslag.noteer(S, `lezer: ${b}`);
  const o = plan.offertes ?? [];
  verslag.noteer(S, `gelezen offertes: ${o.length} (rijk ${o.filter((x) => x.klasse === "1").length}, VH-lijst ${o.filter((x) => x.klasse === "2").length}, plat ${o.filter((x) => x.klasse === "3").length}); lijnen ${o.reduce((s, x) => s + x.lijnen, 0)}`);
}
