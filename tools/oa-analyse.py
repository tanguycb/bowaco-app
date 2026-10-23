#!/usr/bin/env python3 -I
"""Stap 1.2: namen en codes uit de planning halen en een validatierapport voor Alexis maken.

Gebruik (python3 -I: de planning is gegevens, nooit code; alleen standaardbibliotheek):
  python3 -I tools/oa-analyse.py PLANNING.xlsx --uit MAP [--varianten varianten.json]

Schrijft in MAP (NIET in git: bevat echte firma- en persoonsnamen):
  analyse.json                          alle namen met tellingen en voorstellen
  <naam>.md    leesbaar rapport
  <naam>.csv   werkblad voor Alexis (punt-komma, UTF-8 met BOM, opent in Excel)

--varianten: JSON met de handmatige kennis (ook echte namen, dus buiten git):
  { "varianten": {"CODE2": "CODE1"}, "leveranciers": ["LEVERANCIER"], "nutsbedrijven": ["NUTSBEDRIJF"], "personen": ["VOORNAAM"] }
Zonder dat bestand worden alleen hoofdletters, spaties en dagnamen samengevoegd.

De 13 firma's van blad 2 (met KBO-nummer) zijn zeker; al de rest is een voorstel. Het script verandert niets:
het leest alleen.
"""
import argparse
import csv
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter, OrderedDict, defaultdict
from datetime import date, timedelta
from pathlib import Path

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
SYSTEEM = {"BOWACO", "ALEXIS", "ALEX", "KLANT", "VERGUNNING", "IEDEREEN", "NIET", "?", "STOP", "BOUWVERLOF", "CONGE", "CONGÉ"}
DAGEN = {"MAANDAG", "DINSDAG", "WOENSDAG", "DONDERDAG", "VRIJDAG", "ZATERDAG", "ZONDAG"}
# Woorden die een taak of opmerking verraden in plaats van een naam: voorgesteld als "negeren".
TAAKWOORDEN = {"OPMETEN", "PLAATSEN", "PLOOIEN", "OPLEVERING", "DEFINITIEVE", "DEFINITIVE", "SANITAIR", "ELEKTRICITEIT", "BINNENSCHRIJNWERK", "KEUKEN", "OF"}

# Trefwoorden → vakgebied (sleutels van Config.defaultTrades). Een voorstel, geen waarheid.
VAKGEBIED = [
    (r"afbraak|sloop|afbreek|kappen|slijpen", "afbraak"),
    (r"elektr", "elektriciteit"),
    (r"sanitair|chauffage|verwarming|warmtepomp|boiler|radiator", "sanitair-chauffage"),
    (r"ventilatie", "ventilatie"),
    (r"pleister|binnenplaat|gyproc|stuc|plafond", "pleister"),
    (r"vloerisolatie|isolatie", "vloerisolatie"),
    (r"chape|dekvloer", "chape"),
    (r"parket|laminaat|osb", "parket"),
    (r"tegel|faien|faïen|zandsteen|vloeren", "tegels"),
    (r"keuken|kasten|binnendeur|plinten|dagkanten|trap|schrijnwerk|timmer", "binnenschrijnwerk"),
    (r"schilder|verf", "schilder"),
    (r"dakwerk|dakbedekking|zink|leien|dakraam|\bdak\b", "dak"),
    (r"ruwbouw|metsel|steenwerk", "ruwbouw"),
    (r"injecter|injectie|vocht", "injecteren"),
    (r"raam|ramen|buitenschrijnwerk|gevelbekleding", "buitenschrijnwerk"),
    (r"tuin|bestrating|verharding|oprit", "tuin"),
    (r"riolering|afvoer", "riolering"),
    (r"crepi", "pleister"),
    (r"epb|veiligheid|studie|stabiliteit", "studies"),
]


def col2n(c):
    n = 0
    for ch in c:
        n = n * 26 + ord(ch) - 64
    return n


