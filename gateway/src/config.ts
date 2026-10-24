// Instellingen van de gateway: ENKEL uit de omgeving (systemd EnvironmentFile op de server, nooit in git).
// Sinds mail-caffeine (E-11, 24-10) verstuurt de gateway GEEN mail meer: de app doet dat zelf via de maildienst van
// Caffeine. Wat overblijft is voor fase 3 (AI-taken, eenvoudigfactureren.be): het ticket controleren en een voorstel
// terugschrijven. Enig geheim: de sleutel van de robot (een bestand, pad in ROBOT_KEY_FILE).
import { readFileSync } from "node:fs";

export type Config = {
  canisterId: string;
  icHost: string;
  local: boolean; // lokaal testnet: root key ophalen (nooit op mainnet)
  robotKeyFile: string;
  httpHost: string;
  httpPort: number;
  allowOrigin: string | null; // het adres van de app (voor /task vanuit de browser, fase 3)
  version: string;
};

function req(env: NodeJS.ProcessEnv, k: string): string {
  const v = env[k]?.trim();
  if (!v) throw new Error(`omgevingsvariabele ${k} ontbreekt`);
  return v;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const icHost = env.IC_HOST?.trim() || "https://icp-api.io";
  const local = /localhost|127\.0\.0\.1/.test(icHost);
  // De mail van 1b.3 (Brevo) is weg: wie ze nog instelt, krijgt een duidelijke fout in plaats van een stille gateway.
  for (const k of ["MAIL_PROVIDER", "BREVO_API_KEY"]) {
    if (env[k]?.trim()) throw new Error(`${k} wordt niet meer gebruikt: de mail gaat via de maildienst van Caffeine (docs/postbode-installatie.md). Haal de regel weg.`);
  }
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  return {
    canisterId: req(env, "BOWACO_CANISTER"),
    icHost,
    local,
    robotKeyFile: req(env, "ROBOT_KEY_FILE"),
    httpHost: env.HTTP_HOST?.trim() || "127.0.0.1",
    httpPort: Number(env.HTTP_PORT ?? 8787) || 8787,
    allowOrigin: env.ALLOW_ORIGIN?.trim() || null,
    version: pkg.version,
  };
}
