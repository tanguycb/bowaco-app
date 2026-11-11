// v3 (4b.3): de zuivere kern van het tabelonderdeel (sorteren, filteren), zonder React, voor tests/proef-4b-3.mjs.
import type { ReactNode } from "react";

export type Column<T> = {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  /** Getallen en bedragen rechts uitlijnen. */
  right?: boolean;
  width?: string;
  /** Sorteren op deze kolom: de waarde om te vergelijken. */
  sort?: (row: T) => string | number | bigint | undefined | null;
  /** Mag verborgen worden via Kolommen; hidden = standaard verborgen. */
  optional?: boolean;
  hidden?: boolean;
};

export type TableFilter<T> = { key: string; label: string; test: (row: T) => boolean };

const leeg = (x: unknown) => x === undefined || x === null || x === "";

/** Vergelijken zonder accenten en hoofdletters; getallen en bigints als getal. */
export function vergelijk(a: unknown, b: unknown): number {
  if (leeg(a) && leeg(b)) return 0;
  if (leeg(a)) return 1;
  if (leeg(b)) return -1;
  if (typeof a === "bigint" || typeof b === "bigint") {
    const x = BigInt(a as bigint), y = BigInt(b as bigint);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "nl-BE", { numeric: true, sensitivity: "base" });
}

/** Filter + sortering. Lege waarden staan altijd achteraan (ook aflopend); bij gelijkheid blijft de oorspronkelijke volgorde. */
export function tabelRijen<T>(rows: T[], columns: Column<T>[], sort: string | null, filter: TableFilter<T> | undefined): T[] {
  const out = filter ? rows.filter(filter.test) : rows.slice();
  if (!sort) return out;
  const desc = sort.startsWith("-");
  const col = columns.find((c) => c.key === sort.replace(/^-/, ""));
  if (!col?.sort) return out;
  const f = col.sort;
  return out
    .map((r, i) => ({ r, i, v: f(r) }))
    .sort((x, y) => {
      if (leeg(x.v) || leeg(y.v)) return vergelijk(x.v, y.v) || x.i - y.i;
      const v = vergelijk(x.v, y.v);
      return (desc ? -v : v) || x.i - y.i;
    })
    .map((x) => x.r);
}

/** Zuiver: de volgende of vorige sleutel bij een pijltje (blijft op de rand staan). */
export function volgende(keys: string[], huidig: string | undefined, stap: 1 | -1): string | undefined {
  if (keys.length === 0) return undefined;
  const i = huidig === undefined ? -1 : keys.indexOf(huidig);
  if (i < 0) return stap === 1 ? keys[0] : keys[keys.length - 1];
  return keys[Math.min(keys.length - 1, Math.max(0, i + stap))];
}

