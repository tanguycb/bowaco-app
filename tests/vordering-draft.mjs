// Vorderingsstaten (stap 2.10, bouwplan §9 rij 2.10, §5.1 en §7) op een canister die al in gebruik is (een draft of het eigen net).
// Zet enkel VERZONNEN testgegevens: per run een eigen proefwerf "P-VS-…" met een aanvaarde proefofferte "VS-…" (tests/vordering-lib.mjs).
// Op het einde staat de proefwerf op "geannuleerd" en staan de instellingen terug zoals ze waren. Gebruikt de testidentiteiten
// van tests/rollen.mjs (of tools/draft-opbouw.mjs). Bewijst vooral:
//   (1) bedragen, eenheidsprijzen en marges gaan NOOIT naar de werfleider of externen (sleutels van de antwoorden, .did-typen);
//   (2) de voorstellen: VH uit de afgesloten opmeting (2.9), regie uit de werfverslagen (1.6) zonder betwiste uren (1.7), % uit de
//       planning; de werfleider bereidt voor, admin en calculator rekenen en versturen;
//   (3) cumulatief correct: vorige staten, deze periode, totaal, rest; meer- en minderwerk apart; met de hand nagerekend;
//   (4) contractparameters: prijsherziening (model + indexwaarden), inhouding waarborg, vervaldag, btw van de werf;
//   (5) de browser rekent mee en de server weigert een ander totaal; getypte totalen bestaan niet;
//   (6) een verzonden staat is onwijzigbaar (hash); verbeteren = creditnota of volgende staat;
//   (7) de klant ziet enkel zijn verzonden staten en geeft (instelbaar) akkoord; klaar voor factuur; factuurgegevens (UBL);
//   (8) auditlog zonder bedragen, export, instellingen.
//   node tests/vordering-draft.mjs <canister-id>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { backend, freshBackend } from "../tools/lib.mjs";
import { proefVordering, browserTotals, saveAs, prepareAs, PM, ok, errOf, opt } from "./vordering-lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/vordering-draft.mjs <canister-id>");
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const isOk = (r) => r && typeof r === "object" && "ok" in r;
const denied = async (p) => { try { const r = await p; return !!(r && "err" in r && /^Geen toegang|^Onbekende staat/.test(r.err)); } catch (e) { return /Geen toegang|trap|Reject|reject/i.test(String(e)); } };
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const flat = (x) => JSON.stringify(x, big);
const uid = () => crypto.randomUUID();
// Alle sleutels van een antwoord (recursief): een bedragveld mag er niet in voorkomen.
const keysOf = (x, out = new Set()) => { if (Array.isArray(x)) x.forEach((y) => keysOf(y, out)); else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { out.add(k); keysOf(v, out); } return out; };
const MONEY = /cents|price|cost|margin|amount|euro|total|payable|retention|revision/i;
const noMoney = (x) => ![...keysOf(x)].some((k) => MONEY.test(k));

const [admin, wl, calc, arch, oa2, klant, vc] = await Promise.all(["proef-admin", "proef-werfleider", "proef-calculator", "proef-architect", "proef-oa2", "proef-klant", "proef-vc"].map((n) => backend(n, cid)));
const anon = await backend(null, cid);
const vreemd = await freshBackend(cid);
const me = await admin.me();
check("versie 2.10 of later op de canister", /^2\.1\d|^[3-9]\./.test(me.version) || /dev/.test(me.version), me.version);
const cDay = BigInt(Math.floor(Number((await admin.auditLog(0n, 1n))[0].at / 1_000_000n) / 86_400_000));
const settings0 = await admin.progressSettings();
ok(await admin.saveProgressSettings({ client: "mogelijk", retentionOnIncl: false }));

// ── Opzet ──
const S = await proefVordering({ admin, calc, wl });
const { W, wid, L, dak, regieTask } = S;
check("opzet: proefwerf met aanvaarde offerte, werfstart (regietaak) en proefcontract", !!wid && !!regieTask, W);

// ── (1) Wie ziet wat, vóór er een staat is ──
for (const [n, x] of [["architect", arch], ["onderaannemer", oa2], ["klant", klant], ["veiligheidscoördinator", vc], ["anoniem", anon], ["onbekende login", vreemd]]) {
  const rs = await Promise.all([x.progressWorks(), x.listProgress(wid), x.newProgress(wid), x.progressQty(1n), x.readProgressStatement(1n), x.readProgressRevision(wid), x.progressInvoiceData(1n)].map(denied));
  check(`(1) ${n}: lijsten, nieuw, lezen, prijsherziening en factuurgegevens geweigerd`, rs.every(Boolean), rs.map((r) => (r ? "·" : "✗")).join(""));
}
check("(1) de werfleider ziet de werf in Vorderingen (scope voorbereiden), de calculator met volle rechten", (await wl.progressWorks()).some((x) => x.workId === wid && x.scope === "prepare") && (await calc.progressWorks()).some((x) => x.workId === wid && x.scope === "full"));
check("(1) de werfleider leest het rekenmodel van de prijsherziening niet", await denied(wl.readProgressRevision(wid)));

