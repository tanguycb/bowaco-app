// Stresstest van het weekbord (1.4, Q-09): maakt op het EIGEN testnet (poort 8041, nooit een draft) een
// gevulde app met veel werven en OA's en meet weekBoard, boardConflicts, workConflicts en myBoard: rekenwerk
// (instructies, grens van een query: 5 miljard), grootte van het antwoord en tijd.
//   ICP_HOST=http://localhost:8041 node tools/weekbord-stress.mjs <canister-id> [werven=120] [oas=60]
// Draai het na tests/rollen.mjs op dezelfde canister (gebruikt diens testbeheerder). Enkel verzonnen namen.
import { backend, ok } from "./lib.mjs";

const cid = process.argv[2];
const host = process.env.ICP_HOST || "";
if (!cid || !(host.includes("localhost") || host.includes("127.0.0.1"))) throw new Error("enkel lokaal: ICP_HOST=http://localhost:8041 node tools/weekbord-stress.mjs <canister-id>");
const NW = Number(process.argv[3] ?? 120);
const NO = Number(process.argv[4] ?? 60);
const admin = await backend("proef-admin", cid);
const day = (d = new Date()) => BigInt(Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000));
const today = day();
const monday = today - BigInt((Number(today) + 3) % 7);
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pool = async (n, items, fn) => {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
};
const t0 = Date.now();
const trades = (await admin.listTrades(false)).map((t) => t.key);
const existing = (await admin.listOrgs(false)).filter((o) => o.name.startsWith("Stress OA "));
let orgs = existing;
if (orgs.length < NO) {
  const made = await pool(10, Array.from({ length: NO - orgs.length }, (_, i) => orgs.length + i), async (i) =>
    ok(await admin.createOrg({ kind: { subcontractor: null }, name: `Stress OA ${String(i + 1).padStart(3, "0")}`, kbo: [], vat: [], aliases: [`S${String(i + 1).padStart(3, "0")}`], trades: [trades[i % trades.length]], address: [], notes: "" })));
  orgs = [...orgs, ...made];
}
console.log(`${orgs.length} OA's (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
const addr = { street: "Stresslaan", number: "1", zip: "9000", city: "Gent", country: "BE" };
const worksNow = (await admin.listWorks()).filter((w) => w.code.startsWith("S-"));
const todo = Array.from({ length: Math.max(0, NW - worksNow.length) }, (_, i) => worksNow.length + i);
let done = 0;
await pool(12, todo, async (i) => {
  const w = ok(await admin.createWork({ code: `S-${String(i + 1).padStart(3, "0")}`, name: `Stresswerf ${i + 1}`, address: addr, parentId: [], clientOrgId: [], architectOrgId: [], leaderPersonId: [], vatBp: 600n }));
  // Starten verspreid over -10 … +30 weken; 1 op 5 OA's is "druk" (krijgt veel taken), zoals in de Excel.
  const start = monday + BigInt(Math.floor(rnd() * 280) - 70);
  ok(await admin.applyTemplate(w.id, "standaardrenovatie", start, false, 0n));
  let p = await admin.getPlan(w.id);
  for (const t of p.tasks) {
    const busy = rnd() < 0.5;
    const o = busy ? orgs[Math.floor(rnd() * Math.ceil(orgs.length / 5))] : orgs[Math.floor(rnd() * orgs.length)];
    const r = await admin.saveTask(w.id, { id: [t.id], title: t.title, note: "", kind: t.kind, trade: t.trade, responsibleOrgId: [o.id], status: t.status, percent: 0n, start: t.start, workdays: t.workdays, leadDays: t.leadDays, orderDay: t.orderDay, reason: "" }, p.version);
    p = { ...p, version: ok(r).version };
  }
  if (++done % 10 === 0) console.log(`  ${done}/${todo.length} werven (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
});
// Afwezigheden: een week verlof voor 1 op 4 OA's in de komende weken
for (const [k, o] of orgs.entries()) {
  if (k % 4 === 0) await admin.saveAbsence({ id: [], orgId: o.id, personId: [], kind: { verlof: null }, from: monday + BigInt(7 * (k % 8)), to: monday + BigInt(7 * (k % 8) + 4), note: "" }).catch(() => {});
}
const ex = await admin.exportIntern();
console.log(`data: ${ex.works.length} werven, ${ex.orgs.length} organisaties, ${ex.tasks.length} taken, ${ex.assignments.length} toewijzingen, ${ex.absences.length} afwezigheden (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
const size = (x) => JSON.stringify(x, (_, v) => (typeof v === "bigint" ? v.toString() : v)).length;
const measure = async (name, fn) => {
  const s = Date.now();
  const r = await fn();
  console.log(`${name.padEnd(48)} ${String(Date.now() - s).padStart(6)} ms  ${(size(r) / 1024).toFixed(0).padStart(5)} KiB${r.instructions !== undefined ? `  ${(Number(r.instructions) / 1e6).toFixed(0).padStart(6)} M instructies` : ""}${r.total !== undefined ? `  totaal ${r.total}` : ""}${r.conflictTotal !== undefined ? `  conflicten ${r.conflictTotal}` : ""}`);
  return r;
};
const bq = (o) => ({ from: monday, weeks: 6n, offset: 0n, limit: 50n, text: "", trade: [], workId: [], onlyConflicts: false, withIdle: false, ...o });
const r6 = await measure("weekBoard 6 weken, 50 firma's", () => admin.weekBoard(bq({})));
await measure("weekBoard 12 weken, 50 firma's, ook zonder werk", () => admin.weekBoard(bq({ weeks: 12n, withIdle: true })));
await measure("weekBoard 12 weken, pagina 2", () => admin.weekBoard(bq({ weeks: 12n, withIdle: true, offset: 50n })));
await measure("weekBoard 12 weken, enkel conflicten", () => admin.weekBoard(bq({ weeks: 12n, onlyConflicts: true })));
await measure("weekBoard 1 week (dagen)", () => admin.weekBoard(bq({ weeks: 1n })));
await measure("weekBoard 6 weken, een jaar later", () => admin.weekBoard(bq({ from: monday + 364n })));
await measure("boardConflicts 6 weken (Vraagt aandacht)", () => admin.boardConflicts(monday, 6n, 50n));
const w1 = ex.works.find((w) => w.code === "S-001");
await measure("workConflicts S-001, 12 weken (werfpagina)", () => admin.workConflicts(w1.id, monday, 12n));
console.log(`(antwoordgrens van een query: 3 MiB; ${r6.rows.length} rijen in de eerste pagina)`);
