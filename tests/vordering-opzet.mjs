// Een verse proefwerf voor de vorderingsstaten (stap 2.10), voor de proef in Chrome of op het eigen net: een aanvaarde proefofferte
// (VH, vaste prijs, minwerk, regie), de werfstart, een proefcontract (inhouding 5 %, prijsherziening, 30 dagen) met rekenmodel,
// een afgesloten opmeting (afbraak 42 m² van 40) en een afgesloten werfverslag met 16 u regie (bevestigd door de OA) en 4 u
// betwist. De proefklant en de OA zijn lid van de werf. Nog GEEN vorderingsstaat: die maakt wie test. Enkel verzonnen gegevens.
//   node tests/vordering-opzet.mjs <canister-id> [prefix]     (2.11: prefix P-OFUI voor de proef met de OA-facturen)
import { backend } from "../tools/lib.mjs";
import { proefVordering, ok, opt } from "./vordering-lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/vordering-opzet.mjs <canister-id>");
const [admin, wl, calc, oa2, klant] = await Promise.all(["proef-admin", "proef-werfleider", "proef-calculator", "proef-oa2", "proef-klant"].map((n) => backend(n, cid)));
const uid = () => crypto.randomUUID();
const cDay = BigInt(Math.floor(Number((await admin.auditLog(0n, 1n))[0].at / 1_000_000n) / 86_400_000));
const prefix = process.argv[3] ?? "P-VSUI";
const S = await proefVordering({ admin, calc, wl }, { prefix, titleSuffix: " (proef)" });
const { wid, L, dak, regieTask } = S;
// 2.11: de inhoudingsplicht vraagt een KBO-nummer: de proeffirma krijgt een verzonnen nummer als ze er nog geen heeft.
if (!dak.kbo.length) ok(await admin.updateOrg(dak.id, { kind: dak.kind, name: dak.name, kbo: ["0999111222"], vat: dak.vat, aliases: dak.aliases, trades: dak.trades, address: dak.address, notes: dak.notes }));
const KM = uid();
const m = (op) => wl.measureSync([{ opId: uid(), clientKey: KM, op }]);
await m({ open: { workId: wid } });
await m({ entry: { lineId: L.afbraak, qtyMilli: 42_000n, day: cDay, complete: true, note: "proef", files: [], corrects: [], reason: "" } });
await m({ close: { note: "proef 2.10" } });
ok(await admin.addMembership(wid, [(await oa2.me()).person[0].id], [], { onderaannemer: null }, [{ confirmHours: null }, { confirmPlanning: null }]));
ok(await admin.addMembership(wid, [(await klant.me()).person[0].id], [], { klant: null }, []));
const KR = uid();
const r = (op) => wl.reportSync([{ opId: uid(), clientKey: KR, op }]);
await r({ ensure: { workId: wid, day: cDay } });
const [a1] = await r({ attendance: { orgId: [dak.id], personId: [], names: "Proefploeg 2.10", headcount: 2n, slots: [{ fromMin: 450n, toMin: 720n }, { fromMin: 750n, toMin: 960n }], regie: true, taskId: opt(regieTask.id), note: "", replaces: [] } });
const [a2] = await r({ attendance: { orgId: [dak.id], personId: [], names: "Proef betwist", headcount: 1n, slots: [{ fromMin: 480n, toMin: 720n }], regie: true, taskId: [regieTask.id], note: "", replaces: [] } });
await r({ finalize: null });
ok(await oa2.confirmHours(a1.outcome.done.entityId[0], true, ""));
ok(await oa2.confirmHours(a2.outcome.done.entityId[0], false, "proef: niet aanwezig"));
console.log(`Proefwerf ${S.W} (werf #${wid}, offerte ${S.NR}): klaar voor een vorderingsstaat.`);
