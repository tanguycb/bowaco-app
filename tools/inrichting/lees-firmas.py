#!/usr/bin/env python3 -I
"""Stap 2b.6 stap 2: de firma-leesmodule. Maakt uit de beslissingen van 1.2 (validatie-CSV) en de firma-index van 0.3
(aankoopfacturen, KBO uit de pdf, voorstellen planningscode → firma) het plan stap2-firmas.json voor importOrgs.

  python3 -I tools/inrichting/lees-firmas.py --validatie BOWACO_validatie_onderaannemers_1.2.csv --firmas BOWACO_index_firmas.csv

Regels (BOWACO_analyse_documenten.md §2.5 en §4 stap 2; voorlopige keuzes = de aanbeveling van de analyse):
  - eerst de firma's die in 1.2 beslist zijn (BESLISSING firma/leverancier/nutsbedrijf): naam, KBO, codes, vakgebied;
  - dan de firma's uit de aankoopfacturen met een soort: OA → onderaannemer, leverancier → leverancier,
    nutsbedrijf/overheid → overheid en nutsbedrijf, verzekering → andere. De app matcht op KBO en op naam/code, dus een
    firma die al bestaat wordt aangevuld (nooit overschreven) en een tweede run maakt niets dubbel;
  - een ZEKER voorstel planningscode → firma (0.3) wordt een code van die firma (vraag D27, nog na te kijken); een
    WAARSCHIJNLIJK voorstel komt enkel in de notitie;
  - NIET in de app: diensten en bedrijfskosten (vraag D25), firma's zonder soort of zonder naam (D28), personen
    (privacy), wat in 1.2 "negeren" kreeg, en planningscodes zonder firma (die kent enkel de zaakvoerder: D27).
  - Geen persoonsgegevens: geen gsm, e-mail of naam van personen; enkel de firma.
"""
import argparse
import collections
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bron  # noqa: E402

SOORT = {"OA": "subcontractor", "firma": "subcontractor", "leverancier": "supplier", "nutsbedrijf": "authority", "overheid": "authority", "verzekering": "other"}
BESLIST = {"firma": "subcontractor", "leverancier": "supplier", "nutsbedrijf": "authority"}
SLECHT = re.compile(r"^(re|fw|fwd|tr)\s*:|^\s*$|^\W+$", re.I)


def firmanaam(naam):
    """Een naam die nog de bestandsnaam van een factuur is ("20260303 FIRMA - 5600114721.PDF") → de firmanaam."""
    if re.search(r"\.pdf$", naam, re.I) or re.match(r"^\d{8}\s", naam):
        naam = re.sub(r"\.pdf$", "", re.sub(r"^\d{8}\s+", "", naam), flags=re.I)
        naam = naam.split(" - ")[0].strip()
    return naam


def codes(tekst):
    return [c.strip().upper() for c in re.split(r"[|,;]", tekst or "") if c.strip() and len(c.strip()) <= 20]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--validatie", required=True)
    ap.add_argument("--firmas", required=True)
    ap.add_argument("--uit", default="stap2-firmas.json")
    ap.add_argument("--bron", default="echt", choices=["echt", "test"])
    ap.add_argument("--min-facturen", type=int, default=2, help="zonder KBO: pas vanaf zoveel facturen (anders te onzeker)")
    a = ap.parse_args()

    rijen, niet = [], collections.defaultdict(list)
    for r in bron.lees_index(a.validatie):
        code = (r.get("code") or "").strip().upper()
        b = (r.get("BESLISSING") or "").strip().lower()
        if not b:
            niet["planningscode zonder beslissing (vraag D27)"].append(code)
            continue
        if b not in BESLIST:
            niet[f"1.2: {b}"].append(code)
            continue
        naam = (r.get("FIRMANAAM") or "").strip() or code.title()
        rijen.append({"key": f"1.2:{code}", "kind": BESLIST[b], "name": naam[:80], "kbo": re.sub(r"\D", "", r.get("KBO") or "") or None,
                      "aliases": [code] + codes(r.get("ook_geschreven_als")), "trades": [t.strip() for t in re.split(r"[,;]", r.get("VAKGEBIED") or "") if t.strip()],
                      "notes": "Uit de OA-lijst van de planning (1.2); codes en vakgebied nog na te kijken (vraag D27, D28)."})

    for r in sorted(bron.lees_index(a.firmas), key=lambda x: -int(x.get("aantal_facturen") or 0)):
        if r.get("bron", "").startswith("OA-lijst"):
            continue  # staat al hierboven (beslist) of is een planningscode zonder firma
        soort = (r.get("soort") or "").strip()
        naam = firmanaam((r.get("naam") or "").strip())
        n = int(r.get("aantal_facturen") or 0)
        kbo = re.sub(r"\D", "", r.get("kbo") or "") or None
        if soort not in SOORT:
            niet[{"diensten": "diensten en bedrijfskosten (vraag D25)", "persoon": "persoon (privacy)", "negeren": "negeren (0.3)"}.get(soort, "soort onbekend (vraag D28)")].append(naam or r["firma_id"])
            continue
        if SLECHT.search(naam):
            niet["geen bruikbare firmanaam"].append(r["firma_id"])
            continue
        if not kbo and n < a.min_facturen:
            niet[f"zonder KBO en minder dan {a.min_facturen} facturen"].append(naam)
            continue
        zeker = (r.get("zekerheid_voorstel") or "") == "zeker"
        voorstel = codes(r.get("planningscode_voorstel_0_3"))
        notitie = [f"Nog na te kijken (vraag D28): soort «{soort}» afgeleid uit {n} aankoopfactu{'ur' if n == 1 else 'ren'}" + (f" ({r['jaren']})" if r.get("jaren") else "") + "."]
        try:
            verlegd = float(r.get("btw_verlegd_aandeel") or 0)
            if soort == "OA" and n:
                notitie.append(f"Btw verlegd op {round(verlegd * 100)} % van de facturen (vraag D30).")
        except ValueError:
            pass
        if voorstel and zeker:
            notitie.append(f"Planningscode {', '.join(voorstel)} gekoppeld (zeker volgens de documenten; vraag D27).")
        elif voorstel:
            notitie.append(f"Mogelijk planningscode {', '.join(voorstel)} (waarschijnlijk; niet gekoppeld, vraag D27).")
        if not kbo:
            notitie.append("Zonder ondernemingsnummer in de facturen.")
        rijen.append({"key": r["firma_id"], "kind": SOORT[soort], "name": naam[:80], "kbo": kbo, "aliases": voorstel if zeker else [], "trades": [],
                      "notes": " ".join(notitie)[:1000]})

    plan = {"bron": a.bron, "stap": 2, "gemaakt": bron.vandaag(), "rijen": rijen,
            "nietInDeApp": {k: {"aantal": len(v), "voorbeelden": v[:8]} for k, v in niet.items()}}
    p = bron.schrijf_plan(a.uit, plan)
    tel = collections.Counter(x["kind"] for x in rijen)
    print(f"firma's naar de app: {len(rijen)} ({', '.join(f'{k} {v}' for k, v in tel.items())}) · niet in de app: {sum(len(v) for v in niet.values())}")
    print(f"plan: {p}")


if __name__ == "__main__":
    main()
