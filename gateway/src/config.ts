// Instellingen van de gateway: ENKEL uit de omgeving (systemd EnvironmentFile op de server, nooit in git).
// Sinds mail-caffeine (E-11, 24-10) verstuurt de gateway GEEN mail meer. Gateway v2 (3.1, ontwerp §3): AI-taken met
// bestanden, adapters per leverancier, budget en logboek zonder inhoud. Geheimen: de robotsleutel (bestand, pad in
// ROBOT_KEY_FILE) en de leverancierssleutels (sleutels.ts; staan in /etc/bowaco-postbode/sleutels.env, root 0600,
// systemd laadt ze; ze komen NOOIT in dit Config-object, zodat ze niet per ongeluk gelogd of getoond worden).
import { readFileSync } from "node:fs";

export type Grenzen = {
  maxBestanden: number; // ≤ 10 per taak
  maxTotaal: number; // bytes, ≤ 20 MB samen
  maxBestand: number; // bytes, ≤ 15 MB per bestand
  maxTekst: number; // bytes in invoer.tekst
  maxPdfBladen: number; // 60
  maxXlsxRijen: number; // 5 000 per blad
  maxBeeldPx: number; // 2 000 (zie bestanden.ts: verkleinen = open punt)
};

export type Plafonds = { maand: number; claude: number; grok: number; nep: number }; // eurocent per maand

export type Config = {
  canisterId: string;
  icHost: string;
  local: boolean; // lokaal testnet: root key ophalen (nooit op mainnet)
  robotKeyFile: string;
  httpHost: string;
  httpPort: number;
  allowOrigin: string | null; // het adres van de app; enige toegelaten Origin voor /v2/* (en CORS)
  version: string;
  staatDir: string; // budget.json en log/<jjjj-mm>.jsonl
  nep: boolean; // GATEWAY_NEP=1: de nep-leverancier mag (nooit op de echte server)
  grenzen: Grenzen;
  tijdslimietMs: number; // per taak bij de leverancier (120 s)
  antwoordMs: number; // HTTP-verbinding maximaal open (150 s)
  gelijktijdig: number; // taken tegelijk in het proces (4)
  plafond: Plafonds;
  usdEurMilli: number; // koers, dezelfde waarde als ai.usdEurMilli in de app (920 = 0,920 €/$)
  logDagen: number; // bewaartermijn logboek (400)
  basis: { claude: string; grok: string }; // API-adres van de leveranciers (enkel https, of 127.0.0.1 voor tests)
};

function req(env: NodeJS.ProcessEnv, k: string): string {
  const v = env[k]?.trim();
  if (!v) throw new Error(`omgevingsvariabele ${k} ontbreekt`);
  return v;
}

function num(env: NodeJS.ProcessEnv, k: string, std: number): number {
  const v = env[k]?.trim();
  if (!v) return std;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${k} moet een getal ≥ 0 zijn`);
  return n;
}

// Een leveranciersadres mag enkel https zijn, of http op 127.0.0.1 (nagebootste leverancier in de tests). Zo kan een
// verkeerde instelling de sleutel nooit in klare tekst over het net sturen.
function basis(env: NodeJS.ProcessEnv, k: string, std: string): string {
  const v = env[k]?.trim() || std;
  const u = new URL(v);
  const ok = u.protocol === "https:" || (u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost"));
  if (!ok) throw new Error(`${k} moet https:// zijn`);
  return v.replace(/\/+$/, "");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const icHost = env.IC_HOST?.trim() || "https://icp-api.io";
  const local = /localhost|127\.0\.0\.1/.test(icHost);
  // Mail (1b.3, Brevo) is weg; de inkomende mailbox (ontwerp §4) is nog niet gebouwd. Wie ze instelt, krijgt een
  // duidelijke fout in plaats van een stille gateway.
  for (const k of ["MAIL_PROVIDER", "BREVO_API_KEY"]) {
    if (env[k]?.trim()) throw new Error(`${k} wordt niet meer gebruikt: de mail gaat via de maildienst van Caffeine (docs/postbode-installatie.md). Haal de regel weg.`);
  }
  for (const k of ["INBOX_PROVIDER", "INBOX_WEBHOOK_SECRET", "INBOX_ALLOWED_DOMAIN"]) {
    if (env[k]?.trim()) throw new Error(`${k}: de inkomende mailbox is nog niet gebouwd (ontwerp 3.1 §4). Haal de regel weg.`);
  }
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  const MB = 1024 * 1024;
  const maand = num(env, "GATEWAY_MAANDPLAFOND_CENT", 10_000);
  const allowOrigin = env.ALLOW_ORIGIN?.trim() || null;
  if (allowOrigin && !/^https?:\/\/[^/\s]+$/.test(allowOrigin)) throw new Error("ALLOW_ORIGIN moet een origin zijn (schema + host, zonder pad)");
  const port = Number(env.HTTP_PORT ?? 8787);
  return {
    canisterId: req(env, "BOWACO_CANISTER"),
    icHost,
    local,
    robotKeyFile: req(env, "ROBOT_KEY_FILE"),
    httpHost: env.HTTP_HOST?.trim() || "127.0.0.1",
    httpPort: Number.isInteger(port) && port >= 0 ? port : 8787,
    allowOrigin,
    version: pkg.version,
    staatDir: env.GATEWAY_STAAT?.trim() || "/var/lib/bowaco-postbode",
    nep: env.GATEWAY_NEP?.trim() === "1",
    grenzen: {
      maxBestanden: num(env, "GATEWAY_MAX_BESTANDEN", 10),
      maxTotaal: num(env, "GATEWAY_MAX_TOTAAL_MB", 20) * MB,
      maxBestand: num(env, "GATEWAY_MAX_BESTAND_MB", 15) * MB,
      maxTekst: num(env, "GATEWAY_MAX_TEKST", 200_000),
      maxPdfBladen: num(env, "GATEWAY_MAX_PDF_BLADEN", 60),
      maxXlsxRijen: num(env, "GATEWAY_MAX_XLSX_RIJEN", 5_000),
      maxBeeldPx: num(env, "GATEWAY_MAX_BEELD_PX", 2_000),
    },
    tijdslimietMs: num(env, "GATEWAY_TIJDSLIMIET_MS", 120_000),
    antwoordMs: num(env, "GATEWAY_ANTWOORD_MS", 150_000),
    gelijktijdig: num(env, "GATEWAY_GELIJKTIJDIG", 4),
    plafond: {
      maand,
      claude: num(env, "GATEWAY_PLAFOND_CLAUDE_CENT", maand),
      grok: num(env, "GATEWAY_PLAFOND_GROK_CENT", maand),
      nep: maand,
    },
    usdEurMilli: num(env, "GATEWAY_USD_EUR_MILLI", 1_000),
    logDagen: num(env, "GATEWAY_LOG_DAGEN", 400),
    basis: {
      claude: basis(env, "ANTHROPIC_BASE_URL", "https://api.anthropic.com"),
      grok: basis(env, "XAI_BASE_URL", "https://api.x.ai"),
    },
  };
}
