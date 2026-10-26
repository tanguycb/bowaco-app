// OA-facturen registreren en controleren (stap 2.11, bouwplan §9 rij 2.11 en §5.1) op een canister die al in gebruik is (een draft
// of het eigen net). Zet enkel VERZONNEN testgegevens: een eigen proefwerf "P-OF-…" (tests/vordering-lib.mjs: aanvaarde offerte met
// aankoopprijzen van Proef Dak NV, een afgesloten opmeting, 16 u regie bevestigd en 4 u betwist) en proeffacturen "PF-…". Op het
// einde staat de proefwerf op "geannuleerd" en staan de instellingen terug. Bewijst vooral:
//   (1) bedragen gaan NOOIT naar de werfleider of externen (sleutels van de antwoorden, .did-typen); de werfleider ziet uren en
//       hoeveelheden en de markeringen daarop;
//   (2) de controle per regel: afgesproken prijs, opmeting, VH, regie-uren (bevestigd/betwist), al gefactureerd, drempel, btw;
//   (3) de inhoudingsplicht is VERPLICHT bij goedkeuring: een raadpleging van die dag met referentie, of een gemotiveerde uitzondering;
//   (4) goedkeuren met markeringen vraagt een reden; een goedgekeurde factuur verandert niet; betwisten met reden (melding naar de
//       OA, instelbaar); intrekken; geen dubbele registratie;
//   (5) de OA ziet enkel de status van zijn eigen facturen als de beheerder dat aanzet; auditlog zonder bedragen; export.
//   node tests/oafactuur-draft.mjs <canister-id>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { backend, freshBackend } from "../tools/lib.mjs";
import { proefVordering, ok, errOf, opt } from "./vordering-lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/oafactuur-draft.mjs <canister-id>");
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const isOk = (r) => r && typeof r === "object" && "ok" in r;
const denied = async (p) => { try { const r = await p; return !!(r && "err" in r && /^Geen toegang/.test(r.err)); } catch (e) { return /Geen toegang|trap|Reject|reject/i.test(String(e)); } };
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const flat = (x) => JSON.stringify(x, big);
const uid = () => crypto.randomUUID();
const keysOf = (x, out = new Set()) => { if (Array.isArray(x)) x.forEach((y) => keysOf(y, out)); else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { out.add(k); keysOf(v, out); } return out; };
const MONEY = /cents|price|cost|margin|amount|euro|total|agreed/i;
const noMoney = (x) => ![...keysOf(x)].some((k) => MONEY.test(k));

const [admin, wl, calc, arch, oa2, klant, vc] = await Promise.all(["proef-admin", "proef-werfleider", "proef-calculator", "proef-architect", "proef-oa2", "proef-klant", "proef-vc"].map((n) => backend(n, cid)));
const anon = await backend(null, cid);
const vreemd = await freshBackend(cid);
const me = await admin.me();
check("versie 2.11 of later op de canister", /^2\.1[1-9]|^[3-9]\./.test(me.version) || /dev/.test(me.version), me.version);
const cDay = BigInt(Math.floor(Number((await admin.auditLog(0n, 1n))[0].at / 1_000_000n) / 86_400_000));
const set0 = await admin.oaInvoiceSettings();
ok(await admin.saveOaInvoiceSettings({ thresholdBp: 200n, thresholdCents: 1_000n, oaView: false, disputeNotice: "melding" }));

