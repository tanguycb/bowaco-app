// Boete-opzoeking (1b.2) op een canister die al in gebruik is (een draft). Gebruikt de testidentiteiten en P-B. Laat
// enkel testdata achter: het werfverslag van vandaag op P-B (open) met de ploeg van BOWACO en één rit "1-PRF-1B2" met
// uren. Opnieuw draaien mag: het verslag en de rit worden hergebruikt (vaste sleutel per dag).
//   node tests/boete-draft.mjs <canister-id>
import { backend } from "../tools/lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/boete-draft.mjs <canister-id>");
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const rejects = async (p) => { try { await p; return false; } catch { return true; } };
const ok = (r) => { if (r && "err" in r) throw new Error(r.err); return r.ok; };
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const today = BigInt(Math.floor(Date.now() / 86_400_000));

const [admin, wl, calc, oa2] = await Promise.all(["proef-admin", "proef-werfleider", "proef-calculator", "proef-oa2"].map((n) => backend(n, cid)));
const me = await admin.me();
check("versie 1b.2 of later op de canister", /^1b\.([2-9])|^[2-9][b-z]?\./.test(me.version), me.version);
const B = (await admin.listWorks()).find((w) => w.code === "P-B")?.id;
if (B === undefined) throw new Error("P-B ontbreekt");
const wlId = (await wl.me()).person[0].id;
const adminId = me.person[0].id;
// Vaste sleutels per dag: een tweede run hergebruikt het verslag en de rit (opId = zelfde resultaat).
const key = `boete-proef-${today}`;
const sync = async (who, opId, op) => (await who.reportSync([{ opId, clientKey: key, op }]))[0];
const e = await sync(wl, `${key}-ensure`, { ensure: { workId: B, day: today } });
check("werfleider opent het verslag van vandaag op P-B", "done" in e.outcome, JSON.stringify(e.outcome, big));
const a = await sync(wl, `${key}-ploeg`, { attendance: { orgId: [], personId: [], names: "Ploeg BOWACO (proef)", headcount: 2n, slots: [{ fromMin: 450n, toMin: 720n }, { fromMin: 750n, toMin: 960n }], regie: false, taskId: [], note: "", replaces: [] } });
check("ploeg van BOWACO 07:30–12:00, 12:30–16:00", "done" in a.outcome, JSON.stringify(a.outcome, big));
const t = await sync(wl, `${key}-rit`, { trip: { vehicleId: [], plate: "1-PRF-1B2", driverOutPersonId: [wlId], driverBackPersonId: [adminId], driverOutText: "", driverBackText: "", note: "proef 1b.2", outMin: [415n], backMin: [985n] } });
check("rit 1-PRF-1B2 met uren 06:55 en 16:25", "done" in t.outcome, JSON.stringify(t.outcome, big));
const q = (o) => ({ day: today, time: o.time === undefined ? [] : [o.time], plate: o.plate ?? "1prf1b2", place: o.place ?? "", widen: false });
check("calculator en OA geweigerd", (await rejects(calc.lookupFine(q({})))) && (await rejects(oa2.lookupFine(q({})))));
const r1 = ok(await admin.lookupFine(q({ time: 425n })));
const m1 = r1.matches.find((m) => m.plate === "1-PRF-1B2");
check("om 07:05: heenrit met Proef Werfleider", !!m1 && m1.guess.startsWith("heenrit") && m1.guess.includes("Proef Werfleider"), m1?.guess);
check("de ploeg met haar tijdvakken en de uren van de rit", m1.crew.some((c) => c.includes("07:30–12:00")) && m1.outTime[0] === "06:55" && m1.backTime[0] === "16:25");
check("om 14:00: tijdens de werkuren", ok(await admin.lookupFine(q({ time: 840n }))).matches[0].guess.startsWith("tijdens de werkuren"));
const r3 = ok(await admin.lookupFine(q({ time: 1000n })));
check("om 16:40: terugrit, chauffeur terug = de testbeheerder", r3.matches[0].guess.startsWith("terugrit") && r3.matches[0].guess.includes(me.person[0].name), r3.matches[0].guess);
const pl = (await admin.getWork(B)).address.city;
if (pl) check("plaats = gemeente van P-B: klopt", ok(await admin.lookupFine(q({ place: pl }))).matches[0].placeMatch);
check("werfleider (chauffeur heen) vindt zijn rit", ok(await wl.lookupFine(q({}))).matches.some((m) => m.plate === "1-PRF-1B2"));
check("vergunning van die dag erbij (de container op P-B als die vandaag geldt, anders leeg)", Array.isArray(m1.permits));
check("auditlog: boete-opgezocht", (await admin.auditLog(0n, 40n)).some((x) => x.action === "boete-opgezocht" && x.detail.includes("1prf1b2")));
console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
