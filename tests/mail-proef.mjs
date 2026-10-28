// Proef van de mail via de maildienst van Caffeine (mail-caffeine, E-11), lokaal of op de draft. Vervangt
// tests/postbode-proef.mjs (de gateway verstuurt geen mail meer).
//   lokaal (na tests/rollen.mjs, met NEPMAIL = de nep-maildienst): testmodus, voorbeeld, droog, testadres, logboek.
//   draft:  node tests/mail-proef.mjs <canister-id>                 → DROOG: er vertrekt niets (enkel het logboek)
//           TESTADRES=<adres van de eigenaar> ECHT=1 node tests/mail-proef.mjs <canister-id>
//                                                                   → één echte proefmail naar DAT adres (testmodus)
// De proef spreekt enkel de proeffirma "Proef Dak NV" aan en een proefmail; nooit de echte firma's (E-0). Op de draft
// staat de testmodus altijd aan: elke mail gaat enkel naar het testadres, of nergens heen.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { backend, KEYDIR, nepmail, ok } from "../tools/lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/mail-proef.mjs <canister-id>");
const host = process.env.ICP_HOST || "https://icp-api.io";
const local = host.includes("localhost") || host.includes("127.0.0.1");
const echt = process.env.ECHT === "1" && !!process.env.TESTADRES;
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const admin = await backend("proef-admin", cid);
const wl = await backend("proef-werfleider", cid);
const nep = local && process.env.NEPMAIL ? await nepmail(process.env.NEPMAIL) : null;
const dak = (await admin.listOrgs(false)).find((o) => o.name === "Proef Dak NV");
if (!dak) throw new Error("Proef Dak NV ontbreekt (eerst tests/rollen.mjs, of een draft met de proefdata)");
const jobOf = async (id) => (await admin.listJobs("alles", 0n, 200n)).find((j) => j.id === id);
// Versturen tot er geen ronde meer loopt (de eigen klokjob van de app kan er net mee bezig zijn).
async function flush() {
  for (let i = 0; i < 90; i++) {
    const r = ok(await admin.sendMailNow());
    if (!r.busy) return r;
    await sleep(2000);
  }
  throw new Error("de verstuurronde bleef bezig");
}

const ps = await admin.postSettings();
console.log(`canister ${cid} · ${(await admin.me()).version} · draft ${ps.draft} · livecanister ${ps.liveMail} · testmodus ${ps.testMode} · testadres ${ps.testAddress ? "ingesteld" : "geen (droog)"} · cycles ${(Number(ps.cyclesBalance) / 1e12).toFixed(2)} biljoen`);
check("testmodus staat aan", ps.testMode);
if (ps.draft) {
  const r = await admin.setMailTest(false, "");
  check("draft: de testmodus kan niet uit", "err" in r && r.err.includes("testomgeving"), JSON.stringify(r));
}
// 1b.5 (M2): buiten de testbouw kan echte mail enkel vanaf een canister in Config.mailLiveBackends.
if (!local) check("geen livecanister: liveMail = false (echte mail onmogelijk, wat de beheerder ook instelt)", ps.liveMail === false);
check("werfleider ziet de postbode niet en kan niets versturen", (await wl.postSettings().then(() => false, () => true)) && (await wl.sendMailNow().then(() => false, () => true)));

// Voorbeeld voor de proeffirma (HTML naar een bestand buiten git, om te bekijken)
const nextMon = (() => { const d = BigInt(Math.floor(Date.now() / 86_400_000)); return d + BigInt(7 - ((Number(d) + 3) % 7)); })();
const out = join(KEYDIR, "mail-proef");
mkdirSync(out, { recursive: true });
for (const [kind, org] of [["weekplanning", [dak.id]], ["herinnering-planning", [dak.id]], ["proef", []]]) {
  const r = await admin.mailPreview(kind, org, nextMon);
  if ("ok" in r) {
    writeFileSync(join(out, `${kind}.html`), r.ok.html);
    check(`voorbeeld ${kind}: ${r.ok.deliver}`, r.ok.html.startsWith("<!doctype html>") && !r.ok.html.includes("<script"));
  } else console.log(`· voorbeeld ${kind}: ${r.err}`);
}
console.log(`  (HTML in ${out})`);

// Eén proefmail. Zonder testadres: droog. Met TESTADRES + ECHT=1: naar dat adres (testmodus), en enkel daarheen.
if (echt) {
  check("testadres ingesteld (testmodus aan)", "ok" in (await admin.setMailTest(true, process.env.TESTADRES)));
} else if (!local && ps.testAddress) {
  // Op de draft staat al een testadres: deze proef maakt het niet leeg, maar verstuurt dan ook niets.
  console.log("· er staat al een testadres: geen proefmail (gebruik ECHT=1 TESTADRES=… om er één te sturen)");
}
const before = await admin.listMailLog(0n, 1n);
const n0 = nep ? Number(await nep.aantal()) : 0;
const mayRun = echt || local || !ps.testAddress;
if (mayRun) {
  const id = ok(await admin.queueTestMail(process.env.TESTADRES || "eigen@proef.invalid"));
  const r = await flush();
  let j = await jobOf(id);
  for (let i = 0; i < 30 && j && ("queued" in j.state || "leased" in j.state); i++) { await sleep(2000); await flush(); j = await jobOf(id); }
  const log = (await admin.listMailLog(0n, 20n)).filter((l) => l.jobId === id);
  console.log(`  ronde ${JSON.stringify(r, big)} · opdracht ${JSON.stringify(j?.state, big)} · logboek ${JSON.stringify(log.map((l) => [Object.keys(l.outcome)[0], l.cycles]), big)}`);
  const s2 = await admin.postSettings();
  if (s2.testAddress) {
    check("proefmail verstuurd via Caffeine, enkel naar het testadres", !!j && "done" in j.state && j.state.done.result.startsWith("verstuurd via Caffeine") && log.some((l) => "sent" in l.outcome && l.test));
    const c = log.find((l) => "sent" in l.outcome)?.cycles ?? 0n;
    console.log(`  kost van deze mail: ${c} cycles (${(Number(c) / 1e9).toFixed(3)} miljard)`);
    if (nep) check("nep-maildienst: precies één mail, naar het testadres", Number(await nep.aantal()) === n0 + 1 && (await nep.mails(BigInt(n0)))[0]?.to === s2.testAddress);
  } else {
    check("droog: niets verstuurd, logboek 'droog'", !!j && "done" in j.state && j.state.done.result.startsWith("droog") && log.some((l) => "dryRun" in l.outcome) && (!nep || Number(await nep.aantal()) === n0));
  }
}
check("logboek zonder e-mailadres", !JSON.stringify(await admin.listMailLog(0n, 200n), big).includes("@"));
check("niets meer bij de maildienst", (await admin.postSettings()).leased === 0n && before !== null);
console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
