// v3 (4b.3): één tabelonderdeel voor de hele app (L9): vaste kop, sorteren op een kolom, kolommen kiezen (onthouden per
// toestel), filters als knoppen, een teller en een lege toestand. De oude aanroepen (columns/rows/rowKey/onRow) blijven werken.
import { useMemo, useRef, useState, type ReactNode } from "react";
import { t } from "../texts/nl";
import { Icon } from "./Icon";
import { useBuiten } from "./Pop";
import { tabelRijen, type Column, type TableFilter } from "./tabel";

export type { Column, TableFilter } from "./tabel";

type Props<T> = {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRow?: (row: T) => void;
  /** Op de gsm (< 640 px) wordt elke rij een blok met label: waarde, zonder horizontale scroll. */
  stackOnMobile?: boolean;
  caption?: string;
  /** Sleutel om de kolomkeuze op dit toestel te onthouden (enkel gemak, nooit gegevens). */
  id?: string;
  filters?: TableFilter<T>[];
  /** Begin-sortering: kolomsleutel, "-" ervoor = aflopend. */
  defaultSort?: string;
  empty?: ReactNode;
  /** Extra knoppen in de werkbalk (links van de teller). */
  tools?: ReactNode;
  /** De gekozen rij (Werklijst). */
  selected?: string;
  /** Teller tonen ("12 regels"). */
  count?: boolean;
};

const lees = (k: string): string[] | null => {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as string[]) : null; } catch { return null; }
};
const bewaar = (k: string, v: string[]) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* enkel gemak */ } };

export function Table<T>({ columns, rows, rowKey, onRow, stackOnMobile = true, caption, id, filters, defaultSort, empty, tools, selected, count }: Props<T>) {
  const opslag = id ? `bw-kolommen-${id}` : null;
  const [verborgen, setVerborgen] = useState<string[]>(() => (opslag ? lees(opslag) : null) ?? columns.filter((c) => c.hidden).map((c) => c.key));
  const [sort, setSort] = useState<string | null>(defaultSort ?? null);
  const [filter, setFilter] = useState<string | null>(null);
  const [kies, setKies] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useBuiten(kies, box, () => setKies(false));
  const zichtbaar = columns.filter((c) => !(c.optional && verborgen.includes(c.key)));
  const f = filters?.find((x) => x.key === filter);
  const shown = useMemo(() => tabelRijen(rows, columns, sort, f), [rows, columns, sort, f]);
  const wissel = (k: string) => {
    const v = verborgen.includes(k) ? verborgen.filter((x) => x !== k) : [...verborgen, k];
    setVerborgen(v);
    if (opslag) bewaar(opslag, v);
  };
  const optional = columns.filter((c) => c.optional);
  const balk = (filters && filters.length > 0) || optional.length > 0 || tools || count;
  return (
    <div className="bw-tabel">
      {balk && (
        <div className="bw-table-tools">
          {filters && filters.length > 0 && (
            <>
              <button type="button" className="bw-filter" aria-pressed={filter === null} onClick={() => setFilter(null)}>{t.schil.filterAlles}<span className="bw-filter__n">{rows.length}</span></button>
              {filters.map((x) => (
                <button key={x.key} type="button" className="bw-filter" aria-pressed={filter === x.key} onClick={() => setFilter(filter === x.key ? null : x.key)} data-testid={`filter-${x.key}`}>
                  {x.label}<span className="bw-filter__n">{rows.filter(x.test).length}</span>
                </button>
              ))}
            </>
          )}
          {tools}
          {count && <span className="bw-table-tools__n">{t.schil.aantal(shown.length)}</span>}
          {optional.length > 0 && (
            <span className="bw-cols" ref={box}>
              <button type="button" className="bw-btn bw-btn--quiet bw-btn--sm" aria-expanded={kies} onClick={() => setKies((k) => !k)} aria-label={t.schil.kolommenLabel}>
                <Icon name="columns" size={16} />{t.schil.kolommen}
              </button>
              {kies && (
                <span className="bw-cols__pop" role="group" aria-label={t.schil.kolommenLabel}>
                  {optional.map((c) => (
                    <label key={c.key}><input type="checkbox" checked={!verborgen.includes(c.key)} onChange={() => wissel(c.key)} />{c.label}</label>
                  ))}
                </span>
              )}
            </span>
          )}
        </div>
      )}
      {shown.length === 0 && empty ? (
        typeof empty === "string" ? <p className="a-empty">{empty}</p> : empty
      ) : (
        <div className="bw-table-wrap">
          <table className={`bw-table${stackOnMobile ? " bw-table--stack" : ""}`}>
            {caption && <caption className="bw-label" style={{ textAlign: "left", padding: "10px 14px" }}>{caption}</caption>}
            <thead>
              <tr>
                {zichtbaar.map((c) => {
                  const nu = sort === c.key ? "asc" : sort === `-${c.key}` ? "desc" : null;
                  return (
                    <th key={c.key} className={c.right ? "bw-right" : undefined} style={c.width ? { width: c.width } : undefined} aria-sort={nu === "asc" ? "ascending" : nu === "desc" ? "descending" : undefined}>
                      {c.sort ? (
                        <button type="button" className="bw-th-sort" aria-pressed={!!nu} title={t.schil.sorteer(c.label.toLowerCase())} onClick={() => setSort(nu === "asc" ? `-${c.key}` : nu === "desc" ? null : c.key)}>
                          {c.label}{nu && <Icon name={nu === "asc" ? "up" : "down"} size={12} />}
                        </button>
                      ) : c.label}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const k = rowKey(r);
                return (
                  <tr
                    key={k}
                    className={[onRow && "bw-row--click", selected === k && "bw-row--sel"].filter(Boolean).join(" ") || undefined}
                    onClick={onRow ? () => onRow(r) : undefined}
                    tabIndex={onRow ? 0 : undefined}
                    aria-selected={selected !== undefined ? selected === k : undefined}
                    onKeyDown={onRow ? (e) => { if (e.key === "Enter") onRow(r); } : undefined}
                  >
                    {zichtbaar.map((c) => (
                      <td key={c.key} data-label={c.label} className={c.right ? "bw-right" : undefined}>{c.render(r)}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
