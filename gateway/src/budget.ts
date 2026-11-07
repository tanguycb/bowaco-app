// Budget van de gateway (ontwerp §3.7): twee sloten boven op het ticketbudget — een maandplafond voor alles samen en
// een plafond per leverancier. Teller in <staat>/budget.json per maand, per leverancier en per fiche; atomisch
// geschreven (tijdelijk bestand + rename). Lopende taken houden een reservering in het geheugen, zodat vier taken
// tegelijk het plafond niet samen kunnen overschrijden.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Plafonds } from "./config.ts";
import type { LevNaam } from "./leveranciers/leverancier.ts";

type Teller = { cent: number; taken: number; fouten: number };
type Maand = { leveranciers: Partial<Record<LevNaam, Teller>>; fiches: Record<string, number> };
type Data = Record<string, Maand>;

export const maandSleutel = (t = new Date()) => `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;

export class Budget {
  #data: Data = {};
  #gereserveerd = new Map<LevNaam, number>();
  #bestand: string | null;
  private plafond: Plafonds;
  private nu: () => Date;

  constructor(staatDir: string | null, plafond: Plafonds, nu: () => Date = () => new Date()) {
    this.plafond = plafond;
    this.nu = nu;
    this.#bestand = staatDir ? join(staatDir, "budget.json") : null;
    if (this.#bestand && existsSync(this.#bestand)) {
      try {
        this.#data = JSON.parse(readFileSync(this.#bestand, "utf8")) as Data;
      } catch {
        throw new Error(`budget.json onleesbaar (${this.#bestand}); herstel of verwijder het bestand bewust`);
      }
    }
  }

  #maand(): Maand {
    const k = maandSleutel(this.nu());
    return (this.#data[k] ??= { leveranciers: {}, fiches: {} });
  }

  #teller(lev: LevNaam): Teller {
    const m = this.#maand();
    return (m.leveranciers[lev] ??= { cent: 0, taken: 0, fouten: 0 });
  }

  // Reserveer `cent` voor een oproep bij `lev`; false = een plafond zou overschreden worden.
  reserveer(lev: LevNaam, cent: number): boolean {
    const m = this.#maand();
    const totaal = Object.values(m.leveranciers).reduce((n, t) => n + (t?.cent ?? 0), 0) + [...this.#gereserveerd.values()].reduce((a, b) => a + b, 0);
    const lv = this.#teller(lev).cent + (this.#gereserveerd.get(lev) ?? 0);
    if (totaal + cent > this.plafond.maand || lv + cent > this.plafond[lev]) return false;
    this.#gereserveerd.set(lev, (this.#gereserveerd.get(lev) ?? 0) + cent);
    return true;
  }

  vrij(lev: LevNaam, cent: number) {
    this.#gereserveerd.set(lev, Math.max(0, (this.#gereserveerd.get(lev) ?? 0) - cent));
  }

  // Na de oproep: echte (of bij "onzeker" de geraamde) kost boeken.
  boek(lev: LevNaam, fiche: string, cent: number, fout: boolean) {
    const t = this.#teller(lev);
    t.cent += cent;
    t.taken += 1;
    if (fout) t.fouten += 1;
    const m = this.#maand();
    m.fiches[fiche] = (m.fiches[fiche] ?? 0) + cent;
    this.#bewaar();
  }

  stand(): { cent: number; taken: number; fouten: number; leveranciers: Partial<Record<LevNaam, Teller>> } {
    const m = this.#data[maandSleutel(this.nu())] ?? { leveranciers: {}, fiches: {} };
    const s = { cent: 0, taken: 0, fouten: 0 };
    for (const t of Object.values(m.leveranciers)) {
      s.cent += t?.cent ?? 0;
      s.taken += t?.taken ?? 0;
      s.fouten += t?.fouten ?? 0;
    }
    return { ...s, leveranciers: structuredClone(m.leveranciers) };
  }

  #bewaar() {
    if (!this.#bestand) return;
    mkdirSync(join(this.#bestand, ".."), { recursive: true, mode: 0o700 });
    const tmp = `${this.#bestand}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.#data), { mode: 0o600 });
    renameSync(tmp, this.#bestand);
  }
}
