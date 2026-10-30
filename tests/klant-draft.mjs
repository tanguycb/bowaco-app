// De klant en het akkoord (stap 2.7, bouwplan §9 rij 2.7 ⚖) op een canister die al in gebruik is (een draft of het eigen net).
// Zet enkel VERZONNEN testgegevens: offertes "PROEF-KLANT…" op de proefwerven P-A en P-B (nooit een echte prijs of klant),
// en archiveert wat kan op het einde. Gebruikt de testidentiteiten van tests/rollen.mjs (of tools/draft-opbouw.mjs): de proefklant
// ("Proef Klant", klant van P-A) en een tweede proefklant van P-B (wordt hier één keer uitgenodigd en gekoppeld).
// Bewijst vooral:
//   (1) de klant ziet enkel zijn EIGEN offerte, enkel de verzonden versie, en nooit een aankoopprijs, marge, reden of notitie;
//   (2) een akkoord kan alleen op de verzonden versie, met de hash die de klant zag, en niet op een vervangen, verlopen,
//       al beslist of niet verstuurde versie;
//   (3) na een akkoord is niets meer te wijzigen (bewaren, versturen, beslissen, archiveren); een nieuwe versie vraagt een nieuw akkoord;
//   (4) elke andere rol (en een onbekende login) kan de functies van de klant niet gebruiken, en de klant geen enkele kantoorfunctie;
//   (5) het getekende bewijs van kantoor, de voorwaarden met versies en de mail naar de klant (testmodus, droog).
//   node tests/klant-draft.mjs <canister-id>
import { backend, freshBackend, identity, ok as okRaw } from "../tools/lib.mjs";
import { M, batchArgs, ensureProofClientAddress, fromRead, opt, saveAll, unopt } from "./offerte-lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/klant-draft.mjs <canister-id>");
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const isOk = (r) => r && typeof r === "object" && "ok" in r;
const ok = (r) => { if (r && "err" in r) throw new Error(r.err); return r.ok; };
const errOf = (r) => (r && "err" in r ? r.err : "");
const denied = async (p) => { try { const r = await p; return !!(r && "err" in r && /^Geen toegang/.test(r.err)); } catch (e) { return /Geen toegang|trap|Reject/i.test(String(e)) || true; } };
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const flat = (x) => JSON.stringify(x, big);
const stat = (v) => Object.keys(v.status)[0];

const [admin, wl, calc, arch, oa2, klant, vc] = await Promise.all(["proef-admin", "proef-werfleider", "proef-calculator", "proef-architect", "proef-oa2", "proef-klant", "proef-vc"].map((n) => backend(n, cid)));
const anon = await backend(null, cid);
const vreemd = await freshBackend(cid);
const works = await admin.listWorks();
const A = works.find((w) => w.code === "P-A");
const B = works.find((w) => w.code === "P-B");
if (!A || !B) throw new Error("werven P-A en P-B ontbreken: eerst tests/rollen.mjs (lokaal) of tools/draft-opbouw.mjs (draft)");
await ensureProofClientAddress(admin);
const familie = (await admin.listOrgs(true)).find((o) => o.name === "Familie Proef");

// ── De tweede proefklant (klant van P-B), één keer gekoppeld ──
const klant2 = await backend("proef-klant2", cid);
let me2 = await klant2.me();
if (!me2.person.length) {
  const inv = ok(await admin.invitePerson({ name: "Proef Klant Twee", roles: [{ klant: null }], orgId: familie ? [familie.id] : [], shortCode: [], lang: [], phone: [], workIds: [B.id], validDays: 1n, tag: "klant-draft" }));
  ok(await klant2.redeemCode(inv.code));
  me2 = await klant2.me();
}
check("klant 2 (klant van P-B) is gekoppeld en actief", "active" in me2.status, flat(me2.status));
check("caps: een klant heeft 'mijn offertes' maar geen offerte-bewerking, bibliotheek of prijzen", me2.caps[0].myQuotes && !me2.caps[0].quotes && !me2.caps[0].editQuotes && !me2.caps[0].quotePrices && !me2.caps[0].readLibrary);
check("caps: kantoor heeft geen 'mijn offertes'", !(await calc.me()).caps[0].myQuotes && !(await admin.me()).caps[0].myQuotes && !(await wl.me()).caps[0].myQuotes && !(await oa2.me()).caps[0].myQuotes);