// ── Opzet: werf, opmeting, regie-uren ──
const S = await proefVordering({ admin, calc, wl }, { prefix: "P-OF", titleSuffix: " OA-facturen 2.11" });
const { W, wid, L, dak, regieTask } = S;
const KM = uid();
const msync = (op) => wl.measureSync([{ opId: uid(), clientKey: KM, op }]);
await msync({ open: { workId: wid } });
await msync({ entry: { lineId: L.afbraak, qtyMilli: 42_000n, day: cDay, complete: true, note: "proef", files: [], corrects: [], reason: "" } });
await msync({ close: { note: "proef 2.11" } });
const oaPerson = (await oa2.me()).person[0].id;
ok(await admin.addMembership(wid, [oaPerson], [], { onderaannemer: null }, [{ confirmHours: null }, { confirmPlanning: null }]));
const KR = uid();
const rsync = (op) => wl.reportSync([{ opId: uid(), clientKey: KR, op }]);
await rsync({ ensure: { workId: wid, day: cDay } });
const [a1] = await rsync({ attendance: { orgId: [dak.id], personId: [], names: "Proefploeg 2.11", headcount: 2n, slots: [{ fromMin: 450n, toMin: 720n }, { fromMin: 750n, toMin: 960n }], regie: true, taskId: opt(regieTask.id), note: "", replaces: [] } });
const [a2] = await rsync({ attendance: { orgId: [dak.id], personId: [], names: "Proef betwist 2.11", headcount: 1n, slots: [{ fromMin: 480n, toMin: 720n }], regie: true, taskId: [regieTask.id], note: "", replaces: [] } });
await rsync({ finalize: null });
ok(await oa2.confirmHours(a1.outcome.done.entityId[0], true, ""));
ok(await oa2.confirmHours(a2.outcome.done.entityId[0], false, "proef: niet aanwezig"));
check("opzet: proefwerf, opmeting 42 m², 16 u regie bevestigd en 4 u betwist door Proef Dak NV", !!regieTask, W);

// De inhoudingsplicht vraagt een KBO-nummer: de proeffirma krijgt een verzonnen nummer als ze er nog geen heeft (lokaal).
if (!dak.kbo.length) ok(await admin.updateOrg(dak.id, { kind: dak.kind, name: dak.name, kbo: ["0999111222"], vat: dak.vat, aliases: dak.aliases, trades: dak.trades, address: dak.address, notes: dak.notes }));
const posts = await calc.oaInvoicePosts(wid);
const R = (t) => posts.find((p) => p.title.startsWith(t)).root;
const fakeBlob = (c) => new TextEncoder().encode("!caf!sha256:" + c.repeat(64));
const fileConf = ok(await calc.addFile("proef-factuur.pdf", "application/pdf", 50_000n, fakeBlob("f"), [wid], true));
const fileOpen = ok(await calc.addFile("proef-open.pdf", "application/pdf", 50_000n, fakeBlob("e"), [wid], false));
const ST = Date.now().toString(36).toUpperCase();
const line = (kind, root, description, qty, unit, amount = null) => ({ kind: { [kind]: null }, root: opt(root), description, qtyMilli: qty, unitCents: unit, amountCents: amount ?? (qty * unit + (qty * unit >= 0n ? 500n : -500n)) / 1000n });
const inv = (o) => ({ id: [], orgId: dak.id, workId: wid, number: `PF-${ST}-${o.n}`, invoiceDay: cDay, dueDay: [cDay + 30n], periodFrom: [], periodTo: [], vatRegime: { reverse: null }, reverseMention: true, fileId: [fileConf], note: "proef", netCents: 0n, vatCents: 0n, totalCents: 0n, lines: [], ...o.x });
const withTotals = (x) => { const net = x.lines.reduce((a, l) => a + l.amountCents, 0n); return { ...x, netCents: x.netCents || net, totalCents: x.totalCents || net + x.vatCents }; };

// ── (1) Rechten ──
for (const [n, x] of [["architect", arch], ["onderaannemer", oa2], ["klant", klant], ["veiligheidscoördinator", vc], ["anoniem", anon], ["onbekende login", vreemd]]) {
  const rs = await Promise.all([x.listOaInvoices([], []), x.oaInvoicePosts(wid), x.oaInvoiceQty(1n), x.readOaInvoice(1n), x.saveOaInvoice(inv({ n: "X" }), 0n), x.approveOaInvoice(1n, 0n, { exception: "x".repeat(20) }, "x"), x.disputeOaInvoice(1n, 0n, "proef")].map(denied));
  check(`(1) ${n}: lijst, posten, lezen, registreren, goedkeuren en betwisten geweigerd`, rs.every(Boolean), rs.map((r) => (r ? "·" : "✗")).join(""));
}
check("(1) de werfleider registreert niet en leest de posten van het formulier niet", (await denied(wl.saveOaInvoice(inv({ n: "WL" }), 0n))) && (await denied(wl.oaInvoicePosts(wid))));

