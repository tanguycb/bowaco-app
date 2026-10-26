// "+ Verslag" in de vaste balk van de werfleider: kies de werf van vandaag en het werfverslag opent (de 4 stappen blijven zoals ze zijn).
import { useState } from "react";
import type { MyDayView } from "../backend";
import { Button, Icon, Sheet } from "../design";
import { useCached } from "../offline/cached";
import { t } from "../texts/nl";
import { todayDay, useBackend } from "../util";
import { Loading } from "./common";

export function VerslagKies({ go, onClose }: { go: (to: string) => void; onClose: () => void }) {
  const { actor } = useBackend();
  const day = todayDay();
  const [all, setAll] = useState(false);
  const q = useCached<MyDayView>(["myDay", String(day), all ? "all" : "mine"], () => actor!.myDay(day, all));
  const works = q.data?.value.works ?? [];
  const pick = (id: bigint) => { onClose(); go(`verslag/${id}/${day}`); };
  return (
    <Sheet title={t.menu.verslagKies} open onClose={onClose}>
      {!q.data && <Loading q={q} />}
      {q.data && works.length === 0 && <p className="a-empty">{t.menu.verslagGeen}</p>}
      <ul className="a-list">
        {works.map((w) => (
          <li key={String(w.id)}>
            <button type="button" className="a-list__main a-pick" onClick={() => pick(w.id)}>
              <b>{w.code} · {w.name}</b>
              <span className="bw-muted">{[w.address.street, w.address.number].filter(Boolean).join(" ")}{w.address.city ? `, ${w.address.city}` : ""}</span>
            </button>
            <Icon name="next" size={18} />
          </li>
        ))}
      </ul>
      {!all && <Button variant="quiet" onClick={() => setAll(true)}>{t.menu.verslagAlle}</Button>}
      <Button variant="secondary" onClick={() => { onClose(); go("werven"); }}>{t.nav.werven}</Button>
    </Sheet>
  );
}
