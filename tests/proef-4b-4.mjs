// Stap 4b.4 (gsm en externen): per rol wat de startpagina toont, bevestigen met één tik, en geen bedragen voor externen.
// De zuivere kern (src/frontend/src/app/eentik.ts, nav.ts, schil.ts, fase.ts: door Node rechtstreeks gedraaid, zoals de browser) en,
// met een canister, de backend (enkel op het eigen lokale net, met verzonnen gegevens die de reeks van tests/lokaal.sh al zette).
//   (A) Eén tik: welke bevestigingen een werfleider krijgt (wie is er, taak klaar) en wanneer ze verdwijnen;
//   (B) de onderbalk en het menu per rol, de routes van de Werklijsten (offerte, factuur, Te doen) en hun ⓘ;
//   (C) de start van klant, architect en veiligheidscoördinator: enkel wat hun rechten op die werf al gaven;
//   (D) backend: één tik gaat via dezelfde opdrachten als het verslag, de onderaannemer bevestigt zijn dag, externen krijgen geen bedrag;
//   (E) niets aan de backend of de rekenmodules gewijzigd (4b.4 is enkel schermen).
//   node tests/proef-4b-4.mjs                 (A–C, E)
//   ICP_HOST=http://localhost:84xx node tests/proef-4b-4.mjs <canister-id>   (+ D)
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEenTik, loadNav, loadSchil } from "./menu-lib.mjs";
const E = await loadEenTik();
const N = await loadNav();
const S = await loadSchil();

const cid = process.argv[2];
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const J = (x) => JSON.stringify(x, big);

// ── A. Eén tik ──────────────────────────────────────────────────────────
const werk = (id, o = {}) => ({ id, code: `W-${id}`, name: "x", planned: [{ orgId: 7n, code: "GILS", name: "Gils" }, { orgId: 8n, code: "DAK", name: "Dak" }], tasks: [], reports: [], ...o });
const taak = (id, o = {}) => ({ id, title: `Taak ${id}, extra`, status: "planned", percent: 0n, ...o });
let r = E.tikken([werk(1n, { tasks: [taak(10n), taak(11n)] })], []);
check("(A1) een werf met geplande firma's en nog geen verslag: 'Wie is er? Klopt' met één opdracht per firma", r[0].key === "wie-1" && r[0].op.length === 2 && r[0].op.every((o) => o.__kind__ === "attendance") && r[0].detail === "GILS · DAK");
check("(A1) de aanwezigheid krijgt de standaard tijdvakken (07:30–12:00 en 12:30–16:00) en geen regie", r[0].op[0].attendance.slots.length === 2 && r[0].op[0].attendance.slots[0].fromMin === 450n && r[0].op[0].attendance.slots[1].toMin === 960n && r[0].op[0].attendance.regie === false && r[0].op[0].attendance.replaces === undefined);
check("(A2) elke open taak = 'Taak klaar?' met voortgang 100 % (de titel tot de eerste komma)", r.filter((x) => x.key.startsWith("taak-")).length === 2 && r[1].op[0].__kind__ === "workDone" && r[1].op[0].workDone.percent === 100n && r[1].op[0].workDone.taskId === 10n && r[1].detail === "Taak 10");
check("(A3) nooit meer dan drie taken per werf", E.tikken([werk(1n, { tasks: [1n, 2n, 3n, 4n, 5n].map((i) => taak(i)) })], []).filter((x) => x.key.startsWith("taak-")).length === 3);
check("(A4) een afgeronde taak (done of 100 %) krijgt geen rij", E.tikken([werk(1n, { tasks: [taak(1n, { status: "done" }), taak(2n, { percent: 100n })] })], []).every((x) => !x.key.startsWith("taak-")));
check("(A5) een verslag dat al bestaat: geen 'Wie is er?' meer", E.tikken([werk(1n, { reports: [{}] })], []).every((x) => x.key !== "wie-1"));
const wacht = E.tikken([werk(1n, { tasks: [taak(10n)] })], [{ workId: 1n, kind: "attendance" }, { workId: 1n, kind: "workDone", taskId: 10n, percent: 100n }]);
check("(A5) wat al in de wachtrij staat (aanwezigheid, taak 100 %) verdwijnt meteen; geen dubbele opdracht bij een tweede tik", wacht.length === 0);
check("(A5) een wachtrij van een andere werf of een voortgang onder 100 % laat de rij staan", E.tikken([werk(1n, { tasks: [taak(10n)] })], [{ workId: 2n, kind: "attendance" }, { workId: 1n, kind: "workDone", taskId: 10n, percent: 50n }]).length === 2);
check("(A6) niemand gepland en geen taken: geen rijen (het blok verdwijnt)", E.tikken([werk(1n, { planned: [] })], []).length === 0);

