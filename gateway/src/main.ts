// BOWACO gateway (stap 1b.3, sinds mail-caffeine zonder mail). Start: `node src/main.ts` met de omgeving uit
// /etc/bowaco-postbode/postbode.env. Vandaag enkel /health en /task (ticket + voorstel, proeftaak); in fase 3 komen de
// AI-taken en eenvoudigfactureren.be erbij. De mail verstuurt de app zelf via de maildienst van Caffeine.
//   eenmalig: `node src/sleutel.ts <pad>` maakt de robotsleutel en toont de principal (die voegt de admin toe in de app).
import { loadConfig } from "./config.ts";
import { newStats, startHttp } from "./http.ts";
import { connect } from "./ic.ts";

const cfg = loadConfig();
const { robot, principal } = await connect(cfg);
console.log(`gateway ${cfg.version} · robot ${principal} · app ${cfg.canisterId} via ${cfg.icHost} · geen mail (die gaat via de app)`);
const server = startHttp(cfg, robot, principal, newStats());
const end = () => {
  server.close();
  setTimeout(() => process.exit(0), 500);
};
process.on("SIGTERM", end);
process.on("SIGINT", end);
