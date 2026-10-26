// Opmeting ter plaatse (stap 2.9, bouwplan §9 rij 2.9 en §5.1) op een canister die al in gebruik is (een draft of het eigen net).
// Zet enkel VERZONNEN testgegevens: per run een eigen proefwerf "P-OM-…", proefposten "Proef … (2.9)" in de bibliotheek en een
// aanvaarde proefofferte "OM-…". Op het einde staat de proefwerf op "geannuleerd" (en staan de schakelaars van de opmeting terug
// zoals ze waren). Gebruikt de testidentiteiten van tests/rollen.mjs (of tools/draft-opbouw.mjs). Bewijst:
//   (1) wie de posten ziet: werfleider/calculator/admin alles, de OA enkel de posten van zijn firma, architect en klant niets
//       tot de beheerder het toelaat; geen enkele functie voor anoniem, een vreemde login of de veiligheidscoördinator;
//   (2) meten: deelopmetingen tellen op, verschil in hoeveelheid en %, markering boven de drempel (meer/minder/nog open),
//       foto's en schets (nooit bij de losse bestanden van de werf), validatie, een tweede toestel in DEZELFDE opmeting,
//       dezelfde opId nog eens = geen dubbele regel;
//   (3) de OA stelt voor (instelbaar), de werfleider bevestigt of wijst af; zonder beslissing geen afsluiten;
//   (4) afsluiten legt de stand vast; een afgesloten opmeting verandert nooit meer (weghalen geweigerd, nieuwe regel komt in de
//       volgende opmeting); corrigeren kan alleen met een nieuwe regel en een reden; de stand van de afgesloten opmeting blijft;
//   (5) architect en klant: enkel de afgesloten stand, enkel met de schakelaar en het leesrecht;
//   (6) NERGENS een prijs (typen in de .did, waarden in de antwoorden); instellingen; export; auditlog.
//   node tests/opmeting-draft.mjs <canister-id>
import { readFileSync } from "node:fs";
import { backend, freshBackend } from "../tools/lib.mjs";
import { proefWerf } from "./opmeting-lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/opmeting-draft.mjs <canister-id>");
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const isOk = (r) => r && typeof r === "object" && "ok" in r;
const ok = (r) => { if (r && "err" in r) throw new Error(r.err); return r.ok; };
const errOf = (r) => (r && "err" in r ? r.err : "");
const denied = async (p) => { try { const r = await p; return !!(r && "err" in r && /^Geen toegang/.test(r.err)); } catch (e) { return /Geen toegang|trap|Reject|reject/i.test(String(e)); } };
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const flat = (x) => JSON.stringify(x, big);
const uid = () => crypto.randomUUID();
const wd = (d) => (Number(d) + 3) % 7;

const [admin, wl, calc, arch, oa2, klant, vc] = await Promise.all(["proef-admin", "proef-werfleider", "proef-calculator", "proef-architect", "proef-oa2", "proef-klant", "proef-vc"].map((n) => backend(n, cid)));
const anon = await backend(null, cid);
const vreemd = await freshBackend(cid);
const me = await admin.me();
check("versie 2.9 of later op de canister", /^2\.(9|1\d)|^(2b|[3-9])\./.test(me.version) || /dev/.test(me.version), me.version);
// De dag van de canister (de klokproeven van tests/rollen.mjs verzetten de klok van het eigen net): de jongste auditregel.
const cDay = BigInt(Math.floor(Number((await admin.auditLog(0n, 1n))[0].at / 1_000_000n) / 86_400_000));
const DAY = cDay;
const settings0 = await admin.measureSettings();
// Een bekende beginstand (een eerdere, afgebroken run kan de schakelaars aan hebben laten staan); op het einde terug zoals ze waren.
ok(await admin.saveMeasureSettings({ thresholdBp: 1000n, oaPropose: false, externalRead: false }));

// ── Proefposten (verzonnen; idempotent via de importsleutel) en een proefofferte (nog niet aanvaard) ──
const { familie, dak, elek, wlId, iAfbraak, iDak, iElek, W, wid, NR, v1, rd, L, acceptNow } = await proefWerf({ admin, calc, wl }, { accept: false });
check("proefgegevens: Familie Proef, Proef Dak NV, Proef Elektro BV en de proefwerfleider bestaan", !!familie && !!dak && !!elek && !!wlId);
check("proefposten 2.9 in de bibliotheek (standaard-OA)", !!iAfbraak && !!iDak && !!iElek);

// ── (1) Voor de offerte aanvaard is: geen posten ──
const sumVoor = await wl.measureSummary(wid);
check("(1) zonder aanvaarde offerte: geen posten, nota 'geen getekende offerte'", sumVoor.posts.length === 0 && sumVoor.note === "geen getekende offerte");
await acceptNow();