// ── (2) Registreren en weigeren wat niet klopt ──
const F1in = withTotals(inv({ n: "1", x: { lines: [line("regie", R("Proef regie"), "regie 16 u", 16_000n, 4000n), line("post", R("Proef afbraak"), "afbraak", 42_000n, 2500n)] } }));
const f1 = await calc.saveOaInvoice(F1in, 0n);
check("(2) factuur 1 geregistreerd (regie 16 u × 40,00, afbraak 42 m² × 25,00, btw verlegd, bijlage)", isOk(f1), errOf(f1));
const F1 = f1.ok;
check("(2) dezelfde firma en hetzelfde nummer nog eens: geweigerd", /al geregistreerd/.test(errOf(await calc.saveOaInvoice(F1in, 0n))));
check("(2) een post die niet in de offerte staat: geweigerd", /niet in de getekende offerte/.test(errOf(await calc.saveOaInvoice(withTotals(inv({ n: "B1", x: { lines: [line("post", 999_999n, "x", 1n, 1n)] } })), 0n))));
check("(2) een regieregel op een post die geen regie is: geweigerd", /regiepost/.test(errOf(await calc.saveOaInvoice(withTotals(inv({ n: "B2", x: { lines: [line("regie", R("Proef afbraak"), "x", 1_000n, 1n)] } })), 0n))));
check("(2) een bijlage die geen vertrouwelijk bestand van de werf is: geweigerd", /vertrouwelijk bestand/.test(errOf(await calc.saveOaInvoice(withTotals(inv({ n: "B3", x: { fileId: [fileOpen], lines: [] } })), 0n))));
const familie = (await admin.listOrgs(false)).find((o) => o.name === "Familie Proef");
check("(2) een klant als firma: geweigerd", /onderaannemer of leverancier/.test(errOf(await calc.saveOaInvoice({ ...inv({ n: "B4" }), orgId: familie.id }, 0n))));
check("(2) een factuurdatum in de toekomst: geweigerd", /Factuurdatum/.test(errOf(await calc.saveOaInvoice({ ...inv({ n: "B5" }), invoiceDay: cDay + 10n }, 0n))));

let v1 = ok(await calc.readOaInvoice(F1));
const lr = (v, t) => v.lines.find((l) => l.q.description === t);
check("(2) regie: 16 u gefactureerd = 16 u bevestigd in de werfverslagen (uit de werfverslagen), uurloon = afgesproken 40,00; wel 'uren betwist' (4 u)", lr(v1, "regie 16 u").q.expectedQtyMilli[0] === 16_000n && lr(v1, "regie 16 u").q.expectedFrom === "regie-uren" && lr(v1, "regie 16 u").m.agreedCents[0] === 4000n && lr(v1, "regie 16 u").q.hours[0].disputedMilli === 4_000n && lr(v1, "regie 16 u").q.flags.includes("uren-betwist") && lr(v1, "regie 16 u").m.flags.length === 0, flat(lr(v1, "regie 16 u")));
check("(2) afbraak: 42 m² = de opmeting, prijs = afgesproken met deze OA: geen markering", lr(v1, "afbraak").q.expectedFrom === "opmeting" && lr(v1, "afbraak").q.expectedQtyMilli[0] === 42_000n && lr(v1, "afbraak").q.flags.length === 0 && lr(v1, "afbraak").m.flags.length === 0 && lr(v1, "afbraak").m.agreedOrg, flat(lr(v1, "afbraak")));
check("(2) koptekst: geen markering (som = excl. btw, verlegd met vermelding, bijlage, OA op de werf); 1 markering in totaal", v1.headerFlags.length === 0 && v1.flagCount === 1n && v1.oaOnWork && v1.sumLinesCents === v1.netCents && v1.netCents === 169_000n, flat(v1.headerFlags));
check("(2) Peppol voorzien: bron 'hand', geen extern nummer", v1.brief.source === "hand" && v1.externalRef === "");

