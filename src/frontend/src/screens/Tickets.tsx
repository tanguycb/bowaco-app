import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { NewTicket } from "../backend";
import { errText, fmtTime, loadConfig, unwrap, useBackend } from "../util";

// (d) Ticketpatroon: de browser vraagt een ticket; de robot (later: de gateway op een server) controleert
// het en schrijft een voorstel terug. In deze proef draait de robot als script op de Mac van de eigenaar:
// zijn sleutel mag nooit in de browser of in de app staan.
export function TicketPanel() {
  const { actor } = useBackend();
  const [t, setT] = useState<NewTicket | null>(null);
  const cfg = useQuery({ queryKey: ["config"], queryFn: () => loadConfig() });
  const proposals = useQuery({
    queryKey: ["proposals"],
    queryFn: () => actor!.myProposals(),
    enabled: !!actor,
    refetchInterval: t ? 5000 : false, // na een ticket: elke 5 s kijken of de robot al antwoordde
  });
  const make = useMutation({
    mutationFn: async () => unwrap(await actor!.createTicket("proef-voorstel", "Proefwerf")),
    onSuccess: setT,
  });
  const command = t
    ? `cd ~/Desktop/Split/bowaco-app && node tools/robot.mjs ${cfg.data?.backend_canister_id ?? "<backend>"} ${t.ticket}`
    : "";
  const answered = t && (proposals.data ?? []).some((p) => p.ticketId === t.ticketId);
  return (
    <>
      <section className="card">
        <h2>Ticket voor de robot</h2>
        <p>
          De robot is het stuk dat later als "gateway" op een server draait (AI, mails). Zijn sleutel mag nooit
          in de app staan, daarom draait hij in deze proef als klein programma op de Mac.
        </p>
        <ol className="steps">
          <li>Klik <b>Ticket maken</b> (10 minuten geldig, één keer bruikbaar).</li>
          <li>Klik <b>Opdracht kopiëren</b>, open het programma <b>Terminal</b> op de Mac, plak en druk Enter.</li>
          <li>Het voorstel van de robot verschijnt hieronder vanzelf.</li>
        </ol>
        <button type="button" disabled={make.isPending} onClick={() => make.mutate()}>
          {make.isPending ? "Ticket maken…" : "Ticket maken"}
        </button>
        {make.error && <p className="error">{errText(make.error)}</p>}
        {t && (
          <div className="code">
            <p>Ticket #{String(t.ticketId)}, geldig tot {fmtTime(t.expiresAt)}.</p>
            <p className="mono small">{command}</p>
            <button type="button" onClick={() => navigator.clipboard?.writeText(command)}>
              Opdracht kopiëren
            </button>
            <p>{answered ? "✓ De robot heeft geantwoord." : "Wacht op de robot…"}</p>
          </div>
        )}
      </section>
      <section className="card">
        <h2>Voorstellen van de robot</h2>
        {(proposals.data ?? []).length === 0 && <p>Nog geen voorstellen.</p>}
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
