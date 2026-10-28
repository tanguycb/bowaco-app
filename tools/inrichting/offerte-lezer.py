#!/usr/bin/env python3 -I
"""Stap 2b.6 stap 4 (de vroegere stap 2.3): de offerte-lezer. Leest de oude Excelofferten van BOWACO en maakt het plan
voor de postenbibliotheek (posten, hoofdstukken, aankoopprijzen met datum, marge per post).

Gebruik (python3 -I: de offertes zijn gegevens, nooit code; enkel standaardbibliotheek):
  python3 -I tools/inrichting/offerte-lezer.py --index BOWACO_index_offertes.csv --bestanden MAP [--uit stap4-posten.json]

MAP bevat per offerte <offerte_id>.xlsx (de laatste versie per nummer; tools/inrichting/lees-alles.sh kopieert ze uit
iCloud). Het plan komt in ~/.bowaco/inrichting/plan (NIET in git: echte prijzen en marges).

Leesregels (BOWACO_analyse_documenten.md §2.1), voor de vier sjabloonfamilies met één lezer:
  - De KOLOMKOPPEN zijn de bron: de rij met "Aantal" is de kop; "Beschrijving", "Eenheid", "Stukprijs", "Totaal" en
    "Subtotaal" geven de kolommen. Een kolom "VH" vóór Aantal = de vermoedelijke-hoeveelheidsvlag.
  - Hoofdstuk = de BUITENSTE =SUM-groep in de subtotaalkolom; een binnenste groep (Gelijkvloers, Keuken …) is een
    subgroep. Zonder hoofdstukken (VH-lijst) volgt het hoofdstuk uit de posttitel.
  - Stukprijs "=X/0,8" → aankoopprijs X en 20 % marge (de standaard); "/0,9" → 10 %, "/0,85" → 15 % enz. Een vast getal
    = een vaste verkoopprijs zonder aankoopprijs.
  - De datum in de offerte is =TODAY() en dus nergens vastgelegd: de datum komt uit de index (bestandsnaam of
    bestandsdatum, kolom datum_laatste).
  - Importklasse 1 (rijk) en 2 (VH-lijst) maken posten; klasse 3 (plat) geeft enkel aankoopprijzen aan een post die er al
    is (prijsgeheugen, vraag D7); klasse 4 (andere activiteit) en 5 (geen tabel) worden niet gelezen.
  - Sleutel van een post = hash van de gevouwen titel + eenheid: dezelfde post in tien offertes is één post (ontdubbelen),
    en een tweede run vindt hem terug (idempotent).
"""
import argparse
import collections
import os
import re
import statistics
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bron  # noqa: E402

# Niet in de bibliotheek: kortingen, totalen, en afrekenregels met een datum vooraan ("16/01/2025 Gepresteerde uren …").
SKIP = re.compile(r"buiten de offerte|niet besproken|^\s*korting|totaalprijs .*korting|^\s*subtot|^\s*totaal\b|^\s*\d{1,2}/\d{1,2}/\d{2,4}\b", re.I)


