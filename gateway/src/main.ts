// BOWACO postbode (gateway-lite, stap 1b.3). Start: `node src/main.ts` met de omgeving uit /etc/bowaco-postbode/postbode.env.
//   eenmalig: `node src/sleutel.ts <pad>` maakt de robotsleutel en toont de principal (die voegt de admin toe in de app).
import { loadConfig } from "./config.ts";
import { startHttp } from "./http.ts";
import { connect } from "./ic.ts";
import { Journal } from "./journal.ts";
import { loop, newStats, round } from "./worker.ts";

const cfg = loadConfig();
const { robot, principal } = await connect(cfg);
const journal = new Journal(cfg.journalFile);
const stats = newStats();
console.log(`postbode ${cfg.version} · robot ${principal} · app ${cfg.canisterId} via ${cfg.icHost} · maildienst ${cfg.provider}${cfg.brevoSandbox ? " (testmodus)" : ""} · elke ${cfg.pollSeconds} s`);

if (process.argv.includes("--eenmaal")) {
  // Eén ronde en stoppen (deploy-controle en proeven).
  const n = await round(cfg, robot, journal, stats);
  console.log(`één ronde: ${n} opdrachten, ${stats.sent} verstuurd, ${stats.failed} mislukt`);
  process.exit(stats.failed ? 1 : 0);
}

const server = startHttp(cfg, robot, principal, stats, () => journal.size);
const stop = { stopped: false };
const end = () => {
  stop.stopped = true;
  server.close();
  setTimeout(() => process.exit(0), 500);
};
process.on("SIGTERM", end);
process.on("SIGINT", end);
await loop(cfg, robot, journal, stats, stop);