def load_sheet(path, sheet):
    z = zipfile.ZipFile(path)
    ss = []
    for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
        ss.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
    rows = {}
    root = ET.fromstring(z.read("xl/worksheets/%s.xml" % sheet))
    for c in root.iter("{%s}c" % NS["m"]):
        m = re.match(r"([A-Z]+)(\d+)", c.get("r"))
        v = c.find("m:v", NS)
        t = c.get("t")
        if t == "inlineStr":
            val = "".join(x.text or "" for x in c.iter("{%s}t" % NS["m"]))
        elif v is None:
            continue
        elif t == "s":
            val = ss[int(v.text)]
        else:
            val = v.text
        rows.setdefault(int(m.group(2)), {})[col2n(m.group(1))] = val
    return rows


def is_num(v):
    try:
        float(v)
        return True
    except (TypeError, ValueError):
        return False


def norm(t):
    """Hoofdletters, enkelvoudige spaties, dagnamen achteraan weg."""
    t = re.sub(r"\s+", " ", (t or "").strip(" `´'\"")).upper()
    parts = t.split(" ")
    while len(parts) > 1 and parts[-1] in DAGEN:
        parts.pop()
    return " ".join(parts)


def fold(t):
    return re.sub(r"[^a-z0-9]", "", (t or "").lower())


def split_names(t):
    """'WESLEY + TOM' → twee namen."""
    return [norm(p) for p in re.split(r"\s*(?:\+|,|\sEN\s|\sen\s)\s*", t or "") if norm(p)]


def looks_like_name(t):
    t = (t or "").strip()
    if not t or len(t) > 30 or re.search(r"\d", t):
        return False
    return bool(re.fullmatch(r"[A-Za-zÀ-ÿ&.\-' ?+]{1,30}", t))


def vakgebieden(tekst, maximum=2):
    c = Counter()
    for t in tekst:
        low = t.lower()
        for rx, key in VAKGEBIED:
            if re.search(rx, low):
                c[key] += 1
                break
    return [k for k, _ in c.most_common(maximum)]


