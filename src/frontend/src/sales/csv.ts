// De kwartaallijst voor de boekhouder (stap 2c.6b, ontwerp 2c §4.6, AC-20, D26): één regel per uitgereikte factuur en creditnota van
// het kwartaal, met de werfcode als analytische code, de maatstaf en de btw per tarief, het totaal en de dag van de betaling.
// Puntkomma en decimale komma (zoals Excel in België het opent), UTF-8 met BOM. Zonder React: Node draait dit bestand rechtstreeks.

type N = bigint | number;
export type QuarterRow = {
  number: string;
  series: string;
  kind: string;
  issueDay: N;
  dueDay: N;
  clientName: string;
  clientVat: string;
  workCode: string;
  analyticCode: string;
  vatLines: { vatBp: bigint; reverse: boolean; baseCents: bigint; vatCents: bigint }[];
  netCents: bigint;
  vatCents: bigint;
  totalCents: bigint;
  paidDay: N | null;
  creditOf: string;
};

export const CSV_HEAD = ["nummer", "reeks", "soort", "datum", "vervaldag", "klant", "btw-nummer klant", "werfcode", "analytische code", "maatstaf 6 %", "btw 6 %", "maatstaf 21 %", "btw 21 %", "maatstaf btw verlegd", "totaal excl. btw", "btw", "totaal incl. btw", "betaald op", "bij factuur"];

const day = (d: N) => new Date(Number(d) * 86_400_000).toISOString().slice(0, 10);
const abs = (x: bigint) => (x < 0n ? -x : x);
export const eurCsv = (c: bigint) => `${c < 0n ? "-" : ""}${abs(c) / 100n},${String(abs(c) % 100n).padStart(2, "0")}`;
const cell = (s: string) => (/[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
// Review M6: een tekstcel die met = + - @ tab of CR begint, zou Excel als formule lezen: een ' vooraan en tussen aanhalingstekens.
export const textCell = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `"'${s.replace(/"/g, '""')}"` : cell(s));

// De kolommen met tekst (nummer, reeks, soort, klant, btw-nummer, werfcode, analytische code, bij factuur); de rest zijn data en bedragen.
const TEXT_COLS = new Set([0, 1, 2, 5, 6, 7, 8, 18]);

export function quarterCsv(rows: QuarterRow[]): string {
  const lines = [CSV_HEAD.join(";")];
  for (const r of rows) {
    const by = (bp: bigint, reverse: boolean) => r.vatLines.filter((v) => v.reverse === reverse && (reverse || v.vatBp === bp));
    const sum = (xs: { baseCents: bigint; vatCents: bigint }[], k: "baseCents" | "vatCents") => xs.reduce((a, v) => a + v[k], 0n);
    const v6 = by(600n, false);
    const v21 = by(2100n, false);
    const vr = by(0n, true);
    lines.push([
      r.number, r.series, r.kind, day(r.issueDay), day(r.dueDay), r.clientName, r.clientVat, r.workCode, r.analyticCode,
      eurCsv(sum(v6, "baseCents")), eurCsv(sum(v6, "vatCents")), eurCsv(sum(v21, "baseCents")), eurCsv(sum(v21, "vatCents")), eurCsv(sum(vr, "baseCents")),
      eurCsv(r.netCents), eurCsv(r.vatCents), eurCsv(r.totalCents), r.paidDay === null ? "" : day(r.paidDay), r.creditOf,
    ].map((x, i) => (TEXT_COLS.has(i) ? textCell(String(x)) : cell(String(x)))).join(";"));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** Het kwartaal van een dagnummer: [jaar, 1–4]. */
export function quarterOf(d: N): [number, number] {
  const dt = new Date(Number(d) * 86_400_000);
  return [dt.getUTCFullYear(), Math.floor(dt.getUTCMonth() / 3) + 1];
}
