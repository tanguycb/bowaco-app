// Gateway v2 (3.1-B3) zonder netwerk: een nagebootste app (Robot) en de nep-leverancier; claude/grok met een
// nagebootste fetch (opgenomen antwoordvorm). Geen echte oproep naar Anthropic of xAI.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { crc32, deflateRawSync } from "node:zlib";
import { controleer, herken, invoerHash, xlsxNaarCsv } from "../src/bestanden.ts";
import { Budget } from "../src/budget.ts";
import { type Config, loadConfig } from "../src/config.ts";
import { startHttp } from "../src/http.ts";
import type { AiUsage, Robot, TicketInfo } from "../src/ic.ts";
import { maakClaude } from "../src/leveranciers/claude.ts";
import { maakGrok } from "../src/leveranciers/grok.ts";
import { maakLeveranciers } from "../src/leveranciers/index.ts";
import { maakNep } from "../src/leveranciers/nep.ts";
import { Logboek } from "../src/logboek.ts";
import { proefbank } from "../src/proef.ts";
import { Sleutels, scrub } from "../src/sleutels.ts";
import { standaardTaken } from "../src/taken/index.ts";
import type { TaakDef } from "../src/taken/taak.ts";

const ORIGIN = "https://app.voorbeeld.example.com";
const SLEUTEL_CLAUDE = "sk-ant-proef-ECHTGEHEIM-0123456789abcdef";
const GEHEIME_TEKST = "GEHEIME-INVOERTEKST-klant-Janssens";
const BESTANDSNAAM = "Klant Janssens offerte.pdf";

// --- nagebootste app ---------------------------------------------------------------------------------------------
type T = { info: TicketInfo; staat: "open" | "gebruikt"; verlopen?: boolean };
function nepApp() {
  const tickets = new Map<string, T>();
  const voorstellen: { ticketId: bigint; kind: string; content: string }[] = [];
  const usage: { ticketId: bigint; u: AiUsage }[] = [];
  const fails: { ticketId: bigint; why: string }[] = [];
  let n = 0;
  const robot: Robot = {
    async checkTicket(tk) {
      const t = tickets.get(tk);
      if (!t) return { err: "Onbekend ticket" };
      if (t.staat !== "open") return { err: "Ticket al gebruikt of verlopen" };
      if (t.verlopen) return { err: "Ticket verlopen" };
      t.staat = "gebruikt";
      return { ok: t.info };
    },
    async submitProposal(ticketId, kind, content) {
      if (voorstellen.some((v) => v.ticketId === ticketId)) return { err: "Er is al een voorstel" };
      voorstellen.push({ ticketId, kind, content });
      return { ok: BigInt(100 + voorstellen.length) };
    },
    async reportAiUsage(ticketId, u) {
      if (usage.some((x) => x.ticketId === ticketId)) return { err: "al gemeld" };
      usage.push({ ticketId, u });
      return { ok: null };
    },
    async failAiTicket(ticketId, why) {
      fails.push({ ticketId, why });
      return { ok: null };
    },
  };
  const ticket = (task: string, o: { budget?: number; persoon?: number; verlopen?: boolean; model?: string } = {}) => {
    n++;
    const tk = `TK-test${String(n).padStart(6, "0")}`;
    tickets.set(tk, {
      staat: "open",
      verlopen: o.verlopen,
      info: { ticketId: BigInt(n), personId: BigInt(o.persoon ?? n), personName: "P", task, workId: [901n], budgetCents: BigInt(o.budget ?? 100), expiresAt: 0n, model: o.model ? [o.model] : [], fallbackModel: [], payloadRef: [`call-${n}`] },
    });
    return { tk, id: BigInt(n) };
  };
  return { robot, ticket, tickets, voorstellen, usage, fails };
}