// Een afwijkende factuur
const F2in = { ...inv({ n: "2" }), vatRegime: { normal: 2100n }, reverseMention: false, fileId: [], lines: [line("post", R("Proef container"), "container", 2_000n, 33_000n), line("post", R("Proef afbraak"), "afbraak extra", 5_000n, 2500n), line("regie", R("Proef regie"), "regie 4 u", 4_000n, 4000n), line("other", null, "Proef verplaatsing", 1_000n, 5000n), line("post", R("Proef metselwerk"), "metselwerk", 1_000n, 100_000n, 90_000n)] };
const net2 = F2in.lines.reduce((a, l) => a + l.amountCents, 0n) + 100n; // 1 euro naast de som
const f2 = await calc.saveOaInvoice({ ...F2in, netCents: net2, vatCents: 1n, totalCents: net2 + 2n }, 0n);
check("(2) factuur 2 (afwijkend) geregistreerd", isOk(f2), errOf(f2));
const F2 = f2.ok;
const v2 = ok(await calc.readOaInvoice(F2));
const hk = v2.headerFlags.map((f) => f.key);
check("(2) koptekst: som ≠ excl. btw, excl. + btw ≠ totaal, btw-bedrag fout, normaal tarief bij een OA (verlegging?), geen bijlage", ["som-regels", "totaal", "btw-bedrag", "btw-normaal-bij-oa", "geen-bijlage"].every((k) => hk.includes(k)), hk.join(","));
check("(2) container: 330,00 i.p.v. 320,00 (+3,1 % > 2 %, € 20 > € 10) = prijs hoger", lr(v2, "container").m.flags.includes("prijs-hoger") && lr(v2, "container").q.expectedFrom === "vh", flat(lr(v2, "container").m.flags));
check("(2) afbraak: 42 al gefactureerd + 5 > 42 gemeten = meer dan opgemeten; 'al gefactureerd' toont 42 m² en 1.050,00", lr(v2, "afbraak extra").q.flags.includes("meer-dan-gemeten") && lr(v2, "afbraak extra").q.prevQtyMilli === 42_000n && lr(v2, "afbraak extra").m.prevCents === 105_000n);
check("(2) regie: 16 al gefactureerd + 4 > 16 bevestigd = meer uren dan gepresteerd", lr(v2, "regie 4 u").q.flags.includes("meer-dan-uren"));
check("(2) andere kost: niet gekoppeld; metselwerk: bedrag ≠ hoeveelheid × prijs en geen afspraak met deze OA", lr(v2, "Proef verplaatsing").q.flags.includes("niet-gekoppeld") && lr(v2, "metselwerk").m.flags.includes("rekenfout") && lr(v2, "metselwerk").m.flags.includes("afspraak-andere-oa"), flat([lr(v2, "metselwerk").m.flags]));
check("(2) de factuur toont de andere facturen van deze OA op deze werf", v2.previous.some((p) => p.id === F1 && p.netCents === 169_000n));
// Drempel hoger: de prijsafwijking valt weg
ok(await admin.saveOaInvoiceSettings({ thresholdBp: 500n, thresholdCents: 1_000n, oaView: false, disputeNotice: "melding" }));
check("(2) drempel 5 %: de container (+3,1 %) is geen afwijking meer", !lr(ok(await calc.readOaInvoice(F2)), "container").m.flags.includes("prijs-hoger"));
ok(await admin.saveOaInvoiceSettings({ thresholdBp: 200n, thresholdCents: 1_000n, oaView: false, disputeNotice: "melding" }));

// ── (1) De werfleider: hoeveelheden en uren, nooit een bedrag ──
const q2 = await wl.oaInvoiceQty(F2);
check("(1) werfleider: de lijst en de regels met hoeveelheden, uren en markeringen", (await wl.listOaInvoices([wid], [])).some((b) => b.id === F2) && q2.lines.length === 5 && q2.lines.find((l) => l.description === "afbraak extra").flags.includes("meer-dan-gemeten") && q2.lines.find((l) => l.description === "regie 4 u").hours.length === 1);
check("(1) werfleider: GEEN bedrag, prijs of afspraak in zijn antwoorden (sleutels), geen prijsmarkering", noMoney(q2) && noMoney(await wl.listOaInvoices([wid], [])) && !flat(q2).includes("prijs-hoger") && !flat(q2).includes("rekenfout"), [...keysOf(q2)].filter((k) => MONEY.test(k)).join(","));
check("(1) werfleider: lezen met bedragen, goedkeuren en betwisten geweigerd", (await denied(wl.readOaInvoice(F2))) && (await denied(wl.approveOaInvoice(F2, 0n, { exception: "x".repeat(20) }, "x"))) && (await denied(wl.disputeOaInvoice(F2, 0n, "proef"))));