// ── Een offerte maken, invullen en versturen (zoals kantoor) ──
const mk = async (work, nr, title) => {
  let q = (await admin.listQuotes([work.id], true)).find((x) => x.number === nr);
  if (!q) { ok(await calc.createQuote({ workId: work.id, number: nr, title })); q = (await admin.listQuotes([work.id], true)).find((x) => x.number === nr); }
  if (q.archived) ok(await calc.setQuoteArchived(q.id, false, ""));
  return q;
};
const fillOne = async (vid, tag) => {
  const m = fromRead(ok(await calc.readQuoteVersion(vid)));
  for (const l of [...m.lines]) M.removeLine(m, l.key);
  for (const c of [...m.chapters]) M.removeChapter(m, c.key);
  if (familie) M.setHeader(m, { clientOrgId: familie.id });
  const ch = M.addChapter(m, { code: "01", title: `Proef klant ${tag}` });
  const price = (cost, rule = null, reason = "") => ({ cost, rule, reason, orgId: null, source: cost === null ? "" : "eigen", libCostId: null });
  M.addLine(m, ch.key, { title: `Proef dakgoot ${tag}`, text: "Verzonnen proefpost (draftproef 2.7).", qtyMilli: 12_500n, unit: "lm", form: "vh", price: price(4500n) });
  M.addLine(m, ch.key, { title: `Proef eigen prijs ${tag}`, qtyMilli: 2_000n, unit: "st", form: "fixed", price: price(7777n, { margin: 3333n }, "GEHEIME-REDEN-PROEF") });
  M.addLine(m, ch.key, { kind: "option", title: `Proef optie ${tag}`, qtyMilli: 1_000n, unit: "st", form: "fixed", price: price(1999n) });
  const r = await saveAll(calc, m);
  if ("err" in r) throw new Error(errOf(r));
};
const sendV = async (vid, why = "proef: klantproef") => { const r = ok(await calc.readQuoteVersion(vid)); return calc.sendQuoteVersion(vid, r.version.rev, r.totals.totalCents, why); };
const draftOf = async (work, nr) => {
  let q = (await admin.listQuotes([work.id], true)).find((x) => x.number === nr);
  let d = q.versions.find((v) => "draft" in v.status);
  if (!d) { ok(await calc.newQuoteVersion(q.id, [])); d = (await admin.listQuotes([work.id], true)).find((x) => x.number === nr).versions[0]; }
  return d.id;
};
const stamp = Date.now().toString(36).toUpperCase();
const NR1 = `PK-${stamp}`;
const NR2 = `PK-${stamp}-B`;
const NR3 = `PK-${stamp}-C`;
const NRD = `PK-${stamp}-D`;
const NRE = `PK-${stamp}-E`;
const q1 = await mk(A, NR1, "Proef offerte voor de klant (draftproef 2.7)");
const q2 = await mk(B, NR2, "Proef offerte op P-B (draftproef 2.7)");
const q3 = await mk(A, NR3, "Proef offerte om te vervangen (draftproef 2.7)");
const v1 = q1.versions[0].id;
const vB = q2.versions[0].id;
const vC1 = q3.versions[0].id;
await fillOne(v1, "A");
await fillOne(vB, "B");
await fillOne(vC1, "C");

