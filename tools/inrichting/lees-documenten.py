#!/usr/bin/env python3 -I
"""Stap 2b.6/2d.4 stap 7: de selectie van de werfdocumenten. Neemt uit de documenten-index de werfbestanden en de foto's
van ALLE werven met een werfmap en schrijft per werf wat er zou opgeladen worden (soort, aantal, grootte, pad).

  python3 -I tools/inrichting/lees-documenten.py --documenten BOWACO_index_documenten.csv --werven stap3-werven.json
         [--docs <documentenmap>]

2d.4 (D47): de gegevens komen van alle werven, de documenten standaard enkel van de ACTIEVE werven (= de werven die stap 3
aanmaakt: "actief": true). tools/inrichting.mjs kiest per werf (--documenten-werf W-012=ja,W-091=nee) en raamt vooraf de
kost: foto's verkleind zoals de app (tools/inrichting/zuinig.mjs), video's enkel in de lijst.

NOOIT in de selectie: gevoelige bestanden, dubbels en oudere versies, blanco sjablonen, historiek (fase 3), aankoop- en
verkoopfacturen. Foto's en video's wel (rij "foto-selectie later"): de import verkleint de foto's en slaat de video's over.
Enkel lezen: de documentenmap blijft ongewijzigd.
"""
import argparse
import collections
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bron  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--documenten", required=True)
    ap.add_argument("--werven", required=True, help="plan stap3-werven.json")
    ap.add_argument("--docs", help="de documentenmap (met 'Bowaco Administratie'): het pad per bestand, voor het verkleinen")
    ap.add_argument("--uit", default="stap7-documenten.json")
    ap.add_argument("--bron", default="echt", choices=["echt", "test"])
    a = ap.parse_args()

    actief = {w["key"]: w for w in json.load(open(a.werven, encoding="utf-8"))["werven"]}
    root = os.path.join(a.docs, "Bowaco Administratie") if a.docs else None
    per = collections.defaultdict(lambda: {"bestanden": [], "soorten": collections.Counter(), "bytes": 0})
    niet = collections.Counter()
    for d in bron.lees_index(a.documenten):
        if not d.get("werf_id"):
            continue
        act = d.get("import_actie") or ""
        foto = act.startswith("foto-selectie")
        # Aankoopfacturen zijn historiek (fase 3), ook als ze in een werfmap staan.
        if not (act.startswith("werf-bestand") or foto) or (d.get("gevoelig") or "nee") != "nee" or "historiek" in act or "aankoopfactuur" in act:
            niet[act.split(" (")[0] if not act.startswith("werf-bestand") else act] += 1
            continue
        soort = "foto" if foto else (act[len("werf-bestand"):].strip(" ()") or "overig")
        w = per[d["werf_id"]]
        grootte = int(d.get("grootte_bytes") or 0)
        rij = {"doc": d["doc_id"], "soort": soort, "bytes": grootte, "type": (d.get("type") or "").lower(), "naam": os.path.basename(d.get("pad") or "")}
        if root:
            rij["pad"] = os.path.join(root, d["pad"])
        w["bestanden"].append(rij)
        w["soorten"][soort] += 1
        w["bytes"] += grootte
    out = [{"werf": k, "code": actief[k]["code"] if k in actief else k, "actief": k in actief, "aantal": len(v["bestanden"]), "bytes": v["bytes"],
            "soorten": dict(v["soorten"]), "bestanden": v["bestanden"]} for k, v in sorted(per.items())]
    plan = {"bron": a.bron, "stap": 7, "gemaakt": bron.vandaag(), "werven": out, "nietGeselecteerd": dict(niet)}
    p = bron.schrijf_plan(a.uit, plan)
    print(f"werven met documenten {len(out)} (actief {sum(1 for x in out if x['actief'])}) · bestanden {sum(x['aantal'] for x in out)} · {sum(x['bytes'] for x in out) / 1e9:.2f} GB · niet geselecteerd {sum(niet.values())}")
    print(f"plan: {p}")


if __name__ == "__main__":
    main()
