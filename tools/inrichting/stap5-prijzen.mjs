// Stap 2b.6 stap 5: prijslijsten van OA's en leveranciers (plan van tools/inrichting/lees-prijslijsten.py) als
// aankoopprijzen met datum. Een prijsregel komt bij de post uit de offertes met dezelfde titel en eenheid; anders wordt
// het een nieuwe post (sleutel "p:…") in het hoofdstuk van het vakgebied. Idempotent: een post op zijn sleutel, een prijs
// op zijn verwijzing ("prijslijst D-…"). De firma enkel als ze al in de app staat (stap 2), nooit een nieuwe firma.
import { bibliotheek, fold, ok, pool, dagNr, NAKIJKEN } from "./lib.mjs";

export async function stap5({ actor, plan, echt, verslag, zou }) {
  const S = 5;
  const hoofdstukken = new Map((await actor.libraryChapters(true)).map((c) => [c.code, c.id]));
  for (const c of zou?.hoofdstukken ?? []) if (!hoofdstukken.has(c)) hoofdstukken.set(c, -1n); // droogloop: komt in stap 1
  const units = new Set([...(await actor.libraryUnits(true)).map((u) => u.key), ...(zou?.eenheden ?? [])]);
  const { perSleutel } = await bibliotheek(actor);
  const firmas = (await actor.listOrgs(false)).filter((o) => "subcontractor" in o.kind || "supplier" in o.kind);
  const plat = (t) => fold(t).replace(/ /g, "");
  const vindFirma = (hint) => {
    const h = plat(hint);
    if (h.length < 4) return null;
    return firmas.find((o) => plat(o.name).includes(h) || h.includes(plat(o.name)) || o.aliases.some((a) => plat(a) === h)) ?? null;
  };
  for (const l of plan.lijsten) {
    const firma = vindFirma(l.firmaHint);
    verslag.noteer(S, `prijslijst ${l.doc} (${l.datum}): ${l.lijnen.length} prijzen, ${firma ? `firma ${firma.name}` : "firma niet in de app (prijs zonder firma)"}`);
    const chapterId = hoofdstukken.get(l.hoofdstuk) ?? hoofdstukken.get("99");
    if (chapterId === undefined) { verslag.add(S, "prijslijst", l.doc, "", "conflict", "hoofdstukken ontbreken: eerst stap 1"); continue; }
    const ref = `prijslijst ${l.doc}`;
    // Na elkaar (geen pool): twee regels die op dezelfde post uitkomen, mogen elkaar niet kruisen (dubbele post of prijs).
    await pool(l.lijnen, 1, async (x) => {
      if (!units.has(x.eenheid)) { verslag.add(S, "prijs", `${x.key}:${ref}`, x.titel, "conflict", `eenheid "${x.eenheid}" staat niet in de lijst`); return; }
      const hit = (x.offerteKey && perSleutel.get(x.offerteKey)) || perSleutel.get(x.key);
      let id = hit?.id;
      if (!hit) {
        if (echt) {
          const r = await actor.saveLibraryItem({ id: [], chapterId, code: "", title: x.titel, text: "", unit: x.eenheid, form: { fixed: null }, trade: [], orgId: firma ? [firma.id] : [], durationDays: [], perDayMilli: [], planStepKey: [], keywords: [], importKey: [x.key] }, 0n);
          if ("err" in r) { verslag.add(S, "post", x.key, x.titel, "fout", r.err); return; }
          id = r.ok.id;
          perSleutel.set(x.key, r.ok);
        }
        verslag.add(S, "post", x.key, x.titel, "aangemaakt", `uit ${ref}`);
      } else verslag.add(S, "post", x.key, x.titel, "overgeslagen", hit.importKey[0] === x.offerteKey ? "zelfde post als in de offertes" : "bestaat al");
      if (id === undefined) { verslag.add(S, "prijs", `${x.key}:${ref}`, x.titel, "aangemaakt", ""); return; }
      if (hit) {
        const refs = new Set(ok(await actor.readLibraryPriceHistory(id)).costs.map((c) => c.ref));
        if (refs.has(ref)) { verslag.add(S, "prijs", `${x.key}:${ref}`, x.titel, "overgeslagen", "staat er al"); return; }
      }
      if (echt) {
        const r = await actor.addLibraryCost(id, { orgId: firma ? [firma.id] : [], day: dagNr(l.datum), costCents: BigInt(x.cents), source: "oa-offerte", ref, note: `${NAKIJKEN}: overgenomen uit de prijslijst van ${l.datum}` });
        if ("err" in r) { verslag.add(S, "prijs", `${x.key}:${ref}`, x.titel, "fout", r.err); return; }
      }
      verslag.add(S, "prijs", `${x.key}:${ref}`, x.titel, "aangemaakt", "");
    });
  }
  for (const d of plan.dubbels ?? []) verslag.noteer(S, `${d.doc} heeft dezelfde prijzen als ${d["zelfde als"]}: één keer genomen`);
  for (const h of plan.metDeHand ?? []) verslag.noteer(S, `met de hand: ${h.doc}: ${h.reden}`);
}