def lees(pad):
    """Eén offerte: kop, hoofdstukken (buitenste SUM-groepen), lijnen. Gooit niets weg: elke afwijking is een bevinding."""
    blad = bron.xlsx_bladen(pad)[0][2]
    kop = None
    for r in sorted(blad):
        for c, (v, _) in blad[r].items():
            if (v or "").strip().lower() == "aantal":
                kop = (r, c)
                break
        if kop:
            break
    if not kop:
        return None
    hr, qc = kop
    cols = {}
    for c, (v, _) in blad[hr].items():
        k = (v or "").strip().lower()
        if k in ("beschrijving", "omschrijving", "aantal", "eenheid", "stukprijs", "eenheidsprijs", "totaal", "subtotaal", "vh"):
            cols[{"omschrijving": "beschrijving", "eenheidsprijs": "stukprijs"}.get(k, k)] = c
    dc = cols.get("beschrijving", 1)
    uc = cols.get("eenheid", qc + 1)
    pc = cols.get("stukprijs", qc + 2)
    tc = cols.get("totaal", qc + 3)
    sc = cols.get("subtotaal", tc + 1)
    vhc = cols.get("vh", 2 if qc == 3 else None)
    onvolledig = 0
    groepen, lijnen = [], []
    for r in sorted(blad):
        if r <= hr:
            continue
        d = blad[r]
        andere = [(v or "").strip().lower() for c, (v, _) in d.items() if c != dc]
        if any(t.startswith("subtot") for t in andere) or (any(t == "btw" for t in andere) and not d.get(dc)):
            break
        tekst = (d.get(dc, (None, None))[0] or "").strip()
        qty = bron.getal(d.get(qc, (None, None))[0])
        unit = (d.get(uc, (None, None))[0] or "").strip()
        prijs, formule = d.get(pc, (None, None))
        prijs = bron.getal(prijs)
        som = d.get(sc, (None, None))[1] or ""
        vh = bool(vhc and (d.get(vhc, (None, None))[0] or "").strip().upper() == "VH")
        if tekst and som.upper().startswith("SUM(") and qty is None and prijs is None:
            m = re.match(r"SUM\(\$?[A-Z]+\$?(\d+):\$?[A-Z]+\$?(\d+)\)", som.upper().replace(" ", ""))
            if m:
                groepen.append({"rij": r, "titel": tekst[:120], "a": int(m.group(1)), "b": int(m.group(2))})
            continue
        if tekst and (prijs is not None or qty is not None) and not (unit and prijs is not None and qty is not None):
            onvolledig += 1  # een prijsregel zonder eenheid, aantal of bewaarde waarde: geteld, niet stil weg
        if tekst and unit and prijs is not None and qty is not None:
            lijnen.append({"rij": r, "tekst": tekst, "vh": vh, "qty": qty, "eenheid": unit, "prijs": prijs, "formule": (formule or "").replace(" ", "")})
    buitenste = [g for g in groepen if not any(h is not g and h["a"] <= g["a"] and g["b"] <= h["b"] and (h["b"] - h["a"]) > (g["b"] - g["a"]) for h in groepen)]
    for l in lijnen:
        l["hoofdstuk"] = next((g["titel"] for g in buitenste if g["a"] <= l["rij"] <= g["b"]), None)
        l["subgroep"] = next((g["titel"] for g in groepen if g not in buitenste and g["a"] <= l["rij"] <= g["b"]), None)
    return {"lijnen": lijnen, "hoofdstukken": [g["titel"] for g in buitenste], "onvolledig": onvolledig}


def prijsvorm(l):
    """(aankoopprijs in cent of None, marge in basispunten of None, uitleg)."""
    f = l["formule"].replace(",", ".")
    m = re.fullmatch(r"=?\(?(\d+(?:\.\d+)?)\)?/(0\.\d+)", f)
    if m:
        deler = float(m.group(2))
        return round(float(m.group(1)) * 100), round((1 - deler) * 10000), f"X/{m.group(2)}"
    if not f or re.fullmatch(r"=?\d+(?:\.\d+)?", f):
        return None, None, "vaste prijs"
    return None, None, "andere formule"