// ── (2) Een opmeting (2.9) en regie-uren (1.6, 1.7) als bron ──
const msync = (who, op) => who.measureSync([{ opId: uid(), clientKey: KM, op }]);
const KM = uid();
ok({ ok: (await msync(wl, { open: { workId: wid } }))[0] });
const [me1] = await msync(wl, { entry: { lineId: L.afbraak, qtyMilli: 42_000n, day: cDay, complete: true, note: "proef", files: [], corrects: [], reason: "" } });
const [mc] = await msync(wl, { close: { note: "proef 2.10" } });
check("(2) opmeting: afbraak 42 m² (VH 40), afgesloten", "done" in me1.outcome && "done" in mc.outcome, flat([me1.outcome, mc.outcome]));
// Regie: lid van de werf met uren bevestigen; één bevestigde regel (16 u), één betwiste (4 u), één zonder regiepost (2 u).
const oaPerson = (await oa2.me()).person[0].id;
ok(await admin.addMembership(wid, [oaPerson], [], { onderaannemer: null }, [{ confirmHours: null }, { confirmPlanning: null }]));
const KR = uid();
const rsync = (op) => wl.reportSync([{ opId: uid(), clientKey: KR, op }]);
const [re] = await rsync({ ensure: { workId: wid, day: cDay } });
const att = (h, task) => ({ attendance: { orgId: [dak.id], personId: [], names: "Proefploeg 2.10", headcount: h, slots: [{ fromMin: 450n, toMin: 720n }, { fromMin: 750n, toMin: 960n }], regie: true, taskId: opt(task), note: "", replaces: [] } });
const [a1] = await rsync(att(2n, regieTask.id)); // 2 × 8 u = 16 u
const [a2] = await rsync({ attendance: { orgId: [dak.id], personId: [], names: "Proef betwist", headcount: 1n, slots: [{ fromMin: 480n, toMin: 720n }], regie: true, taskId: [regieTask.id], note: "", replaces: [] } }); // 4 u
const [a3] = await rsync({ attendance: { orgId: [], personId: [], names: "Proef zonder post", headcount: 1n, slots: [{ fromMin: 480n, toMin: 600n }], regie: true, taskId: [], note: "", replaces: [] } }); // 2 u
const [rf] = await rsync({ finalize: null });
check("(2) werfverslag met regie-uren afgesloten", [re, a1, a2, a3, rf].every((x) => "done" in x.outcome), flat([a1.outcome, rf.outcome]));
check("(2) de OA bevestigt 16 u en betwist 4 u", isOk(await oa2.confirmHours(a1.outcome.done.entityId[0], true, "")) && isOk(await oa2.confirmHours(a2.outcome.done.entityId[0], false, "proef: niet aanwezig")));

