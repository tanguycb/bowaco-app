// De lus van de postbode: leasen → versturen → bevestigen. Eén ronde per POLL_SECONDS.
import type { Config } from "./config.ts";
import type { JobLease, Robot } from "./ic.ts";
import type { Journal } from "./journal.ts";
import { send, type SendResult } from "./send.ts";

export type Stats = { rounds: number; sent: number; failed: number; lastRound: string | null; lastError: string | null; lastOk: string | null };

export function newStats(): Stats {
  return { rounds: 0, sent: 0, failed: 0, lastRound: null, lastError: null, lastOk: null };
}

const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

export async function handle(cfg: Config, robot: Robot, journal: Journal, job: JobLease, stats: Stats, sender = send): Promise<void> {
  const tag = `#${job.id} ${job.kind} poging ${job.attempt}`;
  // Al verstuurd volgens het logboek (crash na het versturen): enkel nog bevestigen, geen tweede mail.
  if (journal.has(job.key)) {
    const r = await robot.completeJob(job.id, job.attempt, "al verstuurd (logboek postbode)");
    log(`${tag}: al verstuurd volgens het logboek → ${"ok" in r ? "klaar" : r.err}`);
    return;
  }
  let res: SendResult;
  try {
    res = await sender(cfg, job);
  } catch (e) {
    res = { ok: false, why: `fout: ${(e as Error).message}`.slice(0, 180), retry: true };
  }
  if (res.ok) {
    journal.add({ at: new Date().toISOString(), key: job.key, job: String(job.id), result: res.id.slice(0, 120) });
    const r = await robot.completeJob(job.id, job.attempt, res.id.slice(0, 200));
    stats.sent++;
    stats.lastOk = new Date().toISOString();
    log(`${tag}: verstuurd (${res.id.slice(0, 60)})${"err" in r ? ` — bevestigen mislukt: ${r.err}` : ""}`);
  } else {
    const r = await robot.failJob(job.id, job.attempt, res.why, res.retry);
    stats.failed++;
    stats.lastError = `${new Date().toISOString()} ${res.why}`;
    log(`${tag}: mislukt (${res.why}; ${res.retry ? "later opnieuw" : "definitief"})${"err" in r ? ` — melden mislukt: ${r.err}` : ""}`);
  }
}

export async function round(cfg: Config, robot: Robot, journal: Journal, stats: Stats): Promise<number> {
  stats.rounds++;
  stats.lastRound = new Date().toISOString();
  const jobs = await robot.leaseJobs(BigInt(cfg.batch));
  for (const j of jobs) await handle(cfg, robot, journal, j, stats);
  return jobs.length;
}

export async function loop(cfg: Config, robot: Robot, journal: Journal, stats: Stats, stop: { stopped: boolean }): Promise<void> {
  while (!stop.stopped) {
    try {
      let n = await round(cfg, robot, journal, stats);
      // Een volle ronde: meteen nog een (wachtrij leegmaken), anders wachten.
      while (n === cfg.batch && !stop.stopped) n = await round(cfg, robot, journal, stats);
    } catch (e) {
      stats.lastError = `${new Date().toISOString()} ${(e as Error).message.slice(0, 200)}`;
      log(`ronde mislukt: ${(e as Error).message.slice(0, 200)}`);
    }
    await new Promise((r) => setTimeout(r, cfg.pollSeconds * 1000));
  }
}
