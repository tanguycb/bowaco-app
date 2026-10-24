// End-to-end proef van de postbode (1b.3): de ECHTE gateway (gateway/src/main.ts) als robot tegen een canister.
// Er wordt NOOIT een echte mail verstuurd:
//   lokaal (ICP_HOST=http://localhost:…): Brevo wordt nagebootst door een kleine HTTP-server hier (mailvanger) die
//     elke aanvraag bijhoudt; de gateway gebruikt exact dezelfde code als op de server (MAIL_PROVIDER=brevo, testmodus).
//   draft: MAIL_PROVIDER=bestand: de mails komen als bestanden in een map buiten git (de "lokale mailvanger").
// De proef spreekt enkel de proeffirma "Proef Dak NV" aan (adres planning@proef-dak.invalid) en een proefmail naar
// eigen@proef.invalid; nooit de echte firma's (E-0). Draait na tests/rollen.mjs (lokaal) of op een draft met P-B.
//   node tests/postbode-proef.mjs <canister-id>
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backend, identity, KEYDIR, ok } from "../tools/lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/postbode-proef.mjs <canister-id>");
const host = process.env.ICP_HOST || "https://icp-api.io";
const local = host.includes("localhost") || host.includes("127.0.0.1");
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const repo = join(import.meta.dirname, "..");
const tmp = mkdtempSync(join(tmpdir(), "postbode-proef-"));

const admin = await backend("proef-admin", cid);
const wl = await backend("proef-werfleider", cid);
const robotName = "robot-gateway";
identity(robotName); // maakt ~/.bowaco/robot-gateway.json als het nog niet bestaat (zelfde vorm als gateway/src/sleutel.ts)
const robotP = identity(robotName).getPrincipal();
const B = (await admin.listWorks()).find((w) => w.code === "P-B")?.id;
const dak = (await admin.listOrgs(false)).find((o) => o.name === "Proef Dak NV");
if (B === undefined || !dak) throw new Error("P-B of Proef Dak NV ontbreekt");

// Robot registreren (soort mail); bestaat hij al (een vorige run), dan is dat goed.
const reg = await admin.addRobot(robotP, "Postbode (proef)", ["mail"]);
check("postbode (proef) als robot met de soort mail", "ok" in reg || /bestaat al/.test(reg.err), JSON.stringify(reg));
check("adres van de proeffirma", "ok" in (await admin.saveOrgContact(dak.id, { phone: [], email: ["planning@proef-dak.invalid"], website: [], contactNote: "" })));
const prevSettings = await admin.postSettings();
if (!prevSettings.appUrl) ok(await admin.setPostSettings({ weekmail: prevSettings.weekmail, reminders: prevSettings.reminders, day: prevSettings.day, hour: prevSettings.hour, reminderDay: prevSettings.reminderDay, appUrl: "https://splendid-tan-31l-draft.caffeine.xyz/" }));
// Een VERSE week met werk van Proef Dak NV op P-B: elke run een nieuwe proeftaak een week later (zo bestaat de
// idempotentiesleutel van die week nog niet en gaat de weekmail echt door de gateway).
let plan = await admin.getPlan(B);
const n = plan.tasks.filter((t) => t.title.startsWith("Postbode proef")).length;
const today = BigInt(Math.floor(Date.now() / 86_400_000));
const monday = today - BigInt((Number(today) + 3) % 7) + 7n * BigInt(6 + n);
const st = await admin.saveTask(B, { id: [], title: `Postbode proef ${n + 1}`, note: "", kind: { work: null }, trade: [], responsibleOrgId: [dak.id], status: { planned: null }, percent: 0n, start: monday + 1n, workdays: 2n, leadDays: 0n, orderDay: [], reason: "postbodeproef" }, plan.version);
if (!("ok" in st)) throw new Error(st.err);
// Opdrachten die nog open staan van vorige runs: weg (anders telt deze proef ze mee).
for (const j of await admin.listJobs("open", 0n, 200n)) if (/Proef Dak|^$/.test(j.orgName) || j.kind === "proef") await admin.cancelJob(j.id);
const qw = ok(await admin.queueWeekMails(monday, [dak.id]));
check("weekmail voor Proef Dak NV in een verse week: 1 nieuw", qw === 1n, String(qw));
// Een herhaalde run van deze proef: de opdracht van die week bestaat al (idempotentiesleutel) → dan een nieuwe week erbij
// is niet nodig; de proefmail volstaat om de lus te bewijzen.
const tm = ok(await admin.queueTestMail("eigen@proef.invalid"));
const open0 = (await admin.listJobs("open", 0n, 200n)).filter((j) => j.kind === "proef" || j.orgName === "Proef Dak NV");
check("opdrachten in de wachtrij (weekmail Proef Dak NV en een proefmail)", open0.some((j) => j.id === tm), `weekmail nieuw: ${qw}`);

// ── Mailvanger: lokaal een nagebootste Brevo, op de draft een map ─────────
const seen = [];
let mode503 = false;
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    seen.push({ url: req.url, headers: req.headers, body: JSON.parse(body || "{}") });
    if (mode503) { res.writeHead(503); return res.end(); }
    res.writeHead(201, { "content-type": "application/json" });
    res.end(JSON.stringify({ messageId: `<proef-${seen.length}@mailvanger>` }));
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const env = {
  ...process.env,
  BOWACO_CANISTER: cid,
  IC_HOST: host,
  ROBOT_KEY_FILE: join(KEYDIR, `${robotName}.json`),
  MAIL_PROVIDER: local ? "brevo" : "bestand",
  BREVO_API_KEY: "proef-sleutel-geen-echte",
  BREVO_URL: `http://127.0.0.1:${port}/v3/smtp/email`,
  BREVO_SANDBOX: "1",
  MAIL_DIR: join(tmp, "mails"),
  MAIL_FROM: "BOWACO werven <planning@proef.invalid>",
  JOURNAL_FILE: join(tmp, "journaal.jsonl"),
  POLL_SECONDS: "15",
  HTTP_PORT: String(port + 1),
};
const runOnce = () => new Promise((resolve) => {
  const p = spawn(process.execPath, [join(repo, "gateway/src/main.ts"), "--eenmaal"], { env, cwd: join(repo, "gateway") });
  let out = "";
  p.stdout.on("data", (d) => (out += d));
  p.stderr.on("data", (d) => (out += d));
  p.on("close", (code) => resolve({ code, out }));
});

