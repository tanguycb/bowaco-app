// Demo 5 werven (12-11): de grens van stap 8 voor echte bestanden. Zonder netwerk: elke weigering valt vóór de eerste oproep.
//   node tests/demo-draft-grens.mjs
// Een echt plan mag enkel naar live (met JA_EIGENAAR=1) of, uitzonderlijk, naar ÉÉN draft die in DEMO_DRAFT staat, met een
// werfcode uit DEMO_DRAFT_WERVEN en JA_EIGENAAR=1. Verzonnen id's en een verzonnen werfcode.
const DRAFT = "ryjl3-tyaaa-aaaaa-aaaba-cai", ANDERE = "rrkah-fqaaa-aaaaa-aaaaq-cai";
delete process.env.ICP_HOST; // niet lokaal
const { stap8 } = await import("../tools/inrichting/stap8-werf.mjs");
let pass = 0, fail = 0;
const check = (n, c) => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}`); };
const bereikt = new Error("bereikt de eerste oproep");
const actor = new Proxy({}, { get: () => () => { throw bereikt; } });
const plan = { bron: "echt", werf: { code: "W-999" }, soorten: [], offertes: [], firmas: { rijen: [] }, klant: { name: "x" }, bestanden: [] };
async function run(cid, env) {
  for (const k of ["JA_EIGENAAR", "DEMO_DRAFT", "DEMO_DRAFT_WERVEN"]) delete process.env[k];
  Object.assign(process.env, env);
  try { await stap8({ actor, plan, echt: true, verslag: { add() {}, noteer() {} }, gelijktijdig: 3, cid, opties: {} }); return "ok"; }
  catch (e) { return e === bereikt ? "toegelaten" : String(e.message); }
}
check("een draft zonder uitzondering weigert echte bestanden", (await run(DRAFT, { JA_EIGENAAR: "1" })).includes("nooit naar een draft"));
check("de uitzondering vraagt JA_EIGENAAR=1", (await run(DRAFT, { DEMO_DRAFT: DRAFT, DEMO_DRAFT_WERVEN: "W-999" })).includes("enkel met JA_EIGENAAR=1"));
check("een andere draft dan DEMO_DRAFT wordt geweigerd", (await run(ANDERE, { JA_EIGENAAR: "1", DEMO_DRAFT: DRAFT, DEMO_DRAFT_WERVEN: "W-999" })).includes("nooit naar een draft"));
check("een werfcode buiten DEMO_DRAFT_WERVEN wordt geweigerd", (await run(DRAFT, { JA_EIGENAAR: "1", DEMO_DRAFT: DRAFT, DEMO_DRAFT_WERVEN: "W-001,W-002" })).includes("nooit naar een draft"));
check("de genoemde draft + werf + JA_EIGENAAR=1 passeert de grens", (await run(DRAFT, { JA_EIGENAAR: "1", DEMO_DRAFT: DRAFT, DEMO_DRAFT_WERVEN: "W-001, W-999" })) === "toegelaten");
console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