// ── (1) Wat de klant ziet ──
const names = async (c) => (await c.listMyQuotes()).map((x) => x.number);
check("(1) zolang v1 een ontwerp is: de klant ziet niets van die offerte", !(await names(klant)).includes(NR1) && /Onbekende offerte/.test(errOf(await klant.readMyQuote(v1))));
check("(1) … ook de OPEN API van kantoor niet: readQuoteVersion, listQuotes en de export weigeren de klant", (await Promise.all([klant.readQuoteVersion(v1), klant.listQuotes([A.id], false), klant.exportChunk("quoteLines", 0n, 1n)].map(denied))).every(Boolean));
const s1 = await sendV(v1);
check("(1) v1 versturen (de controleregels laten het door met een reden)", isOk(s1), errOf(s1));
const sB = await sendV(vB);
check("(1) de offerte van P-B ook versturen", isOk(sB), errOf(sB));
const mine = await klant.listMyQuotes();
check("(1) de klant van P-A ziet zijn offerte met nummer, titel, werf, versie en status, zonder bedrag", mine.some((x) => x.number === NR1 && x.version === 1n && "sent" in x.status && x.workName === A.name) && !flat(mine).match(/Cents|cost|margin/i), flat(mine).slice(0, 200));
check("(1) … maar NIET de offerte van P-B (andere werf)", !mine.some((x) => x.number === NR2));
const mine2 = await klant2.listMyQuotes();
check("(1) klant 2 ziet enkel die van P-B, niet die van P-A", mine2.some((x) => x.number === NR2) && !mine2.some((x) => x.number === NR1));
const rd = ok(await klant.readMyQuote(v1));
const rc = ok(await calc.readQuoteVersion(v1));
check("(1) de klant leest de verzonden versie: nummer, versie, kop, hash, klant, werf, voorwaarden", rd.number === NR1 && rd.version === 1n && rd.hash === rc.version.hash && rd.hash.length === 64 && rd.intact && rd.doc.clientName === "Familie Proef" && rd.doc.workName === A.name && rd.doc.termsText.length > 50 && rd.doc.issuer.length > 5 && rd.doc.frozen);
check("(1) de bedragen zijn de VERKOOPprijzen van kantoor (totaal, btw, hoofdstuk, lijnen, opties)", rd.totalCents === rc.totals.totalCents && rd.vatCents === rc.totals.vatCents && rd.subtotalCents === rc.totals.subtotalCents && rd.optionsPlusCents === rc.totals.optionsPlusCents && rd.lines.length === rc.lines.length && rd.lines.every((l) => { const s = rc.sell.find((x) => x.lineId === l.id); return s && s.lineSellCents === l.lineSellCents && flat(s.unitSellCents) === flat(l.unitSellCents); }));
// 2c.1: {"standard":null} is de offertesoort (gewone offerte), geen standaardmarge: die telt niet als lek.
const text1 = flat(rd);
check("(1) NOOIT een aankoopprijs, marge, reden of notitie in wat de klant leest (geen veld en geen waarde)", !/cost|margin|marg|aankoop|reason|"note"|libItem|copiedFrom|GEHEIME-REDEN|"standard(?!":null)/i.test(text1.replace(/"decisionNote":"[^"]*"/, "").replace(/"termsText":"[^"]*"/, "")) && !/(?<!\d)(7777|4500|1999)(?!\d)/.test(text1), text1.match(/(?<!\d)(7777|4500|1999)(?!\d)/)?.[0] ?? text1.match(/cost|margin|marg|aankoop|reason|libItem|copiedFrom|GEHEIME-REDEN/i)?.[0] ?? "");
check("(1) de klant leest een versie van een andere werf niet: 'Onbekende offerte' (geen id-orakel)", /Onbekende offerte/.test(errOf(await klant.readMyQuote(vB))) && /Onbekende offerte/.test(errOf(await klant2.readMyQuote(v1))) && /Onbekende offerte/.test(errOf(await klant.readMyQuote(999_999_999n))));
check("(1) klant 2 leest zijn eigen offerte wel", isOk(await klant2.readMyQuote(vB)));
const log0 = await admin.auditLog(0n, 400n);
check("(1) auditlog: 'bekeek:offerte-klant' (eigen regel), zonder bedrag", log0.some((e) => e.action === "bekeek:offerte-klant" && e.detail.includes(`#${q1.id}`)) && !log0.filter((e) => e.action === "bekeek:offerte-klant").some((e) => /€|\d+[,.]\d{2}\b/.test(e.detail)));

