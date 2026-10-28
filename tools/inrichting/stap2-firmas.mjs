// Stap 2b.6 stap 2: firma's (OA's, leveranciers, overheid en nutsbedrijven) via importOrgs (1.2), plan van
// tools/inrichting/lees-firmas.py. De backend matcht op KBO en op naam/code en vult enkel aan: een tweede run geeft
// "ongewijzigd". Per stuk van 40 eerst de proefronde van de backend; een rij met conflict of fout wordt niet bewaard.
import { opt } from "./lib.mjs";

const UITKOMST = { created: "aangemaakt", updated: "bijgewerkt", unchanged: "overgeslagen", conflict: "conflict", invalid: "fout" };

export async function stap2({ actor, plan, echt, verslag }) {
  const S = 2;
  const rows = plan.rijen.map((r) => ({ key: r.key, kind: { [r.kind]: null }, name: r.name, kbo: opt(r.kbo), vat: [], aliases: r.aliases, trades: r.trades, phone: [], email: [], website: [], notes: r.notes, persons: [] }));
  for (let i = 0; i < rows.length; i += 40) {
    const stuk = rows.slice(i, i + 40);
    const dry = await actor.importOrgs(true, stuk);
    if ("err" in dry) throw new Error(dry.err);
    let rep = dry.ok;
    if (echt) {
      const real = await actor.importOrgs(false, stuk);
      if ("err" in real) throw new Error(real.err);
      rep = real.ok;
    }
    rep.results.forEach((r, j) => {
      const [k, why] = Object.entries(r.outcome)[0];
      verslag.add(S, "firma", stuk[j].key, stuk[j].name, UITKOMST[k], typeof why === "string" ? why : r.changes.join("; "));
    });
  }
  for (const [reden, x] of Object.entries(plan.nietInDeApp ?? {})) verslag.noteer(S, `niet in de app: ${x.aantal} × ${reden}`);
}