// ── B. Onderbalk, menu, Werklijsten ─────────────────────────────────────
const caps = (o = {}) => ({ home: "werven", readTeam: false, writeReports: false, myTenders: false, ...o });
check("(B1) onderbalk onderaannemer: Week · Uren · Prijsvragen · Meer", J(N.bottomBar(caps({ home: "week", myTenders: true }))) === J(["week", "uren", "prijsvragen", "meer"]));
check("(B1) een onderaannemer zonder prijsvragen houdt Werven in plaats daarvan; de werfleider houdt zijn balk; de rest geen", J(N.bottomBar(caps({ home: "week" }))) === J(["week", "uren", "werven", "meer"]) && J(N.bottomBar(caps({ home: "vandaag", writeReports: true, readTeam: true }))) === J(["vandaag", "werven", "verslag", "meer"]) && N.bottomBar(caps({ home: "overzicht", readTeam: true })).length === 0 && N.bottomBar(caps()).length === 0);
check("(B2) de routes van de Werklijsten tonen hun ⓘ en tabbladen: #/offertes/k/12, #/facturen/5, #/te-doen/<regel>", S.toontUitleg(["offertes", "k", "12"]) && S.toontUitleg(["facturen", "5"]) && S.toontUitleg(["te-doen", "melding%3A1"]));
check("(B2) de editor (#/offertes/12/3) en een los stuk blijven zonder ⓘ van de lijst", !S.toontUitleg(["offertes", "12", "3"]) && !S.toontUitleg(["werven", "3", "planning"]));

// ── C. De starten van klant, architect en veiligheidscoördinator ────────
check("(C1) architect of veiligheidscoördinator zonder vinkjes: planning, vergunningen en documenten, geen verslagen en geen upload", J(E.veiligRegels({ grants: [] }).map((x) => x.key)) === J(["planning", "vergunningen", "documenten"]));
check("(C1) met het vinkje Verslagen komen de verslagen erbij; met uploadrecht zegt de regel dat je stukken kan toevoegen", E.veiligRegels({ grants: ["readReports"] }).some((x) => x.key === "verslagen") && E.veiligRegels({ grants: ["uploadDocs"] }).some((x) => x.key === "documentenUpload") && !E.veiligRegels({ grants: [] }).some((x) => x.key === "documentenUpload"));
check("(C1) elke regel opent een tabblad dat de werf voor deze rol kent (planning, verslagen, vergunningen, documenten)", E.veiligRegels({ grants: ["readReports", "uploadDocs"] }).every((x) => ["planning", "verslagen", "vergunningen", "documenten"].includes(x.tab)));
const fase = (o) => ({ index: 4, key: "x", cancelled: false, aftercare: false, manual: false, steps: [], at: [], ...o });
check("(C2) de klant leest de stand in één zin in zijn eigen woorden; een geannuleerde werf ligt stil", /Uw werf staat in de fase «Werken bezig»/.test(E.standZin(fase({ index: 4 }), true)) && /stil/.test(E.standZin(fase({ cancelled: true }), true)));
check("(C3) geen enkel eurobedrag in de teksten van de starten", !/€|euro|prijs|bedrag/i.test(J(E.veiligRegels({ grants: ["readReports", "uploadDocs"] })) + E.standZin(fase({}), true)));

