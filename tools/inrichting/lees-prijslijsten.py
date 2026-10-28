#!/usr/bin/env python3 -I
"""Stap 2b.6 stap 5: prijslijsten van OA's en leveranciers → aankoopprijzen met datum in de postenbibliotheek.

  python3 -I tools/inrichting/lees-prijslijsten.py --documenten BOWACO_index_documenten.csv --bestanden MAP

MAP bevat per prijsdocument <doc_id>.<ext> (tools/inrichting/lees-alles.sh kopieert ze uit iCloud). Leest:
  - Word (.docx, en .doc via textutil van macOS): regels "omschrijving … 17 €/m²" of "omschrijving = 17€ m2"; een regel
    zonder prijs boven een groep is de kop (bv. "Scheidingswand") en komt vóór de titel;
  - NIET automatisch: pdf's van leveranciers (offerte- of factuuropmaak, geen tabel), foto's en schermafbeeldingen, de
    eigen ramingen van verzekeringen en de algemene voorwaarden van een OA. Die staan in het plan als "met de hand".
Twee bestanden met dezelfde regels zijn één prijslijst (de jongste datum telt). De firma is een hint (eerste regel of
mapnaam); de inrichting koppelt ze enkel aan een firma die al in de app staat. Geen persoonsgegevens in het plan.
"""
import argparse
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bron  # noqa: E402

VAK = {"gyproc": "13", "pleisterwerk": "14", "tegels": "17", "container": "01", "beton": "06", "afplakken": "02", "afvalzakken": "01", "schilderwerk": "18"}
EENH = r"m2|m²|m3|m³|l\s*/\s*m|lm|m|st(?:uk|uks)?|u(?:ur)?|sog|forfait|zak|rol"
REGEL = re.compile(rf"^\s*[-•·]?\s*(?P<d>.+?)\s*(?:=|:|aan de prijs van|\s{{2,}}|\s(?=\d))\s*€?\s*(?P<p>(?!0\d)\d+(?:[.,]\d+)?)\s*(?:€|eur(?:o)?)?\s*(?:/|per)?\s*(?P<u>{EENH})\b\.?(?P<r>.*)$", re.I)


def regels(pad):
    if pad.endswith(".docx"):
        return [t for _, t in bron.docx_alineas(pad)]
    if pad.endswith(".doc"):
        out = subprocess.run(["/usr/bin/textutil", "-convert", "txt", "-stdout", pad], capture_output=True, text=True, timeout=60)
        return [x for x in out.stdout.splitlines() if x.strip()]
    return None


