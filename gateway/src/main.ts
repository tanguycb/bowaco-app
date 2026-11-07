// BOWACO gateway v2 (stap 3.1). Start: `node src/main.ts` met de omgeving uit /etc/bowaco-postbode/postbode.env
// (instellingen, 0640) en /etc/bowaco-postbode/sleutels.env (leverancierssleutels, root 0600) — beide via systemd.
//   eenmalig: `node src/sleutel.ts <pad>` maakt de robotsleutel en toont de principal (die voegt de admin toe in de app).
import { Budget } from "./budget.ts";
import { loadConfig } from "./config.ts";
import { startHttp } from "./http.ts";
import { connect } from "./ic.ts";
import { maakLeveranciers } from "./leveranciers/index.ts";
import { Logboek } from "./logboek.ts";
import { Sleutels, registreerGeheimen, wisUitOmgeving } from "./sleutels.ts";

const cfg = loadConfig();
const sleutels = new Sleutels(process.env);
registreerGeheimen(wisUitOmgeving(process.env)); // vanaf hier staan de sleutels niet meer in process.env
const { robot, principal } = await connect(cfg);
const logboek = new Logboek(cfg.staatDir);
const weg = logboek.opruimen(cfg.logDagen);
const budget = new Budget(cfg.staatDir, cfg.plafond);
const leveranciers = maakLeveranciers(cfg, sleutels);
console.log(
  `gateway ${cfg.version} · robot ${principal} · app ${cfg.canisterId} via ${cfg.icHost} · sleutels ${JSON.stringify(sleutels.stand())}${cfg.nep ? " · NEP AAN" : ""}${weg.length ? ` · ${weg.length} oude logmaand(en) weg` : ""}`,
);
const server = startHttp({ cfg, robot, principal, sleutels, leveranciers, budget, logboek });
const end = () => {
  server.close();
  setTimeout(() => process.exit(0), 500);
};
process.on("SIGTERM", end);
process.on("SIGINT", end);