// ── (3) De werfleider bereidt voor ──
const n1 = await wl.newProgress(wid);
check("(3) de werfleider begint een ontwerp", isOk(n1), errOf(n1));
const id1 = n1.ok;
check("(3) een tweede ontwerp op dezelfde werf: geweigerd", /al een ontwerp/.test(errOf(await calc.newProgress(wid))));
let q = await wl.progressQty(id1);
const byTitle = (v, t) => v.lines.find((l) => (l.q ?? l).title.startsWith(t));
check("(3) 5 posten: afbraak, container, metselwerk, minwerk (aanneming) en regie", q.lines.length === 5 && q.lines.filter((l) => "contract" in l.section).length === 4 && "regie" in byTitle(q, "Proef regie").section, flat(q.lines.map((l) => [l.title, l.section])));
check("(3) GEEN bedrag, eenheidsprijs of marge in wat de werfleider leest (sleutels)", noMoney(q), [...keysOf(q)].filter((k) => MONEY.test(k)).join(","));
const qa = byTitle(q, "Proef afbraak");
check("(3) voorstel VH = de afgesloten opmeting (42 m², opmeting 1) en gemarkeerd 'boven-vh'", qa.cumQtyMilli === 42_000n && qa.hints.measuredMilli[0] === 42_000n && qa.hints.measuredSurvey[0] === 1n && qa.flags.includes("boven-vh") && !qa.hasInput);
const qr = byTitle(q, "Proef regie");
check("(3) voorstel regie = 16 u bevestigd (de 4 betwiste uren tellen niet), gemarkeerd 'uren-betwist'", qr.cumQtyMilli === 16_000n && qr.hints.hoursMilli[0] === 16_000n && qr.hints.hoursDisputedMilli === 4_000n && qr.flags.includes("uren-betwist"), flat(qr.hints));
check("(3) regie-uren zonder regiepost: apart vermeld (2 u)", q.unassignedRegieMilli === 2_000n, String(q.unassignedRegieMilli));
check("(3) de werfleider leest de staat met bedragen niet", await denied(wl.readProgressStatement(id1)));
const op = (root, o) => ({ root, cumPctBp: opt(o.pct ?? null), cumQtyMilli: opt(o.qty ?? null), note: o.note ?? "", clear: !!o.clear });
const R = (t) => byTitle(q, t).root;
check("(3) % boven 100: geweigerd", /0 tot 100/.test(errOf(await prepareAs(wl, id1, [op(R("Proef container"), { pct: 10_001n })]))));
check("(3) een hoeveelheid bij een post met vaste prijs: geweigerd", /vraagt een % uitgevoerd/.test(errOf(await prepareAs(wl, id1, [op(R("Proef container"), { qty: 1_000n })]))));
check("(3) een onbekende post: geweigerd", /Onbekende post/.test(errOf(await prepareAs(wl, id1, [op(999_999n, { qty: 1n })]))));
check("(3) de werfleider stuurt geen totalen of indexwaarden mee", /Geen toegang/.test(errOf(await wl.saveProgressDraft(id1, q.brief.rev, { periodTo: [], note: [], setIndexes: true, sIndex: [1n], iIndex: [1n], lines: [], expect: [] }))) && /Geen toegang/.test(errOf(await wl.saveProgressDraft(id1, q.brief.rev, { periodTo: [], note: [], setIndexes: false, sIndex: [], iIndex: [], lines: [], expect: [{ periodCents: 0n, revisionCents: 0n, vatCents: 0n, totalCents: 0n, payableCents: 0n }] }))));
const pr = await prepareAs(wl, id1, [op(R("Proef container"), { pct: 5_000n }), op(R("Proef metselwerk"), { pct: 3_000n, note: "binnenmuur half" })]);
check("(3) werfleider bewaart container 50 % en metselwerk 30 %", isOk(pr), errOf(pr));
check("(3) een verouderde bewerkteller: geweigerd (geen stil overschrijven)", /intussen/.test(errOf(await wl.saveProgressDraft(id1, 0n, { periodTo: [], note: [], setIndexes: false, sIndex: [], iIndex: [], lines: [], expect: [] }))));
check("(3) 'voorbereid' melden: de calculator krijgt een melding", isOk(await wl.markProgressPrepared(id1)) && (await calc.myNotifications(true)).some((n) => n.kind === "vordering" && n.text.includes(W)));