// ── (1) Wie ziet wat ──
const sum0 = await wl.measureSummary(wid);
const titles0 = sum0.posts.map((p) => p.title).sort();
check("(1) werfleider: 7 posten van de getekende offerte (tekstregel en niet-aanvaarde optie niet)", sum0.posts.length === 7 && !titles0.some((t) => /tekstregel|optie/.test(t)) && sum0.scope === "full" && sum0.canWrite && sum0.canReview && !sum0.canPropose, flat(titles0));
check("(1) de post toont VH, eenheid, hoofdstuk, offertenummer; niets gemeten", sum0.posts.every((p) => p.measuredMilli === 0n && p.entryCount === 0n && "none" in p.flag) && sum0.posts.find((p) => p.title === iAfbraak.title).vhMilli === 40_000n && sum0.posts.find((p) => p.title === iAfbraak.title).chapterTitle === "Afbraak" && sum0.quotes[0] === `${NR} v1`);
check("(1) drempel standaard 10 % (1000 bp); OA stelt niet voor, externen lezen niet mee", sum0.thresholdBp === settings0.thresholdBp);
const sumCalc = await calc.measureSummary(wid);
const sumAdmin = await admin.measureSummary(wid);
check("(1) calculator en admin: alle 7 posten, mogen meten en bevestigen", sumCalc.posts.length === 7 && sumCalc.canWrite && sumAdmin.posts.length === 7 && sumAdmin.canReview);
for (const [n, x] of [["onderaannemer zonder lidmaatschap", oa2], ["architect", arch], ["klant", klant], ["veiligheidscoördinator", vc], ["anoniem", anon], ["onbekende login", vreemd]]) {
  const rs = await Promise.all([x.measureSummary(wid), x.measurePost(wid, 1n), x.getMeasureSurvey(999_999_999n)].map(denied));
  check(`(1) ${n}: samenvatting, post en opmeting geweigerd`, rs.every(Boolean), rs.map((r) => (r ? "·" : "✗")).join(""));
}
check("(1) anoniem en een vreemde login: niets (ook geen lijst); veiligheidscoördinator, klant en architect: geen schrijfpoort en geen instellingen, en een lege lijst", (await Promise.all([anon, vreemd].flatMap((x) => [x.measureSync([]), x.measureSettings(), x.listMeasureWorks()].map(denied)))).every(Boolean) && (await Promise.all([vc, klant, arch].flatMap((x) => [x.measureSync([]), x.measureSettings()].map(denied)))).every(Boolean) && (await Promise.all([vc, klant, arch].map((x) => x.listMeasureWorks()))).every((l) => l.length === 0));
const mOa = ok(await admin.addMembership(wid, [(await oa2.me()).person[0].id], [], { onderaannemer: null }, []));
const sumOa = await oa2.measureSummary(wid);
check("(1) OA van Proef Dak NV (lid van de werf): enkel de posten van zijn firma (dakgoot), scope firma, mag nog niet voorstellen", sumOa.scope === "firm" && sumOa.posts.length === 1 && sumOa.posts[0].title === iDak.title && !sumOa.canWrite && !sumOa.canPropose && !sumOa.canReview && sumOa.orgName === "Proef Dak NV", flat(sumOa.posts.map((p) => p.title)));
check("(1) OA: de posten van andere firma's staan nergens in zijn antwoord", !/afbraak|stopcontacten|container|gevel|verlichting/i.test(flat(sumOa)));
check("(1) OA: de post van een andere firma opvragen: geweigerd", await denied(oa2.measurePost(wid, sum0.posts.find((p) => p.title === iElek.title).root)));
check("(1) lijst 'Opmeting': werfleider en OA zien de werf; de OA met 1 post", (await wl.listMeasureWorks()).some((x) => x.workId === wid && x.posts === 7n) && (await oa2.listMeasureWorks()).some((x) => x.workId === wid && x.posts === 1n && x.scope === "firm"));

