#!/usr/bin/env python3 -I
"""Stap 2b.6 stap 1: bedrijf en tellers. Leest de bedrijfsgegevens uit het offertesjabloon, de algemene voorwaarden en de
offerte-index, en schrijft het plan stap1-bedrijf.json (buiten git).

  python3 -I tools/inrichting/lees-bedrijf.py --sjabloon basisofferte.xlsx --voorwaarden voorwaarden.docx
         --offertes BOWACO_index_offertes.csv --verkoop BOWACO_index_verkoop.csv --posten stap4-posten.json

Wat in het plan komt (BOWACO_analyse_documenten.md §4, stap 1):
  - de afzender van de offerte (naam, adres, ondernemingsnummer, contact, rekening van het bedrijf) uit de voettekst en
    de kop van het sjabloon; nooit een persoonsnaam;
  - de betaaltermijn van de klantfacturen (de meest gebruikte in de verkoopindex; vraag D4);
  - de algemene voorwaarden als versie, gemarkeerd "nog na te kijken" (jurist, vraag D49);
  - het laatste offertenummer (de nummering loopt door over de jaren; vraag D1);
  - de eenheden die de offertes gebruiken en de app nog niet kent (vraag D10), de hoofdstuklijst (D6), de standaardmarge (D5).
"""
import argparse
import collections
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bron  # noqa: E402

# Namen voor de eenheden die de app nog niet kent (0.3 §2.1, N2). De bestaande 12 staan in Config.defaultUnits.
EENHEID_NAMEN = {"m": "meter", "cm/m2": "cm dikte per m²", "zak": "zak", "doos": "doos", "deur": "deur", "week": "week", "dag": "dag",
                 "werkdag": "werkdag", "pct": "procent (%)", "ton": "ton", "l": "liter", "m2/laag": "m² per laag", "wa": "werkelijk aantal (per verplaatsing)",
                 "dm2": "dm²", "rol": "rol", "pak": "pak"}
BESTAAND = {"sog", "st", "m2", "lm", "m3", "kg", "u", "set", "post", "maand", "punt", "dlm"}


def afzender(pad):
    """De afzender uit kop en voettekst van het offertesjabloon (tekst, geen getallen uit formules)."""
    rijen = bron.xlsx_bladen(pad)[0][2]
    cel = lambda r, c: (rijen.get(r, {}).get(c, (None, None))[0] or "").strip()
    alles = [cel(r, c) for r in sorted(rijen) for c in sorted(rijen[r]) if cel(r, c)]
    naam = next((t for t in alles if re.search(r"\b(BV|NV|BVBA|VOF|CV)\b", t)), "")
    kbo = next((re.search(r"BE\s?0?\d{3}[. ]?\d{3}[. ]?\d{3}", t).group(0) for t in alles if re.search(r"BE\s?0?\d{3}[. ]?\d{3}[. ]?\d{3}", t)), "")
    iban = next((t for t in alles if re.search(r"\bBE\d{2}\s?\d{4}", t)), "")
    tel = next((t for t in alles if re.search(r"^T\s*\+?\d", t)), "")
    web = next((t.strip() for t in alles if re.search(r"www\.", t, re.I)), "")
    mail = next((t.lower() for t in alles if re.fullmatch(r"(info|contact)@[\w.-]+", t.strip(), re.I)), "")
    # Adres: de rij onder de bedrijfsnaam (straat) en de rij daaronder (postcode + gemeente).
    straat = gemeente = ""
    for r in sorted(rijen):
        if cel(r, 1) == naam:
            straat, gemeente = cel(r + 1, 1), cel(r + 2, 1)
            break
    gemeente = re.sub(r"^(\d{4})\s+(.+)$", lambda m: m.group(1) + " " + m.group(2).title(), gemeente)
    regels = [naam, straat, gemeente, f"Ondernemingsnummer en btw: {kbo}" if kbo else "", " · ".join(x for x in (tel, mail, web.lower()) if x),
              re.sub(r"^\w+\s+(BE)", r"Rekening \1", iban) if iban else ""]
    return "\n".join(r for r in regels if r), {"naam": bool(naam), "adres": bool(straat and gemeente), "ondernemingsnummer": bool(kbo), "rekening": bool(iban), "telefoon": bool(tel), "e-mail": bool(mail)}


