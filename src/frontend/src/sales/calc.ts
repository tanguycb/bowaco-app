// Rekenmodule van de verkoopfacturen (stap 2c.6): DEZELFDE regels als src/backend/lib/SalesCalc.mo (rekentest browser = server in
// tests/factuur-2c6.mjs). Geld in eurocent (bigint), hoeveelheden in duizendsten, percentages in basispunten; afronden op de cent,
// half weg van nul. Korting op het totaal verdeeld over de hoofdstukken naar verhouding (laatste hoofdstuk met een bedrag neemt de
// rest); schijven per hoofdstuk, de laatste schijf neemt de rest; btw per tarief op het totaal per tarief; verlegd = één blok aan 0 %.
export const version = 1n;

export function roundDiv(n: bigint, d: bigint): bigint {
  if (d <= 0n) throw new Error("roundDiv: deler ≤ 0");
  return n >= 0n ? (n + d / 2n) / d : -((-n + d / 2n) / d);
}

export const lineAmount = (qtyMilli: bigint, unitCents: bigint): bigint => roundDiv(qtyMilli * unitCents, 1000n);
export const pctOf = (cents: bigint, bp: bigint): bigint => roundDiv(cents * bp, 10_000n);

export function netChapters(sells: bigint[], discount: bigint): bigint[] {
  const n = sells.length;
  if (discount === 0n || n === 0) return [...sells];
  let gross = 0n;
  let last = -1;
  sells.forEach((s, i) => { gross += s; if (s !== 0n) last = i; });
  const lastIdx = last >= 0 ? last : n - 1;
  const out = sells.map(() => 0n);
  let given = 0n;
  sells.forEach((s, i) => {
    if (i === lastIdx) return;
    const share = gross === 0n ? 0n : roundDiv(discount * s, gross);
    out[i] = s - share;
    given += share;
  });
  out[lastIdx] = sells[lastIdx] - (discount - given);
  return out;
}

/** pct[s][c] = % van schijf s voor hoofdstuk c (basispunten); de laatste schijf neemt per hoofdstuk de rest. */
export function stepAmounts(nets: bigint[], pct: bigint[][]): bigint[][] {
  const steps = pct.length;
  if (steps === 0) return [];
  const out = pct.map(() => nets.map(() => 0n));
  nets.forEach((net, c) => {
    let given = 0n;
    for (let s = 0; s < steps; s++) {
      if (s + 1 < steps) {
        const a = pctOf(net, pct[s][c] ?? 0n);
        out[s][c] = a;
        given += a;
      } else out[s][c] = net - given;
    }
  });
  return out;
}

export type VatLine = { vatBp: bigint; reverse: boolean; baseCents: bigint; vatCents: bigint };
export type Totals = { netCents: bigint; vatCents: bigint; totalCents: bigint; vatLines: VatLine[] };

export function totals(lines: { amountCents: bigint; vatBp: bigint }[], reverse: boolean): Totals {
  const net = lines.reduce((s, l) => s + l.amountCents, 0n);
  if (reverse) return { netCents: net, vatCents: 0n, totalCents: net, vatLines: [{ vatBp: 0n, reverse: true, baseCents: net, vatCents: 0n }] };
  const rates: bigint[] = [];
  for (const l of lines) if (!rates.includes(l.vatBp)) rates.push(l.vatBp);
  rates.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  let vat = 0n;
  const vatLines = rates.map((r) => {
    const base = lines.filter((l) => l.vatBp === r).reduce((s, l) => s + l.amountCents, 0n);
    const v = pctOf(base, r);
    vat += v;
    return { vatBp: r, reverse: false, baseCents: base, vatCents: v };
  });
  return { netCents: net, vatCents: vat, totalCents: net + vat, vatLines };
}

const pad = (n: bigint | number, w: number) => String(n).padStart(w, "0");

/** Gestructureerde mededeling: reeks (1 factuur, 2 creditnota), jaar, volgnummer; controlegetal mod 97 (0 → 97). */
export function paymentRef(seriesDigit: bigint, year: bigint, seq: bigint): string {
  const base = (seriesDigit % 10n) * 1_000_000_000n + (year % 10_000n) * 100_000n + (seq % 100_000n);
  const m = base % 97n;
  const s = pad(base, 10) + pad(m === 0n ? 97n : m, 2);
  return `+++${s.slice(0, 3)}/${s.slice(3, 7)}/${s.slice(7, 12)}+++`;
}

/** Controle van een gestructureerde mededeling (voor de proef en het scherm). */
export function paymentRefOk(ref: string): boolean {
  const d = ref.replace(/[^0-9]/g, "");
  if (d.length !== 12) return false;
  const m = BigInt(d.slice(0, 10)) % 97n;
  return (m === 0n ? 97n : m) === BigInt(d.slice(10));
}

export const number = (series: string, year: bigint, seq: bigint) => `${series === "CN" ? "CN " : ""}${year}-${pad(seq, 3)}`;
