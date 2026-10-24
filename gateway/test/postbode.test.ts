// Eenheidstesten van de postbode zonder netwerk: opmaak (ontsnappen), idempotentiesleutel, Brevo-verzoek (testmodus,
// fouten), en de lus (logboek voorkomt een tweede mail).
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig, parseFrom } from "../src/config.ts";
import type { JobLease, Robot } from "../src/ic.ts";
import { Journal } from "../src/journal.ts";
import { esc, renderHtml, renderText } from "../src/render.ts";
import { idemKey, send } from "../src/send.ts";
import { handle, newStats } from "../src/worker.ts";

const dir = mkdtempSync(join(tmpdir(), "postbode-"));
const cfg = (extra: Record<string, string> = {}) =>
  loadConfig({ BOWACO_CANISTER: "aaaaa-aa", ROBOT_KEY_FILE: "x", MAIL_DIR: join(dir, "mails"), JOURNAL_FILE: join(dir, "j.jsonl"), ...extra });

const job = (o: Partial<JobLease> = {}): JobLease => ({
  id: 7n,
  kind: "weekplanning",
  key: "weekplanning:org3:2026-W45",
  attempt: 1n,
  leaseUntil: 0n,
  mail: { to: [{ name: "Proef Dak NV", email: "planning@proef.invalid" }], subject: "BOWACO planning 2026-W45", preheader: "p", heading: "Planning week 2026-W45", intro: "Hallo <b>Dak</b>", sections: [{ title: "P-B · Proef", subtitle: "Straat 1, Stad", lines: ["ma 02.11 · Dak <script>"] }], outro: "o", link: ["https://splendid.example/#/week"], tag: "weekplanning" },
  ...o,
});

test("MAIL_FROM wordt gelezen", () => {
  assert.deepEqual(parseFrom("BOWACO werven <planning@bowaco.eu>"), { name: "BOWACO werven", email: "planning@bowaco.eu" });
  assert.throws(() => parseFrom("geen adres"));
});

test("opmaak ontsnapt alle tekst uit de app; link enkel https", () => {
  const h = renderHtml(job().mail);
  assert.ok(!h.includes("<script>") && h.includes("&lt;script&gt;") && h.includes("&lt;b&gt;Dak&lt;/b&gt;"));
  assert.ok(h.includes('href="https://splendid.example/#/week"'));
  const bad = renderHtml({ ...job().mail, link: ["javascript:alert(1)"] });
  assert.ok(!bad.includes("javascript:"));
  assert.ok(renderText(job().mail).includes("  - ma 02.11 · Dak <script>"));
  assert.equal(esc(`"'&`), "&quot;&#39;&amp;");
});

test("idempotentiesleutel: stabiel per opdracht, anders per week", () => {
  assert.equal(idemKey("a"), idemKey("a"));
  assert.notEqual(idemKey("weekplanning:org3:2026-W45"), idemKey("weekplanning:org3:2026-W46"));
  assert.match(idemKey("a"), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test("Brevo: testmodus, idempotentiesleutel, geen sleutel in de fout", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const fake = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify({ messageId: "<m1@brevo>" }), { status: 201 });
  }) as unknown as typeof fetch;
  const c = cfg({ MAIL_PROVIDER: "brevo", BREVO_API_KEY: "xkeysib-proef", BREVO_SANDBOX: "1", BREVO_URL: "http://brevo.invalid/v3/smtp/email" });
  const r = await send(c, job(), fake);
  assert.deepEqual(r, { ok: true, id: "<m1@brevo>" });
  const b = JSON.parse(String(seen!.init.body));
  assert.equal(b.headers["X-Sib-Sandbox"], "drop");
  assert.equal(b.headers.idempotencyKey, idemKey(job().key));
  assert.equal((seen!.init.headers as Record<string, string>)["api-key"], "xkeysib-proef");
  const fail = (async () => new Response(JSON.stringify({ code: "unauthorized", message: "Key not found" }), { status: 401 })) as unknown as typeof fetch;
  const r2 = await send(c, job(), fail);
  assert.equal(r2.ok, false);
  assert.ok(!r2.ok && !r2.retry && !r2.why.includes("xkeysib"));
  const busy = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
  const r3 = await send(c, job(), busy);
  assert.ok(!r3.ok && r3.retry);
  const dup = (async () => new Response(JSON.stringify({ code: "duplicate_parameter", message: "idempotencyKey already used" }), { status: 400 })) as unknown as typeof fetch;
  assert.equal((await send(c, job(), dup)).ok, true);
});

test("bestand: schrijft html, txt en json (lokale mailvanger)", async () => {
  const c = cfg();
  const r = await send(c, job());
  assert.ok(r.ok);
  assert.ok(readFileSync(join(dir, "mails", "7-weekplanning.txt"), "utf8").includes("Onderwerp: BOWACO planning 2026-W45"));
});

test("lus: verstuurd → completeJob; logboek voorkomt een tweede mail; mislukt → failJob met retry", async () => {
  const calls: string[] = [];
  const robot: Robot = {
    leaseJobs: async () => [],
    completeJob: async (id, a, res) => (calls.push(`klaar ${id}/${a} ${res}`), { ok: null }),
    failJob: async (id, a, why, retry) => (calls.push(`mislukt ${id}/${a} ${retry}`), { ok: null }),
    checkTicket: async () => ({ err: "x" }),
    submitProposal: async () => ({ err: "x" }),
  };
  const journal = new Journal(join(dir, "j2.jsonl"));
  const stats = newStats();
  let sends = 0;
  const sender = async () => (sends++, { ok: true as const, id: "m1" });
  await handle(cfg(), robot, journal, job(), stats, sender);
  await handle(cfg(), robot, journal, job({ attempt: 2n }), stats, sender);
  assert.equal(sends, 1, "tweede lease van dezelfde opdracht verstuurt niet opnieuw");
  assert.ok(calls[1].startsWith("klaar 7/2 al verstuurd"));
  assert.equal(new Journal(join(dir, "j2.jsonl")).has(job().key), true, "logboek overleeft een herstart");
  const failing = async () => ({ ok: false as const, why: "http 503", retry: true });
  await handle(cfg(), robot, journal, job({ id: 8n, key: "k8" }), stats, failing);
  assert.equal(calls[2], "mislukt 8/1 true");
  assert.ok(!readFileSync(join(dir, "j2.jsonl"), "utf8").includes("@"), "geen adressen in het logboek");
});
