// Technisch logboek van de gateway (ontwerp §3.7): <staat>/log/<jjjj-mm>.jsonl, één regel per taak. GEEN inhoud:
// geen tekst, geen bestandsnamen, geen hash van de inhoud, geen ticket. De regel wordt veld per veld opgebouwd uit
// een vaste lijst (nooit een object doorgeven), en de fouttekst gaat door scrub (≤ 200 tekens).
import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { maandSleutel } from "./budget.ts";
import { scrub } from "./sleutels.ts";

export type LogRegel = {
  ticketId: bigint | null;
  personId: bigint | null;
  workerKey: string | null;
  workId: bigint | null;
  leverancier: string | null;
  model: string | null;
  bestanden: { aantal: number; bytes: number; soorten: string[] };
  tokensIn: number;
  tokensUit: number;
  kostCent: number;
  duurMs: number;
  uitkomst: string; // "ok" of de foutcode ("ticket", "budget", "tijd", …)
  terugval: boolean;
  fout: string | null;
};

export class Logboek {
  #dir: string | null;
  private nu: () => Date;
  constructor(staatDir: string | null, nu: () => Date = () => new Date()) {
    this.nu = nu;
    this.#dir = staatDir ? join(staatDir, "log") : null;
  }

  schrijf(r: LogRegel) {
    const n = (x: bigint | null) => (x === null ? null : Number(x));
    const regel = {
      tijd: this.nu().toISOString(),
      ticketId: n(r.ticketId),
      personId: n(r.personId),
      workerKey: r.workerKey === null ? null : scrub(r.workerKey, 40),
      workId: n(r.workId),
      leverancier: r.leverancier,
      model: r.model === null ? null : scrub(r.model, 60),
      bestanden: { aantal: r.bestanden.aantal, bytes: r.bestanden.bytes, soorten: r.bestanden.soorten.map((s) => scrub(s, 20)) },
      tokensIn: r.tokensIn,
      tokensUit: r.tokensUit,
      kostCent: r.kostCent,
      duurMs: r.duurMs,
      uitkomst: scrub(r.uitkomst, 20),
      terugval: r.terugval,
      fout: r.fout === null ? null : scrub(r.fout, 200),
    };
    if (!this.#dir) return regel;
    mkdirSync(this.#dir, { recursive: true, mode: 0o700 });
    appendFileSync(join(this.#dir, `${maandSleutel(this.nu())}.jsonl`), `${JSON.stringify(regel)}\n`, { mode: 0o600 });
    return regel;
  }

  // Bij de start: maandbestanden waarvan de hele maand ouder is dan `dagen` weg.
  opruimen(dagen: number): string[] {
    if (!this.#dir) return [];
    const grens = this.nu().getTime() - dagen * 86_400_000;
    const weg: string[] = [];
    let namen: string[] = [];
    try {
      namen = readdirSync(this.#dir);
    } catch {
      return [];
    }
    for (const f of namen) {
      const m = /^(\d{4})-(\d{2})\.jsonl$/.exec(f);
      if (!m) continue;
      const einde = Date.UTC(Number(m[1]), Number(m[2]), 1); // eerste dag van de volgende maand
      if (einde < grens) {
        unlinkSync(join(this.#dir, f));
        weg.push(f);
      }
    }
    return weg;
  }
}
