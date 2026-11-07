// 2d.3: Beheer > Documenten — foto's verkleinen vóór het opladen (aan/uit + langste zijde). Bewaard op dit toestel
// (localStorage, geen backend-veld); standaard aan, 2000 px. Foto's worden altijd hercodeerd (EXIF/GPS weg).
import { useState } from "react";
import { DEFAULT_MAX_SIDE, clampSide, getPhotoPrefs, setPhotoPrefs } from "../lib/uploadPrep";

export function FotoInstelling() {
  const [p, setP] = useState(getPhotoPrefs);
  const [side, setSide] = useState(String(p.maxSide));
  const save = (n: typeof p) => { setP(n); setPhotoPrefs(n); };
  return (
    <section className="a-section" style={{ maxWidth: 860 }}>
      <h2 className="bw-h2">Foto's opladen</h2>
      <p className="bw-muted">Foto's worden op het toestel verkleind en zonder locatiegegevens opgeladen; het origineel blijft op het toestel. PDF, Excel en Word gaan ongewijzigd. Grens 15 MB per bestand, video's niet. Deze instelling geldt voor dit toestel.</p>
      <label className="bw-field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <input type="checkbox" checked={p.shrink} onChange={(e) => save({ ...p, shrink: e.target.checked })} />
        <span>Foto's verkleinen</span>
      </label>
      <label className="bw-field" style={{ maxWidth: 240 }}>
        <span className="bw-label">Langste zijde (px)</span>
        <input className="bw-input" inputMode="numeric" value={side} disabled={!p.shrink}
          onChange={(e) => setSide(e.target.value.replace(/\D/g, ""))}
          onBlur={() => { const n = clampSide(Number(side || DEFAULT_MAX_SIDE)); setSide(String(n)); save({ ...p, maxSide: n }); }} />
      </label>
    </section>
  );
}