def lees(pad):
    rij = regels(pad)
    if rij is None:
        return None, None
    kop, lijnen = "", []
    hint = rij[0].strip() if rij else ""
    # Een brief op briefpapier (firmanaam met BV/BVBA/NV bovenaan): geen koppen, want daar staan naam en adres.
    brief = bool(re.search(r"\b(BV|BVBA|NV|VOF|CommV)\b", hint))
    for t in rij:
        t = t.replace(" ", " ").strip()
        m = REGEL.match(t)
        if not m:
            # Een kop: korte regel zonder cijfers en zonder aanhef of adres (bv. "Scheidingswand", "Planfond").
            if 2 < len(t) < 45 and not re.search(r"\d|@|tel|gsm|btw|bus |straat|laan|geachte|beste|betreft|vriendelijke|t\.a\.v|^aan\b|zaakvoerder|dhr|mevr|heer|offerte", t, re.I) and not brief:
                kop = t.rstrip(" :")
            continue
        d = re.sub(r"\s+", " ", m.group("d")).strip(" -=:")
        d = re.sub(r"\s*(aan de prijs van|inclusief|incl\.?)\s*$", "", d, flags=re.I)
        rest = re.sub(r"\s+", " ", m.group("r")).strip(" .,")
        if len(d) < 3:
            continue
        titel = (f"{kop}: " if kop and bron.fold(kop) not in bron.fold(d) and kop != hint else "") + d + (f" ({rest})" if rest and len(rest) < 40 else "")
        titel = titel[:160].strip()
        eh = bron.eenheid(re.sub(r"\s", "", m.group("u"))).replace("l/m", "lm")
        # De sleutel van dezelfde post uit een offerte (dan komt de prijs bij die post) en een eigen sleutel.
        lijnen.append({"titel": titel[:160], "eenheid": eh, "cents": round(float(m.group("p").replace(",", ".")) * 100),
                       "key": bron.postsleutel(titel[:160], eh, "p"),
                       # Enkel zonder kop dezelfde post als in de offertes: "Plafond: X" en "Wand: X" zijn twee posten.
                       "offerteKey": bron.postsleutel(d, eh) if titel == d else None})
    return lijnen, hint


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--documenten", required=True)
    ap.add_argument("--bestanden", required=True)
    ap.add_argument("--uit", default="stap5-prijzen.json")
    ap.add_argument("--bron", default="echt", choices=["echt", "test"])
    a = ap.parse_args()

    lijsten, hand = [], []
    for d in bron.lees_index(a.documenten):
        act = d.get("import_actie") or ""
        if not (act.startswith("bron prijzen") or "06 Prijzen/Eigen prijzen" in d.get("pad", "")):
            continue
        delen = d["pad"].split("/")
        vak = next((VAK[bron.fold(x)] for x in delen if bron.fold(x) in VAK), None)
        naam = delen[-1]
        ext = os.path.splitext(naam)[1].lower()
        pad = os.path.join(a.bestanden, d["doc_id"] + ext)
        if "Eigen prijzen" in d["pad"]:
            hand.append({"doc": d["doc_id"], "reden": "eigen raming of lijst met één regel (verzekering, offerteprijzen): geen OA-prijs"})
            continue
        if "voorwaarden" in naam.lower():
            hand.append({"doc": d["doc_id"], "reden": "algemene voorwaarden van een OA: geen prijslijst"})
            continue
        if ext not in (".docx", ".doc"):
            hand.append({"doc": d["doc_id"], "reden": {".pdf": "pdf van een leverancier (offerte- of factuuropmaak, geen tabel): met de hand overnemen",
                                                         ".png": "schermafbeelding: met de hand overtypen", ".jpeg": "foto: met de hand overtypen",
                                                         ".jpg": "foto: met de hand overtypen"}.get(ext, "ander formaat: met de hand")})
            continue
        if not os.path.exists(pad):
            hand.append({"doc": d["doc_id"], "reden": "bestand ontbreekt in de werkmap"})
            continue
        lijnen, hint = lees(pad)
        if not lijnen:
            hand.append({"doc": d["doc_id"], "reden": "geen prijsregels herkend"})
            continue
        if not re.fullmatch(r"\d{4}-\d\d-\d\d", (d.get("datum") or "")[:10]):
            hand.append({"doc": d["doc_id"], "reden": "geen datum: de prijs heeft een datum nodig"})
            continue
        # Twee regels met dezelfde post in één lijst: de eerste telt, de rest staat in het plan als dubbel.
        gezien, uniek_l = set(), []
        for x in lijnen:
            if x["key"] in gezien:
                hand.append({"doc": d["doc_id"], "reden": f"dubbele regel in de lijst: {x['titel'][:60]}"})
                continue
            gezien.add(x["key"])
            uniek_l.append(x)
        lijnen = uniek_l
        if vak is None or ("gyproc" in bron.fold(naam) and vak != "13"):
            vak = "13" if "gyproc" in bron.fold(naam + hint) else vak or "99"
        firma = re.sub(r"(?i)^prijslijst\s+(gyproc|pleisterwerk|tegels)?\s*", "", hint).strip() if hint.lower().startswith("prijslijst") else hint
        lijsten.append({"doc": d["doc_id"], "datum": d.get("datum") or "", "hoofdstuk": vak, "firmaHint": firma[:60], "lijnen": lijnen})

    # Dezelfde regels in twee bestanden = één prijslijst (de jongste blijft).
    uniek, dubbel = {}, []
    for l in sorted(lijsten, key=lambda x: x["datum"]):
        sleutel = tuple((x["titel"], x["eenheid"], x["cents"]) for x in l["lijnen"])
        if sleutel in uniek:
            dubbel.append({"doc": uniek[sleutel]["doc"], "zelfde als": l["doc"]})
        uniek[sleutel] = l
    plan = {"bron": a.bron, "stap": 5, "gemaakt": bron.vandaag(), "lijsten": sorted(uniek.values(), key=lambda x: x["doc"]), "dubbels": dubbel, "metDeHand": hand}
    p = bron.schrijf_plan(a.uit, plan)
    print(f"prijslijsten gelezen {len(plan['lijsten'])} ({sum(len(x['lijnen']) for x in plan['lijsten'])} prijzen) · dubbel {len(dubbel)} · met de hand {len(hand)}")
    print(f"plan: {p}")


if __name__ == "__main__":
    main()
