import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { NewTicket } from "../backend";
import { errText, fmtTime, unwrap, useBackend } from "../util";

// (d) Ticketpatroon: de browser vraagt een ticket; de robot (gateway) controleert het en schrijft een voorstel terug.
export function TicketPanel() {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const [t, setT] = useState<NewTicket | null>(null);
  const proposals = useQuery({ queryKey: ["proposals"], queryFn: () => actor!.myProposals(), enabled: !!actor });
  const make = useMutation({
    mutationFn: async () => unwrap(await actor!.createTicket("proef-voorstel", "Proefwerf")),
    onSuccess: setT,
  });
  return (
    <>
      <section className="card">
        <h2>Ticket voor de robot</h2>
        <p>
          Maak een ticket (10 minuten geldig, eenmalig). Laat daarna het robotscript lopen:
          <br />
          <span className="mono small">node tools/robot.mjs &lt;backend-canister&gt; &lt;ticket&gt;</span>
        </p>
        <button type="button" disabled={make.isPending} onClick={() => make.mutate()}>Ticket maken</button>
        {make.error && <p className="error">{errText(make.error)}</p>}
        {t && (
          <div className="code">
            <p className="big mono">{t.ticket}</p>
            <p>Geldig tot {fmtTime(t.expiresAt)}.</p>
            <button type="button" className="secondary" onClick={() => navigator.clipboard?.writeText(t.ticket)}>Kopiëren</button>
          </div>
        )}
      </section>
      <section className="card">
        <h2>Voorstellen van de robot</h2>
        <button type="button" className="secondary" onClick={() => qc.invalidateQueries({ queryKey: ["proposals"] })}>Vernieuwen</button>
        <ul className="plain">
          {(proposals.data ?? []).map((p) => (
            <li key={String(p.id)}>
              <b>Ticket #{String(p.ticketId)}</b> · {fmtTime(p.at)}
              <pre>{p.content}</pre>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
