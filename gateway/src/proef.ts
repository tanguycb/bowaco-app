// Proefbank-CLI (ontwerp §3.9): dezelfde Leverancier-interface en dezelfde taakdefinities als /v2/taak.
//   node src/proef.ts <workerKey> <map met testset> --model nep/echo [--versie 1] [--json]
// Testset: per geval een submap met `invoer.txt` (tekst), optioneel bestanden (alles behalve invoer.txt en
// verwacht.json, alfabetisch) en `verwacht.json`. Score per veld: exact (tekst genormaliseerd: kleine letters,
// zonder accenten, witruimte samengevoegd), getallen binnen 1 %. Geen ticket, geen app.
// In 3.1 ENKEL tegen de nep-leverancier: echte modellen pas na de installatie door de eigenaar (geen sleutels hier).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { controleer } from "./bestanden.ts";
import { loadConfig } from "./config.ts";
import { type Leveranciers, maakLeveranciers } from "./leveranciers/index.ts";
import { Sleutels } from "./sleutels.ts";
import { type Taken, standaardTaken } from "./taken/index.ts";
import { voerUit } from "./uitvoer.ts";

export type GevalScore = { geval: string; score: number; uitkomst: string; velden: number; goed: number; kostCent: number; duurMs: number };
export type Samenvatting = { workerKey: string; model: string; versie: number; gevallen: number; score: number; kostCent: number; duurMs: number; perGeval: { geval: string; score: number; uitkomst: string }[] };

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

function velden(v: unknown, pad = "$", uit = new Map<string, unknown>()): Map<string, unknown> {
  if (v !== null && typeof v === "object") for (const [k, x] of Object.entries(v as object)) velden(x, Array.isArray(v) ? `${pad}[${k}]` : `${pad}.${k}`, uit);
  else uit.set(pad, v);
  return uit;
}

export function vergelijk(verwacht: unknown, kreeg: unknown): { velden: number; goed: number } {
  const a = velden(verwacht);
  const b = velden(kreeg);
  let goed = 0;
  for (const [k, x] of a) {
    const y = b.get(k);
    if (typeof x === "number" && typeof y === "number") goed += (x === 0 ? Math.abs(y) < 1e-9 : Math.abs(y - x) / Math.abs(x) <= 0.01) ? 1 : 0;
    else if (typeof x === "string" && typeof y === "string") goed += norm(x) === norm(y) ? 1 : 0;
    else goed += x === y ? 1 : 0;
  }
  return { velden: a.size, goed };
}

export async function proefbank(o: { workerKey: string; map: string; model: string; versie: number; leveranciers: Leveranciers; taken?: Taken; env?: NodeJS.ProcessEnv }): Promise<{ samenvatting: Samenvatting; gevallen: GevalScore[] }> {
  if (!o.model.startsWith("nep/")) throw new Error("proefbank in 3.1: enkel nep-modellen (echte leveranciers na de installatie door de eigenaar)");
  const taak = (o.taken ?? standaardTaken()).get(o.workerKey);
  if (!taak || taak.zonderLeverancier) throw new Error(`onbekende taak ${o.workerKey}`);
  const versie = taak.instructies[o.versie];
  if (!versie) throw new Error(`versie ${o.versie} bestaat niet voor ${o.workerKey}`);
  const cfg = loadConfig({ BOWACO_CANISTER: "proefbank", ROBOT_KEY_FILE: "-", ...(o.env ?? {}) });
  const gevallen: GevalScore[] = [];
  for (const g of readdirSync(o.map).sort()) {
    const dir = join(o.map, g);
    if (!statSync(dir).isDirectory()) continue;
    const tekst = readFileSync(join(dir, "invoer.txt"), "utf8");
    const verwacht = JSON.parse(readFileSync(join(dir, "verwacht.json"), "utf8"));
    const delen = readdirSync(dir)
      .filter((f) => f !== "invoer.txt" && f !== "verwacht.json")
      .sort()
      .map((f) => ({ bytes: readFileSync(join(dir, f)) }));
    const bestanden = controleer(delen, cfg.grenzen);
    const r = await voerUit({ taak, versie, modellen: [o.model], invoerTekst: tekst, bestanden, leveranciers: o.leveranciers, tijdslimietMs: cfg.tijdslimietMs, usdEurMilli: cfg.usdEurMilli, maxBeeldPx: cfg.grenzen.maxBeeldPx });
    const v = r.ok ? vergelijk(verwacht, r.json) : { velden: velden(verwacht).size, goed: 0 };
    gevallen.push({ geval: g, score: v.velden ? v.goed / v.velden : 0, uitkomst: r.ok ? "ok" : r.code, velden: v.velden, goed: v.goed, kostCent: r.kostCent, duurMs: r.duurMs });
  }
  const som = (f: (x: GevalScore) => number) => gevallen.reduce((n, x) => n + f(x), 0);
  const samenvatting: Samenvatting = {
    workerKey: o.workerKey,
    model: o.model,
    versie: o.versie,
    gevallen: gevallen.length,
    score: gevallen.length ? Math.round((som((x) => x.score) / gevallen.length) * 1000) / 1000 : 0,
    kostCent: som((x) => x.kostCent),
    duurMs: som((x) => x.duurMs),
    perGeval: gevallen.map((x) => ({ geval: x.geval.slice(0, 40), score: Math.round(x.score * 1000) / 1000, uitkomst: x.uitkomst })),
  };
  return { samenvatting, gevallen };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const opt = (k: string) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const [workerKey, map] = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
  if (!workerKey || !map) {
    console.error("gebruik: node src/proef.ts <workerKey> <map> --model nep/echo [--versie 1] [--json]");
    process.exit(2);
  }
  const model = opt("--model") ?? "nep/echo";
  const lev = maakLeveranciers({ basis: { claude: "https://api.anthropic.com", grok: "https://api.x.ai" }, nep: true }, new Sleutels({}));
  try {
    const { samenvatting, gevallen } = await proefbank({ workerKey, map, model, versie: Number(opt("--versie") ?? 1), leveranciers: lev });
    if (args.includes("--json")) console.log(JSON.stringify(samenvatting, null, 2));
    else {
      console.log(`proefbank ${workerKey} · ${model} · versie ${samenvatting.versie}`);
      console.log("geval".padEnd(24) + "score".padStart(7) + "velden".padStart(8) + "uitkomst".padStart(12) + "cent".padStart(6) + "ms".padStart(7));
      for (const g of gevallen) console.log(g.geval.padEnd(24) + g.score.toFixed(3).padStart(7) + `${g.goed}/${g.velden}`.padStart(8) + g.uitkomst.padStart(12) + String(g.kostCent).padStart(6) + String(g.duurMs).padStart(7));
      console.log(`samen: score ${samenvatting.score} · ${samenvatting.gevallen} gevallen · ${samenvatting.kostCent} cent · ${samenvatting.duurMs} ms`);
    }
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
