#!/usr/bin/env python3 -I
"""Stap 2b.6 stap 7: de selectie van de documenten van de actieve werven (geen upload). Neemt uit de documenten-index de
werfbestanden van de werven die stap 3 aanmaakt en schrijft per werf wat er zou opgeladen worden (soort, aantal, grootte).

  python3 -I tools/inrichting/lees-documenten.py --documenten BOWACO_index_documenten.csv --werven stap3-werven.json

NOOIT in de selectie: gevoelige bestanden, foto's en video's (selectie later, vraag D52), dubbels en oudere versies,
blanco sjablonen, aankoop- en verkoopfacturen. Een upload gaat naar de opslagdienst van Caffeine, dus buiten het lokale
net: tools/inrichting.mjs weigert hem tot de eigenaar beslist (vraag D47) en zijn "ja" geeft.
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
    ap.add_argument("--uit", default="stap7-documenten.json")
    ap.add_argument("--bron", default="echt", choices=["echt", "test"])
    a = ap.parse_args()

    werven = {w["key"]: w for w in json.load(open(a.werven, encoding="utf-8"))["werven"]}
    per = collections.defaultdict(lambda: {"bestanden": [], "soorten": collections.Counter(), "bytes": 0})
    niet = collections.Counter()
    for d in bron.lees_index(a.documenten):
        if d.get("werf_id") not in werven:
            continue
        act = d.get("import_actie") or ""
        # Aankoopfacturen zijn historiek (fase 3), ook als ze in een werfmap staan.
        if not act.startswith("werf-bestand") or (d.get("gevoelig") or "nee") != "nee" or "historiek" in act or "aankoopfactuur" in act:
            niet[act.split(" (")[0] if not act.startswith("werf-bestand") else act] += 1
            continue
        soort = act[len("werf-bestand"):].strip(" ()") or "overig"
        w = per[d["werf_id"]]
        grootte = int(d.get("grootte_bytes") or 0)
        w["bestanden"].append({"doc": d["doc_id"], "soort": soort, "bytes": grootte, "type": d.get("type", "")})
        w["soorten"][soort] += 1
        w["bytes"] += grootte
    out = [{"werf": k, "code": werven[k]["code"], "aantal": len(v["bestanden"]), "bytes": v["bytes"], "soorten": dict(v["soorten"]), "bestanden": v["bestanden"]} for k, v in sorted(per.items())]
    plan = {"bron": a.bron, "stap": 7, "gemaakt": bron.vandaag(), "werven": out, "nietGeselecteerd": dict(niet)}
    p = bron.schrijf_plan(a.uit, plan)
    print(f"werven met documenten {len(out)} · bestanden {sum(x['aantal'] for x in out)} · {sum(x['bytes'] for x in out) / 1e9:.2f} GB · niet geselecteerd {sum(niet.values())}")
    print(f"plan: {p}")


if __name__ == "__main__":
    main()