def voorwaarden(pad):
    tekst = []
    for stijl, t in bron.docx_alineas(pad):
        if stijl.lower().startswith(("kop", "heading", "titel", "title")):
            tekst.append("\n" + t.rstrip(" :"))
        elif stijl.lower().startswith(("lijst", "list")):
            tekst.append("- " + t)
        else:
            tekst.append(t)
    return "\n".join(tekst).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sjabloon", required=True)
    ap.add_argument("--voorwaarden", required=True)
    ap.add_argument("--offertes", required=True)
    ap.add_argument("--verkoop")
    ap.add_argument("--posten", help="plan van de offerte-lezer (voor de eenheden)")
    ap.add_argument("--uit", default="stap1-bedrijf.json")
    ap.add_argument("--bron", default="echt", choices=["echt", "test"])
    a = ap.parse_args()

    issuer, gevonden = afzender(a.sjabloon)
    av = voorwaarden(a.voorwaarden)
    offertes = bron.lees_index(a.offertes)
    nummers = [(int(o["jaar_in_nummer"] or 0), int(o["volgnummer"])) for o in offertes if (o.get("volgnummer") or "").isdigit()]
    # Het jaar van nu (een tikfout als "2028-228" telt niet); het volgnummer loopt door over de jaren (vraag D1).
    jaar = int(bron.vandaag()[:4])
    laatste = max(n for _, n in nummers) if nummers else 0
    termijn, termijnen = 15, collections.Counter()
    if a.verkoop:
        for v in bron.lees_index(a.verkoop):
            m = re.search(r"(\d+)\s*dagen", v.get("betalingstermijn") or "")
            if m:
                termijnen[int(m.group(1))] += 1
        if termijnen:
            termijn = termijnen.most_common(1)[0][0]
    eenheden = collections.Counter()
    if a.posten and os.path.exists(a.posten):
        for p in json.load(open(a.posten, encoding="utf-8"))["posten"]:
            if p["eenheid"] not in BESTAAND:
                eenheden[p["eenheid"]] += 1
    for k in ("wa", "cm/m2", "zak", "doos", "deur", "week", "dag", "werkdag", "pct", "ton", "l", "m", "m2/laag"):
        eenheden.setdefault(k, 0)
    plan = {
        "bron": a.bron, "stap": 1, "gemaakt": bron.vandaag(),
        "afzender": issuer, "afzenderGevonden": gevonden,
        "betaaltermijn": termijn, "betaaltermijnen": {str(k): v for k, v in termijnen.most_common()},
        "voorwaarden": {"titel": "Algemene voorwaarden BOWACO", "tekst": av[:30000], "nakijken": True,
                        "notitie": "Nog na te kijken (vraag D49): tekst uit de documenten van BOWACO; de jurist kijkt ze na (AK1–AK6). Tegenstrijdige termijnen: D3, D4."},
        "offertenummer": {"jaar": jaar, "laatste": laatste},
        "eenheden": [{"key": k, "naam": EENHEID_NAMEN.get(k, k), "gebruik": n} for k, n in sorted(eenheden.items(), key=lambda x: -x[1])],
        "hoofdstukken": [{"code": c, "titel": t, "volgorde": int(c) * 10} for c, t, _ in bron.HOOFDSTUKKEN],
        "margeBp": 2000,
    }
    p = bron.schrijf_plan(a.uit, plan)
    print(f"afzender: {', '.join(k for k, v in gevonden.items() if v)} gevonden · voorwaarden {len(av)} tekens · laatste offertenummer {jaar}/{laatste} · "
          f"betaaltermijn {termijn} dagen · nieuwe eenheden {len(plan['eenheden'])}")
    print(f"plan: {p}")


if __name__ == "__main__":
    main()
