// Maandagbriefing (stap 4.4) op een canister die al in gebruik is (het eigen net, na tests/rollen.mjs). Bewijst:
//   (1) rechten: enkel de beheerder leest readBriefing; calculator, werfleider, architect, OA, klant, veiligheidscoördinator en anoniem
//       krijgen niets; de briefing is enkel lezen: niets in de canister verandert (aantal auditregels, facturen, offertes);
//   (2) inhoud: zes onderdelen in vaste volgorde, zonder één bedrag; met verzonnen gegevens staan erin: een taak van deze week, een
//       vergunning met voorbije deadline, een document dat verloopt, een factuur te beslissen, een offerte die op akkoord wacht;
//       een geannuleerde werf valt weg; het dringendste staat bovenaan;
//   (3) de bot-tool maandagbriefing: enkel op de fiche, enkel de werven van de fiche (de werf buiten de fiche staat er niet in),
//       geen bedragen, alleen lezen (readOnlyHint), het logboek bewaart geen inhoud; een bot zonder de tool krijgt "Geen toegang".
// Enkel VERZONNEN gegevens: "Proef … 44", gemeente Lindegem, postcode 9993.
//   node tests/briefing-4-4.mjs <canister-id>
import { backend, freshBackend } from "../tools/lib.mjs";
import { M, saveAll, fromRead } from "./offerte-lib.mjs";
import { connect, FORBIDDEN, tool, rpc } from "./mcp-lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/briefing-4-4.mjs <canister-id>");
const host = process.env.ICP_HOST || "";
if (!host.includes("localhost") && !host.includes("127.0.0.1")) throw new Error("tests/briefing-4-4.mjs enkel op het eigen lokale net");
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const S = (x) => JSON.stringify(x, big);
const ok = (r) => { if (r && typeof r === "object" && "err" in r) throw new Error(r.err); return r && typeof r === "object" && "ok" in r ? r.ok : r; };
const errOf = (r) => (r && typeof r === "object" && "err" in r ? r.err : "");
const denied = async (p) => { try { await p; return false; } catch (e) { return /Geen toegang|trap|Reject|Unauthorized/i.test(String(e)); } };
const keysOf = (x, out = new Set()) => { if (Array.isArray(x)) x.forEach((y) => keysOf(y, out)); else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { out.add(k); keysOf(v, out); } return out; };
const MONEY = /cents|price|cost|margin|amount|euro|agreed|rate/i; // "total" = een aantal punten, geen bedrag
const u = (x) => (Array.isArray(x) ? x[0] : x);
const fakeBlob = (c) => new TextEncoder().encode("!caf!sha256:" + c.repeat(64));
const sfx = Date.now().toString(36).slice(-5).toUpperCase();