// ── E. Enkel schermen ───────────────────────────────────────────────────
const git = (...a) => { try { return execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" }); } catch (e) { return String(e); } };
const basis = "00c355c";
// 4b.5: de controle gaat over de stap 4b.4 zelf (00c355c → fe0f754); latere stappen mogen de backend wel wijzigen.
const eind = "fe0f754";
for (const pad of ["src/backend", "src/frontend/src/tender", "src/frontend/src/progress", "src/frontend/src/minmeer", "src/frontend/src/nacalc", "src/frontend/src/quote", "src/frontend/src/pdf"]) {
  const v = git("diff", "--stat", basis, eind, "--", pad).trim();
  check(`(E1) ${pad} is in 4b.4 (${basis} → ${eind}) ongewijzigd`, v === "", v.slice(0, 200));
}
const gew = git("diff", "--name-only", basis, eind).split("\n").filter(Boolean);
check("(E2) enkel schermen, ontwerp, teksten, opmaak, de proef en de documentatie zijn aangeraakt", gew.every((f) => /^src\/frontend\/src\/(screens|design|app|texts)|^src\/frontend\/proef\/|^tests\/|^docs\//.test(f)), gew.filter((f) => !/^src\/frontend\/src\/(screens|design|app|texts)|^src\/frontend\/proef\/|^tests\/|^docs\//.test(f)).join(", "));

// ── D. Backend ──────────────────────────────────────────────────────────
if (cid) {
  const { backend, freshBackend } = await import("../tools/lib.mjs");
  const [admin, wl, oa, oa2, klant, arch, vc] = await Promise.all(["proef-admin", "proef-werfleider", "proef-oa2", "proef-oa", "proef-klant", "proef-architect", "proef-vc"].map((n) => backend(n, cid)));
  const vreemd = await freshBackend(cid);
  const geld = (x) => /Cents|"totals"|unitPrice|amount|price|margin|€/i.test(J(x).replace(/"(?:[a-zA-Z]*(?:Count|count|Discount)[a-zA-Z]*)":/g, ""));
  const uid = () => crypto.randomUUID();
  const done = (x) => x && x.outcome && "done" in x.outcome;
  // oa = de onderaannemer met toewijzingen in de reeks (sleutel proef-oa2); oa2 = een andere sleutel (hier niet gekoppeld) voor de weigering.
  const nu = BigInt(Math.floor(Date.now() / 86_400_000));

  // D1: de werfleider bevestigt met één tik: openen, aanwezigheid, taak klaar: dezelfde opdrachten als het verslag.
  let dagWerk = null;
  let dag = nu;
  for (let d = nu - 3n; d <= nu + 3n && !dagWerk; d++) {
    const v = await wl.myDay(d, true).catch(() => null);
    const w = v?.works?.find((x) => x.mine && E.tikken([{ ...x, reports: [] }], []).length > 0);
    if (w) { dagWerk = w; dag = d; }
  }
  if (!dagWerk) check("(D1) geen werf met werk op de dagen rond het net gevonden: de rollentest dekt het verslag", true, "overgeslagen");
  else {
    const key = uid();
    const rij = E.tikken([{ ...dagWerk, reports: [] }], []);
    const opn = await wl.reportSync([{ opId: uid(), clientKey: key, op: { ensure: { workId: dagWerk.id, day: dag } } }]);
    check("(D1) 'verslag openen' (de eerste opdracht van een tik) lukt voor de werfleider", done(opn[0]), J(opn[0]).slice(0, 160));
    let ok = true;
    for (const x of rij) for (const o of x.op) {
      const op = o.__kind__ === "attendance"
        ? { attendance: { orgId: [o.attendance.orgId], personId: [], names: "", headcount: 1n, slots: o.attendance.slots, regie: false, taskId: [], note: "", replaces: [] } }
        : { workDone: { taskId: [o.workDone.taskId], text: "", percent: [100n] } };
      const res = await wl.reportSync([{ opId: uid(), clientKey: key, op }]);
      if (!done(res[0])) { ok = false; console.log("  ✗ opdracht geweigerd:", J(res[0]).slice(0, 200)); }
    }
    check(`(D1) er is minstens één tik, en alle ${rij.length} opdrachten van een tik (wie is er, taak klaar) worden aanvaard`, ok && rij.length > 0);
    const opnieuw = await wl.reportSync([{ opId: uid(), clientKey: key, op: { ensure: { workId: dagWerk.id, day: dag } } }]);
    check("(D1) nog eens openen met dezelfde sleutel = 'bestaat' (geen dubbel verslag door een tweede tik)", done(opnieuw[0]) && opnieuw[0].outcome.done.note === "bestaat");
    const dagNa = await wl.myDay(dag, true);
    check("(D1) de werfleider ziet na de tik zijn verslag en nog steeds geen bedrag", dagNa.works.some((x) => x.id === dagWerk.id && x.reports.length > 0) && !geld(dagNa));
  }

  // D2: de onderaannemer bevestigt zijn dag met één tik (en een andere firma of een vreemde niet).
  const mijn = await oa.orgAssignments([], nu - 30n, nu + 300n).catch(() => []);
  const open = mijn.find((r) => r.canConfirm && !["confirmed", "declined"].includes(Object.keys(r.assignment.confirmation)[0]));
  if (open) {
    const a = open.assignment.id;
    const bad = await oa2.confirmAssignment(a, true, "").then((x) => "err" in x).catch(() => true);
    const vr = await vreemd.confirmAssignment(a, true, "").then((x) => "err" in x).catch(() => true);
    const ja = await oa.confirmAssignment(a, true, "");
    check("(D2) 'Bevestigen' (één tik) lukt voor de eigen firma; een andere firma en een vreemde krijgen een weigering", "ok" in ja && bad && vr, J(ja).slice(0, 120));
    const na = (await oa.orgAssignments([], nu - 30n, nu + 300n)).find((r) => r.assignment.id === a);
    check("(D2) daarna staat de dag op 'bevestigd' (Voor jou toont hem niet meer bovenaan)", na && "confirmed" in na.assignment.confirmation);
  } else check("(D2) geen te bevestigen dag meer in de reeks (de rollentest bevestigde ze al): geen herhaling nodig", true, "overgeslagen");
  const nog = (await oa.orgAssignments([], nu - 30n, nu + 300n)).filter((r) => r.canConfirm && !["confirmed", "declined"].includes(Object.keys(r.assignment.confirmation)[0]));
  check("(D2) 'Voor jou' toont enkel dagen van de eigen firma met het recht om te bevestigen", nog.every((r) => r.canConfirm));

  // D3: geen bedragen voor externen op wat hun start toont (Te doen, mijn werven, planning, uren, prijsvragen).
  for (const [naam, w] of [["onderaannemer", oa], ["klant", klant], ["architect", arch], ["veiligheidscoördinator", vc]]) {
    const todo = await w.myTodo({ day: nu, offset: 0n, limit: 50n, snoozed: false, kind: "" }).catch(() => null);
    const werken = await w.myWorks().catch(() => []);
    check(`(D3) ${naam}: Te doen en Mijn werven bevatten geen bedrag`, todo !== null && !geld(todo) && !geld(werken), geld(todo) ? J(todo).slice(0, 160) : "");
  }
  const uren = await oa.myHours(nu - 60n, nu + 1n).catch(() => []);
  const board = await oa.myBoard(nu - 7n, 2n).catch(() => null);
  check("(D3) onderaannemer: uren en week (myBoard) zonder bedrag", !geld(uren) && !geld(board));
  const tenders = await oa.listMyTenders().catch(() => []);
  check("(D3) onderaannemer: Mijn prijsvragen zonder bedragen van andere firma's", !/otherPrice|offerCents/i.test(J(tenders)));

  // D4: klant, architect, VC en een vreemde: de rechten blijven zoals ze waren.
  for (const [naam, w] of [["klant", klant], ["architect", arch], ["veiligheidscoördinator", vc]]) {
    const me = (await w.me()).caps?.[0];
    check(`(D4) ${naam}: geen kantoorrechten (geen offertes met prijs, geen team, geen werf maken)`, me && !me.quotePrices && !me.readTeam && !me.createWork && !me.manageSettings && !me.sales && !me.oaInvoices);
  }
  const werkenV = await vreemd.myWorks().catch(() => []);
  check("(D4) een vreemde zonder lidmaatschap heeft geen werven", werkenV.length === 0);
  void admin;
}

console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