def contractvorm(l, hoofdstuktitel):
    t = bron.fold(l["tekst"]) + " " + bron.fold(hoofdstuktitel or "")
    if "regie" in bron.fold(l["tekst"]) or (l["eenheid"].lower() in ("u", "uur") and "regie" in t):
        return "regie"
    if "raming" in bron.fold(hoofdstuktitel or ""):
        return "estimate"
    if l["vh"]:
        return "vh"
    return "fixed"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--index", required=True)
    ap.add_argument("--bestanden", required=True)
    ap.add_argument("--uit", default="stap4-posten.json")
    ap.add_argument("--bron", default="echt", choices=["echt", "test"])
    a = ap.parse_args()

    offertes = bron.lees_index(a.index)
    posten = collections.OrderedDict()
    prijsgeheugen, bevindingen, gelezen = [], [], []
    klas = lambda o: (o.get("importklasse") or "")[:1]
    # Klasse 1 en 2 eerst (zij maken de posten), daarna 3 (enkel prijzen bij bestaande posten); oud → nieuw.
    volgorde = sorted([o for o in offertes if klas(o) in "123" and klas(o)], key=lambda o: (klas(o) == "3", o.get("datum_laatste") or "", o["offerte_id"]))
    for o in volgorde:
        pad = os.path.join(a.bestanden, o["offerte_id"] + ".xlsx")
        if not os.path.exists(pad):
            bevindingen.append(f"{o['offerte_id']}: bestand ontbreekt in de werkmap")
            continue
        try:
            res = lees(pad)
        except Exception as e:  # een kapot bestand stopt de rest niet
            bevindingen.append(f"{o['offerte_id']}: niet leesbaar ({type(e).__name__})")
            continue
        if not res or not res["lijnen"]:
            bevindingen.append(f"{o['offerte_id']}: geen prijslijnen gevonden")
            continue
        # De verwijzing komt uit de bestandsnaam (offerte_id), want die is uniek: twee varianten van één offerte
        # ("verzekering", "klantenversie") en zelfs twee offertes (een nummer in de cel dat niet klopt) delen soms het
        # nummer in de cel. Anders valt de aankoopprijs van de tweede weg (zelfde verwijzing).
        m = re.match(r"Q-(\d{4})-(\d{3}[a-d]?)(?:-(.+))?$", o["offerte_id"])
        nummer = f"{m.group(1)}/{m.group(2)}" if m else o["offerte_id"]
        if res.get("onvolledig"):
            bevindingen.append(f"{o['offerte_id']}: {res['onvolledig']} regel(s) zonder eenheid, aantal of prijs overgeslagen")
        cel = (o.get("nummer_in_cel") or "").strip()
        if m and m.group(3):
            nummer += f" ({m.group(3)})"
        if cel and cel != nummer.split(" ")[0]:
            nummer += f" (in de offerte: {cel})"
        dag = (o.get("datum_laatste") or "")[:10]
        if not re.fullmatch(r"\d{4}-\d\d-\d\d", dag):
            dag = f"{o['offerte_id'][2:6]}-07-01"
            bevindingen.append(f"{o['offerte_id']}: geen datum in de index, 1 juli van het jaar genomen")
        n = {"lijnen": 0, "nieuw": 0, "bestaand": 0, "prijs": 0, "overgeslagen": 0}
        gezien = set()
        for l in res["lijnen"]:
            eerste = re.sub(r"^postomschrijving:\s*", "", l["tekst"].split("\n")[0].strip(), flags=re.I)
            # De nummering van één offerte ("1.4.a. ", "2.65 ", "5. ") hoort niet bij de post: weg uit titel en sleutel.
            nr = re.match(r"^(\d+(?:\.\d+)*\.?[a-z]?\.?(?:\s*&\s*(?:\d+(?:\.\d+)*\.?)?[a-z]\.?)*)\s*(?=[^\W\d_])", eerste)
            if nr and "." in nr.group(1):
                eerste = eerste[nr.end():]
            if SKIP.search(l["tekst"]) or l["qty"] < 0 or l["prijs"] < 0 or not eerste:
                n["overgeslagen"] += 1
                continue
            n["lijnen"] += 1
            eh = bron.eenheid(l["eenheid"])
            key = bron.postsleutel(eerste, eh)
            kost, marge, uitleg = prijsvorm(l)
            if klas(o) == "3":
                if key in posten and kost is not None and key not in gezien:
                    prijsgeheugen.append({"post": key, "offerte": nummer, "dag": dag, "cents": kost, "margeBp": marge})
                    n["prijs"] += 1
                gezien.add(key)
                continue
            hs = bron.hoofdstuk(l["hoofdstuk"]) if l["hoofdstuk"] else bron.hoofdstuk(eerste)
            p = posten.get(key)
            if p is None:
                p = posten[key] = {"key": key, "titel": eerste[:160].strip(), "tekst": l["tekst"][:4000], "eenheid": eh, "eenheden": collections.Counter(),
                                   "hoofdstukken": collections.Counter(), "vormen": collections.Counter(), "marges": collections.Counter(), "kosten": [],
                                   "verkoop": [], "offertes": [], "ruweHoofdstukken": collections.Counter()}
                n["nieuw"] += 1
            else:
                n["bestaand"] += 1
                if len(l["tekst"]) > len(p["tekst"]) and len(l["tekst"]) <= 4000:
                    p["tekst"] = l["tekst"]  # de uitgebreidste lastenboektekst
            p["eenheden"][l["eenheid"]] += 1
            p["hoofdstukken"][hs] += 1
            if l["hoofdstuk"]:
                p["ruweHoofdstukken"][l["hoofdstuk"][:60]] += 1
            p["vormen"][contractvorm(l, l["hoofdstuk"])] += 1
            p["marges"][marge if marge is not None else uitleg] += 1
            p["verkoop"].append(round(l["prijs"] * 100))
            if nummer not in p["offertes"]:
                p["offertes"].append(nummer)
            if kost is not None and key not in gezien:
                p["kosten"].append({"offerte": nummer, "dag": dag, "cents": kost, "margeBp": marge})
                n["prijs"] += 1
            gezien.add(key)
        gelezen.append({"offerte": nummer, "id": o["offerte_id"], "klasse": klas(o), "dag": dag, **n})

    uit_posten = []
    for p in posten.values():
        marges = [m for m, _ in p["marges"].most_common() if isinstance(m, int)]
        marge = marges[0] if marges else None
        # Vaste verkoopprijs enkel als de offertes een getypt getal hadden; een andere formule (=D12/0,8, =ROUND(…))
        # is geen vaste prijs: dan geen verkoopregel (de standaard) en een bevinding.
        vast = not marges and p["marges"].get("vaste prijs", 0) > 0
        if not marges and not vast:
            bevindingen.append(f"post {p['key']}: enkel een andere prijsformule; geen aankoopprijs en geen vaste prijs genomen")
        uit_posten.append({
            "key": p["key"], "titel": p["titel"], "tekst": p["tekst"], "eenheid": p["eenheid"],
            "eenheidRuw": "|".join(f"{u}:{c}" for u, c in p["eenheden"].most_common(3)),
            "hoofdstuk": p["hoofdstukken"].most_common(1)[0][0],
            "vorm": p["vormen"].most_common(1)[0][0],
            "margeBp": None if (vast or marge == 2000) else marge,
            "margeKlassen": {str(k): v for k, v in p["marges"].items()},
            "verkoopCents": round(statistics.median(p["verkoop"])) if vast else None,
            "kosten": p["kosten"], "offertes": p["offertes"],
            "ruweHoofdstukken": [h for h, _ in p["ruweHoofdstukken"].most_common(3)],
        })
    plan = {
        "bron": a.bron, "stap": 4, "gemaakt": bron.vandaag(),
        "hoofdstukken": [{"code": c, "titel": t, "volgorde": int(c) * 10} for c, t, _ in bron.HOOFDSTUKKEN],
        "posten": uit_posten, "prijsgeheugen": prijsgeheugen, "offertes": gelezen, "bevindingen": bevindingen,
    }
    p = bron.schrijf_plan(a.uit, plan)
    tel = collections.Counter(x["klasse"] for x in gelezen)
    print(f"offertes gelezen {len(gelezen)} (klasse 1: {tel['1']}, 2: {tel['2']}, 3: {tel['3']}) · posten {len(uit_posten)} · "
          f"aankoopprijzen {sum(len(x['kosten']) for x in uit_posten)} · prijsgeheugen {len(prijsgeheugen)} · bevindingen {len(bevindingen)}")
    print(f"plan: {p}")


if __name__ == "__main__":
    main()
