// Stap 2b.6 stap 6: de kennisbank vergunningen (plan van tools/inrichting/lees-vergunningen.py): nieuwe soorten, de
// gemeenten en per gemeente de procedures met doorlooptijd. Idempotent: een soort op zijn code, een gemeente op haar
// naam, een procedure op gemeente + soort. Wat er al staat, wordt NIET overschreven (de beheerder kan het aangepast hebben).
import { fold, ok } from "./lib.mjs";

export async function stap6({ actor, plan, echt, verslag }) {
  const S = 6;
  const soorten = await actor.listPermitKinds(true);
  let order = soorten.reduce((m, k) => (k.order > m ? k.order : m), 0n);
  const bekend = new Set(soorten.map((k) => k.key));
  for (const k of plan.soorten) {
    if (bekend.has(k.key)) { verslag.add(S, "vergunningssoort", k.key, k.naam, "overgeslagen", "bestaat al"); continue; }
    order += 10n;
    if (echt) ok(await actor.setPermitKind({ key: k.key, name: k.naam, leadDays: BigInt(k.dagen), words: k.woorden, publicDomain: k.openbaarDomein, order, archived: false }), `soort ${k.key}`);
    bekend.add(k.key);
    verslag.add(S, "vergunningssoort", k.key, k.naam, "aangemaakt", `doorlooptijd ${k.dagen} dagen (nog na te kijken, vraag D36)`);
  }
  const gemeenten = await actor.listMunicipalities(true);
  for (const g of plan.gemeenten) {
    let m = gemeenten.find((x) => !x.archived && fold(x.name) === fold(g.naam));
    if (m) verslag.add(S, "gemeente", g.naam, g.naam, "overgeslagen", "staat er al");
    else {
      if (echt) m = ok(await actor.saveMunicipality({ id: [], name: g.naam, zips: g.postcodes, portal: [], email: [], phone: [], contact: "", notes: g.notitie, archived: false }), `gemeente ${g.naam}`);
      verslag.add(S, "gemeente", g.naam, g.naam, "aangemaakt", g.notitie);
    }
    for (const p of g.procedures) {
      const sleutel = `${g.naam}:${p.soort}`;
      if (!bekend.has(p.soort)) { verslag.add(S, "procedure", sleutel, g.naam, echt ? "conflict" : "aangemaakt", echt ? `onbekende soort ${p.soort}` : "na de nieuwe soort"); continue; }
      if (m?.procedures.some((x) => x.kind === p.soort)) { verslag.add(S, "procedure", sleutel, g.naam, "overgeslagen", "staat er al"); continue; }
      if (echt) m = ok(await actor.saveProcedure({ municipalityId: m.id, kind: p.soort, how: p.hoe, portal: [], email: [], leadDays: BigInt(p.dagen), cost: "", attachments: [], contact: "", notes: `${p.notitie} Nog na te kijken (vraag D36).`, archived: false }), `procedure ${sleutel}`);
      verslag.add(S, "procedure", sleutel, g.naam, "aangemaakt", `${p.dagen} dagen`);
    }
  }
}