// --- testtaak met bestanden --------------------------------------------------------------------------------------
const docSchema = { type: "object", additionalProperties: false, required: ["firma", "totaal"], properties: { firma: { type: "string" }, totaal: { type: "number" } } };
const testDocs = (terugval = true): TaakDef => ({
  key: terugval ? "test-docs" : "test-docs-strikt",
  actief: true,
  bestanden: { max: 3, soorten: ["pdf", "png", "jpeg", "xlsx", "csv"] },
  modellen: ["nep/echo", "nep/fout-opnieuw", "nep/fout-ongeldig", "nep/fout-lek", "nep/traag", "claude/sonnet-5.5", "grok/grok-4"],
  standaardModel: "nep/echo",
  terugval,
  instructies: { 1: { schemaVersie: 1, maxUit: 400, systeem: "Lees de offerte.", schema: docSchema } },
  voorbeeld: { firma: "Firma Voorbeeld bv", totaal: 1234.5 },
});

// Minimale bestanden met de juiste magic bytes.
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Pages /Count 1 >> endobj\n2 0 obj << /Type /Page >> endobj\n%%EOF\n");
const png = (w: number, h: number) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};
const EXE = Buffer.from("MZ\x90\x00\x03\x00\x00\x00binair\x00\x00", "latin1");

// Kleine zip-schrijver (stored + deflate) om een echte XLSX te bouwen.
function zip(entries: Record<string, string>): Buffer {
  const lokaal: Buffer[] = [];
  const centraal: Buffer[] = [];
  let off = 0;
  for (const [naam, inhoud] of Object.entries(entries)) {
    const ruw = Buffer.from(inhoud, "utf8");
    const comp = deflateRawSync(ruw);
    const nm = Buffer.from(naam, "utf8");
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc32(ruw), 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(ruw.length, 22);
    lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc32(ruw), 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(ruw.length, 24);
    ch.writeUInt16LE(nm.length, 28);
    ch.writeUInt32LE(off, 42);
    lokaal.push(lh, nm, comp);
    centraal.push(ch, nm);
    off += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(centraal);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0);
  e.writeUInt16LE(centraal.length / 2, 8);
  e.writeUInt16LE(centraal.length / 2, 10);
  e.writeUInt32LE(cd.length, 12);
  e.writeUInt32LE(off, 16);
  return Buffer.concat([...lokaal, cd, e]);
}
const XLSX = zip({
  "[Content_Types].xml": "<Types/>",
  "xl/workbook.xml": '<workbook><sheets><sheet name="Meetstaat" sheetId="1" r:id="rId1"/></sheets></workbook>',
  "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
  "xl/sharedStrings.xml": "<sst><si><t>Post</t></si><si><t>Metselwerk, gevel</t></si></sst>",
  "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Bedrag</t></is></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="C2"><v>1250.5</v></c></row></sheetData></worksheet>',
});

// --- opstelling --------------------------------------------------------------------------------------------------
type Opstelling = { server: Server; port: number; app: ReturnType<typeof nepApp>; staat: string; cfg: Config; claudeOproepen: { url: string; init: RequestInit }[] };

async function start(env: Record<string, string> = {}, o: { claudeSleutel?: boolean; claudeAntwoord?: (init: RequestInit) => Response } = {}): Promise<Opstelling> {
  const staat = mkdtempSync(join(tmpdir(), "gw-v2-"));
  const cfg = loadConfig({ BOWACO_CANISTER: "aaaaa-aa", ROBOT_KEY_FILE: "x", HTTP_PORT: "0", ALLOW_ORIGIN: ORIGIN, GATEWAY_NEP: "1", GATEWAY_STAAT: staat, ...env });
  const app = nepApp();
  const sleutels = new Sleutels(o.claudeSleutel === false ? {} : { ANTHROPIC_API_KEY: SLEUTEL_CLAUDE });
  const claudeOproepen: Opstelling["claudeOproepen"] = [];
  const nepFetch = (async (url: string, init: RequestInit) => {
    claudeOproepen.push({ url: String(url), init });
    return o.claudeAntwoord ? o.claudeAntwoord(init) : claudeOk({ firma: "Firma Voorbeeld bv", totaal: 99 });
  }) as unknown as typeof fetch;
  const lev = maakLeveranciers(cfg, sleutels, nepFetch);
  const taken = standaardTaken();
  taken.set("test-docs", testDocs(true));
  taken.set("test-docs-strikt", testDocs(false));
  const server = startHttp({ cfg, robot: app.robot, principal: "robot-test", sleutels, leveranciers: lev, taken, budget: new Budget(staat, cfg.plafond), logboek: new Logboek(staat) });
  await new Promise((r) => server.once("listening", r));
  return { server, port: (server.address() as { port: number }).port, app, staat, cfg, claudeOproepen };
}

