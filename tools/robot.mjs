// (d) Proefrobot = de gateway in het klein. Eigen Ed25519-principal (sleutel in ~/.bowaco/robot-test.json);
// in de app registreert de admin enkel de publieke principal (Instellingen → Robots).
//   node tools/robot.mjs principal
//   node tools/robot.mjs <backend-canister> <ticket>
// Standaard mainnet (de draft); ICP_HOST=http://localhost:8041 voor het eigen testnetwerk.
import { backend, identity } from "./lib.mjs";

const [cid, ticket] = process.argv.slice(2);
if (cid === "principal") {
  console.log(identity("robot-test").getPrincipal().toText());
  process.exit(0);
}
if (!cid || !ticket) {
  console.error("gebruik: node tools/robot.mjs <backend-canister> <ticket>");
  process.exit(2);
}

const app = await backend("robot-test", cid);
const t0 = Date.now();
const info = await app.checkTicket(ticket.trim());
const t1 = Date.now();
if ("err" in info) {
  console.error(`checkTicket geweigerd: ${info.err}`);
  process.exit(1);
}
const i = info.ok;
console.log(`checkTicket OK in ${t1 - t0} ms: ${i.personName}, taak '${i.task}', werf ${i.workId.length ? '#' + i.workId[0] : '–'}, budget € ${(Number(i.budgetCents) / 100).toFixed(2)}`);

// Hier zou de gateway het echte werk doen (AI, mail, …). De proef schrijft een vast voorstel terug.
const content = [
  `Proefvoorstel voor ${i.personName}`,
  `Taak: ${i.task} · Werf: ${i.workId.length ? '#' + i.workId[0] : '–'}`,
  `Gemaakt door de proefrobot op ${new Date().toLocaleString("nl-BE")}.`,
].join("\n");
const res = await app.submitProposal(i.ticketId, "proef", content);
const t2 = Date.now();
if ("err" in res) {
  console.error(`submitProposal geweigerd: ${res.err}`);
  process.exit(1);
}
console.log(`submitProposal OK in ${t2 - t1} ms: voorstel #${res.ok}. Totaal ${t2 - t0} ms.`);