// ── (3) Inhoudingsplicht verplicht bij goedkeuring ──
// recordWithholdingCheck geeft de stand van de firma terug (de raadpleging met de jongste datum); de id van DEZE raadpleging komt
// uit de historiek (unieke referentie per run).
const rec = async (org, result, day, ref) => {
  ok(await calc.recordWithholdingCheck(org, { result: { [result]: null }, consultedOn: day, reference: ref, note: "proef 2.11", workId: [wid] }));
  const h = (await calc.withholdingHistory(org)).filter((c) => c.reference === ref && c.consultedOn === day);
  return h.reduce((a, c) => (c.id > a ? c.id : a), 0n);
};
v1 = ok(await calc.readOaInvoice(F1));
check("(3) zonder raadpleging van vandaag: geen bewijs", v1.todayCheck.length === 0 || v1.todayCheck[0].orgId === dak.id);
const yId = await rec(dak.id, "clear", cDay - 1n, `PROEF-GISTER-${ST}`);
check("(3) een raadpleging van gisteren: geweigerd", /dag van goedkeuring/.test(errOf(await calc.approveOaInvoice(F1, v1.brief.rev, { check: yId }, "proef: uren betwist apart"))));
const norefId = await rec(dak.id, "clear", cDay, "");
check("(3) een raadpleging van vandaag zonder referentie: geweigerd", /referentie/.test(errOf(await calc.approveOaInvoice(F1, v1.brief.rev, { check: norefId }, "proef: uren betwist apart"))));
const unkId = await rec(dak.id, "unknown", cDay, `PROEF-ONB-${ST}`);
check("(3) resultaat onbekend: geweigerd", /onbekend/.test(errOf(await calc.approveOaInvoice(F1, v1.brief.rev, { check: unkId }, "proef: uren betwist apart"))));
const elek = (await admin.listOrgs(false)).find((o) => o.name === "Proef Elektro BV");
const otherId = elek?.kbo?.length ? await rec(elek.id, "clear", cDay, `PROEF-ANDER-${ST}`) : null;
if (otherId) check("(3) een raadpleging van een andere firma: geweigerd", /andere firma/.test(errOf(await calc.approveOaInvoice(F1, v1.brief.rev, { check: otherId }, "proef"))));
check("(3) een uitzondering met te weinig motivering: geweigerd", /motiveer/.test(errOf(await calc.approveOaInvoice(F1, v1.brief.rev, { exception: "kort" }, "proef: uren betwist apart"))));
const gId = await rec(dak.id, "clear", cDay, "PROEF-211-OK");
v1 = ok(await calc.readOaInvoice(F1));
check("(3) de factuur toont de raadpleging van vandaag", v1.todayCheck[0]?.id === gId && v1.todayCheck[0].reference === "PROEF-211-OK");
check("(4) goedkeuren met een markering zonder reden: geweigerd", /markering/.test(errOf(await calc.approveOaInvoice(F1, v1.brief.rev, { check: gId }, ""))));
check("(4) de werfleider keurt niet goed", await denied(wl.approveOaInvoice(F1, v1.brief.rev, { check: gId }, "proef")));
const ap = await calc.approveOaInvoice(F1, v1.brief.rev, { check: gId }, "proef: 4 betwiste uren niet gefactureerd");
v1 = ok(await calc.readOaInvoice(F1));
// Factuur 2 is intussen geregistreerd en telt als "al gefactureerd": bij factuur 1 nu ook meer dan gemeten en meer uren (3 markeringen).
check("(3)(4) goedgekeurd met de raadpleging van vandaag (resultaat en referentie in de beslissing); de markeringen van dat moment (3, ook factuur 2 telt als al gefactureerd) staan erbij", isOk(ap) && "approved" in v1.brief.status && "check" in v1.decision[0].withholding[0] && v1.decision[0].withholding[0].check.reference === "PROEF-211-OK" && v1.decision[0].flags === 3n, errOf(ap) || flat(v1.decision));
check("(4) een goedgekeurde factuur: verbeteren, nog eens goedkeuren, betwisten en intrekken geweigerd", /Enkel een geregistreerde/.test(errOf(await calc.saveOaInvoice({ ...F1in, id: [F1] }, v1.brief.rev))) && /goedgekeurd/.test(errOf(await calc.approveOaInvoice(F1, v1.brief.rev, { check: gId }, "x"))) && /Enkel een geregistreerde/.test(errOf(await calc.disputeOaInvoice(F1, v1.brief.rev, "proef nog eens"))) && /goedgekeurd/.test(errOf(await calc.withdrawOaInvoice(F1, v1.brief.rev, "proef weg"))));
// Een uitzondering en een rode raadpleging
const f3 = ok(await calc.saveOaInvoice(withTotals(inv({ n: "3", x: { lines: [line("post", R("Proef container"), "container deel", 1_000n, 32_000n)] } })), 0n));
const v3 = ok(await calc.readOaInvoice(f3));
const ap3 = await calc.approveOaInvoice(f3, v3.brief.rev, { exception: "Proef: zelfde dag al nagekeken voor factuur 1 (zie PROEF-211-OK)" }, "proef: factuur 2 wordt betwist");
check("(3) goedgekeurd met een gemotiveerde uitzondering (staat in de beslissing)", isOk(ap3) && "exception" in ok(await calc.readOaInvoice(f3)).decision[0].withholding[0], errOf(ap3));
const redId = await rec(dak.id, "social", cDay, `PROEF-211-ROOD-${ST}`);
const f4 = ok(await calc.saveOaInvoice(withTotals(inv({ n: "4", x: { lines: [line("post", R("Proef container"), "container rest", 1_000n, 32_000n)] } })), 0n));
const v4 = ok(await calc.readOaInvoice(f4));
check("(3) rood (sociale schulden): de factuur toont de in te houden 35 % sociaal (112,00 op 320,00)", v4.todayCheck[0].id === redId && v4.withholdSocialCents === 11_200n && v4.withholdFiscalCents === 0n, `${v4.withholdSocialCents}`);
check("(3) goedgekeurd met een rode raadpleging: de beheerders krijgen een melding om in te houden", isOk(await calc.approveOaInvoice(f4, v4.brief.rev, { check: redId }, "proef: factuur 2 wordt betwist")) && (await admin.myNotifications(true)).some((n) => n.kind === "inhoudingsplicht" && n.text.includes(`PF-${ST}-4`)));

