import type { ReactNode } from "react";

export type Column<T> = {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  /** Getallen en bedragen rechts uitlijnen. */
  right?: boolean;
  width?: string;
};

type Props<T> = {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRow?: (row: T) => void;
  /** Op de gsm (< 640 px) wordt elke rij een blok met label: waarde, zonder horizontale scroll. */
  stackOnMobile?: boolean;
  caption?: string;
};

export function Table<T>({ columns, rows, rowKey, onRow, stackOnMobile = true, caption }: Props<T>) {
  return (
    <div className="bw-table-wrap">
      <table className={`bw-table${stackOnMobile ? " bw-table--stack" : ""}`}>
        {caption && <caption className="bw-label" style={{ textAlign: "left", padding: "10px 14px" }}>{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.right ? "bw-right" : undefined} style={c.width ? { width: c.width } : undefined}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={rowKey(r)}
              className={onRow ? "bw-row--click" : undefined}
              onClick={onRow ? () => onRow(r) : undefined}
              tabIndex={onRow ? 0 : undefined}
              onKeyDown={onRow ? (e) => { if (e.key === "Enter") onRow(r); } : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} data-label={c.label} className={c.right ? "bw-right" : undefined}>{c.render(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
