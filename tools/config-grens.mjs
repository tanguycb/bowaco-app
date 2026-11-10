// 3.12 (review L): de livegrens van Config.mo, voor de meetlat (vóór elke upload) en voor tests/live-grens.mjs.
// Kijkt naar de ECHTE definities: commentaar telt niet mee, elke naam moet precies één keer gedefinieerd zijn, en de waarde moet de
// veilige zijn. Zo glipt geen variant door (de juiste regel in commentaar laten staan en de echte definitie anders schrijven).
//   mailLiveBackends en aiLiveBackends = [] · mailLiveAnyCanister, aiLiveAnyCanister, measureAnyCanister, aiGatewayEnabled = false
// Bij de livegang van de mail of van Caffeine AI past de eigenaar deze grens bewust aan (een apart ja), nooit stilzwijgend.
const zonderCommentaar = (src) => src.split("\n").map((l) => { const i = l.indexOf("//"); return i < 0 ? l : l.slice(0, i); }).join("\n");

export function configGrens(src) {
  const code = zonderCommentaar(src);
  const fouten = [];
  const vlag = (naam) => {
    const defs = [...code.matchAll(new RegExp(`public\\s+(?:let|var|func)\\s+${naam}\\b[^;]*;`, "g"))].map((m) => m[0]);
    if (defs.length !== 1) fouten.push(`${naam}: ${defs.length} definities (verwacht 1)`);
    else if (!new RegExp(`^public\\s+let\\s+${naam}\\s*:\\s*Bool\\s*=\\s*false\\s*;$`).test(defs[0])) fouten.push(`${naam} moet false zijn`);
  };
  const lijst = (naam) => {
    const defs = [...code.matchAll(new RegExp(`public\\s+(?:let|var|func)\\s+${naam}\\b[^}]*\\}\\s*;`, "g"))].map((m) => m[0]);
    if (defs.length !== 1) fouten.push(`${naam}: ${defs.length} definities (verwacht 1)`);
    else if (!new RegExp(`^public\\s+func\\s+${naam}\\s*\\(\\s*\\)\\s*:\\s*\\[\\s*Text\\s*\\]\\s*\\{\\s*\\[\\s*\\]\\s*\\}\\s*;$`).test(defs[0])) fouten.push(`${naam} moet leeg zijn ([])`);
  };
  for (const n of ["mailLiveAnyCanister", "aiLiveAnyCanister", "measureAnyCanister", "aiGatewayEnabled"]) vlag(n);
  for (const n of ["mailLiveBackends", "aiLiveBackends"]) lijst(n);
  return fouten;
}