const [admin, calc, wl, arch, klant, vc] = await Promise.all(["proef-admin", "proef-calculator", "proef-werfleider", "proef-architect", "proef-klant", "proef-vc"].map((n) => backend(n, cid)));
const anon = await backend(null, cid);
const oaR = await freshBackend(cid);
const botA = await freshBackend(cid);
const botB = await freshBackend(cid);
const cDay = BigInt(Math.floor(Number((await admin.auditLog(0n, 1n))[0].at / 1_000_000n) / 86_400_000));
const wdOf = (d) => (Number(d) + 3) % 7;
const monday = cDay - BigInt(wdOf(cDay));
const nextWd = (d) => { let x = BigInt(d); while (wdOf(x) > 4) x++; return x; };
const s0 = await admin.getSettings();
const setIn = (z) => ({ werfleiderZietAlles: z, inviteDays: s0.inviteDays, threshold30bisCents: s0.threshold30bisCents, thresholdCheckinatworkCents: s0.thresholdCheckinatworkCents });
const ps0 = await admin.purchaseSettings();
ok(await admin.setSettings(setIn(false)));
try {

// ── B0. Opzet: W1 (op de fiche van de bot), W2 (buiten de fiche), W3 (wordt geannuleerd) ──
const addr = { street: "Proefweg", number: "7", zip: "9993", city: "Lindegem", country: "BE" };
const orgOf = async (name, kind) => ok(await admin.createOrg({ kind: { [kind]: null }, name, kbo: [], vat: [], aliases: [], trades: [], address: [addr], notes: "Verzonnen proeffirma (4.4)" })).id;
const KWARTEL = await orgOf(`Proef Bouwstoffen Kwartel 44 ${sfx}`, "supplier");
const KLANTORG = await orgOf(`Proef Klant Vink 44 ${sfx}`, "client");
const WLID = (await wl.me()).person[0].id;
const mkWork = async (code) => ok(await admin.createWork({ code, name: "Proef briefing 44", address: addr, parentId: [], clientOrgId: [KLANTORG], architectOrgId: [], leaderPersonId: [WLID], vatBp: 2100n, plannedStart: [], plannedEnd: [], estimatedAmountCents: [] })).id;
const W1 = await mkWork(`P-BR1${sfx}`);
const W2 = await mkWork(`P-BR2${sfx}`);
const W3 = await mkWork(`P-BR3${sfx}`);
const CODE1 = `P-BR1${sfx}`;
const CODE2 = `P-BR2${sfx}`;
const CODE3 = `P-BR3${sfx}`;
// W1: een taak die deze week loopt, een vergunning met voorbije deadline, een document dat over 5 dagen verloopt, een factuur te beslissen.
const plan1 = await admin.getPlan(W1);
ok(await admin.saveTask(W1, { id: [], title: "Proef metselen 44", note: "", kind: { work: null }, trade: [], responsibleOrgId: [], status: { planned: null }, percent: 0n, start: monday, workdays: 3n, leadDays: 0n, orderDay: [], reason: "proef 4.4" }, plan1.version));
ok(await admin.savePermit(W1, { id: [], kind: "container", title: "Proef container 44", municipalityId: [], status: { needed: null }, location: "voor de deur", taskIds: [], neededFrom: [cDay + 2n], neededTo: [cDay + 9n], leadDays: [30n], requestedOn: [], validFrom: [], validTo: [], reference: "", costCents: [], note: "" }));
ok(await admin.saveDocument(W1, { id: [], kind: "keuring-elektriciteit", title: "Proef keuring 44", dueDay: [], validUntil: [cDay + 5n], note: "", ownerOrgId: [] }));
ok(await admin.saveDocument(W1, { id: [], kind: "contract", title: "Proef contract 44", dueDay: [], validUntil: [cDay + 4n], note: "", ownerOrgId: [] }));
const fileW = ok(await calc.addFile("proef-briefing-44.pdf", "application/pdf", 40_000n, fakeBlob("a"), [W1], true));
const net = 10_000n;
const PU = ok(await calc.savePurchase({ id: [], orgId: KWARTEL, kind: { supplier: null }, number: `PB-${sfx}-1`, invoiceDay: cDay, dueDay: [cDay + 30n], discountUntil: [], discountBp: [], periodFrom: [], periodTo: [], vatRegime: { normal: 2100n }, reverseMention: false, fileId: [fileW], oaStatementFileId: [], oaStatementRef: "", note: "proef 4.4", netCents: net, vatCents: 2100n, totalCents: net + 2100n, lines: [{ workId: [W1], kind: "materiaal", root: [], description: "Proef materiaal 44", persons: [], qtyMilli: 1000n, unit: "st", unitCents: net, amountCents: net, passOn: false, days: [], lineId: [] }], finalWorkIds: [], creditOf: [] }, 0n));
// W2: een offerte die verzonden is en op het akkoord van de klant wacht.
const q2 = ok(await calc.createQuote({ workId: W2, number: "", title: "Proef offerte 44" }));
{
  const m = fromRead(ok(await calc.readQuoteVersion(q2.versionId)));
  const c1 = M.addChapter(m, { code: "01", title: "Proef ruwbouw 44" });
  M.addLine(m, c1.key, { title: "Proef muur 44", qtyMilli: 10_000n, unit: "st", form: "fixed", price: { cost: 1000n, rule: null, reason: "", orgId: null, source: "eigen", libCostId: null } });
  ok(await saveAll(calc, m));
  const r = ok(await calc.readQuoteVersion(q2.versionId));
  ok(await calc.sendQuoteVersion(q2.versionId, r.version.rev, r.totals.totalCents, "proef 4.4: waarschuwingen doorgezet"));
}
// W3: een document dat verloopt, daarna de werf annuleren.
ok(await admin.saveDocument(W3, { id: [], kind: "keuring-elektriciteit", title: "Proef keuring W3 44", dueDay: [], validUntil: [cDay + 3n], note: "", ownerOrgId: [] }));
check("(B0) opzet: drie werven, taak, vergunning, document, factuur, verzonden offerte", typeof W1 === "bigint" && typeof PU === "bigint" && typeof q2.versionId === "bigint");

// ── B1. Rechten ──
for (const [n, x] of [["calculator", calc], ["werfleider", wl], ["architect", arch], ["OA", oaR], ["klant", klant], ["veiligheidscoördinator", vc], ["anoniem", anon]]) {
  check(`(B1) ${n}: de briefing is geweigerd`, await denied(x.readBriefing()));
}
const aBefore = (await admin.auditLog(0n, 1000n)).length;
const pBefore = (await admin.listPurchases([], [])).length;
const qBefore = (await admin.listQuotes([], false)).length;
const v = await admin.readBriefing();
check("(B1) de beheerder leest de briefing", Array.isArray(v.sections));
check("(B1) enkel lezen: geen nieuwe auditregels, facturen of offertes", (await admin.auditLog(0n, 1000n)).length === aBefore && (await admin.listPurchases([], [])).length === pBefore && (await admin.listQuotes([], false)).length === qBefore);

// ── B2. Inhoud ──
const sec = (k) => v.sections.find((s) => s.key === k);
check("(B2) zes onderdelen in vaste volgorde", S(v.sections.map((s) => s.key)) === S(["week", "attention", "proposals", "expiring", "invoices", "clients"]), S(v.sections.map((s) => s.key)));
check("(B2) geen enkel bedrag of kostprijs in de briefing (veldnamen en tekst)", ![...keysOf(v)].some((k) => MONEY.test(k)) && !/€|EUR|10\.000|100,00/.test(S(v)), S([...keysOf(v)]));
check("(B2) de weekgrenzen kloppen (maandag t.e.m. zondag van vandaag)", v.monday === monday && v.sunday === monday + 6n && v.day === cDay, S([v.monday, v.sunday, v.day]));
const wk = sec("week").items.find((i) => i.workCode === CODE1);
check("(B2) planning van de week: de taak van W1 staat erin met de titel", !!wk && /Proef metselen 44/.test(wk.detail) && u(wk.day) === monday, S(wk));
const exp = sec("expiring").items;
const permit = exp.find((i) => i.workCode === CODE1 && /Vergunning/.test(i.title));
const doc = exp.find((i) => i.workCode === CODE1 && /Proef keuring 44/.test(i.title));
check("(B2) vervallend: de vergunning met voorbije deadline (negatieve dagen) en het document dat over 5 dagen verloopt", !!permit && u(permit.days) < 0n && !!doc && u(doc.day) === cDay + 5n && u(doc.days) === 5n, S([permit, doc]));
check("(B2) vervallend: het dringendste bovenaan (negatieve dagen vóór 5 dagen)", exp.findIndex((i) => i === permit || (i.workCode === CODE1 && /Vergunning/.test(i.title))) < exp.findIndex((i) => i.workCode === CODE1 && /Proef keuring 44/.test(i.title)));
const inv = sec("invoices").items.find((i) => i.workCode === CODE1);
check("(B2) facturen te beslissen: de factuur van de leverancier op W1, met firma, zonder bedrag", !!inv && inv.title.includes(`PB-${sfx}-1`) && inv.detail.includes("Kwartel 44") && u(inv.days) === 0n, S(inv));
const cl = sec("clients").items.find((i) => i.workCode === CODE2);
check("(B2) klantakkoorden: de verzonden offerte van W2 wacht (0 dagen)", !!cl && /wacht op akkoord/.test(cl.title) && u(cl.days) === 0n, S(cl));
check("(B2) het totaal telt alles, de punten hoogstens 15", v.sections.every((s) => s.total >= s.items.length && s.items.length <= 15));
const w3 = exp.find((i) => i.workCode === CODE3);
check("(B2) W3 (nog actief) staat erin; na het annuleren niet meer", !!w3);
ok(await admin.setWorkStatus(W3, { cancelled: null }));
const v2 = await admin.readBriefing();
check("(B2) een geannuleerde werf valt weg uit alle onderdelen", !v2.sections.some((s) => s.items.some((i) => i.workCode === CODE3)));

// ── B3. De bot-tool ──
const ficheIn = (o = {}) => ({ id: [], rev: 0n, name: `Proef bot 44 ${sfx}`, vendor: "Anthropic", model: "Claude (label)", tools: ["mijn_fiche", "maandagbriefing"], allWorks: false, works: [W1], docKinds: ["keuring-elektriciteit"], callsPerDay: 200n, tasks: [], instruction: [], ...o });
ok(await admin._caffeineMcpSetSignInOrigin("https://proef-4-4.example"));
const idA = ok(await admin.saveBot(ficheIn()));
const idB = ok(await admin.saveBot(ficheIn({ name: `Proef bot zonder tool 44 ${sfx}`, tools: ["mijn_fiche", "werven"] })));
const codeA = ok(await admin.newBotCode(idA));
const codeB = ok(await admin.newBotCode(idB));
ok(await botA.claimBotCode(codeA.code));
ok(await botB.claimBotCode(codeB.code));
const conA = await connect(anon, botA, cid, "Proef Claude 44 A");
const conB = await connect(anon, botB, cid, "Proef Claude 44 B");
check("(B3) twee bots gekoppeld", !!conA.access && !!conB.access, S([conA.err, conB.err]));
const info = await admin.mcpInfo();
check("(B3) mcpInfo: de tool maandagbriefing bestaat, zonder taak (enkel lezen)", info.tools.some((t) => t.name === "maandagbriefing" && t.task === "" && t.readOnly));
const tl = (await rpc(anon, cid, conA.access, "tools/list")).json?.result?.tools ?? [];
const tb = tl.find((t) => t.name === "maandagbriefing");
check("(B3) tools/list van bot A: maandagbriefing met readOnlyHint, zonder invoer", !!tb && tb.annotations?.readOnlyHint === true && Object.keys(tb.inputSchema?.properties ?? {}).length === 0, S(tb));
const tlB = (await rpc(anon, cid, conB.access, "tools/list")).json?.result?.tools ?? [];
check("(B3) bot B (tool niet op de fiche): de tool staat niet in tools/list", !tlB.some((t) => t.name === "maandagbriefing"));
const noB = await tool(anon, cid, conB.access, "maandagbriefing");
check("(B3) bot B roept ze toch aan: geweigerd", noB.isError && /Geen toegang|Unknown|Onbekende/i.test(noB.text), noB.text.slice(0, 150));
const bt = await tool(anon, cid, conA.access, "maandagbriefing");
const d = bt.data;
check("(B3) bot A krijgt de briefing: zes onderdelen", !bt.isError && d?.onderdelen?.length === 6, bt.text.slice(0, 200));
const text = bt.text;
check("(B3) enkel de werf van de fiche: W1 erin, W2 en W3 niet (ook niet de offerte van W2)", text.includes(CODE1) && !text.includes(CODE2) && !text.includes(CODE3) && !/wacht op akkoord/.test(text));
check("(B2b) de beheerder ziet het vertrouwelijke document wel; de bot niet (enkel niet-vertrouwelijke soorten op de fiche), het gewone document wel", S(v).includes("Proef contract 44") && !text.includes("Proef contract 44") && text.includes("Proef keuring 44"));
check("(B3) geen bedragen, prijzen, URL's of vertrouwelijke woorden", !FORBIDDEN.test(text) && !/€/.test(text), (text.match(FORBIDDEN) ?? [""])[0]);
check("(B3) de briefing van de bot = die van de beheerder voor W1 (dezelfde punten)", d.onderdelen.find((o) => o.onderdeel === "Planning van de week")?.punten.some((p) => p.werf === CODE1) && d.onderdelen.find((o) => o.onderdeel.startsWith("Facturen"))?.punten.some((p) => p.werf === CODE1));
const log = await admin.botLog(0n, 200n);
const mine = log.filter((c) => c.tool === "maandagbriefing");
check("(B3) logboek: de oproepen (ok en geweigerd) zonder inhoud (enkel een hash van de argumenten)", mine.some((c) => "ok" in c.outcome) && mine.every((c) => /^[0-9a-f]{64}$/.test(c.argsSha256)) && !S(mine).includes(CODE1) && !S(mine).includes("Proef metselen"), S(mine.slice(0, 2)));

} catch (e) {
  check("geen onverwachte fout", false, String(e?.stack ?? e).slice(0, 500));
} finally {
  ok(await admin.setSettings(setIn(s0.werfleiderZietAlles)));
  ok(await admin.savePurchaseSettings(ps0));
}
console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
