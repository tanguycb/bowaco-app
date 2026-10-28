#!/usr/bin/env python3 -I
"""Stap 2b.6 stap 3: de werf-leesmodule. Maakt uit de werf-index en de planning-index van 0.3 het plan stap3-werven.json:
de werven die aangemaakt worden (adres uit de mapnaam) en, per planningblok, of de taken in zo'n werf komen.

  python3 -I tools/inrichting/lees-werven.py --werven BOWACO_index_werven.csv --planning BOWACO_index_planning.csv
         --planplan planning/plan.json

Regels (BOWACO_analyse_documenten.md §4 stap 3 en §8; voorlopige keuzes = de aanbeveling van de index):
  - een werf wordt aangemaakt als de index "stap 3: werf aanmaken" voorstelt (werfmap met een wijziging in 2026, geen
    andere activiteit, geen lege schil). Code = de sleutel van de index (W-001 …: vast, dus een tweede run vindt de werf terug;
    vraag D41 over een eigen werfnummer). Naam en adres komen uit de mapnaam; geen klantnaam (privacy);
  - de oudere werven (2025, ≤ 2024), de werven zonder map (enkel uit een offerte of factuur), de lege schillen en de
    mappen van een andere activiteit komen NIET in de app (vragen D8, D11, D41, D47; de zaakvoerder beslist);
  - planning: een blok dat ZEKER bij een aangemaakte werf hoort (zelfde adres), komt als vervolg in die werf; de andere
    blokken worden een eigen werf zoals in 1.5 (vraag Z1). De taken, uitvoerders en afspraken komen uit plan.json van
    tools/plan-analyse.py (ongewijzigd sinds 1.5);
  - btw 6 % tenzij de planning 21 % zegt; nog na te kijken.
"""
import argparse
import collections
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bron  # noqa: E402


def titel(s):
    s = re.sub(r"\s+", " ", s or "").strip()
    return s if not s.isupper() else s.title()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--werven", required=True)
    ap.add_argument("--planning", required=True)
    ap.add_argument("--planplan", required=True, help="plan.json van tools/plan-analyse.py (pad ten opzichte van de planmap of absoluut)")
    ap.add_argument("--uit", default="stap3-werven.json")
    ap.add_argument("--bron", default="echt", choices=["echt", "test"])
    a = ap.parse_args()

    werven, niet = [], collections.defaultdict(list)
    for w in bron.lees_index(a.werven):
        voorstel = w.get("import_voorstel") or ""
        if not voorstel.startswith("stap 3: werf aanmaken"):
            reden = ("ouder of 2025: historiek (vraag D8, D47)" if "optioneel" in voorstel else
                     "zonder werfmap: de zaakvoerder beslist of ze nog loopt (vraag D41)" if "nieuwe werf" in voorstel else
                     # De reden staat in de index zelf ("niet aanmaken (…)"): geen namen in de code.
                     (voorstel.split("(", 1)[1].rstrip(")") if "(" in voorstel else voorstel or "geen voorstel"))
            niet[reden].append(w["werf_id"])
            continue
        straat, nr, pc, gem = (w.get(k, "").strip() for k in ("straat", "nr", "postcode", "gemeente"))
        if not straat:
            niet["geen adres in de mapnaam"].append(w["werf_id"])
            continue
        naam = f"{titel(straat)} {nr}".strip() + (f", {titel(gem)}" if gem else "")
        nakijken = ["adres uit de mapnaam"]
        if not nr:
            nakijken.append("geen huisnummer")
        if not pc:
            nakijken.append("geen postcode")
        if w.get("cluster_zelfde_straat"):
            nakijken.append("meerdere mappen in dezelfde straat: mogelijk één project (vraag D41)")
        werven.append({"key": w["werf_id"], "code": w["werf_id"], "naam": naam[:80],
                       "adres": {"street": titel(straat)[:80], "number": nr[:20], "zip": pc[:20], "city": titel(gem)[:80], "country": "BE"},
                       "vatBp": 600, "offertes": w.get("offertes", ""), "nakijken": "; ".join(nakijken) + "; btw 6 % voorlopig"})

    aangemaakt = {w["key"] for w in werven}
    blokken = {}
    for b in bron.lees_index(a.planning):
        rij = int(b["rij_in_excel"]) if (b.get("rij_in_excel") or "").isdigit() else None
        if rij is None:
            continue
        if b.get("werf_id") in aangemaakt and (b.get("werf_zekerheid") or "") == "1.0":
            blokken[str(rij)] = {"beslissing": "vervolg", "werf": b["werf_id"], "planblok": b["planblok_id"]}
        else:
            blokken[str(rij)] = {"beslissing": "standaard", "planblok": b["planblok_id"],
                                 "reden": "geen zekere werfmap" if not b.get("werf_id") or b.get("werf_zekerheid") != "1.0" else "werfmap niet aangemaakt (ouder of zonder wijziging in 2026)"}
    plan = {"bron": a.bron, "stap": 3, "gemaakt": bron.vandaag(), "werven": werven,
            "planning": {"plan": a.planplan, "batch": "inrichting-2b6-planning", "blokken": blokken},
            "nietInDeApp": {k: {"aantal": len(v), "voorbeelden": v[:8]} for k, v in niet.items()}}
    p = bron.schrijf_plan(a.uit, plan)
    tel = collections.Counter(x["beslissing"] for x in blokken.values())
    print(f"werven aan te maken {len(werven)} · niet in de app {sum(len(v) for v in niet.values())} · planningblokken: in een werfmap {tel['vervolg']}, eigen werf {tel['standaard']}")
    print(f"plan: {p}")


if __name__ == "__main__":
    main()