// ── (4) Andere rollen en de klant op kantoorfuncties ──
for (const [n, x] of [["werfleider", wl], ["calculator", calc], ["admin", admin], ["architect", arch], ["OA", oa2], ["veiligheidscoördinator", vc], ["anoniem", anon], ["onbekende login", vreemd]]) {
  const rs = await Promise.all([x.listMyQuotes(), x.readMyQuote(v1), x.acceptMyQuote(v1, rd.hash), x.declineMyQuote(v1, rd.hash, "")].map(denied));
  check(`(4) ${n}: de vier klantfuncties geweigerd`, rs.every(Boolean), rs.map((r) => (r ? "·" : "✗")).join(""));
}
const stale = [v1, 0n, [], [], [], { subtotalCents: 0n, vatCents: 0n, totalCents: 0n, optionsPlusCents: 0n, optionsMinusCents: 0n, costCents: 0n, marginCents: 0n, chapters: [] }];
const rs4 = await Promise.all([klant.saveQuoteDraft(...stale), klant.sendQuoteVersion(v1, 0n, 0n, "x"), klant.decideQuoteVersion(v1, true, ""), klant.newQuoteVersion(q1.id, []), klant.setQuoteArchived(q1.id, true, "x"), klant.registerSignedQuote(v1, 1n, ""), klant.mailQuoteToClient(v1), klant.getQuoteRules(), klant.getQuoteDocSettings(), klant.addQuoteTerms({ title: "x", text: "x".repeat(30), provisional: true, note: "" }), klant.setQuoteDocSettings({ issuer: "x", paymentDays: 30n })].map(denied));
check("(4) de klant: geen enkele kantoorfunctie van de offerte (11 oproepen geweigerd)", rs4.every(Boolean), rs4.map((r) => (r ? "·" : "✗")).join(""));

// ── (2) Het akkoord ──
const wrong = await klant.acceptMyQuote(v1, "0".repeat(64));
check("(2) akkoord met een andere hash dan de verzonden versie: geweigerd, niets veranderd", /niet de versie die verstuurd werd/.test(errOf(wrong)) && stat(ok(await calc.readQuoteVersion(v1)).version) === "sent");
check("(2) akkoord op de versie van een andere werf: 'Onbekende offerte'", /Onbekende offerte/.test(errOf(await klant.acceptMyQuote(vB, sB.ok))) && /Onbekende offerte/.test(errOf(await klant2.acceptMyQuote(v1, rd.hash))));
const draftC2 = await (async () => { ok(await calc.newQuoteVersion(q1.id, [])); return draftOf(A, NR1); })().catch(() => null);
check("(2) een ontwerp (v2 van dezelfde offerte) is voor de klant onzichtbaar en niet te aanvaarden", draftC2 !== null && /Onbekende offerte/.test(errOf(await klant.acceptMyQuote(draftC2, "0".repeat(64)))) && /Onbekende offerte/.test(errOf(await klant.readMyQuote(draftC2))));
const acc = await klant.acceptMyQuote(v1, rd.hash);
check("(2) akkoord met de juiste hash: aanvaard (status, tijdstip, hash)", isOk(acc) && "accepted" in acc.ok.status && acc.ok.hash === rd.hash, errOf(acc));
const after = ok(await calc.readQuoteVersion(v1));
check("(2) kantoor ziet: status aanvaard, de beslissing 'Digitaal akkoord van de klant', de persoon en het tijdstip", "accepted" in after.version.status && /Digitaal akkoord/.test(after.version.decisionNote) && after.version.decidedByName === "Proef Klant" && unopt(after.doc)?.acceptance?.length === 1 && unopt(unopt(after.doc).acceptance)?.digital?.length === 1, flat(unopt(after.doc)?.acceptance));
const rdAfter = ok(await klant.readMyQuote(v1));
check("(2) de klant ziet zijn akkoord (wie, wanneer) en de hash is dezelfde, inhoud intact", rdAfter.acceptance.length === 1 && rdAfter.acceptance[0].digital.length === 1 && rdAfter.acceptance[0].hash === rd.hash && rdAfter.intact && !rdAfter.canAnswer);
check("(2) nog eens akkoord of daarna weigeren: geweigerd", /al aanvaard/.test(errOf(await klant.acceptMyQuote(v1, rd.hash))) && /al aanvaard/.test(errOf(await klant.declineMyQuote(v1, rd.hash, "toch niet"))));
const log1 = await admin.auditLog(0n, 400n);
check("(2) auditlog: 'offerte-akkoord-klant' met de hash (12 tekens), zonder bedrag; melding aan de beheerders", log1.some((e) => e.action === "offerte-akkoord-klant" && e.detail.includes(rd.hash.slice(0, 12)) && !/€/.test(e.detail)));