// ── (4)(5) De calculator rekent: met de hand nagerekend ──
let v = ok(await calc.readProgressStatement(id1));
const line = (t) => byTitle(v, t);
check("(4) eenheidsprijzen = verkoopprijs van de offerte (aankoop / 0,8): 31,25 · 400 · 10.000 · 56,25 · 50,00", line("Proef afbraak").m.unitPriceCents === 3125n && line("Proef container").m.unitPriceCents === 40_000n && line("Proef metselwerk").m.unitPriceCents === 1_000_000n && line("Proef minwerk").m.unitPriceCents === 5625n && line("Proef regie").m.unitPriceCents === 5000n);
check("(4) afbraak: offerte 40 × 31,25 = 1.250,00; tot nu 42 × 31,25 = 1.312,50; boven de VH 62,50", line("Proef afbraak").m.offerCents === 125_000n && line("Proef afbraak").m.cumCents === 131_250n && line("Proef afbraak").m.overVhCents === 6_250n);
check("(4) container 50 % van 800,00 = 400,00; metselwerk 30 % van 10.000,00 = 3.000,00; regie 16 × 50 = 800,00; minwerk 0", line("Proef container").m.cumCents === 40_000n && line("Proef metselwerk").m.cumCents === 300_000n && line("Proef regie").m.cumCents === 80_000n && line("Proef minwerk").m.cumCents === 0n);
check("(4) contract: inhouding 5 %, 30 dagen, formule, model; nog geen indexwaarden → waarschuwing prijsherziening", v.header.retentionBp === 500n && v.header.paymentDays === 30n && v.header.formula.length > 0 && v.header.model.length === 1 && v.findings.some((f) => f.key === "prijsherziening"));
check("(4) zonder indexwaarden: geen herziening; deze periode 5.512,50", v.totals.periodCents === 551_250n && v.totals.revisionCents === 0n);
const tB = browserTotals(v);
check("(5) browser = server op hetzelfde ontwerp (periode, btw, totaal, inhouding, te betalen)", tB.periodCents === v.totals.periodCents && tB.vatCents === v.totals.vatCents && tB.totalCents === v.totals.totalCents && tB.retentionCents === v.totals.retentionCents && tB.payableCents === v.totals.payableCents);
// Indexwaarden: s 105, i 210 → factor 0,4·1,05 + 0,4·1,05 + 0,2 = 1,04 op 4.712,50 (zonder regie) = 188,50
const bad = await saveAs(calc, id1, new Map(), { sIndex: 105_000n, iIndex: 210_000n, note: "Proef staat 1", expect: { periodCents: 551_250n, revisionCents: 0n, vatCents: 0n, totalCents: 1n, payableCents: 1n } });
check("(5) een getypt (fout) totaal: geweigerd, niets bewaard", /ander totaal/.test(errOf(bad.r)) && ok(await calc.readProgressStatement(id1)).header.sIndex.length === 0, errOf(bad.r));
const good = await saveAs(calc, id1, new Map(), { sIndex: 105_000n, iIndex: 210_000n, note: "Proef staat 1" });
check("(5) met de totalen van de browser: bewaard", isOk(good.r), errOf(good.r));
v = ok(await calc.readProgressStatement(id1));
const T1 = v.totals;
check("(4) prijsherziening 188,50 (4.712,50 × 0,04, zonder regie); subtotaal 5.701,00", T1.revisionBaseCents === 471_250n && T1.revisionCents === 18_850n && T1.subtotalCents === 570_100n, `${T1.revisionBaseCents} ${T1.revisionCents} ${T1.subtotalCents}`);
check("(4) btw 21 % = 1.197,21; totaal 6.898,21; inhouding 5 % excl. btw = 285,05; te betalen 6.613,16", T1.vatCents === 119_721n && T1.totalCents === 689_821n && T1.retentionCents === 28_505n && T1.payableCents === 661_316n, `${T1.vatCents} ${T1.totalCents} ${T1.retentionCents} ${T1.payableCents}`);
const secT = (t, s) => t.sections.find((x) => s in x.section);
check("(3) secties: aanneming 4.712,50 (offerte 11.937,50), regie 800,00 (offerte 2.000,00); meer- en minderwerk 0", secT(T1, "contract").periodCents === 471_250n && secT(T1, "contract").offerCents === 1_193_750n && secT(T1, "regie").periodCents === 80_000n && secT(T1, "regie").offerCents === 200_000n && secT(T1, "extra").periodCents === 0n && secT(T1, "less").periodCents === 0n, flat(T1.sections));
check("(3) rest = offerte − totaal tot nu (13.937,50 − 5.512,50 = 8.425,00)", T1.offerCents === 1_393_750n && T1.restCents === 842_500n, `${T1.offerCents} ${T1.restCents}`);
check("(2) de werfleider ziet nog steeds geen bedrag (ook niet na het rekenen)", noMoney(await wl.progressQty(id1)));

