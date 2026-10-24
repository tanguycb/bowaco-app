// Technisch logboek van de postbode (bouwplan §6: de gateway bewaart niets behalve technische logs): per verstuurde
// opdracht de sleutel, het tijdstip en het antwoord van de maildienst. GEEN adressen, onderwerpen of inhoud.
// Dient als tweede vangnet tegen dubbele mails: is een sleutel al verstuurd (crash tussen versturen en `completeJob`),
// dan wordt de opdracht enkel nog als klaar gemeld.
import { appendFileSync, existsSync, readFileSync } from "node:fs";

export type Entry = { at: string; key: string; job: string; result: string };

export class Journal {
  private sent = new Set<string>();
  private file: string;
  constructor(file: string) {
    this.file = file;
    if (existsSync(file)) {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          this.sent.add((JSON.parse(line) as Entry).key);
        } catch {
          /* kapotte regel: overslaan */
        }
      }
    }
  }
  has(key: string): boolean {
    return this.sent.has(key);
  }
  add(e: Entry): void {
    appendFileSync(this.file, JSON.stringify(e) + "\n", { mode: 0o600 });
    this.sent.add(e.key);
  }
  get size(): number {
    return this.sent.size;
  }
}