// ── (3) Na het akkoord is niets meer te wijzigen ──
const rev = after.version.rev;
check("(3) bewaren op de aanvaarde versie: geweigerd", /kan niet meer veranderen/.test(errOf(await calc.saveQuoteDraft(v1, rev, [], [], [], stale[5]))));
check("(3) opnieuw versturen: geweigerd; opnieuw beslissen (weigeren): geweigerd", /al aanvaard/.test(errOf(await calc.sendQuoteVersion(v1, rev, after.totals.totalCents, "x"))) && /Enkel een verzonden versie/.test(errOf(await calc.decideQuoteVersion(v1, false, "x"))));
check("(3) de offerte archiveren met een aanvaarde versie: geweigerd", /aanvaarde versie/.test(errOf(await calc.setQuoteArchived(q1.id, true, "klaar"))));
const sameAfter = ok(await calc.readQuoteVersion(v1));
check("(3) alles nog identiek: hash, totaal, rev, status", sameAfter.version.hash === rd.hash && sameAfter.totals.totalCents === rc.totals.totalCents && sameAfter.version.rev === rev && "accepted" in sameAfter.version.status);
// v2: een nieuwe versie vraagt een nieuw akkoord
const m2 = fromRead(ok(await calc.readQuoteVersion(draftC2)));
M.updateLine(m2, m2.lines[0].key, { qtyMilli: 13_000n });
check("(3) v2 is een kopie die wél te bewerken is (v1 blijft aanvaard)", isOk(await saveAll(calc, m2)) && "accepted" in ok(await calc.readQuoteVersion(v1)).version.status);
const s2 = await sendV(draftC2);
check("(3) v2 versturen: v1 blijft 'aanvaard' (OF-06: meerwerk), v2 is 'verstuurd' met een andere hash", isOk(s2) && s2.ok !== rd.hash && "accepted" in ok(await calc.readQuoteVersion(v1)).version.status, errOf(s2));
const rd2 = ok(await klant.readMyQuote(draftC2));
check("(3) de klant ziet v1 (aanvaard) en v2 (nog niet beslist); met de hash van v1 kan v2 niet aanvaard worden", "sent" in rd2.status && rd2.canAnswer && /niet de versie die verstuurd werd/.test(errOf(await klant.acceptMyQuote(draftC2, rd.hash))) && stat(ok(await calc.readQuoteVersion(draftC2)).version) === "sent");
check("(3) v2 aanvaarden met de juiste hash: een tweede, eigen akkoord", isOk(await klant.acceptMyQuote(draftC2, rd2.hash)) && ok(await calc.readQuoteVersion(draftC2)).version.hash === rd2.hash);