// ── (6) Versturen ──
check("(6) de werfleider verstuurt niet", await denied(wl.sendProgress(id1, v.brief.rev, T1.totalCents, "proef")));
check("(6) waarschuwingen zonder reden: geweigerd", /Geef een reden/.test(errOf(await calc.sendProgress(id1, v.brief.rev, T1.totalCents, ""))));
check("(6) een ander totaal dan de server: geweigerd", /veranderd/.test(errOf(await calc.sendProgress(id1, v.brief.rev, T1.totalCents + 1n, "proef: draftproef 2.10"))));
const s1 = await calc.sendProgress(id1, v.brief.rev, T1.totalCents, "proef: draftproef 2.10");
check("(6) verstuurd met een reden: VS <werf>/1", isOk(s1) && s1.ok === `VS ${W}/1`, flat(s1));
v = ok(await calc.readProgressStatement(id1));
check("(6) vast: hash (64 hex), intact, zelfde totalen, vervaldag = verzending + 30", v.frozen && v.intact && /^[0-9a-f]{64}$/.test(v.hash) && v.totals.totalCents === T1.totalCents && v.doc[0].dueDay === v.doc[0].sendDay + 30n);
check("(6) een verzonden staat bewaren: geweigerd", /ligt vast/.test(errOf(await calc.saveProgressDraft(id1, v.brief.rev, { periodTo: [], note: [], setIndexes: false, sIndex: [], iIndex: [], lines: [], expect: [PM.expectOf(T1)] }))) && /ligt vast/.test(errOf(await prepareAs(wl, id1, []))));
check("(6) nog eens versturen of wegdoen: geweigerd", /al verstuurd/.test(errOf(await calc.sendProgress(id1, v.brief.rev, T1.totalCents, "x"))) && /Enkel een ontwerp/.test(errOf(await calc.cancelProgressDraft(id1, "proef weg"))));
ok(await calc.saveProgressRevision(wid, { aBp: 5000n, bBp: 3000n, cBp: 2000n, sBase: 100_000n, iBase: 200_000n, sLabel: "Proef", iLabel: "Proef", note: "gewijzigd" }));
const v1b = ok(await calc.readProgressStatement(id1));
check("(6) het model achteraf wijzigen verandert de verzonden staat niet (zelfde hash en totalen)", v1b.hash === v.hash && v1b.totals.revisionCents === 18_850n && v1b.intact);
ok(await calc.saveProgressRevision(wid, { aBp: 4000n, bBp: 4000n, cBp: 2000n, sBase: 100_000n, iBase: 200_000n, sLabel: "Proef loonindex", iLabel: "Proef materiaalindex", note: "terug" }));
check("(6) het model: a + b + c ≠ 100 % of basis 0 geweigerd", /100 %/.test(errOf(await calc.saveProgressRevision(wid, { aBp: 4000n, bBp: 4000n, cBp: 1000n, sBase: 1n, iBase: 1n, sLabel: "", iLabel: "", note: "" }))) && /groter dan 0/.test(errOf(await calc.saveProgressRevision(wid, { aBp: 4000n, bBp: 4000n, cBp: 2000n, sBase: 0n, iBase: 1n, sLabel: "", iLabel: "", note: "" }))));

// ── (7) De klant ──
const klantId = (await klant.me()).person[0].id;
check("(7) zonder lidmaatschap: de klant ziet de staat niet", !(await klant.listMyProgress()).some((x) => x.id === id1) && /Onbekende staat/.test(errOf(await klant.readMyProgress(id1))));
ok(await admin.addMembership(wid, [klantId], [], { klant: null }, []));
const my = await klant.listMyProgress();
check("(7) de klant (lid van de werf) ziet zijn verzonden staat", my.some((x) => x.id === id1 && x.code === `VS ${W}/1`));
const mr = ok(await klant.readMyProgress(id1));
check("(7) met verkoopprijzen en totalen, zonder aankoopprijs of marge", mr.totals.totalCents === T1.totalCents && mr.lines.length === 5 && ![...keysOf(mr)].some((k) => /cost|margin|reason/i.test(k)) && mr.canAnswer);
check("(7) architect, OA en VC: niets (klantfuncties geweigerd)", (await Promise.all([arch.listMyProgress(), oa2.listMyProgress(), vc.listMyProgress(), oa2.readMyProgress(id1)].map(denied))).every(Boolean));
check("(7) akkoord met een andere hash: geweigerd", /niet de staat/.test(errOf(await klant.answerMyProgress(id1, "0".repeat(64), true, ""))));
check("(7) opmerking zonder uitleg: geweigerd", /Schrijf wat/.test(errOf(await klant.answerMyProgress(id1, mr.hash, false, ""))));
check("(7) akkoord van de klant op de exacte staat; tweemaal: geweigerd", isOk(await klant.answerMyProgress(id1, mr.hash, true, "")) && /antwoordde al/.test(errOf(await klant.answerMyProgress(id1, mr.hash, true, ""))));
check("(7) de calculator ziet het akkoord en kreeg een melding", ok(await calc.readProgressStatement(id1)).answer[0]?.ok === true && (await calc.myNotifications(true)).some((n) => /Akkoord van de klant/.test(n.text) && n.text.includes(`VS ${W}/1`)));
check("(7) klaar voor factuur", isOk(await calc.setProgressReady(id1)) && ok(await calc.readProgressStatement(id1)).brief.billing === "klaar" && /al klaar/.test(errOf(await calc.setProgressReady(id1))));
const inv = ok(await calc.progressInvoiceData(id1));
check("(7) factuurgegevens (UBL): 380, nummer, vervaldag, btw S 21 %, regels = deze periode, toeslag = prijsherziening, analytische code", inv.documentType === "380" && inv.number === `VS ${W}/1` && inv.taxCategory === "S" && inv.vatBp === 2100n && inv.lineTotalCents === T1.periodCents && inv.chargeCents === 18_850n && inv.taxableCents === T1.subtotalCents && inv.totalCents === T1.totalCents && inv.payableCents === T1.payableCents && inv.lines.length === 4 && inv.lines.some((l) => l.unitCode === "MTK") && inv.lines.some((l) => l.unitCode === "HUR") && inv.projectRef.length > 0, flat(inv).slice(0, 300));

