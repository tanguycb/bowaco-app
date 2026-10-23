// Stap 1.5: een GEANONIMISEERDE versie van plan.json maken, om de import op het echte IC (de draft) te bewijzen
// zonder echte werfnamen, adressen of firmanamen. De structuur blijft (blokken, vervolgen, deelwerven, taken,
// weken, uitvoerreeksen, afspraken, dagen en uren); alle tekst wordt vervangen.
//
//   node tools/plan-anonimiseer.mjs --plan plan.json --uit plan-anoniem.json --mapping mapping.json [--firmas 15]
//
// - werven → «Werf 01» · «Teststraat 1, 9000 Teststad»
// - taaktitels die ≥ 3× in de planning voorkomen (algemene werkwoorden zoals «Afbraakwerken») blijven; de rest → «Taak 01-07»
// - de meest voorkomende firmanamen → testcodes TOA01 … (die moeten als firma's met die alias op de draft staan:
//   tests/import-draft.mjs maakt ze); alle andere namen → ONB01 … (blijven bewust zonder firma: zo komt het rapport aan bod)
// - notities en celteksten worden «Notitie» / «Opmerking»; afspraken behouden dag en uur
// - sleutels worden opnieuw gemaakt (geen hash van echte tekst)
// mapping.json (echte naam ↔ code) hoort NIET in git: zet hem in bowaco-docs.
import { readFileSync, writeFileSync } from "node:fs";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : (process.argv[i + 1] ?? true); };
const planPath = arg("plan");
const uit = arg("uit");
const mappingPath = arg("mapping");
const nFirmas = Number(arg("firmas", 15));
if (!planPath || !uit || !mappingPath) throw new Error("gebruik: node tools/plan-anonimiseer.mjs --plan plan.json --uit plan-anoniem.json --mapping mapping.json [--firmas 15]");
const plan = JSON.parse(readFileSync(planPath, "utf8"));
const SYSTEEM = new Set(["BOWACO", "ALEXIS", "ALEX", "KLANT", "VERGUNNING", "IEDEREEN", "NIET", "?"]);
const pad = (n, w = 2) => String(n).padStart(w, "0");

// Firmanamen tellen (reeksen + verantwoordelijken)
const count = new Map();
for (const b of plan.blokken) for (const t of b.tasks) {
  for (const n of [t.responsible, ...t.runs.map((r) => r.name)]) if (n && !SYSTEEM.has(n)) count.set(n, (count.get(n) ?? 0) + 1);
}
const ranked = [...count.entries()].sort((a, b) => b[1] - a[1]);
const nameMap = new Map();
ranked.forEach(([n], i) => nameMap.set(n, i < nFirmas ? `TOA${pad(i + 1)}` : `ONB${pad(i + 1 - nFirmas, 3)}`));
const code = (n) => (n == null ? null : SYSTEEM.has(n) ? n : nameMap.get(n) ?? "ONB999");

// Titels
const titleCount = new Map();
for (const b of plan.blokken) for (const t of b.tasks) titleCount.set(t.title, (titleCount.get(t.title) ?? 0) + 1);

const mapping = { werven: {}, namen: Object.fromEntries(nameMap), titels: {} };
const blokken = plan.blokken.map((b, bi) => {
  const nn = pad(bi + 1);
  const bkey = `anon-b${nn}`;
  mapping.werven[b.code] = { echt: b.header, anoniem: `Werf ${nn}` };
  const tasks = b.tasks.map((t, ti) => {
    const tkey = `${bkey}/t${pad(ti + 1, 3)}`;
    const generic = (titleCount.get(t.title) ?? 0) >= 3 && t.title.length <= 60;
    const title = generic ? t.title : `Taak ${nn}-${pad(ti + 1)}`;
    if (!generic) mapping.titels[`${nn}-${pad(ti + 1)}`] = t.title;
    const sys = t.uitvoering.filter((u) => u !== "BOWACO");
    const note = (t.note ? "Notitie" : "") + (sys.length ? `${t.note ? "\n" : ""}Uitvoering volgens de planning: ${sys.join(", ")}` : "");
    return {
      ...t, key: tkey, title, note, responsible: code(t.responsible),
      runs: t.runs.map((r) => ({ ...r, key: `${tkey}/a:${r.col0}:${code(r.name)}`, name: code(r.name), note: r.note ? "Opmerking" : "" })),
      appointments: t.appointments.map((a) => {
        const d = a.date.split("-");
        const txt = [a.name ? code(a.name) : null, `${d[2]}/${d[1]}`, a.time].filter(Boolean).join(" ");
        return { ...a, key: `${tkey}/p:c${a.col}.${a.key.split(".").pop()}`, name: a.name ? code(a.name) : null, text: txt };
      }),
      extra: t.extra.filter(([k]) => k !== "planning-rij"),
    };
  });
  const ren = (c) => (c ? `B${c.slice(1)}` : c);
  return {
    ...b, key: bkey, header: `Werf ${nn}`, name: `Werf ${nn}`, street: "Teststraat", number: String(bi + 1), zip: "9000", city: "Teststad", tasks,
    rij: 0, streetKey: "", suffix: "", voorstel: { ...b.voorstel, reden: b.voorstel.beslissing === "nieuw" ? "" : `zelfde adres als ${b.voorstel.doel}` },
    besluit: b.besluit,
  };
});
const anon = {
  bron: "geanonimiseerd", batch: "proef-1.5", titel: "Proefplanning (anoniem)", statusGrens: plan.statusGrens, blokken,
  bevindingen: plan.bevindingen.map((f) => ({ ...f, tekst: f.soort, rij: 0 })),
  blokkeringen: plan.blokkeringen, telling: plan.telling,
};
const firmas = ranked.slice(0, nFirmas).map(([, ], i) => ({ code: `TOA${pad(i + 1)}`, name: `Test OA ${pad(i + 1)}` }));
anon.testfirmas = firmas;
writeFileSync(uit, JSON.stringify(anon, null, 1));
writeFileSync(mappingPath, JSON.stringify(mapping, null, 1));
console.log(`anoniem: ${blokken.length} blokken, ${blokken.reduce((a, b) => a + b.tasks.length, 0)} taken, ${firmas.length} testfirma's (TOA01…), ${nameMap.size - firmas.length} namen blijven zonder firma`);
console.log(`geschreven: ${uit}\nmapping (NIET in git): ${mappingPath}`);
