// Back-up in stukken vanuit de app (1.9 V-02): dezelfde bestanden als `tests/herstel.mjs export` (intern.json,
// vertrouwelijk.json), per collectie via exportChunk zodat geen enkel antwoord op de berichtgrens van het IC botst (één
// exportIntern wordt bij ± 100 werven groter dan 2 MiB). Zelfde JSON-vorm ($n = bigint, $b = bytes, $p = principal), dus
// `node tests/herstel.mjs herstel <lege-canister> <map>` leest ook een back-up uit de browser. De lijsten hieronder
// volgen tests/herstel.mjs: een collectie erbij = op beide plaatsen (en in RestoreApi.mo, docs/herstel.md).
import type { Backend } from "./backend";

export const INTERN = ["persons", "links", "linkHistory", "invites", "orgs", "works", "memberships", "files", "workInfo", "documents", "orgContacts", "personContacts", "tasks", "assignments", "dependencies", "calendarBlocks", "taskChanges", "templates", "absences", "absenceChanges", "capacity", "importBatches", "importKeys", "appointments", "vehicles", "dayReports", "reportChanges", "attendances", "hoursConfirmations", "workDone", "materials", "photos", "issues", "trips", "robots", "proposals", "notifications", "lookups", "values", "sequences", "planVersions", "reportKeys", "ops"];
export const LATER = ["permits", "permitChanges", "municipalities", "procedures", "permitAlerts", "jobs", "mailLog", "withholdingChecks", "declarations", "libChapters", "libItems", "libItemVersions", "quotes", "quoteVersions", "quoteChapters", "quoteLines", "quoteRules", "quoteStdPosts", "quoteChecks", "quoteTerms", "quoteSendInfos", "quoteAcceptances", "workStarts", "surveys", "surveyKeys", "measureEntries", "measureSnapshots", "measureOps", "progressStatements", "progressInputs", "progressAnswers", "oaInvoices", "quoteFormInfos", "quoteVersionForms", "quoteSubgroups", "quoteLineForms", "textBlocks", "quoteSentExtras"];
export const CONFIDENTIAL: [string, string][] = [["orgs", "orgConfidential"], ["persons", "personConfidential"], ["files", "confidentialFiles"], ["workConfidential", "workConfidential"], ["workConfidentialHistory", "workConfidentialHistory"], ["libCosts", "libCosts"], ["libSells", "libSells"], ["libSellVersions", "libSellVersions"], ["quotePrices", "quotePrices"], ["quoteVersionConf", "quoteVersionConf"], ["progressConf", "progressConf"], ["progressFrozen", "progressFrozen"], ["progressRevisions", "progressRevisions"], ["oaInvoiceAmounts", "oaInvoiceAmounts"], ["marginClasses", "marginClasses"], ["marginClassLinks", "marginClassLinks"], ["quoteVersionTerms", "quoteVersionTerms"]];

type Raw = { exportChunk: (kind: string, from: bigint, limit: bigint) => Promise<unknown> };

// De ruwe actor (zonder de omzetting van bindgen): zo komen de Candid-waarden ongewijzigd in het bestand, net als in het
// script. `actor.actor` is de agent-actor achter de Backend-klasse.
function raw(b: Backend): Raw {
  return (b as unknown as { actor: Raw }).actor;
}

async function part(b: Backend, kind: string, n = 500): Promise<unknown> {
  const out: unknown[] = [];
  for (let from = 0; ; from += n) {
    const r = (await raw(b).exportChunk(kind, BigInt(from), BigInt(n))) as { ok?: Record<string, unknown>; err?: string };
    if (r.err !== undefined) throw new Error(r.err);
    const xs = Object.values(r.ok!)[0];
    if (!Array.isArray(xs)) return xs; // settings: één record
    out.push(...xs);
    if (xs.length < n) return out;
  }
}

// Collecties met lange teksten (tot 4.000 tekens per record) in kleinere stukken: 500 × 4 KB raakt de berichtgrens.
const SIZE: Record<string, number> = { libItems: 100, libItemVersions: 50, quoteLines: 100, quoteTerms: 20, quoteSendInfos: 20, measureEntries: 100, measureSnapshots: 50, progressInputs: 50, progressFrozen: 10, oaInvoiceAmounts: 50, textBlocks: 50, quoteSentExtras: 20, quoteVersionTerms: 100 };

async function partOpt(b: Backend, kind: string): Promise<unknown> {
  try {
    return await part(b, kind, SIZE[kind] ?? 500);
  } catch (e) {
    if (/Onbekende collectie/.test(String(e))) return [];
    throw e;
  }
}

export async function backupIntern(b: Backend, onStep?: (k: string) => void): Promise<Record<string, unknown>> {
  const me = await b.me();
  const r = raw(b) as unknown as { listTrades: (a: boolean) => Promise<unknown>; auditCount: () => Promise<bigint> };
  const intern: Record<string, unknown> = { version: me.version, at: BigInt(Date.now()) * 1_000_000n, trades: await r.listTrades(true), settings: await part(b, "settings"), auditCount: await r.auditCount() };
  for (const k of INTERN) { onStep?.(k); intern[k] = await part(b, k); }
  for (const k of LATER) { onStep?.(k); intern[k] = await partOpt(b, k); }
  // 2c.1 (les M1 van 2.12, zoals tests/herstel.mjs): de tellers als ALLERLAATSTE, na alle records.
  onStep?.("counters");
  intern.counters = await part(b, "counters");
  return intern;
}

export async function backupConfidential(b: Backend, onStep?: (k: string) => void): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { at: BigInt(Date.now()) * 1_000_000n };
  for (const [name, kind] of CONFIDENTIAL) { onStep?.(kind); out[name] = await partOpt(b, kind); }
  return out;
}

// De auditlog in stukken (nieuwste eerst) → chronologisch, zonder dubbels (elke exportoproep schrijft zelf een regel).
export async function backupAudit(b: Backend): Promise<unknown[]> {
  const r = raw(b) as unknown as { auditLog: (from: bigint, n: bigint) => Promise<{ at: bigint; action: string; who: { toText: () => string }; detail: string }[]> };
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (let from = 0; ; from += 500) {
    const page = await r.auditLog(BigInt(from), 500n);
    for (const e of page) {
      const k = `${e.at}|${e.action}|${e.who.toText()}|${e.detail}`;
      if (!seen.has(k)) { seen.add(k); out.push(e); }
    }
    if (page.length < 500) break;
  }
  return out.reverse();
}

// Zelfde vorm als tests/herstel.mjs (replacer): bigint → {$n}, bytes → {$b}, principal → {$p}. Eerst zelf omzetten en dan
// pas JSON.stringify: in de app definieert een bibliotheek BigInt.prototype.toJSON, waardoor een replacer de getallen
// al als tekst zou krijgen (Chrome-test 2.2) en het script ze bij een herstel niet meer als getal zou lezen.
function encode(v: unknown): unknown {
  if (typeof v === "bigint") return { $n: v.toString() };
  if (v instanceof Uint8Array) {
    let bin = "";
    for (let i = 0; i < v.length; i += 0x8000) bin += String.fromCharCode(...v.subarray(i, i + 0x8000));
    return { $b: btoa(bin) };
  }
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === "object") {
    const o = v as { _isPrincipal?: unknown; toText?: () => string };
    if (o._isPrincipal === true && typeof o.toText === "function") return { $p: o.toText() };
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]));
  }
  return v;
}

export function toJson(data: unknown): string {
  return JSON.stringify(encode(data));
}