// ── (3) Cumulatief: staat 2 ──
const n2 = await calc.newProgress(wid);
// De periode begint de dag na staat 1 (nooit in de toekomst: staat 1 liep tot vandaag, dus begint staat 2 vandaag).
const from2 = ok(await calc.readProgressStatement(n2.ok)).brief.periodFrom;
check("(3) staat 2: nieuw ontwerp (de periode begint na staat 1, nooit in de toekomst)", isOk(n2) && from2 === (v.brief.periodTo + 1n > cDay ? cDay : v.brief.periodTo + 1n), `${from2} ${v.brief.periodTo}`);
const id2 = n2.ok;
let v2 = ok(await calc.readProgressStatement(id2));
const E2 = new Map([[String(byTitle(v2, "Proef container").q.root), { cumPctBp: 10_000n }], [String(byTitle(v2, "Proef metselwerk").q.root), { cumPctBp: 6_000n }]]);
const s2save = await saveAs(calc, id2, E2, { sIndex: 105_000n, iIndex: 210_000n });
check("(3) staat 2 bewaard: container 100 %, metselwerk 60 %", isOk(s2save.r), errOf(s2save.r));
v2 = ok(await calc.readProgressStatement(id2));
const l2 = (t) => byTitle(v2, t);
check("(3) vorige staten = het totaal tot nu van staat 1 per post", l2("Proef afbraak").m.prevCents === 131_250n && l2("Proef container").m.prevCents === 40_000n && l2("Proef metselwerk").m.prevCents === 300_000n && l2("Proef regie").m.prevCents === 80_000n && l2("Proef metselwerk").q.prevPctBp === 3_000n);
check("(3) deze periode: container 400,00 + metselwerk 3.000,00; afbraak en regie 0 (niets bij)", v2.totals.periodCents === 340_000n && l2("Proef afbraak").m.periodCents === 0n && l2("Proef regie").m.periodCents === 0n && l2("Proef container").m.periodCents === 40_000n);
check("(3) totaal tot nu = vorige + deze periode (5.512,50 + 3.400,00 = 8.912,50); rest 5.025,00", v2.totals.prevCents === 551_250n && v2.totals.cumCents === 891_250n && v2.totals.restCents === 502_500n);
check("(4) herziening enkel op deze periode: 3.400,00 × 0,04 = 136,00", v2.totals.revisionCents === 13_600n, String(v2.totals.revisionCents));
const s2 = await calc.sendProgress(id2, v2.brief.rev, v2.totals.totalCents, "proef: draftproef 2.10");
check("(6) staat 2 verstuurd: VS <werf>/2; de klant (nu lid) krijgt een melding zonder bedrag", isOk(s2) && s2.ok === `VS ${W}/2` && (await klant.myNotifications(true)).some((n) => n.kind === "vordering" && n.text.includes(`VS ${W}/2`) && !/€|\d+,\d\d/.test(n.text)), flat(s2));
const T2 = ok(await calc.readProgressStatement(id2)).totals;

// ── (6) Creditnota ──
check("(6) staat 1 crediteren kan niet (staat 2 is later)", /Enkel de laatste staat/.test(errOf(await calc.creditProgress(id1, "proef: verkeerd"))));
check("(6) de werfleider crediteert niet; zonder reden: geweigerd", (await denied(wl.creditProgress(id2, "proef"))) && /Geef een reden/.test(errOf(await calc.creditProgress(id2, ""))));
const cn = await calc.creditProgress(id2, "proef: metselwerk te hoog");
check("(6) creditnota-ontwerp voor staat 2", isOk(cn), errOf(cn));
const cv = ok(await calc.readProgressStatement(cn.ok));
check("(6) de creditnota draait staat 2 volledig terug (alle bedragen tegengesteld)", "credit" in cv.brief.kind && cv.totals.periodCents === -T2.periodCents && cv.totals.totalCents === -T2.totalCents && cv.totals.retentionCents === -T2.retentionCents && cv.totals.revisionCents === -T2.revisionCents, `${cv.totals.totalCents} vs ${T2.totalCents}`);
check("(6) een creditnota bewerken: geweigerd", /creditnota/.test(errOf(await calc.saveProgressDraft(cn.ok, cv.brief.rev, { periodTo: [], note: [], setIndexes: false, sIndex: [], iIndex: [], lines: [], expect: [PM.expectOf({ periodCents: 0n, revisionCents: 0n, vatCents: 0n, totalCents: 0n, payableCents: 0n })] }))));
const cs = await calc.sendProgress(cn.ok, cv.brief.rev, cv.totals.totalCents, "");
check("(6) creditnota verstuurd: CN <werf>/1; staat 2 gemarkeerd als gecrediteerd", isOk(cs) && cs.ok === `CN ${W}/1` && ok(await calc.readProgressStatement(id2)).brief.creditedByCode === `CN ${W}/1`, flat(cs));
check("(6) een gecrediteerde staat kan niet nog eens gecrediteerd worden en wordt niet klaar voor factuur", /al gecrediteerd/.test(errOf(await calc.creditProgress(id2, "proef: nog eens"))) && /gecrediteerd/.test(errOf(await calc.setProgressReady(id2))));
check("(7) de klant ziet de creditnota; geen akkoord nodig", (await klant.listMyProgress()).some((x) => x.code === `CN ${W}/1`) && /vraagt geen akkoord/.test(errOf(await klant.answerMyProgress(cn.ok, cs.ok ? ok(await klant.readMyProgress(cn.ok)).hash : "", true, ""))));
const n3 = await calc.newProgress(wid);
const v3 = ok(await calc.readProgressStatement(n3.ok));
check("(6) na de creditnota telt staat 3 verder op staat 1 (vorige = 5.512,50)", isOk(n3) && v3.totals.prevCents === 551_250n && byTitle(v3, "Proef metselwerk").q.prevPctBp === 3_000n, `${v3.totals.prevCents}`);