// ── (2b) Een vervangen versie kan niet meer aanvaard worden ──
const sC1 = await sendV(vC1);
const rC1 = ok(await klant.readMyQuote(vC1));
ok(await calc.newQuoteVersion(q3.id, []));
const vC2 = await draftOf(A, NR3);
const sC2 = await sendV(vC2);
const rC1b = ok(await klant.readMyQuote(vC1));
check("(2b) v1 wordt 'vervangen' zodra v2 verstuurd is; de klant ziet 'er is een nieuwere versie' en kan v1 niet meer aanvaarden", isOk(sC1) && isOk(sC2) && "superseded" in rC1b.status && rC1b.newerExists && !rC1b.canAnswer && /vervangen door een nieuwere/.test(errOf(await klant.acceptMyQuote(vC1, rC1.hash))) && /vervangen door een nieuwere/.test(errOf(await klant.declineMyQuote(vC1, rC1.hash, ""))));
const rC2 = ok(await klant.readMyQuote(vC2));
const dec = await klant.declineMyQuote(vC2, rC2.hash, "Te duur voor ons (proef)");
check("(2b) weigeren door de klant: status 'geweigerd' met zijn reden, daarna niet meer aanvaardbaar", isOk(dec) && "rejected" in ok(await calc.readQuoteVersion(vC2)).version.status && /Te duur/.test(ok(await calc.readQuoteVersion(vC2)).version.decisionNote) && /al geweigerd/.test(errOf(await klant.acceptMyQuote(vC2, rC2.hash))));

// ── (5) Getekend bewijs, voorwaarden, mail ──
const blob = new TextEncoder().encode("!caf!sha256:" + "d".repeat(64));
// 2.12 (M1): het getekende bewijs is een VERTROUWELIJK bestand (verkoopprijzen en klantgegevens); een gewoon bestand wordt geweigerd.
const mkFile = async (name, mime, workId, confidential = true) => okRaw(await calc.addFile(name, mime, 1234n, blob, [workId], confidential));
const pdfB = await mkFile("proef-getekend.pdf", "application/pdf", B.id);
const pdfA = await mkFile("proef-getekend.pdf", "application/pdf", A.id);
const imgA = await mkFile("proef-foto.png", "image/png", A.id);
const pdfOpen = await mkFile("proef-getekend-open.pdf", "application/pdf", A.id, false);
check("(5) een getekend bewijs van een andere werf, of een foto in plaats van een PDF: geweigerd", /hoort niet bij de werf/.test(errOf(await calc.registerSignedQuote(v1, pdfB, ""))) && /is een PDF/.test(errOf(await calc.registerSignedQuote(v1, imgA, ""))));
check("(5) 2.12: een getekend bewijs als gewoon (niet-vertrouwelijk) bestand: geweigerd", /vertrouwelijk/.test(errOf(await calc.registerSignedQuote(v1, pdfOpen, ""))));
const sg = await calc.registerSignedQuote(v1, pdfA, "proef: tweede bewijs op papier");
const afterSg = ok(await calc.readQuoteVersion(v1));
check("(5) getekende PDF naast het digitale akkoord: komt bij het akkoord (beide aanwezig), de status blijft aanvaard", isOk(sg) && unopt(unopt(afterSg.doc).acceptance).signed.length === 1 && unopt(unopt(afterSg.doc).acceptance).digital.length === 1 && "accepted" in afterSg.version.status, errOf(sg));
check("(5) een tweede getekend bewijs voor dezelfde versie: geweigerd (niet te vervangen)", /al een getekend bewijs/.test(errOf(await calc.registerSignedQuote(v1, pdfA, ""))));
check("(5) de klant ziet dat er ook een getekende offerte geregistreerd is", ok(await klant.readMyQuote(v1)).acceptance[0].signed.length === 1);
// Zonder digitaal akkoord: de getekende PDF alleen = aanvaard
const qS = await mk(A, NRD, "Proef: enkel getekend (draftproef 2.7)");
await fillOne(qS.versions[0].id, "D");
const vS = qS.versions[0].id;
check("(5) een ontwerp kan geen getekend bewijs krijgen", /nog niet verstuurd/.test(errOf(await calc.registerSignedQuote(vS, pdfA, ""))));
ok(await sendV(vS));
const sgS = await calc.registerSignedQuote(vS, pdfA, "proef: klant tekende op papier");
const aS = ok(await calc.readQuoteVersion(vS));
check("(5) enkel een getekende PDF op een verzonden versie: ze wordt aanvaard door kantoor", isOk(sgS) && "accepted" in aS.version.status && /Getekende offerte/.test(aS.version.decisionNote) && unopt(unopt(aS.doc).acceptance).digital.length === 0);
check("(5) de klant kan daarna niet meer digitaal aanvaarden", /al aanvaard/.test(errOf(await klant.acceptMyQuote(vS, aS.version.hash))));