// ── (4)(5) Betwisten, intrekken, de OA ──
const v2b = ok(await calc.readOaInvoice(F2));
check("(4) betwisten zonder reden: geweigerd", /Geef een reden/.test(errOf(await calc.disputeOaInvoice(F2, v2b.brief.rev, ""))));
check("(4) betwist met reden; de OA krijgt een melding (instelling 'melding')", isOk(await calc.disputeOaInvoice(F2, v2b.brief.rev, "proef: container duurder dan afgesproken")) && (await oa2.myNotifications(true)).some((n) => n.kind === "oa-factuur" && n.text.includes(`PF-${ST}-2`) && n.text.includes("container duurder")));
check("(5) OA: zijn facturen zien staat uit (standaard): geweigerd; caps.myOaInvoices nee", (await denied(oa2.myOaInvoices())) && !(await oa2.me()).caps[0].myOaInvoices);
ok(await admin.saveOaInvoiceSettings({ thresholdBp: 200n, thresholdCents: 1_000n, oaView: true, disputeNotice: "app" }));
const mine = await oa2.myOaInvoices();
const m2 = mine.find((x) => x.number === `PF-${ST}-2`);
check("(5) OA (schakelaar aan): enkel de status van zijn eigen facturen, met de reden van de betwisting; geen bedrag", (await oa2.me()).caps[0].myOaInvoices && !!m2 && "disputed" in m2.status && m2.reason.includes("container duurder") && mine.some((x) => x.number === `PF-${ST}-1` && "approved" in x.status) && noMoney(mine), flat(m2));
ok(await admin.saveOaInvoiceSettings({ thresholdBp: 200n, thresholdCents: 1_000n, oaView: true, disputeNotice: "uit" }));
check("(5) betwisting naar de OA 'uit': de reden staat niet bij hem", (await oa2.myOaInvoices()).find((x) => x.number === `PF-${ST}-2`).reason === "");
check("(5) andere externen zien geen facturen, ook met de schakelaar aan", (await Promise.all([arch, klant, vc].map((x) => denied(x.myOaInvoices())))).every(Boolean));
const v2c = ok(await calc.readOaInvoice(F2));
check("(4) een betwiste factuur intrekken (reden); daarna kan het nummer opnieuw geregistreerd worden", isOk(await calc.withdrawOaInvoice(F2, v2c.brief.rev, "proef: vervangen door een nieuwe factuur")) && isOk(await calc.saveOaInvoice(withTotals(inv({ n: "2", x: { lines: [line("post", R("Proef container"), "container nieuw", 1_000n, 32_000n)] } })), 0n)));
check("(4) een ingetrokken factuur telt niet meer als 'al gefactureerd'", ok(await calc.readOaInvoice(F1)).previous.find((p) => p.id === F2)?.status && !("registered" in ok(await calc.readOaInvoice(F1)).previous.find((p) => p.id === F2).status));