// ── (3) Meerwerk ──
const nv = ok(await calc.newQuoteVersion(S.q1.quoteId, []));
{
  const { fromRead, saveAll, M } = await import("./offerte-lib.mjs");
  const m = fromRead(ok(await calc.readQuoteVersion(nv)));
  const ch = M.activeChapters(m)[0];
  M.addLine(m, ch.key, { title: "Proef meerwerk stopcontacten (2.10)", qtyMilli: 3_000n, unit: "st", form: "vh", price: { cost: 6000n, rule: null, reason: "", orgId: null, source: "eigen", libCostId: null } });
  const r = await saveAll(calc, m);
  if (r && "err" in r) throw new Error(errOf(r));
  const rr = ok(await calc.readQuoteVersion(nv));
  ok(await calc.sendQuoteVersion(nv, rr.version.rev, rr.totals.totalCents, "proef: meerwerk 2.10"));
  ok(await calc.decideQuoteVersion(nv, true, "proef: akkoord meerwerk"));
}
const v3b = ok(await calc.readProgressStatement(n3.ok));
const mw = byTitle(v3b, "Proef meerwerk");
check("(3) meerwerk (een post van de nieuwe aanvaarde versie) staat apart in de sectie meerwerk; de rest blijft aanneming", !!mw && "extra" in mw.q.section && mw.m.offerCents === 22_500n && v3b.lines.filter((l) => "contract" in l.q.section).length === 4, flat(v3b.lines.map((l) => [l.q.title, l.q.section])));
const E3 = new Map([[String(mw.q.root), { cumQtyMilli: 2_000n, note: "proef" }]]);
const s3s = await saveAs(calc, n3.ok, E3, { sIndex: 105_000n, iIndex: 210_000n });
const v3c = ok(await calc.readProgressStatement(n3.ok));
check("(3) meerwerk 2 van 3 st = 150,00 in de sectie meerwerk; rest van het meerwerk 75,00", isOk(s3s.r) && secT(v3c.totals, "extra").periodCents === 15_000n && byTitle(v3c, "Proef meerwerk").m.restCents === 7_500n, errOf(s3s.r));
// Een ontwerp wegdoen
check("(6) een ontwerp wegdoen vraagt een reden; daarna staat het niet meer in de lijst", /Geef een reden/.test(errOf(await calc.cancelProgressDraft(n3.ok, ""))) && isOk(await calc.cancelProgressDraft(n3.ok, "proef: weg")) && !(await calc.listProgress(wid)).some((x) => x.id === n3.ok));