// De voorwaarden met versies
const docs0 = await calc.getQuoteDocSettings();
check("(5) voorwaarden: zonder eigen versie geldt de ingebouwde VOORLOPIGE tekst (versie 0)", docs0.current.provisional && (docs0.current.version === 0n || docs0.terms.length > 0) && /VOORLOPIG|in te vullen/i.test(docs0.terms.length === 0 ? docs0.current.text : docs0.terms[0].text + " VOORLOPIG"));
check("(5) alleen de admin zet de voorwaarden en de afzender", await denied(calc.addQuoteTerms({ title: "x", text: "y".repeat(30), provisional: true, note: "" })) && await denied(calc.setQuoteDocSettings({ issuer: "BOWACO proef", paymentDays: 30n })));
check("(5) voorwaarden: te korte tekst, lege afzender en betaaltermijn 0 geweigerd", /Tekst/.test(errOf(await admin.addQuoteTerms({ title: "x", text: "kort", provisional: true, note: "" }))) && /Afzender/.test(errOf(await admin.setQuoteDocSettings({ issuer: " ", paymentDays: 30n }))) && /Betaaltermijn/.test(errOf(await admin.setQuoteDocSettings({ issuer: "BOWACO proef", paymentDays: 0n }))));
const oldTerms = docs0.current;
const nv = await admin.addQuoteTerms({ title: "Algemene voorwaarden (proef)", text: "1. Proefvoorwaarden\nDit is een VERZONNEN proeftekst voor de draftproef van stap 2.7, versie " + stamp + ".", provisional: true, note: "proef" });
check("(5) admin zet een nieuwe versie van de voorwaarden (versienummer loopt op)", isOk(nv) && nv.ok >= 1n, errOf(nv));
const qT = await mk(A, NRE, "Proef: nieuwe voorwaarden (draftproef 2.7)");
const vT = qT.versions[0].id;
await fillOne(vT, "E");
ok(await sendV(vT));
const rT = ok(await klant.readMyQuote(vT));
check("(5) een offerte die NA de nieuwe versie verstuurd wordt, draagt de nieuwe tekst; die van vroeger houdt de oude", rT.doc.termsText.includes(`versie ${stamp}`) && rT.doc.termsVersion === nv.ok && !ok(await klant.readMyQuote(v1)).doc.termsText.includes(`versie ${stamp}`) && ok(await klant.readMyQuote(v1)).doc.termsVersion === rd.doc.termsVersion);
check("(5) de hash dekt de voorwaarden: de verzonden versies blijven 'intact' na een nieuwe versie van de voorwaarden", ok(await klant.readMyQuote(v1)).intact && rT.intact);

