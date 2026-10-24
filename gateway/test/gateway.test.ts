// Eenheidstesten van de gateway zonder netwerk (sinds mail-caffeine zonder mail): instellingen (oude mailregels
// geweigerd), /health zonder geheimen, /task met een nagebootste app (ticket eenmalig, rommel geweigerd, rest 404).
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { newStats, startHttp } from "../src/http.ts";
import type { Robot } from "../src/ic.ts";

const base = { BOWACO_CANISTER: "aaaaa-aa", ROBOT_KEY_FILE: "x" };

test("instellingen: canister en sleutel verplicht; geen mail meer", () => {
  assert.throws(() => loadConfig({}), /BOWACO_CANISTER/);
  const c = loadConfig({ ...base, HTTP_PORT: "9999" });
  assert.equal(c.httpPort, 9999);
  assert.equal(c.httpHost, "127.0.0.1");
  assert.equal(c.local, false);
  assert.throws(() => loadConfig({ ...base, BREVO_API_KEY: "xkeysib-1" }), /maildienst van Caffeine/);
  assert.throws(() => loadConfig({ ...base, MAIL_PROVIDER: "brevo" }), /niet meer gebruikt/);
});

test("http: /health zonder geheimen, /task eenmalig, rommel 400, rest 404", async () => {
  const used = new Set<string>();
  const robot: Robot = {
    checkTicket: async (t) => (used.has(t) ? { err: "Ticket al gebruikt" } : (used.add(t), { ok: { ticketId: 5n, personId: 1n, personName: "P", task: "proef", workId: [], budgetCents: 100n, expiresAt: 0n } })),
    submitProposal: async () => ({ ok: 9n }),
  };
  const cfg = loadConfig({ ...base, HTTP_PORT: "0" });
  const server = startHttp(cfg, robot, "robot-principal", newStats());
  await new Promise((r) => server.once("listening", r));
  const port = (server.address() as { port: number }).port;
  const url = (p: string) => `http://127.0.0.1:${port}${p}`;
  const h = await (await fetch(url("/health"))).json();
  assert.equal(h.status, "ok");
  assert.equal(h.robot, "robot-principal");
  assert.ok(!JSON.stringify(h).includes("ROBOT_KEY") && !("verstuurd" in h));
  const post = (b: unknown) => fetch(url("/task"), { method: "POST", body: JSON.stringify(b) });
  assert.equal((await post({ ticket: "TK-abcdefgh12" })).status, 202);
  assert.equal((await post({ ticket: "TK-abcdefgh12" })).status, 403);
  assert.equal((await post({ ticket: "<script>" })).status, 400);
  assert.equal((await fetch(url("/x"))).status, 404);
  assert.equal((await (await fetch(url("/health"))).json()).taken, 1);
  server.close();
});