// ── (8) Instellingen, auditlog, export, .did ──
check("(8) instellingen: de werfleider en calculator wijzigen ze niet; ongeldige waarde geweigerd", (await denied(wl.saveProgressSettings({ client: "uit", retentionOnIncl: false }))) && (await denied(calc.saveProgressSettings({ client: "uit", retentionOnIncl: false }))) && /uit, mogelijk of vereist/.test(errOf(await admin.saveProgressSettings({ client: "soms", retentionOnIncl: false }))));
ok(await admin.saveProgressSettings({ client: "vereist", retentionOnIncl: true }));
const n4 = ok(await calc.newProgress(wid));
const E4 = new Map([[String(mw.q.root), { cumQtyMilli: 1_000n }]]);
const s4 = await saveAs(calc, n4, E4, { sIndex: 105_000n, iIndex: 210_000n });
const v4 = ok(await calc.readProgressStatement(n4));
check("(4) inhouding op het bedrag incl. btw (instelling): 5 % van het totaal", isOk(s4.r) && v4.totals.retentionCents === (v4.totals.totalCents * 500n + 5_000n) / 10_000n, `${v4.totals.retentionCents} ${v4.totals.totalCents}`);
const s4s = ok(await calc.sendProgress(n4, v4.brief.rev, v4.totals.totalCents, "proef: draftproef 2.10"));
check("(7) klantakkoord vereist: klaar voor factuur pas na het akkoord", /akkoord van de klant is vereist/.test(errOf(await calc.setProgressReady(n4))), s4s);
const r4 = ok(await klant.readMyProgress(n4));
check("(7) een opmerking van de klant (niet akkoord) houdt klaar voor factuur tegen", isOk(await klant.answerMyProgress(n4, r4.hash, false, "proef: klopt niet")) && /opmerking/.test(errOf(await calc.setProgressReady(n4))));
ok(await admin.saveProgressSettings({ client: "uit", retentionOnIncl: false }));
check("(7) klantakkoord uit: de klant kan niet antwoorden", !ok(await klant.readMyProgress(id1)).canAnswer);
ok(await admin.saveProgressSettings(settings0));

const log = await admin.auditLog(0n, 400n);
const mine = log.filter((e) => e.workId.length && e.workId[0] === wid);
check("(8) auditlog: bekeek:vorderingsstaat, verstuurd, waarschuwingen doorgezet, creditnota, akkoord, klaar voor factuur", ["bekeek:vorderingsstaat", "vordering-verstuurd", "vordering-waarschuwingen-doorgezet", "vordering-creditnota-ontwerp", "vordering-akkoord-klant", "vordering-klaar-voor-factuur", "bekeek:vordering-factuurgegevens", "bekeek:vordering-klant", "prijsherziening-model"].every((a) => mine.some((e) => e.action === a)), [...new Set(mine.map((e) => e.action))].join(","));
const amounts = ["689821", "6898,21", "6.898,21", "571000", "570100", "18850", "551250", "131250", "661316"];
check("(8) de auditlog noemt geen bedragen", !mine.some((e) => amounts.some((a) => e.detail.includes(a))), mine.filter((e) => amounts.some((a) => e.detail.includes(a))).map((e) => e.detail).join(" | "));
const ex = await admin.exportChunk("progressStatements", 0n, 500n);
const exF = await admin.exportChunk("progressFrozen", 0n, 500n);
check("(8) export: de staten (intern) en de vastgelegde bedragen (vertrouwelijk) voor de beheerder; de calculator exporteert niet", isOk(ex) && ex.ok.progressStatements.some((x) => x.id === id1) && isOk(exF) && exF.ok.progressFrozen.some(([k]) => k === id1) && (await denied(calc.exportChunk("progressFrozen", 0n, 10n))));
const intern = ok(await admin.exportChunk("progressStatements", 0n, 500n)).progressStatements.find((x) => x.id === id1);
check("(8) het interne record van een staat draagt geen bedrag", noMoney(intern));
let didFile = null;
for (const p of ["src/backend/dist/backend.did"]) { try { didFile = readFileSync(join(import.meta.dirname, "..", p), "utf8"); } catch { /* geen bouw */ } }
if (didFile) {
  // De velden van een record in de .did (met geneste records): tellen van accolades.
  const rec = (name) => {
    const i = didFile.search(new RegExp(`type ${name} =\\s*record \\{`));
    if (i < 0) return "";
    let k = didFile.indexOf("{", i);
    let depth = 0;
    const start = k;
    for (; k < didFile.length; k++) { if (didFile[k] === "{") depth++; else if (didFile[k] === "}" && --depth === 0) break; }
    return didFile.slice(start + 1, k);
  };
  const hit = ["ProgressQtyLine", "ProgressQtyView", "ProgressHints", "ProgressBrief", "ProgressWorkBrief", "ProgressInput", "ProgressStatement", "MyProgressBrief"].filter((t) => MONEY.test(rec(t)) || rec(t) === "");
  check("(1) .did: de typen voor de werfleider en de interne records hebben geen bedragveld", hit.length === 0, hit.join(","));
}

// ── Opruimen ──
ok(await admin.setWorkStatus(wid, { cancelled: null }));
console.log(`\n${pass} ✓ ${fail} ✗`);
process.exit(fail ? 1 : 0);
