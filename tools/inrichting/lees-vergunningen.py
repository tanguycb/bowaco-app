#!/usr/bin/env python3 -I
"""Stap 2b.6 stap 6: de kennisbank vergunningen per gemeente. Neemt het kennisbestand (doorlooptijden per gemeente en
soort, uit de analyse §2.4: BOWACO_kennisbank_vergunningen_2b6.json in bowaco-docs) en telt per gemeente de
vergunningsdocumenten in de werfmappen (documenten-index), en schrijft het plan stap6-vergunningen.json.

  python3 -I tools/inrichting/lees-vergunningen.py --kennis KENNIS.json --documenten BOWACO_index_documenten.csv --werven BOWACO_index_werven.csv

Wat in de app komt: de nieuwe vergunningssoorten (nutsaansluiting, doorlaatbewijs: N9) en per gemeente de procedures met
doorlooptijd en een notitie "nog na te kijken" (vraag D36). Geen namen van personen, geen dossiernummers.
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
    ap.add_argument("--kennis", required=True)
    ap.add_argument("--documenten", required=True)
    ap.add_argument("--werven", required=True)
    ap.add_argument("--uit", default="stap6-vergunningen.json")
    ap.add_argument("--bron", default="echt", choices=["echt", "test"])
    a = ap.parse_args()

    kennis = json.load(open(a.kennis, encoding="utf-8"))
    gemeente = {r["werf_id"]: bron.fold(r.get("gemeente")) for r in bron.lees_index(a.werven)}
    tel = collections.Counter()
    for d in bron.lees_index(a.documenten):
        if "vergunning" in (d.get("import_actie") or "") or (d.get("categorie") or "").startswith(("vergunning", "nutsaansluiting")):
            tel[(gemeente.get(d.get("werf_id"), ""), (d.get("categorie") or "").split(" ")[0])] += 1
    gemeenten = []
    for g in kennis["gemeenten"]:
        f = bron.fold(g["naam"])
        docs = {k[1]: n for k, n in tel.items() if k[0] == f}
        gemeenten.append({**g, "documenten": docs,
                          "notitie": f"Nog na te kijken (vraag D36): uit de documenten van BOWACO ({', '.join(f'{n} {k}' for k, n in docs.items()) or 'geen documenten'})."})
    plan = {"bron": a.bron, "stap": 6, "gemaakt": bron.vandaag(), "herkomst": kennis.get("bron", ""), "soorten": kennis["soorten"], "gemeenten": gemeenten}
    p = bron.schrijf_plan(a.uit, plan)
    print(f"soorten {len(plan['soorten'])} · gemeenten {len(gemeenten)} · procedures {sum(len(g['procedures']) for g in gemeenten)}")
    print(f"plan: {p}")


if __name__ == "__main__":
    main()