// ── (2) Meten ──
const P = (t) => sum0.posts.find((p) => p.title === t).root;
const sync = async (who, ...ops) => who.measureSync(ops);
const done = (r) => r && "done" in r.outcome;
const outErr = (r) => (r && "err" in r.outcome ? r.outcome.err : "");
const f1 = (n, hash = "c") => ({ role: { photo: null }, file: { blob: new TextEncoder().encode("!caf!sha256:" + hash.repeat(64)), name: `proef-${n}.jpg`, mime: "image/jpeg", size: 300_000n }, thumb: [{ blob: new TextEncoder().encode("!caf!sha256:" + "d".repeat(64)), name: `proef-${n}-t.jpg`, mime: "image/jpeg", size: 20_000n }], caption: `foto ${n}` });
const sk = { role: { sketch: null }, file: { blob: new TextEncoder().encode("!caf!sha256:" + "e".repeat(64)), name: "schets.png", mime: "image/png", size: 40_000n }, thumb: [], caption: "schets van de gootlengte" };
const ent = (lineId, qty, o = {}) => ({ entry: { lineId, qtyMilli: qty, day: DAY, complete: false, note: "", files: [], corrects: [], reason: "", ...o } });
const K1 = uid();
const [opened] = await sync(wl, { opId: uid(), clientKey: K1, op: { open: { workId: wid } } });
check("(2) opmeting openen: nieuw", done(opened) && opened.outcome.done.note === "nieuw", flat(opened));
const S1 = opened.outcome.done.surveyId;
const opA1 = uid();
const [e1] = await sync(wl, { opId: opA1, clientKey: K1, op: ent(L.afbraak, 15_000n, { note: "Noordmuur" }) });
check("(2) eerste deelopmeting afbraak (15 van 40 m²)", done(e1) && e1.outcome.done.entityId.length === 1 && e1.outcome.done.surveyId === S1, flat(e1));
const [e1b] = await sync(wl, { opId: opA1, clientKey: K1, op: ent(L.afbraak, 15_000n, { note: "Noordmuur" }) });
check("(2) dezelfde opId nog eens: herhaling, zelfde regel, geen dubbel", done(e1b) && e1b.repeated && e1b.outcome.done.entityId[0] === e1.outcome.done.entityId[0]);
const [e2] = await sync(wl, { opId: uid(), clientKey: K1, op: ent(L.afbraak, 10_000n, { note: "Oostmuur" }) });
let pa = (await wl.measureSummary(wid)).posts.find((p) => p.root === P(iAfbraak.title));
check("(2) deelopmetingen tellen op: 25 m² van 40, verschil −15 (−37,5 %), nog niet volledig → 'open', geen minderwerk", pa.measuredMilli === 25_000n && pa.diffMilli === -15_000n && pa.diffBp[0] === -3750n && "open" in pa.flag && pa.entryCount === 2n && !pa.complete, flat(pa));
const [e3] = await sync(wl, { opId: uid(), clientKey: K1, op: ent(L.afbraak, 16_000n, { complete: true, note: "Rest + zolder" }) });
pa = (await wl.measureSummary(wid)).posts.find((p) => p.root === P(iAfbraak.title));
check("(2) volledig opgemeten: 41 m², +1 (+2,5 %): onder de drempel, geen markering", pa.measuredMilli === 41_000n && pa.diffMilli === 1_000n && pa.diffBp[0] === 250n && "none" in pa.flag && pa.complete);
const [eg] = await sync(wl, { opId: uid(), clientKey: K1, op: ent(L.goot, 14_000n, { complete: true, files: [f1(1), f1(2, "a"), sk] }) });
let pg = (await wl.measureSummary(wid)).posts.find((p) => p.root === P(iDak.title));
check("(2) dakgoot 14 lm van 12: +2 (+16,66 %) boven de drempel = meerwerk", done(eg) && pg.diffMilli === 2_000n && pg.diffBp[0] === 1666n && "more" in pg.flag, flat(pg.flag));
const [es] = await sync(wl, { opId: uid(), clientKey: K1, op: ent(L.stop, 20_000n, { complete: true }) });
const ps = (await wl.measureSummary(wid)).posts.find((p) => p.root === P(iElek.title));
check("(2) stopcontacten 20 van 24, volledig: −16,66 % = minderwerk", done(es) && ps.diffMilli === -4_000n && "less" in ps.flag);
const [epm] = await sync(wl, { opId: uid(), clientKey: K1, op: ent(L.pm, 3_000n) });
const ppm = (await wl.measureSummary(wid)).posts.find((p) => p.title === "Proef p.m. verlichting");
check("(2) post pro memorie (VH 0): % onbepaald, toch meerwerk", done(epm) && ppm.vhMilli === 0n && ppm.diffBp.length === 0 && "more" in ppm.flag);
const [emin] = await sync(wl, { opId: uid(), clientKey: K1, op: ent(L.minwerk, -2_000n, { complete: true }) });
check("(2) minwerk (VH −2): −2 gemeten = geen verschil", done(emin) && (await wl.measureSummary(wid)).posts.find((p) => p.title.startsWith("Proef minwerk")).diffMilli === 0n);
const tot = (await wl.measureSummary(wid)).totals;
check("(2) totalen: 5 van 7 posten gemeten; meerwerk: dakgoot + pro memorie; minderwerk: stopcontacten", tot.measuredPosts === 5n && tot.moreCount === 2n && tot.lessCount === 1n, flat(tot));