// ── (6) Auditlog, export, .did ──
const log = await admin.auditLog(0n, 400n);
const minL = log.filter((e) => e.workId.length && e.workId[0] === wid);
check("(6) auditlog: geregistreerd, bekeek, goedgekeurd met de inhoudingsplicht, betwist, ingetrokken", ["oa-factuur-geregistreerd", "bekeek:oa-factuur", "oa-factuur-goedgekeurd", "oa-factuur-betwist", "oa-factuur-ingetrokken"].every((a) => minL.some((e) => e.action === a)) && minL.some((e) => e.action === "oa-factuur-goedgekeurd" && /PROEF-211-OK/.test(e.detail)), [...new Set(minL.map((e) => e.action))].join(","));
check("(6) de auditlog noemt geen bedragen", !minL.filter((e) => e.action.startsWith("oa-factuur")).some((e) => /169000|1690|1\.690|33000|330,00/.test(e.detail)));
const ex = await admin.exportChunk("oaInvoices", 0n, 500n);
const exA = await admin.exportChunk("oaInvoiceAmounts", 0n, 500n);
check("(6) export: de facturen (intern, zonder bedrag) en de bedragen (vertrouwelijk) voor de beheerder; de calculator exporteert niet", isOk(ex) && ex.ok.oaInvoices.some((x) => x.id === F1) && noMoney(ex.ok.oaInvoices) && isOk(exA) && exA.ok.oaInvoiceAmounts.some(([k]) => k === F1) && (await denied(calc.exportChunk("oaInvoiceAmounts", 0n, 10n))));
let didFile = null;
try { didFile = readFileSync(join(import.meta.dirname, "../src/backend/dist/backend.did"), "utf8"); } catch { /* geen bouw */ }
if (didFile) {
  const rec = (name) => { const i = didFile.search(new RegExp(`type ${name} =\\s*record \\{`)); if (i < 0) return ""; let k = didFile.indexOf("{", i); let d = 0; const s0 = k; for (; k < didFile.length; k++) { if (didFile[k] === "{") d++; else if (didFile[k] === "}" && --d === 0) break; } return didFile.slice(s0 + 1, k); };
  const hit = ["OaLineQty", "OaInvoiceQtyView", "OaInvoiceBrief", "OaInvoice", "MyOaInvoice", "OaHoursView"].filter((t) => MONEY.test(rec(t)) || rec(t) === "");
  check("(1) .did: de typen voor de werfleider, de OA en het interne record hebben geen bedragveld", hit.length === 0, hit.join(","));
}

// ── Opruimen ──
ok(await admin.saveOaInvoiceSettings(set0));
ok(await admin.setWorkStatus(wid, { cancelled: null }));
console.log(`\n${pass} ✓ ${fail} ✗`);
process.exit(fail ? 1 : 0);
