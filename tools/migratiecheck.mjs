// (f) Wat staat er na een upgrade nog? Lokaal met de proef-admin (na proef.mjs).
//   ICP_HOST=http://localhost:8041 node tools/migratiecheck.mjs <canister-id>
import { backend } from "./lib.mjs";

const cid = process.argv[2];
const admin = await backend("proef-admin", cid);
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const s = await admin.probeStatus();
console.log(`versie ${s.version}; personen ${s.persons}; timer-tikken ${s.timerTicks}`);
const persons = await admin.listPersons();
console.log("personen:", JSON.stringify(persons.map((p) => ({ id: p.id, name: p.name, phone: p.phone })), big));
console.log("codes:", (await admin.listInvites()).length, "· koppelingen:", (await admin.listLinks()).length, "· auditregels:", (await admin.auditLog(500n)).length);
console.log("notities:", JSON.stringify(await admin.probeNotes(), big));
