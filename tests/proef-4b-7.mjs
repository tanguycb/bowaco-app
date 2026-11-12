// Assistenten als collega (stap 4b.7) op een canister die al in gebruik is (het eigen net, na de proeven van 3.4–4b.6).
// Bewijst:
//   A (zonder net) de woorden: de stand van een taak (wacht · bezig · voorstel klaar · mislukt), een assistent heet naar zijn taak +
//     "assistent", geen "AI" in de schermteksten van het blok assistenten, de rekenmodules byte-gelijk aan 4b.6;
//   B op het net:
//     (1) een taak geven aan een collega (giveTask): zichtbaar voor de gever en de uitvoerder met omschrijving, kort voor de werfleider
//         (zonder omschrijving), niet voor externen en anoniem; Te doen van de uitvoerder heeft de regel, die van de gever niet;
//     (2) de standen: wacht → bezig → klaar, en kan niet (met reden) = mislukt; de tijdlijn; enkel de uitvoerder beslist, de gever of
//         de beheerder annuleert; een afgesloten taak blijft afgesloten;
//     (3) controles: geen externe als uitvoerder, geen lege omschrijving, geen onmogelijke dag, een werf die de uitvoerder niet ziet;
//     (4) de assistenten (listAssistants): vijf, genoemd naar hun taak + "assistent", de score = de laatste gesloten proefronde (het
//         beste van alle koppelingen, zoals de proefbank ze toont), het aantal open taken klopt, interne rollen ja, externen nee;
//     (5) de beheerder (listTasks) ziet de gewone taak met soort "taak"; de taken van assistenten blijven zoals in 4b.5/4b.6.
// Enkel VERZONNEN gegevens: "Proef … 4b7".
//   node tests/proef-4b-7.mjs <canister-id>      (zonder canister: enkel deel A)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as V from "../src/frontend/src/app/voorstel.ts";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const cid = process.argv[2];
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const S = (x) => JSON.stringify(x, big);