const claudeOk = (json: unknown) =>
  new Response(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(json) }], usage: { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 0 } }), { status: 200 });

async function stuur(
  s: Opstelling,
  o: { ticket: string; tekst?: string; bestanden?: Buffer[]; origin?: string | null; extra?: Record<string, unknown>; sha?: string; versie?: number },
): Promise<{ status: number; body: Record<string, unknown>; ruw: string; headers: Headers }> {
  const tekst = o.tekst ?? `Bij welke werf hoort dit? ${GEHEIME_TEKST}`;
  const bestanden = o.bestanden ?? [];
  const fd = new FormData();
  fd.set("ticket", o.ticket);
  fd.set("invoer", JSON.stringify({ tekst, refs: ["quote-1"], instructieVersie: o.versie ?? 1, schemaVersie: 1, sha256: o.sha ?? invoerHash(tekst, bestanden.map((bytes) => ({ bytes }))), ...(o.extra ?? {}) }));
  for (const b of bestanden) fd.append("bestand", new Blob([b], { type: "application/pdf" }), BESTANDSNAAM);
  const headers: Record<string, string> = {};
  if (o.origin !== null) headers.origin = o.origin ?? ORIGIN;
  const res = await fetch(`http://127.0.0.1:${s.port}/v2/taak`, { method: "POST", body: fd, headers });
  const ruw = await res.text();
  return { status: res.status, body: JSON.parse(ruw), ruw, headers: res.headers };
}

const logRegels = (s: Opstelling) => {
  const dir = join(s.staat, "log");
  return readdirSync(dir).flatMap((f) => readFileSync(join(dir, f), "utf8").trim().split("\n").filter(Boolean));
};

