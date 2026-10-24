// Boete-opzoeking (stap 1b.2, bouwplan §5.2): dag, uur, nummerplaat en plaats uit de boete → de ritten uit het
// werfverslag (wie reed heen en terug, welke werf, wanneer de ploeg er was) en de vergunning die er die dag gold.
// Een update-call: elke opzoeking staat in de auditlog. De backend filtert de ritten per rol (R14).
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { FineMatch, FineResult } from "../backend";
import { Button, Icon } from "../design";
import { t } from "../texts/nl";
import { dayToInput, errText, fmtDayNum, inputToDay, todayDay, unwrap, useBackend } from "../util";
import { Page } from "./common";
import { ReportSheet } from "./Verslagen";
import { Field } from "./Werven";

const B = t.boetes;

export function BoetesPage({ go }: { go: (to: string) => void }) {
  const { actor } = useBackend();
  const [day, setDay] = useState(dayToInput(todayDay() - 1n));
  const [time, setTime] = useState("");
  const [plate, setPlate] = useState("");
  const [place, setPlace] = useState("");
  const [widen, setWiden] = useState(false);
  const [report, setReport] = useState<bigint | null>(null);
  const q = useMutation({
    mutationFn: async (): Promise<FineResult> => {
      const d = inputToDay(day);
      if (d === undefined) throw new Error(B.day);
      const m = /^(\d{2}):(\d{2})$/.exec(time);
      return unwrap(await actor!.lookupFine({ day: d, time: m ? BigInt(Number(m[1]) * 60 + Number(m[2])) : undefined, plate: plate.trim(), place: place.trim(), widen }));
    },
  });
  const r = q.data;
  return (
    <Page title={B.title}>
      <p className="bw-muted">{B.lead}</p>
      <form className="a-section" onSubmit={(e) => { e.preventDefault(); q.mutate(); }}>
        <div className="a-row">
          <Field label={B.day}><input className="bw-input" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
          <Field label={B.time}><input className="bw-input" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
          <Field label={B.plate}><input className="bw-input" value={plate} placeholder={B.platePh} maxLength={20} onChange={(e) => setPlate(e.target.value.toUpperCase())} /></Field>
        </div>
        <Field label={B.place}><input className="bw-input" value={place} placeholder={B.placePh} onChange={(e) => setPlace(e.target.value)} /></Field>
        <label className="a-check"><input type="checkbox" checked={widen} onChange={(e) => setWiden(e.target.checked)} /> {B.widen}</label>
        <div className="a-row"><Button variant="primary" icon="list" busy={q.isPending} onClick={() => q.mutate()}>{B.search}</Button></div>
      </form>
      {q.error && <p className="a-err" role="alert"><Icon name="alert" size={16} /> {errText(q.error)}</p>}
      {r && (
        <section className="a-section">
          {r.ownTripsOnly && <p className="a-note">{B.ownOnly}</p>}
          {plate.trim() !== "" && !r.vehicleKnown && <p className="a-note">{B.plateUnknown}</p>}
          {r.matches.length === 0 && <p className="a-empty">{B.none}</p>}
          <ul className="f-list">
            {r.matches.map((m) => <MatchCard key={String(m.tripId)} m={m} onReport={setReport} onWork={() => go(`werven/${m.workId}`)} />)}
          </ul>
        </section>
      )}
      {report !== null && <ReportSheet id={report} onClose={() => setReport(null)} />}
    </Page>
  );
}

function MatchCard({ m, onReport, onWork }: { m: FineMatch; onReport: (id: bigint) => void; onWork: () => void }) {
  const addr = [m.address.street, m.address.number].filter(Boolean).join(" ") + (m.address.city ? `, ${m.address.zip} ${m.address.city}` : "");
  return (
    <li className="f-card">
      <div className="a-row a-row--between">
        <b>{fmtDayNum(m.day)} · {m.plate}{m.vehicleName ? ` (${m.vehicleName})` : ""}</b>
        <span className="a-row--tight">
          {m.plateMatch && <span className="a-tag a-tag--ok">{B.plateMatch}</span>}
          {m.placeMatch && <span className="a-tag a-tag--ok">{B.placeMatch}</span>}
          {!m.sameDay && <span className="a-tag a-tag--warn">{B.otherDay}</span>}
        </span>
      </div>
      <p className="f-guess"><span className="bw-label">{B.guess}</span> {m.guess}</p>
      <dl className="a-dl">
        <dt>{B.work}</dt><dd><button type="button" className="wb-link" onClick={onWork}>{m.workCode} · {m.workName}</button><br /><span className="bw-muted">{addr}</span></dd>
        <dt>{B.out}</dt><dd>{m.driverOut || "–"}{m.outTime ? ` · ${m.outTime}` : ""}</dd>
        <dt>{B.back}</dt><dd>{m.driverBack || "–"}{m.backTime ? ` · ${m.backTime}` : ""}</dd>
        <dt>{B.crew}</dt><dd>{m.crew.length ? m.crew.join(" · ") : <span className="bw-muted">{B.noCrew}</span>}</dd>
        <dt>{B.permits}</dt>
        <dd>{m.permits.length ? m.permits.map((p) => `${p.kindName}${p.location ? ` (${p.location})` : ""}${p.reference ? ` · ${p.reference}` : ""} · ${fmtDayNum(p.validFrom)} – ${fmtDayNum(p.validTo)}`).join(" · ") : <span className="bw-muted">{B.noPermit}</span>}</dd>
      </dl>
      <Button variant="quiet" icon="doc" onClick={() => onReport(m.reportId)}>{B.report}</Button>
    </li>
  );
}
