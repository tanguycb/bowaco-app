// 4b.4: "Eén tik" op Vandaag van de werfleider (gsm): wat hij elke dag bevestigt, als rij met één knop. Het gaat altijd via de wachtrij van het
// werfverslag (offline-veilig, één keer uitgevoerd): "Wie is er? Klopt" = de geplande firma's als aanwezig, "Taak klaar" = voortgang 100 %.
// Geen nieuwe backendoproep: dezelfde opdrachten als het werfverslag. Wat in het verslag staat, verdwijnt hier; het verslag blijft de plaats voor details.
import type { DayWork } from "../backend";
import { Button, Icon, useToast } from "../design";
import { tikken, type Tik } from "../app/eentik";
import { useOutbox } from "../offline/outbox";
import { t } from "../texts/nl";
import { errText } from "../util";

const V = t.vandaag;

export function EenTikRijen({ works, day }: { works: DayWork[]; day: bigint }) {
  const ob = useOutbox();
  const toast = useToast();
  const pending = ob.ops.filter((o) => o.day === day).map((o) => ({
    workId: o.workId, kind: o.payload.__kind__,
    taskId: o.payload.__kind__ === "workDone" ? o.payload.workDone.taskId : undefined,
    percent: o.payload.__kind__ === "workDone" ? o.payload.workDone.percent : undefined,
  }));
  const rows = tikken(works, pending);
  const done = ob.ops.filter((o) => o.day === day && works.some((w) => w.id === o.workId)).length;
  const run = async (x: Tik) => {
    try {
      const ck = await ob.ensureReport(x.werk.id, day, `${t.verslag.title} ${x.werk.code}`);
      for (const op of x.op) await ob.enqueue({ clientKey: ck, workId: x.werk.id, day, label: x.label, op });
      toast.show({ kind: "ok", text: V.eenTik.bewaard });
    } catch (e) {
      toast.show({ kind: "error", text: errText(e) });
    }
  };
  if (rows.length === 0 && done === 0) return null;
  return (
    <section className="a-section v-tik" data-testid="een-tik" aria-label={V.eenTik.titel}>
      <h2 className="bw-h2">{V.eenTik.titel}</h2>
      {rows.length === 0 ? <p className="bw-muted a-note-small"><Icon name="check" size={16} /> {V.eenTik.klaar0}</p> : (
        <ul className="a-list">
          {rows.map((x) => (
            <li key={x.key} className="v-tik__row" data-tik={x.key}>
              <span className="a-list__main"><span className="bw-muted">{x.werk.code} · {x.tekst}</span><b>{x.detail}</b></span>
              <Button variant="primary" size="lg" icon="check" onClick={() => void run(x)}>{x.knop}</Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
