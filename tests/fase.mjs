// 2b.3: de faseregels (src/frontend/src/app/fase.ts) zonder canister: ALLE combinaties van de zes gebeurtenissen × de zeven
// statussen (64 × 7 = 448), de voorbeeldwerven van het prototype, de tabbladen per rol (met de caps zoals Rights.mo ze geeft
// voor elke rol) en de volgende stap. VOORLOPIG: de regels zijn die van het prototype (vraag 14); Alexis antwoordde nog niet.
//   node tests/fase.mjs
import { loadFase } from "./menu-lib.mjs";

const F = await loadFase();
let pass = 0;
let fail = 0;
const failures = [];
function check(name, cond, extra = "") {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${extra ? ` · ${extra}` : ""}`); console.log(`✗ ${name}${extra ? ` · ${extra}` : ""}`); }
}

const EV = ["quoteSentAt", "acceptedAt", "startedAt", "firstReportAt", "measuredAt", "invoicedAt"]; // fase 1 … 6
const STATUS = ["request", "quoting", "planned", "running", "delivered", "aftercare", "cancelled"];
const FLOOR = { request: 0, quoting: 1, planned: 3, running: 4, delivered: 7, aftercare: 7, cancelled: 0 };
const MARKS = { quoting: [1], planned: [3], running: [3, 4], delivered: [7], aftercare: [7] };

// ── 1. Alle combinaties: de onafhankelijke verwachting naast werfFase ─────────────────────────────────────────────
let combos = 0;
const bad = [];
for (let mask = 0; mask < 64; mask++) {
  for (const status of STATUS) {
    combos++;
    const facts = { status };
    EV.forEach((k, i) => { if (mask & (1 << i)) facts[k] = BigInt(1000 + i); });
    const f = F.werfFase(facts);
    let hi = 0;
    EV.forEach((_, i) => { if (mask & (1 << i)) hi = i + 1; });
    const want = Math.max(hi, FLOOR[status]);
    const steps = Array.from({ length: 8 }, (_, i) => (i === want ? "now" : i > want ? "todo" : i === 0 || (i >= 1 && i <= 6 && mask & (1 << (i - 1))) || (MARKS[status] ?? []).includes(i) ? "done" : "skipped"));
    const ok = f.index === want && f.key === F.PHASE_KEYS[want] && f.cancelled === (status === "cancelled") && f.aftercare === (status === "aftercare") && f.manual === FLOOR[status] > hi && JSON.stringify(f.steps) === JSON.stringify(steps);
    if (!ok) bad.push(`${status}/${mask.toString(2)}: ${f.index} ${f.steps.join(",")} (verwacht ${want} ${steps.join(",")})`);
  }
}
check(`alle ${combos} combinaties (6 gebeurtenissen × 7 statussen): fase, stappen, met de hand, geannuleerd, nazorg`, combos === 448 && bad.length === 0, bad.slice(0, 3).join(" | "));

// ── 2. Eigenschappen over alle combinaties ─────────────────────────────────────────────────────────────────────────
let mono = true;
let oneNow = true;
for (let mask = 0; mask < 64; mask++) {
  for (const status of STATUS) {
    const base = { status };
    EV.forEach((k, i) => { if (mask & (1 << i)) base[k] = 1n; });
    const f = F.werfFase(base);
    if (f.steps.filter((x) => x === "now").length !== 1) oneNow = false;
    for (let j = 0; j < 6; j++) {
      if (mask & (1 << j)) continue;
      const more = F.werfFase({ ...base, [EV[j]]: 1n });
      if (more.index < f.index) mono = false;
    }
  }
}
check("een gebeurtenis erbij laat de fase nooit zakken (monotoon)", mono);
check("altijd precies één fase 'nu'", oneNow);
check("tussentijdse opmeting en vorderingsstaat laten de werf In uitvoering (enkel eindopmeting en slotstaat tellen)", F.werfFase({ status: "planned", startedAt: 1n, firstReportAt: 2n, surveyOpen: true, progressSent: 3n }).key === "uitvoering");
check("opgeleverd kan enkel met de hand (status opgeleverd of nazorg)", F.werfFase({ status: "running", ...Object.fromEntries(EV.map((k) => [k, 1n])) }).index === 6 && F.werfFase({ status: "delivered" }).index === 7 && F.werfFase({ status: "aftercare" }).aftercare);
check("met de hand terugzetten kan niet zolang de gebeurtenis bestaat (verstuurde offerte, status aanvraag → Offerte)", F.werfFase({ status: "request", quoteSentAt: 1n }).key === "offerte" && !F.werfFase({ status: "request", quoteSentAt: 1n }).manual);
check("opdracht zonder offerte (vraag 2): Gestart met de hand, Offerte en Akkoord overgeslagen", (() => { const f = F.werfFase({ status: "planned" }); return f.key === "gestart" && f.manual && f.steps[1] === "skipped" && f.steps[2] === "skipped"; })());
check("geannuleerd: het label zegt Geannuleerd, de fase blijft waar ze stopte", (() => { const f = F.werfFase({ status: "cancelled", quoteSentAt: 1n }); return f.cancelled && f.index === 1 && F.faseNaam(f) === "Geannuleerd"; })());
check("klanttaal: Uw vraag … Werken bezig … Opgeleverd", F.faseNaam(F.werfFase({ status: "request" }), true) === "Uw vraag" && F.faseNaam(F.werfFase({ status: "running" }), true) === "Werken bezig");

// ── 3. De voorbeeldwerven van het prototype (één per fase) ─────────────────────────────────────────────────────────
const VB = [
  ["2026-238 Stuiver 33 (aanvraag)", { status: "request" }, "aanvraag", "aanvragen"],
  ["2026-231 Hovenierstraat 10 (offerte v2 verstuurd)", { status: "quoting", quoteSentAt: 1n, quoteWaiting: true }, "offerte", "aanvragen"],
  ["2026-219 Duifhuisstraat 49 (akkoord)", { status: "quoting", quoteSentAt: 1n, acceptedAt: 2n, startPending: true }, "akkoord", "lopend"],
  ["2026-198 Dieleghemdreef 79 (gestart)", { status: "planned", quoteSentAt: 1n, acceptedAt: 2n, startedAt: 3n, tasks: 14 }, "gestart", "lopend"],
  ["2026-204 Albertlaan 19 (eerste verslag)", { status: "planned", quoteSentAt: 1n, acceptedAt: 2n, startedAt: 3n, firstReportAt: 4n, surveyOpen: true }, "uitvoering", "lopend"],
  ["2026-176 Kunstenaarsstraat 53 (eindopmeting)", { status: "running", quoteSentAt: 1n, acceptedAt: 2n, startedAt: 3n, firstReportAt: 4n, measuredAt: 5n, progressSent: 3 }, "opgemeten", "lopend"],
  ["2026-187 Onderbergen 50 (slotstaat)", { status: "running", quoteSentAt: 1n, acceptedAt: 2n, startedAt: 3n, firstReportAt: 4n, measuredAt: 5n, invoicedAt: 6n, progressSent: 5 }, "gefactureerd", "lopend"],
  ["2025-142 Engelhoekstraat 29 (opgeleverd)", { status: "delivered", quoteSentAt: 1n, acceptedAt: 2n, startedAt: 3n, firstReportAt: 4n, measuredAt: 5n, invoicedAt: 6n }, "opgeleverd", "afgerond"],
];
for (const [n, s, key, groep] of VB) {
  const f = F.werfFase(s);
  check(`prototype ${n}: fase ${key}, Werven → ${groep}`, f.key === key && F.werfGroep(f) === groep, `${f.key} ${F.werfGroep(f)}`);
}
check("geannuleerde werven staan onder Afgerond (enkel zichtbaar met het vinkje)", F.werfGroep(F.werfFase({ status: "cancelled" })) === "afgerond");

// ── 4. Tabbladen per rol (caps zoals Rights.mo ze geeft; de rollentest doet hetzelfde met de echte caps) ────────────────
const base = Object.fromEntries(["manageAccess", "myQuotes", "inviteExternal", "readContracts", "manageMunicipalities", "importOa", "manageOa", "measure", "libraryPrices", "wadm", "measureRead", "importPlan", "managePermitKinds", "readOrgPlanning", "manageBoardRules", "createWork", "manageSettings", "editLibrary", "writeReports", "quotePrices", "readTeam", "permits", "manageTemplates", "progress", "upload", "readLibrary", "editQuotes", "readMunicipalities", "manageOrgs", "myOaInvoices", "manageCompanyCalendar", "manageRobots", "reportOwnAbsence", "export", "quotes", "oaInvoices", "manageAbsences", "readTrips", "manageVehicles", "readConfidentialContact", "workStarts", "myProgress", "readAudit", "readOa"].map((k) => [k, false]));
const on = (home, keys) => ({ ...base, home, ...Object.fromEntries(keys.map((k) => [k, true])) });
const CAPS = {
  admin: on("overzicht", ["readTeam", "quotes", "quotePrices", "editQuotes", "measure", "measureRead", "progress", "oaInvoices", "permits", "wadm", "writeReports", "workStarts", "readOrgPlanning", "createWork", "upload"]),
  werfleider: on("vandaag", ["readTeam", "quotes", "measure", "measureRead", "progress", "oaInvoices", "permits", "wadm", "writeReports", "workStarts", "readOrgPlanning", "createWork", "upload"]),
  calculator: on("offertes", ["readTeam", "quotes", "quotePrices", "editQuotes", "measure", "measureRead", "progress", "oaInvoices", "wadm", "readOrgPlanning", "upload"]),
  oa: on("week", ["measureRead", "upload"]),
  architect: on("werven", []),
  klant: on("werven", ["myQuotes", "myProgress"]),
};
const f4 = F.werfFase({ status: "planned", quoteSentAt: 1n, acceptedAt: 2n, startedAt: 3n, firstReportAt: 4n });
const keys = (r, f = f4, s = { status: "planned", acceptedAt: 2n, firstReportAt: 4n }) => F.werfTabs(CAPS[r], f, s).map((x) => x.key).join(",");
check("tabbladen beheerder: Overzicht · Offerte · Planning · Verslagen · Opmeting · Facturatie · Vergunningen & admin · Documenten · Wie werkt mee", keys("admin") === "overzicht,offerte,planning,verslagen,opmeting,facturatie,vergunningen,documenten,wie" && F.werfTabs(CAPS.admin, f4, {}).map((x) => x.label).join("|") === "Overzicht|Offerte|Planning|Verslagen|Opmeting|Facturatie|Vergunningen & admin|Documenten|Wie werkt mee");
check("tabbladen werfleider: alle negen", keys("werfleider").split(",").length === 9);
check("tabbladen calculator: alle negen (werfadministratie)", keys("calculator").split(",").length === 9, keys("calculator"));
check("tabbladen onderaannemer: Overzicht · Planning · Opmeting · Vergunningen & admin · Documenten", keys("oa") === "overzicht,planning,opmeting,vergunningen,documenten", keys("oa"));
check("tabbladen architect (opmeting niet aangezet): Overzicht · Planning · Verslagen · Vergunningen & admin · Documenten", keys("architect") === "overzicht,planning,verslagen,vergunningen,documenten", keys("architect"));
check("tabbladen architect met opmeting aangezet: + Opmeting", F.werfTabs({ ...CAPS.architect, measureRead: true }, f4, {}).some((x) => x.key === "opmeting"));
check("tabbladen klant: Voortgang · Offerte · Vorderingsstaten · Documenten", F.werfTabs(CAPS.klant, f4, {}).map((x) => x.label).join("|") === "Voortgang|Offerte|Vorderingsstaten|Documenten");
// Grijs met uitleg zolang een tabblad nog niet geldt
const offOf = (f, s) => Object.fromEntries(F.werfTabs(CAPS.admin, f, s).filter((x) => x.off).map((x) => [x.key, x.off]));
const o0 = offOf(F.werfFase({ status: "request" }), { status: "request" });
check("in Aanvraag: Planning, Verslagen, Opmeting en Facturatie grijs met uitleg; Overzicht, Offerte, Documenten, Wie werkt mee open", Object.keys(o0).sort().join() === "facturatie,opmeting,planning,verslagen" && /Werf starten/.test(o0.planning) && /getekend/.test(o0.opmeting));
check("planning met de hand begonnen vóór het akkoord: Planning niet meer grijs", !offOf(F.werfFase({ status: "quoting" }), { status: "quoting", tasks: 3 }).planning);
check("in Akkoord: Planning open (Werf starten maakt ze), Verslagen/Opmeting/Facturatie nog grijs", (() => { const o = offOf(F.werfFase({ status: "quoting", quoteSentAt: 1n, acceptedAt: 2n }), { status: "quoting", acceptedAt: 2n }); return !o.planning && !!o.verslagen && !!o.opmeting && !!o.facturatie; })());
check("gestart zonder getekende offerte: Opmeting blijft grijs met de reden 'geen getekende offerte'", /geen getekende offerte/.test(offOf(F.werfFase({ status: "planned" }), { status: "planned" }).opmeting ?? ""));
check("na de start met akkoord: geen enkel tabblad grijs", Object.keys(offOf(f4, { status: "planned", acceptedAt: 2n, firstReportAt: 4n })).length === 0);

// ── 5. Volgende stap per fase en rol (één knop) ───────────────────────────────────────────────────────────────────
const st = (r, s, edit = true) => F.volgendeStap(F.werfFase(s), s, CAPS[r], edit);
const k = (r, s, edit) => st(r, s, edit)?.key ?? null;
const S = Object.fromEntries(VB.map(([, s, key]) => [key, s]));
check("Aanvraag: beheerder/calculator 'Offerte maken' (tabblad Offerte); werfleider wacht", k("admin", S.aanvraag) === "offerteMaken" && st("admin", S.aanvraag).action.tab === "offerte" && k("werfleider", S.aanvraag) === "wachtOfferte");
check("Offerte: 'Wacht op akkoord van de klant' (tabblad Offerte)", k("admin", S.offerte) === "wachtAkkoord" && k("calculator", S.offerte) === "wachtAkkoord");
check("Offerte in de maak (niets verstuurd): calculator 'Offerte versturen'", k("calculator", { status: "quoting" }) === "offerteVersturen");
check("Akkoord: beheerder en werfleider 'Werf starten' (het voorstel); calculator wacht", k("admin", S.akkoord) === "werfStarten" && st("werfleider", S.akkoord).action.kind === "werfstart" && k("calculator", S.akkoord) === "wachtStart");
check("Gestart: werfleider 'Eerste werfverslag'; calculator 'Planning opvolgen'", k("werfleider", S.gestart) === "eersteVerslag" && st("werfleider", S.gestart).action.kind === "report" && k("calculator", S.gestart) === "planningBekijken");
check("In uitvoering met open opmeting: beheerder 'Opmeting afsluiten', werfleider idem", k("admin", S.uitvoering) === "opmetingAfsluiten" && k("werfleider", S.uitvoering) === "opmetingAfsluiten");
check("In uitvoering zonder open opmeting: werfleider 'Werfverslag van vandaag', calculator 'Vorderingsstaat opmaken'", k("werfleider", { ...S.uitvoering, surveyOpen: false }) === "verslagVandaag" && k("calculator", { ...S.uitvoering, surveyOpen: false }) === "staatMaken");
check("opdracht zonder offerte in uitvoering: geen vorderingsstaat of opmeting als volgende stap (die vertrekken van een aanvaarde offerte)", k("admin", { status: "running" }) === "verslagVandaag" && k("calculator", { status: "running" }) === "planningBekijken");
check("een vorderingsstaat in ontwerp gaat voor: 'Vorderingsstaat afwerken'", k("calculator", { ...S.uitvoering, progressDraft: true }) === "staatAfwerken");
check("Opgemeten: calculator 'Slotstaat opmaken' (tabblad Facturatie); werfleider wacht", k("calculator", S.opgemeten) === "slotstaat" && st("calculator", S.opgemeten).action.tab === "facturatie" && k("werfleider", S.opgemeten) === "wachtSlot");
check("Gefactureerd: wie de werf mag wijzigen 'Oplevering registreren' (status opgeleverd); anders wachten", k("admin", S.gefactureerd, true) === "opleveren" && st("admin", S.gefactureerd, true).action.status === "delivered" && k("calculator", S.gefactureerd, false) === "wachtOplevering");
check("Opgeleverd: 'Nazorg starten'; in nazorg 'Afgerond'", k("admin", S.opgeleverd, true) === "nazorg" && k("admin", { ...S.opgeleverd, status: "aftercare" }, true) === "afgerond");
check("meerwerk aanvaard na de start: 'Meerwerk starten' (Werf starten met enkel het verschil)", k("werfleider", { ...S.uitvoering, startPending: true }) === "meerwerkStarten");
check("geannuleerd: kaart zonder knop", k("admin", { status: "cancelled" }) === "geannuleerd" && st("admin", { status: "cancelled" }).action === null);
check("architect en OA: geen kaart Volgende stap", ["architect", "oa"].every((r) => VB.every(([, s]) => st(r, s) === null)));
check("klant: offerte bekijken · vorderingsstaten · anders documenten", k("klant", S.offerte) === "klantOfferte" && k("klant", S.opgemeten) === "klantVordering" && k("klant", S.aanvraag) === "klantWacht");
check("elke volgende stap heeft een tekst (titel, uitleg en knop niet leeg), in alle fases en voor alle rollen", VB.concat([["x", { status: "cancelled" }], ["y", { status: "aftercare" }], ["z", { status: "running", quoteSentAt: 1n, acceptedAt: 2n, quoteWaiting: true }]]).every(([, s]) => Object.keys(CAPS).every((r) => { const x = st(r, s); if (x === null) return true; const T = F.stapTekst(x.key); return !!T && !!T.t && !!T.d && !!T.b; })));
check("meerwerk verstuurd na de start: kantoor 'Meerwerk wacht op akkoord', de klant 'Uw offerte bekijken'", k("calculator", { ...S.uitvoering, quoteWaiting: true }) === "wachtMeerwerk" && k("klant", { ...S.uitvoering, quoteWaiting: true }) === "klantOfferte");
check("externen (OA, architect) krijgen geen grijze tabbladen (ze hebben geen stand van de werf)", ["oa", "architect"].every((r) => F.werfTabs(CAPS[r], F.werfFase({ status: "planned" }), { status: "planned" }).every((x) => !x.off)));
check("de stappenbalk enkel voor kantoor en de klant", F.toontFase(CAPS.admin) && F.toontFase(CAPS.klant) && !F.toontFase(CAPS.oa) && !F.toontFase(CAPS.architect));

console.log(`\n${pass} ✓  ${fail} ✗`);
if (fail) console.log("Rood:\n  " + failures.join("\n  "));
process.exit(fail ? 1 : 0);