// ── A. Zonder net ────────────────────────────────────────────────────────
{
  const nl = readFileSync(join(repo, "src/frontend/src/texts/nl.ts"), "utf8");
  const i = nl.indexOf("\n  assistenten: {");
  const blok = nl.slice(i, nl.indexOf("\n  voorstel: {", i)).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  check("A1 de stand van een taak in vier woorden (wacht · bezig · voorstel klaar · mislukt)", /wacht: "wacht"/.test(blok) && /bezig: "bezig"/.test(blok) && /voorstel: "voorstel klaar"/.test(blok) && /mislukt: "mislukt"/.test(blok) && V.TAAK_STAND.voorstel === "voorstel klaar");
  check("A2 geen \"AI\", geen leverancier of model in de schermteksten van assistenten", blok.length > 800 && !/\bAI\b/.test(blok) && !/Claude|Grok|Anthropic|model/i.test(blok) && /assistent/.test(blok));
  const scherm = readFileSync(join(repo, "src/frontend/src/screens/Assistenten.tsx"), "utf8").split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/**")).join("\n");
  check("A3 geen window.confirm en geen \"AI\" in het scherm Assistenten", !/window\.confirm|\bconfirm\(/.test(scherm) && !/"[^"]*\bAI\b[^"]*"/.test(scherm));
  check("A4 de tijdlijn kent de gewone taak: gaf de taak · begon eraan · taak klaar · taak mislukt", V.gebeurtenisTekst("taak:wacht") === "gaf de taak" && V.gebeurtenisTekst("taak:bezig") === "begon eraan" && V.gebeurtenisTekst("taak:klaar") === "taak klaar" && V.gebeurtenisTekst("taak:mislukt") === "taak mislukt");
  let same = true;
  try { execFileSync("git", ["diff", "--quiet", "fc1ebf8", "--", "src/frontend/src/quote/calc.ts", "src/frontend/src/tender/compare.ts", "src/frontend/src/tender/calc.ts", "src/backend/lib/QuoteCalc.mo", "src/backend/lib/TenderCompare.mo", "src/backend/lib/OaQuotes.mo", "src/backend/lib/OaRead.mo", "src/backend/lib/InvCheck.mo", "src/backend/lib/AiCheck.mo", "src/backend/lib/Proof.mo"], { cwd: repo }); } catch { same = false; }
  check("A5 rekenmodules en proefbank (3.8–3.11, Proof.mo) byte-gelijk aan 4b.6", same);
}

if (!cid) {
  console.log(`\nproef-4b-7 (enkel deel A): ${pass} ✓ ${fail} ✗`);
  process.exit(fail ? 1 : 0);
}

// ── B. Op het eigen net ─────────────────────────────────────────────────
const host = process.env.ICP_HOST || "";
if (!host.includes("localhost") && !host.includes("127.0.0.1")) throw new Error("tests/proef-4b-7.mjs enkel op het eigen lokale net");
const { backend } = await import("../tools/lib.mjs");
const ok = (r) => { if (r && typeof r === "object" && "err" in r) throw new Error(r.err); return r && typeof r === "object" && "ok" in r ? r.ok : r; };
const errOf = (r) => (r && typeof r === "object" && "err" in r ? r.err : "");
const denied = async (p) => { try { const r = await p; return !!(r && typeof r === "object" && "err" in r && /Geen toegang/.test(r.err)); } catch (e) { return /Geen toegang|trap|Reject|Unauthorized|niet bevestigd|Onbekende/i.test(String(e)); } };

const [admin, calc, wl, arch, klant, vc, oa] = await Promise.all(["proef-admin", "proef-calculator", "proef-werfleider", "proef-architect", "proef-klant", "proef-vc", "proef-oa2"].map((n) => backend(n, cid)));
const anon = await backend(null, cid);
const adminId = (await admin.me()).person[0].id;
const calcId = (await calc.me()).person[0].id;
const wlId = (await wl.me()).person[0].id;
const klantId = (await klant.me()).person[0].id;
const cDay = BigInt(Math.floor(Number((await admin.auditLog(0n, 1n))[0].at / 1_000_000n) / 86_400_000));
const Q = (o = {}) => ({ workId: [], key: "", subject: "", openOnly: false, kind: "", offset: 0n, limit: 100n, ...o });
const seen = async (who, o = {}) => (await who.listTasksFor(Q(o))).items;
const one = async (who, key) => (await seen(who, { key }))[0];
const todoOf = async (who) => { const r = []; for (let off = 0n; ; off += 50n) { const p = await who.myTodo({ day: cDay, offset: off, limit: 50n, snoozed: false, kind: "" }); r.push(...p.items); if (r.length >= Number(p.total) || p.items.length === 0) return r; } };
const sfx = Date.now().toString(36).slice(-5).toUpperCase();
const W = (await admin.listWorks()).find((w) => w.code === "P-A").id;
const TXT = `Proef offerte Specht nakijken 4b7 ${sfx}`;

// ── (1) Een taak geven ──────────────────────────────────────────────────
const id1 = ok(await admin.giveTask({ doerId: calcId, workId: [W], title: TXT, dueDay: [cDay + 2n] }));
const key1 = `taak:${id1}`;
const tc = await one(calc, key1);
const ta = await one(admin, key1);
check("(1) de uitvoerder (calculator) ziet de taak volledig: omschrijving, uiterste dag, stand wacht, gegeven door de beheerder", tc?.full === true && tc.task.title === TXT && tc.task.dueDay[0] === cDay + 2n && tc.task.state === "wacht" && tc.task.givenBy === `persoon:${adminId}` && tc.task.doer === `persoon:${calcId}` && tc.task.kind === "taak" && tc.task.name === "Taak", S(tc?.task));
check("(1) de gever ziet haar ook volledig; tijdlijn: gaf de taak", ta?.full === true && ta.task.title === TXT && S(ta.task.events.map((e) => e.what)) === S(["taak:wacht"]));
const wlAll = (await seen(wl, { workId: [W] })).find((g) => g.task.key === key1);
check("(1) de werfleider (geen partij) ziet enkel de korte vorm: stand en wie, geen omschrijving, geen reden, geen dag", !wlAll || (wlAll.full === false && wlAll.task.title === "" && wlAll.task.reason === "" && wlAll.task.dueDay.length === 0 && wlAll.task.subject === ""), S(wlAll?.task));
const ext = { architect: arch, klant, vc, oa, anoniem: anon };
const open = [];
for (const [n, x] of Object.entries(ext)) { if (!(await denied(x.listTasksFor(Q({ limit: 1n }))))) open.push(n); }
check("(1) externen en anoniem: geen toegang tot de taken (ook niet tot deze)", open.length === 0, open.join(","));
const tdCalc = (await todoOf(calc)).find((x) => x.key === key1);
const tdAdmin = (await todoOf(admin)).find((x) => x.key === key1);
check("(1) Te doen van de uitvoerder heeft de regel (soort taak, omschrijving, 'van <gever>', de knoppen Begin eraan · Klaar · Kan niet); die van de gever niet", !!tdCalc && tdCalc.kind === "taak" && tdCalc.title === TXT && tdCalc.sub === "wacht" && tdCalc.acts.map((a) => a.kind).join() === "taak-start,taak-klaar,taak-kan-niet" && !tdAdmin, S(tdCalc));
check("(1) de regel in Te doen bevat geen bedragen en geen vertrouwelijke tekst (enkel de omschrijving van een mens)", !!tdCalc && !/€|cents/i.test(S(tdCalc.detail)));

// ── (2) De standen ──────────────────────────────────────────────────────
check("(2) enkel de uitvoerder begint aan de taak (de gever en een werfleider niet)", /Enkel de uitvoerder/.test(errOf(await admin.stepTask(id1, { start: null }, ""))) && (await denied(wl.stepTask(id1, { start: null }, ""))));
ok(await calc.stepTask(id1, { start: null }, ""));
let t = (await one(calc, key1)).task;
const tdBusy = (await todoOf(calc)).find((x) => x.key === key1);
check("(2) wacht → bezig: stand bezig, de regel blijft met Klaar en Kan niet (zonder Begin eraan)", t.state === "bezig" && tdBusy?.sub === "bezig" && tdBusy.acts.map((a) => a.kind).join() === "taak-klaar,taak-kan-niet");
check("(2) bezig starten kan niet twee keer", /al bezig/.test(errOf(await calc.stepTask(id1, { start: null }, ""))));
ok(await calc.stepTask(id1, { done: null }, ""));
t = (await one(calc, key1)).task;
check("(2) bezig → klaar: de regel is weg uit Te doen; tijdlijn wacht · bezig · klaar", t.state === "klaar" && !(await todoOf(calc)).some((x) => x.key === key1) && S(t.events.map((e) => e.what)) === S(["taak:wacht", "taak:bezig", "taak:klaar"]), S(t.events.map((e) => e.what)));
check("(2) een afgesloten taak blijft afgesloten (geen stap meer, ook niet annuleren)", /afgesloten/.test(errOf(await calc.stepTask(id1, { start: null }, ""))) && /afgesloten/.test(errOf(await admin.stepTask(id1, { cancel: null }, ""))));
// Kan niet = mislukt, met reden.
const id2 = ok(await calc.giveTask({ doerId: wlId, workId: [W], title: `Proef foto's nemen 4b7 ${sfx}`, dueDay: [] }));
check("(2) Kan niet vraagt een reden", /waarom/.test(errOf(await wl.stepTask(id2, { cannot: null }, "  "))));
ok(await wl.stepTask(id2, { cannot: null }, "Proef: ik ben die dag afwezig"));
const t2 = await one(wl, `taak:${id2}`);
check("(2) kan niet → mislukt, met de reden; de gever (calculator) ziet ze ook; de regel is weg uit Te doen van de uitvoerder", t2.task.state === "mislukt" && t2.task.reason === "Proef: ik ben die dag afwezig" && (await one(calc, `taak:${id2}`)).task.reason === t2.task.reason && !(await todoOf(wl)).some((x) => x.key === `taak:${id2}`));
// Annuleren: de gever of de beheerder.
const id3 = ok(await calc.giveTask({ doerId: wlId, workId: [], title: `Proef rondgang 4b7 ${sfx}`, dueDay: [] }));
check("(2) de uitvoerder mag zijn eigen taak niet annuleren (hij meldt Kan niet); een buitenstaander niet; de gever wel", /Enkel wie de taak gaf/.test(errOf(await wl.stepTask(id3, { cancel: null }, ""))) && (await denied(klant.stepTask(id3, { cancel: null }, ""))));
ok(await calc.stepTask(id3, { cancel: null }, ""));
check("(2) geannuleerd: de taak staat op geannuleerd en verdwijnt uit Te doen", (await one(calc, `taak:${id3}`)).task.state === "geannuleerd" && !(await todoOf(wl)).some((x) => x.key === `taak:${id3}`));
// Beheerder mag annuleren, ook als hij de taak niet gaf.
const id4 = ok(await calc.giveTask({ doerId: wlId, workId: [], title: `Proef opruimen 4b7 ${sfx}`, dueDay: [] }));
ok(await admin.stepTask(id4, { cancel: null }, ""));
check("(2) de beheerder annuleert ook een taak die hij niet gaf", (await one(admin, `taak:${id4}`)).task.state === "geannuleerd");
// Een taak zonder werf: enkel de partijen en de beheerder.
const id5 = ok(await calc.giveTask({ doerId: wlId, workId: [], title: `Proef zonder werf 4b7 ${sfx}`, dueDay: [] }));
check("(2) een taak zonder werf: de gever en de uitvoerder zien ze volledig, een andere interne rol niets of kort", (await one(calc, `taak:${id5}`)).full && (await one(wl, `taak:${id5}`)).full);

// ── (3) Controles ───────────────────────────────────────────────────────
check("(3) een externe als uitvoerder wordt geweigerd", /Kies een collega/.test(errOf(await admin.giveTask({ doerId: klantId, workId: [], title: "Proef extern 4b7", dueDay: [] }))));
check("(3) een lege omschrijving en een onmogelijke dag worden geweigerd", /kort wat er moet/.test(errOf(await admin.giveTask({ doerId: calcId, workId: [], title: "   ", dueDay: [] }))) && /Onmogelijke datum/.test(errOf(await admin.giveTask({ doerId: calcId, workId: [], title: "Proef dag 4b7", dueDay: [1n] }))));
check("(3) een onbekende werf en een onbekende collega worden geweigerd", /Onbekende werf/.test(errOf(await admin.giveTask({ doerId: calcId, workId: [99999999n], title: "Proef werf 4b7", dueDay: [] }))) && /Kies een collega/.test(errOf(await admin.giveTask({ doerId: 99999999n, workId: [], title: "Proef wie 4b7", dueDay: [] }))));
check("(3) externen en anoniem kunnen geen taak geven en geen collega's opvragen", (await denied(klant.giveTask({ doerId: calcId, workId: [], title: "Proef 4b7", dueDay: [] }))) && (await denied(anon.giveTask({ doerId: calcId, workId: [], title: "Proef 4b7", dueDay: [] }))) && (await denied(oa.listColleagues([]))) && (await denied(arch.stepTask(id1, { start: null }, ""))));
const cols = await calc.listColleagues([]);
check("(3) de collega's: enkel interne, actieve personen (geen klant, architect of onderaannemer)", cols.length >= 3 && cols.some((c) => c.id === adminId) && cols.some((c) => c.id === wlId) && !cols.some((c) => c.id === klantId), S(cols.map((c) => c.name)));
check("(3) een taak van een assistent beslis je niet met stepTask (haar eigen scherm)", /eigen scherm/.test(errOf(await admin.stepTask((await admin.listTasks({ workId: [], openOnly: false, kind: "factuurcontrole", offset: 0n, limit: 1n })).items[0]?.id ?? 1n, { cancel: null }, ""))) || (await admin.listTasks({ workId: [], openOnly: false, kind: "factuurcontrole", offset: 0n, limit: 1n })).items.length === 0);

// ── (4) De assistenten en hun score ─────────────────────────────────────
const as = await calc.listAssistants();
const kinds = as.map((a) => a.kind).sort().join();
check("(4) vijf assistenten, genoemd naar hun taak + assistent (nooit leverancier of model), zonder \"AI\"", as.length === 5 && kinds === "document-koppelen,factuurcontrole,oa-offerte-inlezen,offerte-nalezen,offertes-vergelijken" && as.every((a) => /\(assistent\)$/.test(a.name) && !/\bAI\b/.test(a.name)), S(as.map((a) => a.name)));
const rounds = await admin.listProofRounds();
const exp = (kind) => {
  const r = rounds.filter((x) => x.task === kind && x.latest && "closed" in x.state);
  if (r.length === 0) return { score: null, passed: false };
  return { score: Math.max(...r.map((x) => Number(x.pct))), passed: r.some((x) => x.passed) };
};
let klopt = true;
const rij = [];
for (const a of as) {
  const e = exp(a.kind);
  const s = a.score.length ? Number(a.score[0]) : null;
  rij.push(`${a.kind}=${s ?? "–"}${a.passed ? "✓" : ""}`);
  if (s !== e.score || a.passed !== e.passed) klopt = false;
}
check("(4) de score bij de naam = de laatste gesloten proefronde (het beste van alle koppelingen, zoals de proefbank); gehaald = 95 % op 50 gevallen", klopt, rij.join(" "));
check("(4) minstens één assistent heeft al een score uit de proeven van 3.x (de lokale reeks)", as.some((a) => a.score.length > 0) || rounds.filter((x) => "closed" in x.state).length === 0, rij.join(" "));
const openPer = {};
for (let off = 0n; ; off += 100n) { const p = await admin.listTasks(Q({ offset: off, openOnly: true })); for (const x of p.items) openPer[x.kind] = (openPer[x.kind] ?? 0) + 1; if (p.items.length < 100n) break; }
check("(4) het aantal open taken per assistent klopt met het model", as.every((a) => Number(a.open) === (openPer[a.kind] ?? 0)), S(openPer));
check("(4) interne rollen zien de assistenten (beheerder, calculator, werfleider); externen en anoniem niet", (await admin.listAssistants()).length === 5 && (await wl.listAssistants()).length === 5 && (await denied(klant.listAssistants())) && (await denied(arch.listAssistants())) && (await denied(oa.listAssistants())) && (await denied(vc.listAssistants())) && (await denied(anon.listAssistants())));
const keys = JSON.stringify(as, big);
check("(4) de kaart bevat enkel naam, soort, score, aantallen: geen leverancier, model, instructie of bedrag", !/vendor|model|instruction|cents|€/i.test(keys));

// ── (5) De beheerder en de rest van het model ───────────────────────────
const lt = await admin.listTasks(Q({ kind: "taak" }));
check("(5) de beheerder ziet de gewone taken via listTasks (soort taak), de nieuwste eerst", lt.items.length >= 4 && lt.items[0].kind === "taak" && lt.items.every((x) => x.kind === "taak"), `${lt.total}`);
check("(5) listTasks blijft enkel de beheerder (calculator en werfleider: geen toegang)", (await denied(calc.listTasks(Q()))) && (await denied(wl.listTasks(Q()))));
const alle = await seen(calc, {});
check("(5) de taken van assistenten staan er nog zoals in 4b.6 (wie deed wat per werf blijft werken naast de gewone taken)", alle.some((g) => g.task.kind !== "taak") && alle.some((g) => g.task.kind === "taak"));

console.log(`\nproef-4b-7: ${pass} ✓ ${fail} ✗`);
process.exit(fail ? 1 : 0);