// Validatie
const bad = async (n, op, re) => { const [r] = await sync(wl, { opId: uid(), clientKey: K1, op }); check(`(2) ${n}`, !done(r) && re.test(outErr(r)), outErr(r)); };
await bad("onbekende post geweigerd", ent(999_999_999n, 1_000n), /Onbekende post/);
await bad("een post van een andere werf geweigerd (lijn van een andere offerte)", ent(1n, 1_000n), /niet bij deze werf|Onbekende|niet \(meer\)/);
await bad("een optie die niet aanvaard is: geen post", ent(L.optie, 1_000n), /niet \(meer\)/);
await bad("datum te oud (100 dagen) geweigerd", ent(L.container, 1_000n, { day: DAY - 100n }), /datum/i);
await bad("datum in de toekomst (+5) geweigerd", ent(L.container, 1_000n, { day: DAY + 5n }), /datum/i);
await bad("absurde hoeveelheid geweigerd", ent(L.container, 10n ** 14n), /groot/);
await bad("7 foto's geweigerd", ent(L.container, 1_000n, { files: [1, 2, 3, 4, 5, 6, 7].map((n) => f1(n)) }), /foto's/);
await bad("een PDF als foto geweigerd", ent(L.container, 1_000n, { files: [{ ...f1(1), file: { ...f1(1).file, mime: "application/pdf" } }] }), /foto's/i);
await bad("een correctie zonder reden geweigerd", ent(L.afbraak, 41_000n, { corrects: [e3.outcome.done.entityId[0]] }), /reden/);
await bad("een notitie van 1.001 tekens geweigerd", ent(L.container, 1_000n, { note: "x".repeat(1001) }), /hoogstens/);
const [bs] = await sync(wl, { opId: uid(), clientKey: "kort", op: { open: { workId: wid } } });
check("(2) ongeldige clientKey geweigerd; onbekende sleutel: 'eerst openen'", !done(bs) && /sleutel/.test(outErr(bs)) && /eerst openen/.test(outErr((await sync(wl, { opId: uid(), clientKey: uid(), op: ent(L.container, 1_000n) }))[0])));
check("(2) de opId van iemand anders: geweigerd", /iemand anders/.test(outErr((await sync(calc, { opId: opA1, clientKey: uid(), op: { open: { workId: wid } } }))[0])));

// Foto's en schets
const pd = await wl.measurePost(wid, P(iDak.title));
const eGoot = pd.entries[0];
check("(2) regel met 2 foto's (met miniatuur) en een schets: bewaard, met bijschrift", eGoot.files.length === 3 && eGoot.files.filter((f) => "photo" in f.role).length === 2 && eGoot.files.some((f) => "sketch" in f.role && f.caption.includes("gootlengte")) && eGoot.files[0].thumb.length === 1 && eGoot.files[0].file.blob.length === 1, flat(eGoot.files.map((f) => [f.role, f.caption])));
const w1 = await wl.listFiles([wid]);
check("(2) de foto's en de schets staan NIET bij de losse bestanden van de werf (enkel via de opmeting)", w1.length === 0 || !w1.some((f) => /proef-1|schets/.test(f.name)), flat(w1.map((f) => f.name)));
check("(2) en zijn niet los te archiveren", /hoort bij een opmeting/.test(errOf(await wl.archiveFile(eGoot.files[0].file.id))) || /hoort bij een opmeting/.test(errOf(await admin.archiveFile(eGoot.files[0].file.id))));
check("(2) de regel toont wie mat, de datum en het verschil per regel", eGoot.byName.length > 0 && eGoot.day === DAY && eGoot.contributionMilli === 14_000n && eGoot.status === "geldig");

// Tweede toestel: de admin opent met een eigen sleutel → DEZELFDE open opmeting
const K2 = uid();
const [o2] = await sync(admin, { opId: uid(), clientKey: K2, op: { open: { workId: wid } } });
check("(2) tweede toestel (admin) op dezelfde werf: samengevoegd in dezelfde opmeting", done(o2) && o2.outcome.done.note === "samengevoegd" && o2.outcome.done.surveyId === S1);
const [e4] = await sync(admin, { opId: uid(), clientKey: K2, op: ent(L.container, 2_000n, { complete: true, note: "2 containers geleverd" }) });
check("(2) regel van het tweede toestel komt in dezelfde opmeting; nog altijd één open opmeting", done(e4) && e4.outcome.done.surveyId === S1 && (await wl.measureSummary(wid)).surveys.length === 1);
check("(2) calculator mag ook meten (op een werf die hij ziet)", done((await sync(calc, { opId: uid(), clientKey: uid(), op: { open: { workId: wid } } }))[0]));
check("(2) een pakje van meerdere opdrachten met dezelfde opId telt één keer", await (async () => { const id = uid(); const rs = await sync(wl, { opId: id, clientKey: K1, op: ent(L.container, 1_000n, { note: "pakje" }) }, { opId: id, clientKey: K1, op: ent(L.container, 1_000n, { note: "pakje" }) }); const e = (await wl.measurePost(wid, P("Proef container 10 m³ puin"))).entries.filter((x) => x.note === "pakje"); const rm = await sync(wl, { opId: uid(), clientKey: K1, op: { remove: { entryId: e[0].id } } }); return done(rs[0]) && rs[1].repeated && e.length === 1 && done(rm[0]); })());

// ── (3) De OA stelt voor ──
check("(3) OA: voorstellen is uit: de schrijfpoort is dicht", await denied(sync(oa2, { opId: uid(), clientKey: uid(), op: { open: { workId: wid } } })));
check("(3) schakelaar 'OA stelt voor' enkel door de beheerder", (await denied(wl.saveMeasureSettings({ thresholdBp: 1000n, oaPropose: true, externalRead: false }))) && isOk(await admin.saveMeasureSettings({ thresholdBp: 1000n, oaPropose: true, externalRead: false })));
const KO = uid();
const [oo] = await sync(oa2, { opId: uid(), clientKey: KO, op: { open: { workId: wid } } });
check("(3) OA opent: komt in dezelfde open opmeting", done(oo) && oo.outcome.done.surveyId === S1 && oo.outcome.done.note === "samengevoegd");
const [op1] = await sync(oa2, { opId: uid(), clientKey: KO, op: ent(L.goot, 13_500n, { note: "nagemeten door de OA", complete: true }) });
check("(3) OA stelt een opmeting voor op zijn eigen post: 'voorstel'", done(op1) && op1.outcome.done.note === "voorstel", flat(op1));
check("(3) OA op de post van een andere firma: geweigerd", /jouw firma/.test(outErr((await sync(oa2, { opId: uid(), clientKey: KO, op: ent(L.stop, 5_000n) }))[0])));
check("(3) OA kan nog niet over zijn eigen voorstel beslissen", !done((await sync(oa2, { opId: uid(), clientKey: KO, op: { review: { entryId: op1.outcome.done.entityId[0], ok: true, note: "" } } }))[0]));
const sumP = await wl.measureSummary(wid);
const pgP = sumP.posts.find((p) => p.root === P(iDak.title));
check("(3) het voorstel telt nog NIET mee (14 lm blijft), staat als wachtend op de post; totalen tonen 1 voorstel", pgP.measuredMilli === 14_000n && pgP.pendingCount === 1n && sumP.totals.openProposals === 1n && sumP.surveys[0].pendingCount === 1n);
check("(3) melding aan de werfleider: voorstel van Proef Dak NV", (await wl.myNotifications(true)).some((n) => n.kind === "opmeting-voorstel" && n.text.includes("Proef Dak NV") && n.text.includes(W)));
const oaPost = await oa2.measurePost(wid, P(iDak.title));
check("(3) OA ziet zijn voorstel (status 'voorstel') en de geldige regels van zijn post; de notitie van de werfleider niet", oaPost.entries.some((e) => e.status === "voorstel" && e.note === "nagemeten door de OA") && oaPost.entries.every((e) => e.status !== "voorstel" || e.byName.length > 0) && oaPost.entries.some((e) => e.byName.length > 0 && e.status === "geldig"));
const [cl] = await sync(oa2, { opId: uid(), clientKey: KO, op: { close: { note: "" } } });
check("(3) OA kan niet afsluiten", !done(cl));
check("(3) afsluiten kan niet zolang er een voorstel wacht", /Beslis eerst/.test(outErr((await sync(wl, { opId: uid(), clientKey: K1, op: { close: { note: "" } } }))[0])));
check("(3) afwijzen vraagt een reden", /reden/.test(outErr((await sync(wl, { opId: uid(), clientKey: K1, op: { review: { entryId: op1.outcome.done.entityId[0], ok: false, note: "" } } }))[0])));
const [rj] = await sync(wl, { opId: uid(), clientKey: K1, op: { review: { entryId: op1.outcome.done.entityId[0], ok: false, note: "Zonder meetlint gemeten" } } });
const oaAfter = await oa2.measurePost(wid, P(iDak.title));
check("(3) afgewezen: telt niet mee, de OA ziet de reden; de melding aan de OA", done(rj) && oaAfter.entries.some((e) => e.status === "afgewezen" && e.reviewNote.includes("meetlint")) && (await wl.measureSummary(wid)).posts.find((p) => p.root === P(iDak.title)).measuredMilli === 14_000n && (await oa2.myNotifications(true)).some((n) => n.kind === "opmeting-voorstel" && /wees af/.test(n.text)));
check("(3) over een voorstel is maar één keer te beslissen", /al beslist/.test(outErr((await sync(wl, { opId: uid(), clientKey: K1, op: { review: { entryId: op1.outcome.done.entityId[0], ok: true, note: "" } } }))[0])));
const [op2] = await sync(oa2, { opId: uid(), clientKey: KO, op: ent(L.goot, 12_500n, { note: "opnieuw gemeten", complete: true }) });
const [ok2] = await sync(calc, { opId: uid(), clientKey: K1, op: { review: { entryId: op2.outcome.done.entityId[0], ok: true, note: "" } } });
check("(3) tweede voorstel bevestigd door de calculator: telt mee als nieuwe waarde? Nee: een voorstel zonder correctie is een EXTRA deelopmeting", done(ok2) && (await wl.measureSummary(wid)).posts.find((p) => p.root === P(iDak.title)).measuredMilli === 26_500n);
const [op3] = await sync(oa2, { opId: uid(), clientKey: KO, op: ent(L.goot, 1_000n, { note: "per vergissing" }) });
const [rmv] = await sync(oa2, { opId: uid(), clientKey: KO, op: { remove: { entryId: op3.outcome.done.entityId[0] } } });
check("(3) de OA haalt zijn eigen wachtend voorstel weg (open opmeting)", done(rmv));
check("(3) de OA kan een regel van de werfleider niet weghalen", !done((await sync(oa2, { opId: uid(), clientKey: KO, op: { remove: { entryId: e1.outcome.done.entityId[0] } } }))[0]));
// De gedeeltelijke regel van de werfleider (14) en OA (12,5) samen = 26,5: de werfleider corrigeert dat in de volgende stap.

// ── (4) Afsluiten en corrigeren ──
const surveyBefore = await wl.getMeasureSurvey(S1);
const [cs] = await sync(wl, { opId: uid(), clientKey: K1, op: { close: { note: "Eerste opmeting" } } });
check("(4) afsluiten door de werfleider", done(cs) && cs.outcome.done.surveyId === S1);
const sv1 = await wl.getMeasureSurvey(S1);
check("(4) de opmeting is afgesloten (wie, wanneer, drempel van dat moment)", !sv1.survey.open && sv1.survey.closedAt.length === 1 && sv1.survey.closedByName.length > 0 && sv1.survey.thresholdBp[0] === 1000n && sv1.survey.closeNote === "Eerste opmeting");
const snap = sv1.snapshot;
const snapAf = snap.find((x) => x.title === iAfbraak.title);
check("(4) stand per post vastgelegd: VH, gemeten tot dan, wat erbij kwam, verschil, markering (7 posten)", snap.length === 7 && snapAf.vhMilli === 40_000n && snapAf.measuredMilli === 41_000n && snapAf.deltaMilli === 41_000n && snapAf.complete && "none" in snapAf.flag && "more" in snap.find((x) => x.title === iDak.title).flag, flat(snap.map((x) => [x.title, x.measuredMilli])).slice(0, 300));
const stripC = (s) => flat(s.entries.map((e) => [e.id, e.qtyMilli, e.day, e.note, e.files.length, e.createdAt, e.blockKey, e.status, e.corrects]));
check("(4) afsluiten twee keer: 'al afgesloten', geen tweede stand", (await sync(wl, { opId: uid(), clientKey: K1, op: { close: { note: "nog eens" } } }))[0].outcome.done.note === "al afgesloten");
check("(4) een regel van de afgesloten opmeting weghalen: geweigerd (corrigeer met een nieuwe regel en een reden)", /afgesloten/.test(outErr((await sync(wl, { opId: uid(), clientKey: K1, op: { remove: { entryId: e1.outcome.done.entityId[0] } } }))[0])));
const eGootClosed = (await wl.measurePost(wid, P(iDak.title))).entries.find((e) => e.qtyMilli === 14_000n);
check("(4) in de afgesloten opmeting: regels zijn niet weg te halen, wel te corrigeren", !eGootClosed.canRemove && eGootClosed.canCorrect && eGootClosed.surveyClosed);
// Een nieuwe regel via de oude sleutel komt in de VOLGENDE opmeting
const [nx] = await sync(wl, { opId: uid(), clientKey: K1, op: ent(L.gevel, 30_000n, { note: "gevel zuid" }) });
check("(4) een nieuwe regel via de oude sleutel: komt in een nieuwe opmeting ('volgende opmeting'), nummer 2", done(nx) && nx.outcome.done.note === "volgende opmeting" && nx.outcome.done.surveyId !== S1);
const S2 = nx.outcome.done.surveyId;
const sumN = await wl.measureSummary(wid);
check("(4) twee opmetingen: nr 1 afgesloten, nr 2 open", sumN.surveys.length === 2 && !sumN.surveys[0].open && sumN.surveys[1].open && sumN.surveys[1].number === 2n && sumN.openSurveyId[0] === S2);
// Correctie
const goot14 = eGootClosed.id;
const corr = (qty, reason) => ent(L.goot, qty, { corrects: [goot14], reason, complete: true });
check("(4) correctie zonder reden geweigerd", /reden/.test(outErr((await sync(wl, { opId: uid(), clientKey: K1, op: corr(12_000n, "  ") }))[0])));
const [co] = await sync(wl, { opId: uid(), clientKey: K1, op: corr(12_500n, "Foutieve meting, nagemeten met de OA") });
check("(4) correctie met reden: nieuwe regel in opmeting 2 (de afgesloten opmeting blijft ongewijzigd)", done(co) && co.outcome.done.surveyId === S2);
const gootNow = (await wl.measureSummary(wid)).posts.find((p) => p.root === P(iDak.title));
check("(4) gemeten dakgoot = nieuwe waarde (14 → 12,5 + de bevestigde 12,5 van de OA = 25): totaal volgt de laatste waarde", gootNow.measuredMilli === 25_000n, flat(gootNow.measuredMilli));
const gv = await wl.measurePost(wid, P(iDak.title));
const oldE = gv.entries.find((e) => e.id === goot14);
const newE = gv.entries.find((e) => e.id === co.outcome.done.entityId[0]);
check("(4) oude regel 'vervangen' (superseded), niet meer te corrigeren; de correctie draagt −1,5 bij (nieuw − oud) en toont de reden", oldE.superseded && !oldE.canCorrect && newE.contributionMilli === -1_500n && newE.reason.includes("Foutieve") && newE.corrects[0] === goot14 && newE.canRemove);
check("(4) dezelfde regel nog eens corrigeren: geweigerd (corrigeer de laatste regel)", /al gecorrigeerd/.test(outErr((await sync(wl, { opId: uid(), clientKey: K1, op: corr(11_000n, "nog eens") }))[0])));
check("(4) de correctie corrigeert een regel van een andere post niet", /andere post/.test(outErr((await sync(wl, { opId: uid(), clientKey: K1, op: ent(L.stop, 1_000n, { corrects: [newE.id], reason: "fout" }) }))[0])));
const sv1b = await wl.getMeasureSurvey(S1);
check("(4) de afgesloten opmeting 1 is na alles NIET veranderd: dezelfde regels, dezelfde stand per post", stripC(sv1b) === stripC(sv1) && flat(sv1b.snapshot) === flat(sv1.snapshot));
const snapG = sv1b.snapshot.find((x) => x.title === iDak.title);
check("(4) de stand van opmeting 1 voor de dakgoot blijft 14 (+ de bevestigde voorstellen van die dag: 26,5)", snapG.measuredMilli === 26_500n && "more" in snapG.flag);
// Een correctie weghalen in de open opmeting 2 zet de vorige waarde terug
const [rc] = await sync(wl, { opId: uid(), clientKey: K1, op: { remove: { entryId: newE.id } } });
check("(4) de correctie weghalen (opmeting 2 is open): de oude waarde geldt weer, de regel is niet meer vervangen", done(rc) && (await wl.measureSummary(wid)).posts.find((p) => p.root === P(iDak.title)).measuredMilli === 26_500n && !(await wl.measurePost(wid, P(iDak.title))).entries.find((e) => e.id === goot14).superseded);
const [co2] = await sync(wl, { opId: uid(), clientKey: K1, op: corr(12_500n, "Opnieuw gecorrigeerd") });
check("(4) en opnieuw corrigeren kan (de weggehaalde correctie blokkeert niet)", done(co2));
// Lege opmeting
const K9 = uid();
// sluit opmeting 2 (heeft regels) en probeer een lege
const [cs2] = await sync(wl, { opId: uid(), clientKey: K1, op: { close: { note: "Tweede opmeting" } } });
const sv2 = await wl.getMeasureSurvey(S2);
const snapG2 = sv2.snapshot.find((x) => x.title === iDak.title);
check("(4) opmeting 2 afgesloten: de stand tot en met 2 (dakgoot 25) en wat erbij kwam in 2 (−1,5 door de correctie)", done(cs2) && snapG2.measuredMilli === 25_000n && snapG2.deltaMilli === -1_500n && sv2.snapshot.find((x) => x.title.startsWith("Proef gevel")).deltaMilli === 30_000n);
const [o9] = await sync(wl, { opId: uid(), clientKey: K9, op: { open: { workId: wid } } });
check("(4) een nieuwe opmeting openen kan (nr 3), maar een LEGE opmeting afsluiten niet", done(o9) && o9.outcome.done.note === "nieuw" && /nog niets opgemeten/.test(outErr((await sync(wl, { opId: uid(), clientKey: K9, op: { close: { note: "" } } }))[0])));

// ── (5) Architect en klant: alleen de afgesloten stand, met de schakelaar en het leesrecht ──
const archId = (await arch.me()).person[0].id;
const klantId = (await klant.me()).person[0].id;
const mArch = ok(await admin.addMembership(wid, [archId], [], { architect: null }, [{ readProgress: null }]));
const mKlant = ok(await admin.addMembership(wid, [klantId], [], { klant: null }, [{ readProgress: null }]));
check("(5) architect en klant met leesrecht maar zonder de schakelaar: geweigerd", (await Promise.all([arch, klant].map((x) => denied(x.measureSummary(wid))))).every(Boolean));
ok(await admin.saveMeasureSettings({ thresholdBp: 1000n, oaPropose: true, externalRead: true }));
const sa = await arch.measureSummary(wid);
const sk2 = await klant.measureSummary(wid);
check("(5) met de schakelaar: architect en klant lezen de afgesloten stand ('closed'), niet schrijven of bevestigen", sa.scope === "closed" && sk2.scope === "closed" && !sa.canWrite && !sa.canReview && sa.surveys.length === 2 && sa.surveys.every((s) => !s.open) && sa.openSurveyId.length === 0, flat(sa.surveys.map((s) => s.open)));
const gA = sa.posts.find((p) => p.title === iDak.title);
check("(5) hun stand = enkel wat afgesloten is (dakgoot 25), nooit de lopende opmeting", gA.measuredMilli === 25_000n && gA.measuredMilli === gA.closedMilli && sa.posts.find((p) => p.title.startsWith("Proef gevel")).measuredMilli === 30_000n);
check("(5) geen notities, regels, foto's of voorstellen voor hen: regels en post-detail geweigerd; de lopende opmeting niet te openen", (await denied(arch.measurePost(wid, P(iDak.title)))) && (await denied(arch.getMeasureSurvey(o9.outcome.done.surveyId))) && (await arch.getMeasureSurvey(S1)).entries.length === 0 && sa.totals.openProposals === 0n && sa.posts.every((p) => p.pendingCount === 0n));
check("(5) architect/klant kunnen niets schrijven", (await Promise.all([arch, klant].map((x) => denied(x.measureSync([{ opId: uid(), clientKey: uid(), op: { open: { workId: wid } } }]))))).every(Boolean));
const mArch2 = ok(await admin.addMembership(wid, [archId], [], { architect: null }, []));
check("(5) architect zonder leesrecht (grant) op een werf: geweigerd, ook met de schakelaar", await (async () => { await admin.endMembership(mArch); const r = await denied(arch.measureSummary(wid)); return r; })());
await admin.endMembership(mArch2).catch(() => {});

// ── (6) Geen prijzen, instellingen, export, auditlog ──
const did = readFileSync(new URL("../src/backend/dist/backend.did", import.meta.url), "utf8");
const types = new Map([...did.matchAll(/^type (\w+) =([\s\S]*?);\n(?=type |service|$)/gm)].map((m) => [m[1], m[2]]));
const fieldsOf = (n) => [...(types.get(n) ?? "").matchAll(/^\s+(\w+)\s*:/gm)].map((m) => m[1]);
const measureTypes = ["MeasurePostView", "MeasureSummaryView", "SurveyBrief", "MeasureTotals", "MeasureEntryView", "MeasureFileView", "MeasurePostDetail", "SurveyPostSnapView", "SurveyDetail", "MeasureWorkBrief", "MeasureSettingsView", "MeasureFileIn", "MeasureOp", "MeasureOpInput", "MeasureOutcome", "MeasureOpResult", "MeasureEntry", "MeasureFile", "MeasureReview", "Survey", "SurveyPostSnap", "SurveyOpRecord"];
const badFields = measureTypes.flatMap((n) => fieldsOf(n).filter((f) => /cents|cost|margin|marg|price|prijs|amount|bedrag|subtotal|euro|vat|btw/i.test(f)).map((f) => `${n}.${f}`));
const priceTypes = ["QuoteLinePrice", "QuoteCostLine", "QuoteSellLine", "QuoteMarginTotals", "QuoteTotalsView", "LibCost", "LibSell", "ContractParams", "WorkConfidential"];
const refs = measureTypes.filter((n) => priceTypes.some((t) => new RegExp(`\\b${t}\\b`).test(types.get(n) ?? "")));
check("(6) de typen van de opmeting in de .did: allemaal aanwezig, geen enkel veld voor een prijs, aankoopprijs, marge, btw of bedrag, en geen verwijzing naar een prijstype of het contract", measureTypes.every((n) => types.has(n)) && badFields.length === 0 && refs.length === 0, badFields.concat(refs).concat(measureTypes.filter((n) => !types.has(n))).join(", ") || `${measureTypes.length} typen`);
const everything = flat([await wl.measureSummary(wid), await wl.measurePost(wid, P(iDak.title)), await wl.getMeasureSurvey(S1), await oa2.measureSummary(wid), await arch.measureSummary(wid).catch(() => null), await klant.measureSummary(wid), await wl.listMeasureWorks()]);
check("(6) in geen enkel antwoord (werfleider, OA, klant) een veld of waarde met een prijs of de aanneemsom", !/Cents|cost|margin|price|prijs/i.test(everything) && !new RegExp(`(?<!\\d)${rd.totals.subtotalCents}(?!\\d)`).test(everything));
check("(6) instellingen: de werfleider ziet de drempel, de OA en de externen niet; enkel de admin wijzigt", (await wl.measureSettings()).thresholdBp === 1000n && (await denied(oa2.measureSettings())) && (await denied(klant.measureSettings())) && (await denied(wl.saveMeasureSettings({ thresholdBp: 500n, oaPropose: false, externalRead: false }))));
check("(6) drempel: 0 en meer dan 1000 % geweigerd", /Drempel/.test(errOf(await admin.saveMeasureSettings({ thresholdBp: 0n, oaPropose: true, externalRead: true }))) && /Drempel/.test(errOf(await admin.saveMeasureSettings({ thresholdBp: 100_001n, oaPropose: true, externalRead: true }))));
ok(await admin.saveMeasureSettings({ thresholdBp: 2000n, oaPropose: true, externalRead: true }));
const thrOf = async (t) => (await wl.measureSummary(wid)).posts.find((p) => p.title === t);
const stop20 = await thrOf(iElek.title);
const goot20 = await thrOf(iDak.title);
check("(6) drempel 20 %: het minderwerk van de stopcontacten (−16,66 %) valt eronder (geen markering), de dakgoot (+108 %) blijft meerwerk", "none" in stop20.flag && "more" in goot20.flag);
ok(await admin.saveMeasureSettings({ thresholdBp: 1000n, oaPropose: true, externalRead: true }));
check("(6) drempel terug op 10 %: de stopcontacten zijn weer minderwerk; het afgesloten bewijs bewaart de drempel van toen (10 %)", "less" in (await thrOf(iElek.title)).flag && (await wl.getMeasureSurvey(S1)).survey.thresholdBp[0] === 1000n);
ok(await admin.saveMeasureSettings({ thresholdBp: settings0.thresholdBp, oaPropose: settings0.oaPropose, externalRead: settings0.externalRead }));
const log = await admin.auditLog(0n, 500n);
check("(6) auditlog: nieuwe opmeting, regels, correctie, voorstel-bevestigd/afgewezen, afgesloten, instellingen; zonder bedragen", ["opmeting-nieuw", "opmeting-regel", "opmeting-correctie", "opmeting-voorstel-bevestigd", "opmeting-voorstel-afgewezen", "opmeting-afgesloten", "opmeting-instellingen", "opmeting-regel-weg"].every((a) => log.some((e) => e.action === a && e.detail.length > 0)) && !log.filter((e) => e.action.startsWith("opmeting")).some((e) => /€|Cents/.test(e.detail)));
const ex = await Promise.all(["surveys", "surveyKeys", "measureEntries", "measureSnapshots", "measureOps"].map(async (k) => ok(await admin.exportChunk(k, 0n, 500n))));
check("(6) export: opmetingen, sleutels, regels, standen en opdrachten zitten in de back-up", ex[0].surveys.some((s) => s.id === S1) && ex[1].surveyKeys.length > 0 && ex[2].measureEntries.some((e) => e.id === goot14) && ex[3].measureSnapshots.some(([id]) => id === S1) && ex[4].measureOps.length > 0);
check("(6) export door de werfleider of de OA: geweigerd", (await denied(wl.exportChunk("measureEntries", 0n, 1n))) && (await denied(oa2.exportChunk("surveys", 0n, 1n))));
const intern = await admin.exportIntern();
check("(6) exportIntern bevat de opmeting (surveys, regels, standen)", intern.surveys.length > 0 && intern.measureEntries.length > 0 && intern.measureSnapshots.length > 0);

// ── Opruimen ──
await admin.endMembership(mOa).catch(() => {});
await admin.endMembership(mKlant).catch(() => {});
await admin.setWorkStatus(wid, { cancelled: null });
console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
