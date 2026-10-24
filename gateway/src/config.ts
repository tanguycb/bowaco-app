// Instellingen van de postbode: ENKEL uit de omgeving (systemd EnvironmentFile op de server, nooit in git).
// Geheimen: de sleutel van de robot (een bestand, pad in ROBOT_KEY_FILE) en de API-sleutel van de maildienst.
import { readFileSync } from "node:fs";

export type Provider = "brevo" | "bestand";

export type Config = {
  canisterId: string;
  icHost: string;
  local: boolean; // lokaal testnet: root key ophalen (nooit op mainnet)
  robotKeyFile: string;
  provider: Provider;
  brevoUrl: string;
  brevoKey: string;
  brevoSandbox: boolean; // testmodus van Brevo: niets wordt echt verstuurd
  mailFrom: { name: string; email: string };
  replyTo: string | null;
  mailDir: string; // provider "bestand": elke mail als .html + .txt in deze map (lokale mailvanger)
  journalFile: string;
  pollSeconds: number;
  batch: number;
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

// "BOWACO werven <planning@bowaco.eu>" → { name, email }
export function parseFrom(s: string): { name: string; email: string } {
  const m = /^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(s);
  if (m) return { name: m[1], email: m[2] };
  if (/^[^\s@]+@[^\s@]+$/.test(s.trim())) return { name: "", email: s.trim() };
  throw new Error(`MAIL_FROM klopt niet: ${s}`);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const icHost = env.IC_HOST?.trim() || "https://icp-api.io";
  const local = /localhost|127\.0\.0\.1/.test(icHost);
  const provider = (env.MAIL_PROVIDER?.trim() || "bestand") as Provider;
  if (provider !== "brevo" && provider !== "bestand") throw new Error(`MAIL_PROVIDER: brevo of bestand, niet ${provider}`);
  const brevoKey = provider === "brevo" ? req(env, "BREVO_API_KEY") : "";
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  return {
    canisterId: req(env, "BOWACO_CANISTER"),
    icHost,
    local,
    robotKeyFile: req(env, "ROBOT_KEY_FILE"),
    provider,
    brevoUrl: env.BREVO_URL?.trim() || "https://api.brevo.com/v3/smtp/email",
    brevoKey,
    brevoSandbox: env.BREVO_SANDBOX === "1",
    mailFrom: parseFrom(env.MAIL_FROM?.trim() || "BOWACO werven <planning@example.invalid>"),
    replyTo: env.MAIL_REPLY_TO?.trim() || null,
    mailDir: env.MAIL_DIR?.trim() || "./mails",
    journalFile: env.JOURNAL_FILE?.trim() || "./journaal.jsonl",
    pollSeconds: Math.max(15, Number(env.POLL_SECONDS ?? 120) || 120),
    batch: Math.min(10, Math.max(1, Number(env.BATCH ?? 10) || 10)),
    httpHost: env.HTTP_HOST?.trim() || "127.0.0.1",
    httpPort: Number(env.HTTP_PORT ?? 8787) || 8787,
    allowOrigin: env.ALLOW_ORIGIN?.trim() || null,
    version: pkg.version,
  };
}