const r1 = await runOnce();
console.log(r1.out.trim().split("\n").map((l) => `    ${l}`).join("\n"));
const done1 = await admin.listJobs("alles", 0n, 200n);
const jt = done1.find((j) => j.id === tm);
check("de gateway verstuurt en meldt klaar (proefmail)", jt && "done" in jt.state, JSON.stringify(jt?.state, big));
if (local) {
  const mails = seen.filter((s) => s.url === "/v3/smtp/email");
  const test = mails.find((m) => m.body.to?.[0]?.email === "eigen@proef.invalid");
  check("Brevo-aanvraag: api-key in de header, testmodus en idempotencyKey in de body", !!test && test.headers["api-key"] === "proef-sleutel-geen-echte" && test.body.headers["X-Sib-Sandbox"] === "drop" && /^[0-9a-f-]{36}$/.test(test.body.headers.idempotencyKey));
  const wk = mails.find((m) => m.body.to?.[0]?.email === "planning@proef-dak.invalid");
  check("weekmail aan Proef Dak NV: werf P-B met de proeftaak, HTML ontsnapt, platte tekst erbij", !!wk && wk.body.htmlContent.includes("P-B") && wk.body.textContent.includes(`Postbode proef ${n + 1}`) && !wk.body.htmlContent.includes("<script"), wk ? wk.body.subject : "geen");
  // Brevo onbereikbaar (503): de opdracht gaat terug in de wachtrij met wachttijd, niets verloren
  const tm2 = ok(await admin.queueTestMail("eigen@proef.invalid"));
  mode503 = true;
  await runOnce();
  mode503 = false;
  const j2 = (await admin.listJobs("open", 0n, 200n)).find((j) => j.id === tm2);
  check("Brevo 503 → opdracht terug in de wachtrij (poging 1), later opnieuw", j2 && "queued" in j2.state && j2.attempts === 1n, JSON.stringify(j2, big));
  await admin.cancelJob(tm2);
} else {
  const files = readdirSync(join(tmp, "mails"));
  check("mailvanger (bestand): de proefmail als .html/.txt/.json", files.some((f) => f.endsWith("-proef.txt")) && readFileSync(join(tmp, "mails", files.find((f) => f.endsWith("-proef.txt"))), "utf8").includes("eigen@proef.invalid"), files.join(", "));
  check("mailvanger: de weekmail van Proef Dak NV met werf P-B en de proeftaak", files.some((f) => f.endsWith("-weekplanning.txt") && readFileSync(join(tmp, "mails", f), "utf8").includes(`Postbode proef ${n + 1}`)), files.join(", "));
}
check("logboek van de gateway: sleutels, geen adressen", !readFileSync(join(tmp, "journaal.jsonl"), "utf8").includes("@proef"));
const r2 = await runOnce();
check("tweede ronde: niets meer te doen", /één ronde: 0 opdrachten/.test(r2.out), r2.out.trim().split("\n").pop());

// ── HTTP: /health en /task (checkTicket + één voorstel) ───────────────────
const srv = spawn(process.execPath, [join(repo, "gateway/src/main.ts")], { env, cwd: join(repo, "gateway") });
let srvOut = "";
srv.stdout.on("data", (d) => (srvOut += d));
srv.stderr.on("data", (d) => (srvOut += d));
const base = `http://127.0.0.1:${port + 1}`;
let health = null;
for (let i = 0; i < 40 && !health; i++) {
  await new Promise((r) => setTimeout(r, 250));
  health = await fetch(`${base}/health`).then((r) => r.json()).catch(() => null);
}
check("/health: status ok, robotprincipal, testmodus, geen geheimen", health?.status === "ok" && health.robot === robotP.toText() && health.testmodus === true && !JSON.stringify(health).includes("proef-sleutel"), JSON.stringify(health));
const tk = ok(await wl.createTicket("proef", [B]));
const before = (await wl.myProposals()).length;
const tr = await fetch(`${base}/task`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket: tk.ticket }) });
check("/task: ticket gecontroleerd en één voorstel geschreven (202)", tr.status === 202 && (await wl.myProposals()).length === before + 1, String(tr.status));
const tr2 = await fetch(`${base}/task`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket: tk.ticket }) });
check("/task: hetzelfde ticket nog eens geweigerd (403)", tr2.status === 403);
check("/task: rommel geweigerd (400)", (await fetch(`${base}/task`, { method: "POST", body: "{}" })).status === 400);
check("andere paden: 404", (await fetch(`${base}/geheim`)).status === 404);
srv.kill("SIGTERM");
server.close();
rmSync(tmp, { recursive: true, force: true });
// Opruimen: de proefrobot blijft geregistreerd (testidentiteit); open proefopdrachten weg.
for (const j of await admin.listJobs("open", 0n, 200n)) if (j.kind === "proef" || j.orgName === "Proef Dak NV") await admin.cancelJob(j.id);
console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
