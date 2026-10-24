// Verzenden via een gewone maildienst-API. Twee aanbieders:
// - "brevo": Brevo (EU, Frankrijk/Duitsland/België), POST /v3/smtp/email met de header api-key. Testmodus met
//   BREVO_SANDBOX=1: Brevo aanvaardt de mail (201) maar verstuurt niets. Idempotentie: de sleutel van de opdracht als
//   idempotencyKey (Brevo weigert een tweede verzoek met dezelfde sleutel binnen 30 min).
// - "bestand": schrijft elke mail als .html, .txt en .json in MAIL_DIR (lokale mailvanger, nooit een echte mail).
// Fouten: `retry` = de app mag het later opnieuw proberen (netwerk, 429, 5xx); anders definitief (400/401/403).
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.ts";
import type { JobLease } from "./ic.ts";
import { renderHtml, renderText } from "./render.ts";

export type SendResult = { ok: true; id: string } | { ok: false; why: string; retry: boolean };

// Een idempotentiesleutel in UUID-vorm, afgeleid van de sleutel van de opdracht (stabiel bij een herhaalde lease).
export function idemKey(key: string): string {
  const h = createHash("sha256").update(`bowaco-postbode|${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export async function send(cfg: Config, job: JobLease, fetchImpl: typeof fetch = fetch): Promise<SendResult> {
  const m = job.mail;
  if (m.to.length === 0) return { ok: false, why: "geen ontvanger", retry: false };
  const html = renderHtml(m);
  const text = renderText(m);
  if (cfg.provider === "bestand") {
    mkdirSync(cfg.mailDir, { recursive: true, mode: 0o700 });
    const base = join(cfg.mailDir, `${job.id}-${job.kind}`);
    writeFileSync(`${base}.html`, html, { mode: 0o600 });
    writeFileSync(`${base}.txt`, `Aan: ${m.to.map((t) => t.email).join(", ")}\nOnderwerp: ${m.subject}\n\n${text}`, { mode: 0o600 });
    writeFileSync(`${base}.json`, JSON.stringify({ key: job.key, kind: job.kind, to: m.to, subject: m.subject, from: cfg.mailFrom, idempotencyKey: idemKey(job.key) }, null, 1), { mode: 0o600 });
    return { ok: true, id: `bestand:${base}` };
  }
  const headers: Record<string, string> = { idempotencyKey: idemKey(job.key), "X-Mailin-Tag": m.tag };
  if (cfg.brevoSandbox) headers["X-Sib-Sandbox"] = "drop";
  const body = {
    sender: { name: cfg.mailFrom.name || "BOWACO werven", email: cfg.mailFrom.email },
    to: m.to.map((t) => (t.name ? { email: t.email, name: t.name } : { email: t.email })),
    ...(cfg.replyTo ? { replyTo: { email: cfg.replyTo } } : {}),
    subject: m.subject,
    htmlContent: html,
    textContent: text,
    headers,
    tags: [m.tag],
  };
  let r: Response;
  try {
    r = await fetchImpl(cfg.brevoUrl, {
      method: "POST",
      headers: { "api-key": cfg.brevoKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    return { ok: false, why: `netwerk: ${(e as Error).message}`.slice(0, 180), retry: true };
  }
  const txt = await r.text().catch(() => "");
  if (r.status === 201 || r.status === 200 || r.status === 202) {
    let id = "";
    try {
      id = String((JSON.parse(txt) as { messageId?: string }).messageId ?? "");
    } catch {
      /* geen JSON */
    }
    return { ok: true, id: id || `http ${r.status}` };
  }
  // Brevo meldt een herhaalde idempotentiesleutel als fout: de mail ging de eerste keer al weg → geen tweede.
  if (/duplicate_parameter|idempotency/i.test(txt)) return { ok: true, id: "al verstuurd (idempotentiesleutel)" };
  const retry = r.status === 429 || r.status >= 500;
  // Nooit de API-sleutel of het volledige antwoord in een log: enkel de code en een korte reden.
  let why = `http ${r.status}`;
  try {
    const j = JSON.parse(txt) as { code?: string; message?: string };
    why += ` ${j.code ?? ""} ${j.message ?? ""}`.trimEnd();
  } catch {
    /* geen JSON */
  }
  return { ok: false, why: why.slice(0, 180), retry };
}