def parse_planning(path):
    rows = load_sheet(path, "sheet1")
    blocks = []
    cur = None
    for r in sorted(rows):
        row = rows[r]
        a = (row.get(1) or "").strip()
        c = (row.get(3) or "").strip()
        nums = [k for k, v in row.items() if k >= 4 and is_num(v)]
        if a and not c and len(nums) >= 5:
            cur = {"werf": a, "rij": r, "taken": []}
            blocks.append(cur)
            continue
        if cur is None or not a or a.startswith("*Betreft"):
            continue
        weeks = [(k, v.strip()) for k, v in row.items() if k >= 4 and not is_num(v) and v.strip()]
        cur["taken"].append({"rij": r, "taak": a, "notitie": (row.get(2) or "").strip(), "verantwoordelijke": c, "weken": weeks})
    return blocks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("planning")
    ap.add_argument("--uit", required=True)
    ap.add_argument("--varianten")
    ap.add_argument("--naam", default="BOWACO_validatie_onderaannemers", help="bestandsnaam zonder extensie")
    args = ap.parse_args()
    uit = Path(args.uit)
    uit.mkdir(parents=True, exist_ok=True)
    kennis = {"varianten": {}, "leveranciers": [], "nutsbedrijven": [], "personen": []}
    if args.varianten:
        kennis.update(json.loads(Path(args.varianten).read_text(encoding="utf-8")))
    varianten = {norm(k): norm(v) for k, v in kennis["varianten"].items()}
    leveranciers = {norm(x) for x in kennis["leveranciers"]}
    nutsbedrijven = {norm(x) for x in kennis["nutsbedrijven"]}
    personen = {norm(x) for x in kennis["personen"]}

    # Blad 2: de zekere firma's
    b2 = load_sheet(args.planning, "sheet2")
    zeker = OrderedDict()
    for r in sorted(b2):
        if r == 1:
            continue
        code, firma, kbo, werk = [(b2[r].get(i) or "").strip() for i in (1, 2, 3, 4)]
        if not code:
            continue
        kbo = re.sub(r"\D", "", kbo)
        if len(kbo) == 9:
            kbo = "0" + kbo
        zeker[norm(code)] = {"code": norm(code), "firmanaam": firma, "kbo": kbo, "omschrijving": werk}
    # De firmanaam is zelf ook een manier waarop de planning de firma kan noemen (de firmanaam als variant van de code).
    for code, z in zeker.items():
        varianten.setdefault(norm(z["firmanaam"]), code)

    def canon(name):
        n = norm(name)
        return varianten.get(n, n)

    blocks = parse_planning(args.planning)
    stat = defaultdict(lambda: {"schrijfwijzen": Counter(), "taken": 0, "weken": 0, "werven": set(), "taaknamen": [], "weekcellen_in_tekst": 0})
    vrije_tekst = Counter()
    n_taken = 0
    for b in blocks:
        for t in b["taken"]:
            n_taken += 1
            seen_here = set()
            for raw in split_names(t["verantwoordelijke"]):
                k = canon(raw)
                s = stat[k]
                s["schrijfwijzen"][raw] += 1
                s["taken"] += 1
                s["werven"].add(b["werf"])
                if t["taak"] not in s["taaknamen"]:
                    s["taaknamen"].append(t["taak"])
                seen_here.add(k)
            for _, cell in t["weken"]:
                if looks_like_name(cell):
                    for raw in split_names(cell):
                        k = canon(raw)
                        s = stat[k]
                        s["schrijfwijzen"][raw] += 1
                        s["weken"] += 1
                        s["werven"].add(b["werf"])
                        if k not in seen_here and t["taak"] not in s["taaknamen"]:
                            s["taaknamen"].append(t["taak"])
                else:
                    vrije_tekst[cell] += 1

    namen = []
    for k, s in stat.items():
        if k in SYSTEEM or k.startswith("?"):
            soort = "systeem"
        elif k in DAGEN or any(w in TAAKWOORDEN for w in k.split(" ")):
            soort = "geen naam"
        elif k in zeker:
            soort = "zeker"
        elif k in leveranciers:
            soort = "leverancier"
        elif k in nutsbedrijven:
            soort = "nutsbedrijf"
        elif k in personen:
            soort = "persoon"
        else:
            soort = "te bepalen"
        trades = []
        if k in zeker:
            trades = vakgebieden([zeker[k]["omschrijving"]], 3)
        extra = [x for x in vakgebieden(s["taaknamen"], 2) if x not in trades]
        trades = (trades + extra)[:3]
        namen.append(
            {
                "code": k,
                "soort": soort,
                "ook_geschreven_als": sorted(x for x in s["schrijfwijzen"] if x != k),
                "taken": s["taken"],
                "weekcellen": s["weken"],
                "werven": len(s["werven"]),
                "voorbeeldwerven": sorted(s["werven"])[:3],
                "voorbeeldtaken": s["taaknamen"][:3],
                "vakgebieden": trades,
                "firma": zeker.get(k),
            }
        )
    namen.sort(key=lambda n: (n["soort"] != "zeker", n["soort"] == "systeem", -(n["taken"] + n["weekcellen"]), n["code"]))
    for k, z in zeker.items():
        if k not in stat:
            namen.insert(0, {"code": k, "soort": "zeker", "ook_geschreven_als": [], "taken": 0, "weekcellen": 0, "werven": 0, "voorbeeldwerven": [], "voorbeeldtaken": [], "vakgebieden": vakgebieden([z["omschrijving"]], 3), "firma": z})

    stats = {
        "werfblokken": len(blocks),
        "taakrijen": n_taken,
        "namen_totaal": len(namen),
        "zeker": sum(1 for n in namen if n["soort"] == "zeker"),
        "systeem": sum(1 for n in namen if n["soort"] == "systeem"),
        "vermoedelijk_geen_naam": sum(1 for n in namen if n["soort"] == "geen naam"),
        "voorgesteld_leverancier": sum(1 for n in namen if n["soort"] == "leverancier"),
        "voorgesteld_nutsbedrijf": sum(1 for n in namen if n["soort"] == "nutsbedrijf"),
        "voorgesteld_persoon": sum(1 for n in namen if n["soort"] == "persoon"),
        "te_bepalen": sum(1 for n in namen if n["soort"] == "te bepalen"),
        "vrije_tekst_cellen": sum(vrije_tekst.values()),
    }
    (uit / "analyse.json").write_text(json.dumps({"stats": stats, "namen": namen}, ensure_ascii=False, indent=1), encoding="utf-8")

    kop = ["nr", "code", "ook_geschreven_als", "status", "aantal_taken", "aantal_weekcellen", "aantal_werven", "voorbeeldwerven", "voorbeeldtaken", "voorstel_soort", "voorstel_vakgebied",
           "BESLISSING", "FIRMANAAM", "KBO", "DEZELFDE_FIRMA_ALS", "PERSOONSNAAM", "VAKGEBIED", "TELEFOON", "EMAIL", "OPMERKING"]
    voorstel_soort = {"zeker": "firma", "leverancier": "leverancier", "nutsbedrijf": "nutsbedrijf", "persoon": "persoon", "systeem": "negeren", "geen naam": "negeren", "te bepalen": "?"}
    with open(uit / (args.naam + ".csv"), "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(kop)
        for i, n in enumerate(namen, 1):
            z = n["firma"]
            w.writerow([
                i, n["code"], ", ".join(n["ook_geschreven_als"]), "ZEKER (KBO)" if z else "voorstel", n["taken"], n["weekcellen"], n["werven"],
                " | ".join(n["voorbeeldwerven"]), " | ".join(n["voorbeeldtaken"]), voorstel_soort[n["soort"]], ", ".join(n["vakgebieden"]),
                "firma" if z else "negeren" if n["soort"] == "systeem" else "",
                z["firmanaam"] if z else "", z["kbo"] if z else "", "", "", ", ".join(n["vakgebieden"]) if z else "", "", "", "",
            ])

    md = []
    md.append("# Onderaannemers: validatierapport voor Alexis (stap 1.2)\n")
    md.append("*Gemaakt door `tools/oa-analyse.py` uit de planning. **Bevat echte namen: niet in git, niet op de draft.** Niets is gewijzigd of geïmporteerd.*\n")
    md.append("## Samenvatting\n")
    md.append("| | |\n|---|---|")
    for k, v in [("Werfblokken in de planning", stats["werfblokken"]), ("Taakrijen", stats["taakrijen"]), ("Verschillende namen of codes na samenvoegen van duidelijke varianten", stats["namen_totaal"]),
                 ("Zeker: firma's van blad 2 met ondernemingsnummer", stats["zeker"]), ("Systeemcodes (BOWACO, KLANT, VERGUNNING, …): worden genegeerd", stats["systeem"]), ("Vermoedelijk geen naam maar een taak of opmerking in de cel (voorstel: negeren)", stats["vermoedelijk_geen_naam"]),
                 ("Voorstel: leverancier", stats["voorgesteld_leverancier"]), ("Voorstel: nutsbedrijf", stats["voorgesteld_nutsbedrijf"]), ("Voorstel: persoon", stats["voorgesteld_persoon"]),
                 ("Nog te bepalen door jou", stats["te_bepalen"]), ("Cellen met vrije tekst (niet als naam gelezen)", stats["vrije_tekst_cellen"])]:
        md.append(f"| {k} | {v} |")
    md.append("\n## Wat je moet doen\n")
    md.append(f"Open `{args.naam}.csv` in Excel en vul bij elke rij zonder beslissing de kolom **BESLISSING** in met één van deze woorden:\n")
    md.append("| BESLISSING | Betekenis | Wat je nog invult |\n|---|---|---|")
    md.append("| `firma` | Dit is een eigen firma (onderaannemer) | FIRMANAAM, liefst KBO, VAKGEBIED (sleutels, zie onderaan), TELEFOON, EMAIL |")
    md.append("| `dezelfde firma als` | Deze code is een andere schrijfwijze of een medewerker van een firma die al een rij heeft | DEZELFDE_FIRMA_ALS = de **code** van die andere rij |")
    md.append("| `leverancier` | Levert materiaal (geen ploeg op de werf) | FIRMANAAM (leeg = de code), eventueel TELEFOON, EMAIL |")
    md.append("| `nutsbedrijf` | Nutsbedrijf of overheid (water, gas, elektriciteit, gemeente) | FIRMANAAM (leeg = de code) |")
    md.append("| `persoon` | Een persoon zonder eigen firma in de lijst, of een medewerker van een firma | PERSOONSNAAM (leeg = de code); DEZELFDE_FIRMA_ALS = de code van zijn firma, of leeg voor een zelfstandige |")
    md.append("| `negeren` | Geen onderaannemer (bv. KLANT, VERGUNNING) | niets |")
    md.append("\nWat je leeg laat, wordt **niet** geïmporteerd. De import kan veilig opnieuw gedraaid worden: ze maakt geen dubbels en overschrijft niets wat al in de app staat.\n")
    md.append("## Zeker (blad 2 van de planning: firmanaam en ondernemingsnummer bekend)\n")
    md.append("| Code | Ook geschreven als | Firmanaam | KBO | Taken | Werven | Voorgesteld vakgebied |\n|---|---|---|---|---|---|---|")
    for n in namen:
        if n["firma"]:
            z = n["firma"]
            md.append(f"| {n['code']} | {', '.join(n['ook_geschreven_als']) or '–'} | {z['firmanaam']} | {z['kbo']} | {n['taken']} | {n['werven']} | {', '.join(n['vakgebieden'])} |")
    md.append("\n## Voorstellen (jouw beslissing nodig)\n")
    md.append("Gesorteerd van meest naar minst gebruikt. *Voorstel* = wat het script uit de taken afleidt; het is een gok.\n")
    md.append("| Code | Ook geschreven als | Taken | Weekcellen | Werven | Voorbeeldtaken | Voorstel soort | Voorstel vakgebied |\n|---|---|---|---|---|---|---|---|")
    for n in namen:
        if not n["firma"] and n["soort"] not in ("systeem", "geen naam"):
            md.append(f"| {n['code']} | {', '.join(n['ook_geschreven_als']) or '–'} | {n['taken']} | {n['weekcellen']} | {n['werven']} | {' / '.join(t[:40] for t in n['voorbeeldtaken']) or '–'} | {voorstel_soort[n['soort']]} | {', '.join(n['vakgebieden']) or '–'} |")
    md.append("\n## Vermoedelijk geen naam (taak of opmerking in een cel; voorstel: negeren)\n")
    md.append(", ".join(f"{n['code']}" for n in namen if n["soort"] == "geen naam") or "–")
    md.append("\n\n## Systeemcodes (worden genegeerd)\n")
    md.append(", ".join(f"{n['code']} ({n['taken'] + n['weekcellen']}×)" for n in namen if n["soort"] == "systeem") or "–")
    md.append("\n\n## Vakgebieden (sleutels voor de kolom VAKGEBIED)\n")
    md.append("afbraak, grond-fundering, riolering, ruwbouw, stabiliteit, dak, buitenschrijnwerk, elektriciteit, sanitair-chauffage, ventilatie, pleister, vloerisolatie, chape, parket, tegels, binnenschrijnwerk, schilder, tuin, injecteren, studies, algemeen. Meerdere: scheid ze met een komma. Nieuwe vakgebieden voeg je later in de app toe.\n")
    (uit / (args.naam + ".md")).write_text("\n".join(md) + "\n", encoding="utf-8")
    print(json.dumps(stats, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