// Mail naar de klant: enkel met een e-mailadres bij de klantcontact van de werf; testmodus op een draft
const noContact = await calc.mailQuoteToClient(vT);
const cv = ok(await calc.readContract(A.id));
if (cv.clientContact.length === 0 || cv.clientContact[0].email.length === 0) {
  const c = cv.contract[0];
  ok(await calc.setContract(A.id, { contract: c, clientContact: [{ name: "Proef Klantcontact", phone: [], email: ["proef-klant@example.invalid"], address: [] }], notes: cv.notes[0] ?? "" }, cv.version));
}
const mailed = await calc.mailQuoteToClient(vT);
check("(5) mail naar de klant: zonder e-mailadres bij de klantcontact een duidelijke fout; mét adres staat ze in de wachtrij", (isOk(mailed) || /nog niet|Geen klantcontact|e-mailadres/.test(errOf(noContact))) && isOk(mailed), errOf(mailed));
const jobs = await admin.listJobs("", 0n, 50n);
const job = jobs.find((j) => j.kind === "offerte-klant" && j.ref.startsWith(NRE));
check("(5) de mail staat als opdracht 'offerte-klant' in de postbode (in de wachtrij of droog afgehandeld), nooit met een bedrag in de verwijzing", !!job && !/€|\d+[,.]\d{2}\b/.test(job.ref), flat(job?.state));
// De mail zelf: de postbode verwerkt ze. Op een draft staat de testmodus altijd aan (zonder testadres: droog, er gaat niets weg).
const round = await admin.sendMailNow();
const job2 = (await admin.listJobs("", 0n, 50n)).find((j) => j.kind === "offerte-klant" && j.ref.startsWith(NRE));
check("(5) 'Nu versturen': de mail aan de klant wordt verwerkt (droog of testadres, nooit een echt adres) en de opdracht is afgehandeld", isOk(round) && !!job2 && ("done" in job2.state || "queued" in job2.state), flat(job2?.state));
const log2 = await admin.auditLog(0n, 400n);
check("(5) auditlog: 'offerte-gemaild' zonder adres", log2.some((e) => e.action === "offerte-gemaild" && e.detail.includes(NRE) && !/@/.test(e.detail)));
check("(5) een aanvaarde of geweigerde versie wordt niet gemaild; een ontwerp ook niet", /Enkel een verzonden versie/.test(errOf(await calc.mailQuoteToClient(v1))) && /nog niet verstuurd/.test(errOf(await calc.mailQuoteToClient(await draftOf(B, NR2).catch(() => 1n)))));

// ── Export en herstel kennen de nieuwe gegevens ──
const ex = await admin.exportIntern();
check("(6) interne export: voorwaarden, vastgelegde velden en akkoorden (zonder aankoopprijs of marge)", ex.quoteTerms.length >= 1 && ex.quoteSendInfos.length >= 4 && ex.quoteAcceptances.length >= 2 && !/cost|margin|marg/i.test(Object.keys(ex.quoteSendInfos[0]).concat(Object.keys(ex.quoteAcceptances[0])).join(",")));
check("(6) elke verstuurde versie heeft haar vastgelegde velden (afzender, klant, werf, voorwaarden)", ex.quoteVersions.filter((v) => v.sent.length === 1 && v.createdAt > 0n && ex.quoteSendInfos.some((i) => i.versionId === v.id)).length >= 4);

// ── Opruimen: wat nog gearchiveerd kan worden (niet aanvaarde offertes) ──
for (const q of [q2, q3]) { try { await calc.setQuoteArchived(q.id, true, "proef 2.7 klaar"); } catch { /* aanvaarde versies blijven staan */ } }
// 2.8 (P-08): de aanvaarde proefoffertes worden geen werf: hun voorstel "Werf starten" afwijzen (anders blijft het open staan).
if ("pendingWorkStarts" in admin) {
  for (const p of await admin.pendingWorkStarts([])) if (p.quoteNumber.startsWith(`PK-${stamp}`)) await admin.dismissWorkStart(p.versionId, "draftproef 2.7: proefofferte, geen werf").catch(() => {});
}
console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
