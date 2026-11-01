// Wat bij een uitgereikte factuur bijkomt in stap 2c.6b (UBL voor Peppol, herinnering bij een vervallen factuur).
import type { SalesFullView } from "../backend";

export function SalesExtra(_: { v: SalesFullView; onDone: () => void }) {
  return null;
}

export function QuarterExport(_: { today: bigint }) {
  return null;
}
