// Instellingen (R17): werfleider ziet alles, geldigheid van codes, en de robots (R28).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Principal } from "@icp-sdk/core/principal";
import { Button, Choice, useToast } from "../design";
import { t } from "../texts/nl";
import { errText, fmtTime, unwrap, useBackend } from "../util";
import { Loading, Page } from "./common";
import { Field } from "./Werven";

export function Instellingen() {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const qc = useQueryClient();
  const toast = useToast();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => actor!.getSettings(), enabled: on });
  const robots = useQuery({ queryKey: ["robots"], queryFn: () => actor!.listRobots(), enabled: on });
  const [all, setAll] = useState(true);
  const [days, setDays] = useState("7");
  const [rp, setRp] = useState("");
  const [rn, setRn] = useState("");
  useEffect(() => {
    if (settings.data) {
      setAll(settings.data.werfleiderZietAlles);
      setDays(String(settings.data.inviteDays));
    }
  }, [settings.data]);
  const ok = () => { toast.show({ kind: "ok", text: t.common.saved }); void qc.invalidateQueries(); };
  const fail = (e: unknown) => toast.show({ kind: "error", text: errText(e) });
  const save = useMutation({ mutationFn: async () => unwrap(await actor!.setSettings({ werfleiderZietAlles: all, inviteDays: BigInt(days || "0") })), onSuccess: ok, onError: fail });
  const add = useMutation({
    mutationFn: async () => unwrap(await actor!.addRobot(Principal.fromText(rp.trim()), rn, ["proef"])),
    onSuccess: () => { setRp(""); setRn(""); ok(); },
    onError: fail,
  });
  const revoke = useMutation({ mutationFn: async (p: Principal) => unwrap(await actor!.revokeRobot(p)), onSuccess: ok, onError: fail });
  return (
    <Page title={t.settings.title}>
      <Loading q={settings} />
      {settings.data && (
        <section className="a-form" style={{ maxWidth: 560 }}>
          <Field label={t.settings.wlAll}>
            <Choice label={t.settings.wlAll} value={all ? "ja" : "nee"} onChange={(v) => setAll(v === "ja")} options={[{ value: "ja", label: t.common.yes }, { value: "nee", label: t.common.no }]} />
          </Field>
          <p className="bw-muted">{t.settings.wlAllHelp}</p>
          <Field label={t.settings.inviteDays}><input className="bw-input bw-num" style={{ maxWidth: 120 }} value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" /></Field>
          <div><Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>{t.common.save}</Button></div>
        </section>
      )}
      <section className="a-section" style={{ maxWidth: 720 }}>
        <h2 className="bw-h2">{t.settings.robots}</h2>
        <p className="bw-muted">{t.settings.robotsLead}</p>
        <Loading q={robots} />
        {robots.data && robots.data.length === 0 && <p className="a-empty">{t.settings.noRobots}</p>}
        {robots.data && robots.data.length > 0 && (
          <ul className="a-list">
            {robots.data.map((r) => (
              <li key={r.principal.toText()}>
                <span className="a-list__main"><b>{r.name}</b><span className="a-mono">{r.principal.toText()}</span><span className="bw-muted">{fmtTime(r.addedAt)}{r.revokedAt !== undefined ? ` · ingetrokken ${fmtTime(r.revokedAt)}` : ""}</span></span>
                {r.revokedAt === undefined && <Button variant="quiet" onClick={() => revoke.mutate(r.principal)}>{t.settings.revoke}</Button>}
              </li>
            ))}
          </ul>
        )}
        <div className="a-grid2">
          <Field label={t.settings.principal}><input className="bw-input bw-mono" value={rp} onChange={(e) => setRp(e.target.value)} /></Field>
          <Field label={t.team.name}><input className="bw-input" value={rn} onChange={(e) => setRn(e.target.value)} /></Field>
        </div>
        <div><Button icon="plus" disabled={!rp || !rn} busy={add.isPending} onClick={() => add.mutate()}>{t.settings.addRobot}</Button></div>
      </section>
    </Page>
  );
}