// --- tests ------------------------------------------------------------------------------------------------------
describe("v2 /v2/taak met nep-leverancier en nep-app", () => {
  let s: Opstelling;
  before(async () => {
    s = await start();
  });
  after(() => s.server.close());

  test("geslaagd: 202, voorstel in de app, kost gemeld, CORS enkel voor de app-origin", async () => {
    const { tk, id } = s.app.ticket("routering");
    const r = await stuur(s, { ticket: tk, extra: { model: "nep/echo" } });
    assert.equal(r.status, 202, r.ruw);
    assert.equal(r.body.taak, "routering");
    assert.equal(r.body.callId, `call-${id}`);
    assert.equal(r.headers.get("access-control-allow-origin"), ORIGIN);
    const v = s.app.voorstellen.find((x) => x.ticketId === id)!;
    assert.equal(v.kind, "ai:routering");
    assert.deepEqual(JSON.parse(v.content), { werf: "W-901", documentsoort: "oa-offerte", firma: "Firma Voorbeeld bv", vertrouwen: 0.9 });
    const u = s.app.usage.find((x) => x.ticketId === id)!.u;
    assert.equal(u.model, "nep/echo");
    assert.equal(u.outputSha256[0], createHash("sha256").update(v.content).digest("hex"));
    assert.equal(r.body.terugval, false);
    assert.ok(!s.app.fails.some((x) => x.ticketId === id));
  });

  test("ticket ongeldig / gebruikt / verlopen → 403 ticket; vorm fout → 400", async () => {
    const nep = { model: "nep/echo" };
    assert.equal((await stuur(s, { ticket: "TK-bestaatniet01" })).body.code, "ticket");
    const { tk } = s.app.ticket("routering");
    assert.equal((await stuur(s, { ticket: tk, extra: nep })).status, 202);
    const tweede = await stuur(s, { ticket: tk, extra: nep });
    assert.equal(tweede.status, 403);
    assert.match(String(tweede.body.fout), /gebruikt/);
    const oud = s.app.ticket("routering", { verlopen: true });
    const v = await stuur(s, { ticket: oud.tk });
    assert.equal(v.status, 403);
    assert.match(String(v.body.fout), /verlopen/);
    const vorm = await stuur(s, { ticket: "<script>" });
    assert.equal(vorm.status, 400);
    assert.equal(vorm.body.code, "ticket-vorm");
  });

  test("Origin: vreemd of ontbrekend → 403 origin zonder CORS-headers; preflight idem; ticket niet verbruikt", async () => {
    const { tk } = s.app.ticket("routering");
    const vreemd = await stuur(s, { ticket: tk, origin: "https://kwaad.example.net" });
    assert.equal(vreemd.status, 403);
    assert.equal(vreemd.body.code, "origin");
    assert.equal(vreemd.headers.get("access-control-allow-origin"), null);
    assert.equal((await stuur(s, { ticket: tk, origin: null })).status, 403);
    assert.equal(s.app.tickets.get(tk)!.staat, "open");
    const pre = await fetch(`http://127.0.0.1:${s.port}/v2/taak`, { method: "OPTIONS", headers: { origin: "https://kwaad.example.net" } });
    assert.equal(pre.status, 403);
    assert.equal(pre.headers.get("access-control-allow-origin"), null);
    const preOk = await fetch(`http://127.0.0.1:${s.port}/v2/taak`, { method: "OPTIONS", headers: { origin: ORIGIN } });
    assert.equal(preOk.status, 204);
    assert.equal(preOk.headers.get("access-control-allow-origin"), ORIGIN);
    assert.equal((await fetch(`http://127.0.0.1:${s.port}/v2/taken`, { headers: { origin: "https://kwaad.example.net" } })).status, 403);
    const taken = await (await fetch(`http://127.0.0.1:${s.port}/v2/taken`)).json();
    assert.ok(taken.some((t: { key: string }) => t.key === "routering"));
    assert.ok(!taken.some((t: { key: string }) => t.key === "oa-offerte-inlezen"), "stubs staan uit");
  });

  test("bestanden: 11 → 422, 21 MB → 413, verkeerde magic bytes → 415, hash fout → 400; ticket niet verbruikt", async () => {
    const { tk } = s.app.ticket("test-docs");
    const elf = await stuur(s, { ticket: tk, bestanden: Array.from({ length: 11 }, () => PDF) });
    assert.equal(elf.status, 422);
    assert.equal(elf.body.code, "bestanden");
    const groot = await stuur(s, { ticket: tk, bestanden: [Buffer.concat([PDF, Buffer.alloc(21 * 1024 * 1024)])] });
    assert.equal(groot.status, 413);
    assert.equal(groot.body.code, "grootte");
    const exe = await stuur(s, { ticket: tk, bestanden: [EXE] });
    assert.equal(exe.status, 415);
    assert.equal(exe.body.code, "bestand");
    const hash = await stuur(s, { ticket: tk, bestanden: [PDF], sha: "0".repeat(64) });
    assert.equal(hash.status, 400);
    assert.equal(hash.body.code, "hash");
    assert.equal(s.app.tickets.get(tk)!.staat, "open", "fouten vóór checkTicket verbruiken het ticket niet");
    // Een PNG met de mime "application/pdf": de soort komt uit de inhoud.
    assert.equal(herken(png(10, 10))?.soort, "png");
    const ok = await stuur(s, { ticket: tk, bestanden: [PDF, png(800, 600), XLSX] });
    assert.equal(ok.status, 202, ok.ruw);
  });

  test("bestanden passen niet bij de taak → 422 bestanden + failAiTicket", async () => {
    const { tk, id } = s.app.ticket("routering");
    const r = await stuur(s, { ticket: tk, bestanden: [PDF] });
    assert.equal(r.status, 422);
    assert.equal(r.body.code, "bestanden");
    assert.ok(s.app.fails.some((x) => x.ticketId === id));
  });

  test("onbekende of uitgeschakelde taak → 422 taak; model niet toegelaten → 422 model", async () => {
    for (const task of ["bestaat-niet", "oa-offerte-inlezen"]) {
      const { tk, id } = s.app.ticket(task);
      const r = await stuur(s, { ticket: tk });
      assert.equal(r.status, 422);
      assert.equal(r.body.code, "taak");
      assert.ok(s.app.fails.some((x) => x.ticketId === id));
    }
    const { tk } = s.app.ticket("routering");
    const m = await stuur(s, { ticket: tk, extra: { model: "claude/opus-5.5" } });
    assert.equal(m.status, 422);
    assert.equal(m.body.code, "model");
  });

  test("budget: ticketbudget 0 → 429 budget + failAiTicket, niets bij de leverancier", async () => {
    const { tk, id } = s.app.ticket("routering", { budget: 0 });
    const r = await stuur(s, { ticket: tk, extra: { model: "nep/echo" } });
    assert.equal(r.status, 429);
    assert.equal(r.body.code, "budget");
    assert.match(s.app.fails.find((x) => x.ticketId === id)!.why, /^budget/);
    assert.ok(!s.app.usage.some((x) => x.ticketId === id), "geen kost gemeld: er is niets gebeurd");
  });

  test("leverancier faalt: opnieuw → 502 zonder terugval als die niet toegelaten is", async () => {
    const { tk, id } = s.app.ticket("routering");
    const r = await stuur(s, { ticket: tk, extra: { model: "nep/fout-opnieuw" } });
    assert.equal(r.status, 502);
    assert.equal(r.body.code, "leverancier");
    assert.ok(s.app.fails.some((x) => x.ticketId === id));
    const zonder = s.claudeOproepen.length;
    // Taak die geen terugval toelaat: ook met terugvalModel geen 2e leverancier.
    const st = s.app.ticket("test-docs-strikt");
    const r2 = await stuur(s, { ticket: st.tk, extra: { model: "nep/fout-opnieuw", terugvalModel: "claude/sonnet-5.5" } });
    assert.equal(r2.status, 502);
    // Ongeldig valt nooit terug.
    const og = s.app.ticket("test-docs");
    const r3 = await stuur(s, { ticket: og.tk, extra: { model: "nep/fout-ongeldig", terugvalModel: "claude/sonnet-5.5" } });
    assert.equal(r3.status, 502);
    assert.equal(s.claudeOproepen.length, zonder, "claude nooit gebeld");
  });

  test("terugval naar de 2e leverancier als toegelaten (opnieuw → claude)", async () => {
    const { tk, id } = s.app.ticket("test-docs");
    const r = await stuur(s, { ticket: tk, bestanden: [PDF], extra: { model: "nep/fout-opnieuw", terugvalModel: "claude/sonnet-5.5" } });
    assert.equal(r.status, 202, r.ruw);
    assert.equal(r.body.model, "claude/sonnet-5.5");
    assert.equal(r.body.terugval, true);
    const u = s.app.usage.find((x) => x.ticketId === id)!.u;
    assert.ok(!s.app.fails.some((x) => x.ticketId === id));
    assert.equal(u.promptTokens, 1200n);
    // Kost uit de prijstabel: 1200 × 2 + 80 × 10 = 3 200 µUSD → 1 cent (koers 1,000, naar boven).
    assert.equal(u.costCents, 1n);
    // Vorm van het verzoek aan Anthropic.
    const o = s.claudeOproepen.at(-1)!;
    assert.equal(o.url, "https://api.anthropic.com/v1/messages");
    const h = o.init.headers as Record<string, string>;
    assert.equal(h["x-api-key"], SLEUTEL_CLAUDE);
    assert.equal(h["anthropic-version"], "2026-10-21");
    const body = JSON.parse(String(o.init.body));
    assert.equal(body.model, "claude-sonnet-5-5");
    assert.equal(body.output_config.format.type, "json_schema");
    assert.equal(body.messages[0].content[0].type, "document");
    assert.ok(!("temperature" in body) && !("tool_choice" in body));
  });

  test("traag → 504 tijd + failAiTicket('onzeker'); twee tegelijk voor dezelfde persoon → 429 bezet", async () => {
    const s2 = await start({ GATEWAY_TIJDSLIMIET_MS: "300" });
    try {
      const a = s2.app.ticket("routering", { persoon: 7 });
      const b = s2.app.ticket("routering", { persoon: 7 });
      const eerste = stuur(s2, { ticket: a.tk, extra: { model: "nep/traag" } });
      await new Promise((r) => setTimeout(r, 100));
      const tweede = await stuur(s2, { ticket: b.tk, extra: { model: "nep/echo" } });
      assert.equal(tweede.status, 429);
      assert.equal(tweede.body.code, "bezet");
      assert.ok(s2.app.fails.some((x) => x.ticketId === b.id && /^bezet/.test(x.why)));
      const r = await eerste;
      assert.equal(r.status, 504);
      assert.equal(r.body.code, "tijd");
      assert.equal(s2.app.fails.find((x) => x.ticketId === a.id)!.why, "onzeker");
      assert.deepEqual(s2.app.usage.find((x) => x.ticketId === a.id)!.u.outputSha256, []);
    } finally {
      s2.server.close();
    }
  });

  test("plafond van de gateway op → 429 budget", async () => {
    const s3 = await start({ GATEWAY_MAANDPLAFOND_CENT: "0" });
    try {
      const { tk } = s3.app.ticket("routering");
      const r = await stuur(s3, { ticket: tk, extra: { model: "nep/echo" } });
      assert.equal(r.status, 429);
      assert.equal(r.body.code, "budget");
    } finally {
      s3.server.close();
    }
  });

  test("sleutel ontbreekt → 503 sleutel", async () => {
    const s4 = await start({}, { claudeSleutel: false });
    try {
      const { tk } = s4.app.ticket("test-docs");
      const r = await stuur(s4, { ticket: tk, extra: { model: "claude/sonnet-5.5" } });
      assert.equal(r.status, 503);
      assert.equal(r.body.code, "sleutel");
      assert.equal(s4.claudeOproepen.length, 0);
    } finally {
      s4.server.close();
    }
  });

  test("geen sleutel in fouten, failAiTicket of logboek (leverancier lekt hem, of 401 met de sleutel erin)", async () => {
    const lek = s.app.ticket("routering");
    const r = await stuur(s, { ticket: lek.tk, extra: { model: "nep/fout-lek" } });
    assert.equal(r.status, 502);
    assert.ok(!r.ruw.includes("sk-ant-nep"), r.ruw);
    assert.ok(!s.app.fails.find((x) => x.ticketId === lek.id)!.why.includes("sk-ant-nep"));
    const s5 = await start({}, { claudeAntwoord: () => new Response(`{"error":{"message":"invalid x-api-key: ${SLEUTEL_CLAUDE}"}}`, { status: 401 }) });
    try {
      const { tk, id } = s5.app.ticket("test-docs");
      const r2 = await stuur(s5, { ticket: tk, extra: { model: "claude/sonnet-5.5" } });
      assert.equal(r2.status, 503);
      assert.ok(!r2.ruw.includes("ECHTGEHEIM"), r2.ruw);
      assert.ok(!s5.app.fails.find((x) => x.ticketId === id)!.why.includes("ECHTGEHEIM"));
      for (const l of logRegels(s5)) assert.ok(!l.includes("ECHTGEHEIM") && !l.includes("sk-ant"), l);
      const health = await (await fetch(`http://127.0.0.1:${s5.port}/health`)).text();
      assert.ok(!health.includes("ECHTGEHEIM"));
    } finally {
      s5.server.close();
    }
    for (const l of logRegels(s)) assert.ok(!l.includes("sk-ant"), l);
    assert.equal(scrub(`Authorization: Bearer xai-abcdefghijklmnop en sk-ant-xyz123456789 en jan@voorbeeld.example.com`), "Authorization: Bearer [sleutel] en [sleutel] en [adres]");
  });

  test("logboek: één regel per taak, zonder tekst, bestandsnaam of hash; vaste velden", async () => {
    const regels = logRegels(s).map((l) => JSON.parse(l));
    assert.ok(regels.length >= 10);
    const ruw = logRegels(s).join("\n");
    assert.ok(!ruw.includes(GEHEIME_TEKST), "geen invoertekst");
    assert.ok(!ruw.includes("Janssens"), "geen bestandsnaam");
    assert.ok(!/[0-9a-f]{64}/.test(ruw), "geen hash");
    assert.ok(!ruw.includes("TK-"), "geen ticket");
    assert.ok(!ruw.includes("Firma Voorbeeld"), "geen uitvoer");
    const velden = ["tijd", "ticketId", "personId", "workerKey", "workId", "leverancier", "model", "bestanden", "tokensIn", "tokensUit", "kostCent", "duurMs", "uitkomst", "terugval", "fout"];
    for (const r of regels) assert.deepEqual(Object.keys(r), velden);
    const ok = regels.find((r) => r.uitkomst === "ok" && r.bestanden.aantal === 3)!;
    assert.deepEqual(ok.bestanden.soorten.sort(), ["pdf", "png", "xlsx"]);
  });

  test("proefbank-samenvatting via /v2/taak → voorstel kind 'proefbank' zonder leverancier", async () => {
    const { tk, id } = s.app.ticket("proefbank", { budget: 0 });
    const sam = { workerKey: "routering", model: "nep/echo", versie: 1, gevallen: 3, score: 0.9, kostCent: 0, duurMs: 4 };
    const r = await stuur(s, { ticket: tk, tekst: JSON.stringify(sam) });
    assert.equal(r.status, 202, r.ruw);
    assert.equal(s.app.voorstellen.find((x) => x.ticketId === id)!.kind, "proefbank");
  });
});

