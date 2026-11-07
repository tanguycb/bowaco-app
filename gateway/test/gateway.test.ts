// Eenheidstesten van de gateway zonder netwerk: instellingen (oude mail- en inboxregels geweigerd), /health zonder
// geheimen, /task (proeftaak 1b.3) met een nagebootste app (ticket eenmalig, rommel geweigerd, rest 404).
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { newStats, startHttp } from "../src/http.ts";
import type { Robot } from "../src/ic.ts";
import { Sleutels } from "../src/sleutels.ts";

const base = { BOWACO_CANISTER: "aaaaa-aa", ROBOT_KEY_FILE: "x", GATEWAY_STAAT: "" };

test("instellingen: canister en sleutel verplicht; geen mail, geen inbox; leveranciersadres enkel https", () => {
  assert.throws(() => loadConfig({}), /BOWACO_CANISTER/);
  const c = loadConfig({ ...base, HTTP_PORT: "9999" });
  assert.equal(c.httpPort, 9999);
  assert.equal(c.httpHost, "127.0.0.1");
  assert.equal(c.local, false);
  assert.equal(c.nep, false);
  assert.equal(c.grenzen.maxBestanden, 10);
  assert.equal(c.plafond.maand, 10_000);
  assert.throws(() => loadConfig({ ...base, BREVO_API_KEY: "xkeysib-1" }), /maildienst van Caffeine/);
  assert.throws(() => loadConfig({ ...base, MAIL_PROVIDER: "brevo" }), /niet meer gebruikt/);
  assert.throws(() => loadConfig({ ...base, INBOX_PROVIDER: "x" }), /mailbox is nog niet gebouwd/);
  assert.throws(() => loadConfig({ ...base, ANTHROPIC_BASE_URL: "http://elders.example.com" }), /https/);
  assert.throws(() => loadConfig({ ...base, ALLOW_ORIGIN: "https://app.example.com/pad" }), /origin/);
  // De sleutels komen nooit in het Config-object.
  const k = loadConfig({ ...base, ANTHROPIC_API_KEY: "sk-ant-geheim-123456789" });
  assert.ok(!JSON.stringify(k).includes("geheim"));
});

test("http: /health zonder geheimen, /task eenmalig, rommel 400, rest 404", async () => {
  const used = new Set<string>();
  const robot: Robot = {
    checkTicket: async (t) => (used.has(t) ? { err: "Ticket al gebruikt" } : (used.add(t), { ok: { ticketId: 5n, personId: 1n, personName: "P", task: "proef", workId: [], budgetCents: 100n, expiresAt: 0n } })),
    submitProposal: async () => ({ ok: 9n }),
    reportAiUsage: async () => ({ ok: null }),
    failAiTicket: async () => ({ ok: null }),
  };
  const cfg = loadConfig({ ...base, HTTP_PORT: "0" });
  const sleutels = new Sleutels({ ANTHROPIC_API_KEY: "sk-ant-geheim-abcdefghijk", XAI_API_KEY: "xai-oud-abcdefghijk", XAI_API_KEY_VOLGENDE: "xai-nieuw-abcdefghijk" });
  const server = startHttp({ cfg: { ...cfg, staatDir: "" }, robot, principal: "robot-principal", stats: newStats(), sleutels });
  await new Promise((r) => server.once("listening", r));
  const port = (server.address() as { port: number }).port;
  const url = (p: string) => `http://127.0.0.1:${port}${p}`;
  const ruw = await (await fetch(url("/health"))).text();
  const h = JSON.parse(ruw);
  assert.equal(h.status, "ok");
  assert.equal(h.robot, "robot-principal");
  assert.deepEqual(h.adapters, { claude: true, grok: true, nep: false });
  assert.deepEqual(h.sleutel, { claude: "hoofd", grok: "volgende actief" });
  assert.ok(!/geheim|xai-|sk-|ROBOT_KEY/.test(ruw), "geen sleutel of lengte in /health");
  const post = (b: unknown) => fetch(url("/task"), { method: "POST", body: JSON.stringify(b) });
  assert.equal((await post({ ticket: "TK-abcdefgh12" })).status, 202);
  assert.equal((await post({ ticket: "TK-abcdefgh12" })).status, 403);
  assert.equal((await post({ ticket: "<script>" })).status, 400);
  assert.equal((await fetch(url("/x"))).status, 404);
  assert.equal((await (await fetch(url("/health"))).json()).proeftaken, 1);
  server.close();
});
