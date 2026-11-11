// 4b.4: de start van de klant (gsm eerst) en van de architect en de veiligheidscoördinator. Enkel wat de backend die rol al geeft:
// myWorks() (code, naam, status, werfleider, rechten per werf), de fase uit de status, en de regels uit Te doen. Geen bedragen, geen nieuwe stukken.
import { useQuery } from "@tanstack/react-query";
import type { Caps, ExternalWork } from "../backend";
import { standZin, veiligRegels } from "../app/eentik";
import { Button, Card, Icon } from "../design";
import { werfFase, type Fase } from "../app/fase";
import { t } from "../texts/nl";
import { useBackend } from "../util";
import { factsOf, Loading, PhaseLabel } from "./common";
import { TodoBlock } from "./TeDoen";

const K = t.klantStart;
const A = t.veiligStart;

function useMyWorks() {
  const { actor, isFetching } = useBackend();
  return useQuery({ queryKey: ["myWorks"], queryFn: () => actor!.myWorks(), enabled: !!actor && !isFetching });
}
const adres = (w: ExternalWork) => [w.address.street, w.address.number].filter(Boolean).join(" ") + (w.address.city ? `, ${w.address.city}` : "");
const bel = (w: ExternalWork) => w.leaderPhone && <a className="bw-btn bw-btn--secondary bw-btn--lg" href={`tel:${w.leaderPhone.replace(/\s/g, "")}`}><Icon name="phone" size={18} />{t.extern.call}{w.leaderName ? ` ${w.leaderName}` : ""}</a>;
const fase = (w: ExternalWork): Fase => werfFase(factsOf(w, undefined));

/** De klant: de stand van de werf in één zin, wat op zijn akkoord wacht (Te doen), en één knop naar de offerte en de vorderingsstaten. */
export function KlantStart({ caps, go }: { caps: Caps; go: (to: string) => void }) {
  const q = useMyWorks();
  return (
    <div className="a-stack" data-testid="klant-start">
      <Loading q={q} />
      {q.data && q.data.length === 0 && <p className="a-empty">{t.leeg.mijnWerf.d}</p>}
      {(q.data ?? []).map((w) => {
        const f = fase(w);
        return (
          <Card key={String(w.id)} raised title={<button type="button" className="m-titlelink" onClick={() => go(`werven/${w.id}`)}>{w.code} · {w.name} <Icon name="next" size={18} /></button>} meta={adres(w)} aside={<PhaseLabel fase={f} client />}>
            <div className="a-stack">
              <p className="k-stand" data-testid="klant-stand"><b>{standZin(f, true)}</b></p>
              <div className="a-row">
                {caps.myQuotes && <Button size="lg" icon="doc" onClick={() => go("mijn-offerte")}>{K.offerte}</Button>}
                {caps.myProgress && <Button size="lg" icon="receipt" onClick={() => go("mijn-vordering")}>{K.vorderingen}</Button>}
                <Button size="lg" icon="building" onClick={() => go(`werven/${w.id}`)}>{K.werf}</Button>
                {bel(w)}
              </div>
            </div>
          </Card>
        );
      })}
      <TodoBlock go={go} home={caps.home} hideEmpty max={3} />
    </div>
  );
}

export function VeiligStart({ caps, go }: { caps: Caps; go: (to: string) => void }) {
  const q = useMyWorks();
  return (
    <div className="a-stack" data-testid="veilig-start">
      <Loading q={q} />
      {q.data && q.data.length === 0 && <p className="a-empty">{t.leeg.mijnWerven.d}</p>}
      {(q.data ?? []).map((w) => (
        <Card key={String(w.id)} raised title={<button type="button" className="m-titlelink" onClick={() => go(`werven/${w.id}`)}>{w.code} · {w.name} <Icon name="next" size={18} /></button>} meta={adres(w)} aside={<PhaseLabel fase={fase(w)} />}>
          <div className="a-stack">
            <span className="bw-label">{A.klaar}</span>
            <ul className="a-list">
              {veiligRegels(w).map((r) => (
                <li key={r.key}>
                  <button type="button" className="a-list__btn" onClick={() => go(`werven/${w.id}/${r.tab}`)} data-regel={r.key}>
                    <span className="a-list__main"><b>{A.regels[r.key].t}</b><span className="bw-muted">{A.regels[r.key].d}</span></span>
                    <Icon name="next" size={18} />
                  </button>
                </li>
              ))}
            </ul>
            <div className="a-row">{bel(w)}</div>
          </div>
        </Card>
      ))}
      <TodoBlock go={go} home={caps.home} hideEmpty max={3} />
    </div>
  );
}