describe("bestanden, adapters en proefbank (los)", () => {
  test("XLSX → CSV per blad; docx-achtige zip geweigerd; PDF-bladen; afbeeldingsmaat", () => {
    assert.equal(xlsxNaarCsv(XLSX, 5000), '## blad: Meetstaat\nPost,Bedrag\n"Metselwerk, gevel",,1250.5');
    assert.equal(herken(zip({ "word/document.xml": "<w/>" })), null);
    const g = loadConfig({ BOWACO_CANISTER: "a", ROBOT_KEY_FILE: "x" }).grenzen;
    const [p, i] = controleer([{ bytes: PDF }, { bytes: png(4000, 3000) }], g);
    assert.equal(p.bladen, 1);
    assert.deepEqual([i.breedte, i.hoogte], [4000, 3000]);
    const veel = Buffer.from(`%PDF-1.4\n${"<< /Type /Page >>\n".repeat(61)}`);
    assert.throws(() => controleer([{ bytes: veel }], g), /bladzijden/);
  });

  test("grok-adapter: Bearer, json_schema, afbeelding als data-URI, PDF niet; kost uit de tabel", async () => {
    let gezien: RequestInit | null = null;
    const f = (async (_u: string, init: RequestInit) => {
      gezien = init;
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: '{"firma":"X","totaal":1}' } }], usage: { prompt_tokens: 1000, completion_tokens: 100 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const grok = maakGrok({ basis: { claude: "", grok: "https://api.x.ai" } }, new Sleutels({ XAI_API_KEY: "xai-test-0000000000" }), f);
    const g = loadConfig({ BOWACO_CANISTER: "a", ROBOT_KEY_FILE: "x" }).grenzen;
    const [beeld] = controleer([{ bytes: png(10, 10) }], g);
    const u = await grok.run({ model: "grok/grok-4", systeem: "s", invoerTekst: "t", bestanden: [beeld], schema: docSchema, maxUit: 100, tijdslimietMs: 1000 });
    assert.ok(u.ok);
    assert.equal(u.kostUsdMicro, 1000 * 3 + 100 * 15);
    const h = gezien!.headers as Record<string, string>;
    assert.equal(h.authorization, "Bearer xai-test-0000000000");
    const body = JSON.parse(String(gezien!.body));
    assert.equal(body.response_format.type, "json_schema");
    assert.match(body.messages[1].content[0].image_url.url, /^data:image\/png;base64,/);
    const [pdf] = controleer([{ bytes: PDF }], g);
    const n = await grok.run({ model: "grok/grok-4", systeem: "s", invoerTekst: "t", bestanden: [pdf], schema: docSchema, maxUit: 100, tijdslimietMs: 1000 });
    assert.equal(n.ok, false);
  });

  test("claude-adapter: refusal → ongeldig, 529 → opnieuw, netfout vóór verzending → opnieuw", async () => {
    const met = (r: () => Response | Promise<Response>) => maakClaude({ basis: { claude: "https://api.anthropic.com", grok: "" } }, new Sleutels({ ANTHROPIC_API_KEY: "sk-ant-x-0000000000" }), (async () => r()) as unknown as typeof fetch);
    const t = { model: "claude/haiku-5.5", systeem: "s", invoerTekst: "t", bestanden: [], schema: docSchema, maxUit: 50, tijdslimietMs: 1000 };
    const weig = await met(() => new Response(JSON.stringify({ stop_reason: "refusal", content: [], usage: { input_tokens: 10, output_tokens: 0 } }))).run(t);
    assert.ok(!weig.ok && weig.klasse === "ongeldig");
    const druk = await met(() => new Response("overloaded", { status: 529 })).run(t);
    assert.ok(!druk.ok && druk.klasse === "opnieuw");
    const net = await met(() => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    }).run(t);
    assert.ok(!net.ok && net.klasse === "opnieuw");
    const onbekend = await met(() => new Response("{}")).run({ ...t, model: "claude/bestaat-niet" });
    assert.ok(!onbekend.ok);
  });

  test("proef.ts: testset van 3 nepgevallen, score per veld, enkel nep", async () => {
    const map = mkdtempSync(join(tmpdir(), "gw-proef-"));
    const geval = (naam: string, verwacht: unknown) => {
      mkdirSync(join(map, naam));
      writeFileSync(join(map, naam, "invoer.txt"), `Offerte voor ${naam}`);
      writeFileSync(join(map, naam, "verwacht.json"), JSON.stringify(verwacht));
    };
    geval("g1-exact", { werf: "W-901", documentsoort: "oa-offerte", firma: "Firma Voorbeeld bv", vertrouwen: 0.9 });
    geval("g2-afronding", { werf: "w-901", documentsoort: "oa-offerte", firma: "FIRMA  voorbeeld BV", vertrouwen: 0.905 });
    geval("g3-anders", { werf: "W-902", documentsoort: "oa-factuur", firma: "Firma Voorbeeld bv", vertrouwen: 0.5 });
    const lev = { ...maakLeveranciers({ basis: { claude: "https://api.anthropic.com", grok: "https://api.x.ai" }, nep: true }, new Sleutels({})), nep: maakNep(true) };
    const { samenvatting, gevallen } = await proefbank({ workerKey: "routering", map, model: "nep/echo", versie: 1, leveranciers: lev });
    assert.deepEqual(
      gevallen.map((g) => [g.geval, g.score]),
      [
        ["g1-exact", 1],
        ["g2-afronding", 1],
        ["g3-anders", 0.25],
      ],
    );
    assert.equal(samenvatting.gevallen, 3);
    assert.equal(samenvatting.score, 0.75);
    await assert.rejects(proefbank({ workerKey: "routering", map, model: "claude/sonnet-5.5", versie: 1, leveranciers: lev }), /enkel nep/);
  });

  test("sleutels: rotatie met _VOLGENDE, nooit waarde in JSON of inspect", async () => {
    const s = new Sleutels({ ANTHROPIC_API_KEY: "sk-ant-oud-111111111", ANTHROPIC_API_KEY_VOLGENDE: "sk-ant-nieuw-22222222" });
    assert.equal(s.get("claude"), "sk-ant-nieuw-22222222");
    assert.deepEqual(s.stand(), { claude: "volgende actief", grok: "geen" });
    const { inspect } = await import("node:util");
    assert.ok(!JSON.stringify(s).includes("sk-") && !inspect(s).includes("sk-"));
  });
});
