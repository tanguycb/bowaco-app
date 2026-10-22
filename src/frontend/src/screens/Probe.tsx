import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errText, fmtTime, unwrap, useBackend } from "../util";

// (f) migratie, (g) timer, (h) vetkd_public_key — de ruwe meetwaarden.
export function ProbePanel() {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const status = useQuery({ queryKey: ["probe"], queryFn: () => actor!.probeStatus(), enabled: !!actor });
  const notes = useQuery({ queryKey: ["notes"], queryFn: () => actor!.probeNotes(), enabled: !!actor });
  const vetkd = useMutation({ mutationFn: () => actor!.probeVetkd() });
  const add = useMutation({
    mutationFn: async () => unwrap(await actor!.addProbeNote(note)),
    onSuccess: () => {
      setNote("");
      qc.invalidateQueries({ queryKey: ["notes"] });
    },
  });
  const s = status.data;
  const gaps =
    s && s.timerRecent.length > 1
      ? s.timerRecent.slice(1).map((v, i) => Number((v - s.timerRecent[i]) / 1_000_000n) / 1000)
      : [];
  return (
    <>
      <section className="card">
        <h2>Timer en versie</h2>
        <button type="button" className="secondary" disabled={status.isFetching} onClick={() => qc.invalidateQueries({ queryKey: ["probe"] })}>
          {status.isFetching ? "Bezig…" : "Vernieuwen"}
        </button>
        {status.isPending && <p>Meetwaarden ophalen (± 2 s)…</p>}
        {s && (
          <dl className="kv">
            <div><dt>Versie</dt><dd>{s.version}</dd></div>
            <div><dt>Tijd canister</dt><dd>{fmtTime(s.canisterTime)}</dd></div>
            <div><dt>Timer-tikken</dt><dd>{String(s.timerTicks)} (laatste {fmtTime(s.timerLastTick)})</dd></div>
            <div><dt>Tussentijden (s)</dt><dd className="mono small">{gaps.map((g) => g.toFixed(1)).join(" ") || "–"}</dd></div>
            <div><dt>Opgeruimde tickets</dt><dd>{String(s.expiredTickets)}</dd></div>
            <div><dt>Omgevingsvariabelen</dt><dd className="mono small">{s.envNames.join(", ") || "(geen)"}</dd></div>
            <div><dt>Personen / bestanden</dt><dd>{String(s.persons)} / {String(s.files)}</dd></div>
          </dl>
        )}
        {status.error && <p className="error">{errText(status.error)}</p>}
      </section>
      <section className="card">
        <h2>vetKeys: publieke sleutel</h2>
        <p>Vraagt enkel de publieke sleutel op (geen afleiding, geen data).</p>
        <button type="button" disabled={vetkd.isPending} onClick={() => vetkd.mutate()}>
          {vetkd.isPending ? "Bezig met meten (± 7 s)…" : "Meten"}
        </button>
        {vetkd.data && <VetkdReport text={vetkd.data} />}
        {s?.vetkdLastReport && !vetkd.data && (
          <>
            <p className="small">Vorige meting ({fmtTime(s.vetkdLastAt)}):</p>
            <VetkdReport text={s.vetkdLastReport} />
          </>
        )}
        {vetkd.error && <p className="error">{errText(vetkd.error)}</p>}
      </section>
      <section className="card">
        <h2>Proefnotities (migratietest)</h2>
        <div className="stack">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="korte proeftekst" />
          <button type="button" disabled={!note || add.isPending} onClick={() => add.mutate()}>Bewaren</button>
        </div>
        {add.error && <p className="error">{errText(add.error)}</p>}
        <ul className="plain small">
          {(notes.data ?? []).map((n) => (
            <li key={String(n.id)}>#{String(n.id)} · {fmtTime(n.at)} · {n.text}</li>
          ))}
        </ul>
      </section>
    </>
  );
}

// "VETKD_KEY_NAME=… | key_1: OK 96 B, 2536 ms, … | test_key_1: …" → één regel per sleutel.
function VetkdReport({ text }: { text: string }) {
  const parts = text.split(" | ");
  return (
    <ul className="plain small">
      {parts.map((p) => (
        <li key={p}>
          {p.includes(": OK") ? "✅ " : p.includes("FOUT") ? "❌ " : ""}
          <span className="mono">{p}</span>
        </li>
      ))}
    </ul>
  );
}
