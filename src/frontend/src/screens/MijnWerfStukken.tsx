// Mijn werf (klant en architect), stap 2c.8: het verzekeringsattest en het opleveringsdocument die kantoor met de klant deelde. Niets anders:
// geen verzekeraar, geen polis, geen premie, geen werfwaarde, geen aankoopprijzen (de backend stuurt ze niet mee).
import { useQuery } from "@tanstack/react-query";
import { HandoverKind } from "../backend";
import { t } from "../texts/nl";
import { fmtDayNum, useBackend } from "../util";
import { Loading } from "./common";

const C = t.siteAdmin.client;

export function ClientSiteDocs({ workId }: { workId: bigint }) {
  const { actor, isFetching } = useBackend();
  const q = useQuery({ queryKey: ["clientSiteAdmin", String(workId)], queryFn: () => actor!.clientSiteAdmin(workId), enabled: !!actor && !isFetching, retry: 0 });
  const d = q.data;
  if (q.error) return null; // geen toegang (bv. een klant van een andere firma): het blok verdwijnt
  const link = (name: string, url: string | undefined) => (url ? <a className="a-link" href={url} target="_blank" rel="noopener noreferrer">{name}</a> : <span>{name}</span>);
  return (
    <section className="a-section" data-testid="client-site-docs">
      <h2 className="bw-h2">{C.title}</h2>
      <Loading q={q} />
      {d && d.attests.length === 0 && d.handovers.length === 0 && <p className="bw-muted">{C.none}</p>}
      {d && (d.attests.length > 0 || d.handovers.length > 0) && (
        <ul className="a-list">
          {d.attests.map((a, i) => (
            <li key={`a${i}`} className="a-doc"><span className="a-list__main"><b>{C.attest(a.kindName)}</b><span className="bw-muted">{fmtDayNum(a.periodFrom)} – {fmtDayNum(a.periodTo)}</span></span>{link(a.file.name, a.file.blob?.getDirectURL())}</li>
          ))}
          {d.handovers.map((h, i) => (
            <li key={`h${i}`} className="a-doc"><span className="a-list__main"><b>{C.handover(t.siteAdmin.handover.kinds[h.kind as HandoverKind])}{h.day !== undefined ? ` · ${fmtDayNum(h.day)}` : ""}</b><span className="bw-muted bw-mono">{C.code} {h.controlCode.slice(0, 16)}</span></span>{link(h.file.name, h.file.blob?.getDirectURL())}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
