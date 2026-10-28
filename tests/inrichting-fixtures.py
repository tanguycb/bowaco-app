#!/usr/bin/env python3 -I
"""Stap 2b.6: een VERZONNEN documentenmap voor tests/inrichting.mjs (geen enkel echt gegeven: firma's, adressen,
nummers en prijzen zijn bedacht; ondernemingsnummers zijn ongeldige proefnummers).

  python3 -I tests/inrichting-fixtures.py MAP

Maakt in MAP dezelfde vorm als bowaco-docs/bowaco: de indexen (CSV, punt-komma, BOM), de Excelofferten in de vier
vormen die de offerte-lezer moet kennen, het offertesjabloon, de algemene voorwaarden, een prijslijst (docx), het
kennisbestand vergunningen en een planningsplan (zoals tools/plan-analyse.py het schrijft).
"""
import csv
import json
import os
import sys
import zipfile
from datetime import date

ROOT = sys.argv[1]
ADM = os.path.join(ROOT, "Bowaco Administratie")


def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def col(n):
    s = ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def xlsx(pad, rijen):
    """rijen: {rij: {kolom: waarde | ("=formule", waarde)}} → een minimaal xlsx-bestand met inline tekst en formules."""
    os.makedirs(os.path.dirname(pad), exist_ok=True)
    cellen = []
    for r in sorted(rijen):
        cs = []
        for c in sorted(rijen[r]):
            v = rijen[r][c]
            ref = f"{col(c)}{r}"
            f = None
            if isinstance(v, tuple):
                f, v = v[0].lstrip("="), v[1]
            if isinstance(v, (int, float)):
                cs.append(f'<c r="{ref}">' + (f"<f>{esc(f)}</f>" if f else "") + f"<v>{v}</v></c>")
            else:
                cs.append(f'<c r="{ref}" t="inlineStr">' + (f"<f>{esc(f)}</f>" if f else "") + f"<is><t>{esc(v)}</t></is></c>")
        cellen.append(f'<row r="{r}">' + "".join(cs) + "</row>")
    m = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    with zipfile.ZipFile(pad, "w") as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
        z.writestr("_rels/.rels", f'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="{rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        z.writestr("xl/workbook.xml", f'<?xml version="1.0"?><workbook xmlns="{m}" xmlns:r="{rel}"><sheets><sheet name="Blad1" sheetId="1" r:id="rId1"/></sheets></workbook>')
        z.writestr("xl/_rels/workbook.xml.rels", f'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
        z.writestr("xl/worksheets/sheet1.xml", f'<?xml version="1.0"?><worksheet xmlns="{m}"><sheetData>{"".join(cellen)}</sheetData></worksheet>')


def docx(pad, alineas):
    """alineas: [(stijl, tekst)]."""
    os.makedirs(os.path.dirname(pad), exist_ok=True)
    w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    stijl = lambda s: f'<w:pPr><w:pStyle w:val="{s}"/></w:pPr>' if s else ""
    body = "".join(f'<w:p>{stijl(s)}<w:r><w:t xml:space="preserve">{esc(t)}</w:t></w:r></w:p>' for s, t in alineas)
    with zipfile.ZipFile(pad, "w") as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        z.writestr("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        z.writestr("word/document.xml", f'<?xml version="1.0"?><w:document xmlns:w="{w}"><w:body>{body}</w:body></w:document>')


def index(naam, kop, rijen):
    with open(os.path.join(ROOT, naam), "w", newline="", encoding="utf-8-sig") as fh:
        wr = csv.DictWriter(fh, fieldnames=kop, delimiter=";", extrasaction="ignore")
        wr.writeheader()
        for r in rijen:
            wr.writerow({k: r.get(k, "") for k in kop})


os.makedirs(ADM, exist_ok=True)
# Merkbestand: enkel hier mag lees-alles.sh de plannen "test" noemen.
open(os.path.join(ROOT, "VERZONNEN-PROEFMAP"), "w").write("Verzonnen documentenmap van tests/inrichting-fixtures.py: geen echte gegevens.\n")

# ── Offertes (vier vormen) ─────────────────────────────────────────────────
kop_vh = {"A": "Beschrijving", "B": "VH", "C": "Aantal", "D": "Eenheid", "E": "Stukprijs", "F": "Totaal", "G": "Subtotaal"}
K = lambda d: {ord(k) - 64: v for k, v in d.items()}
# Q-2025-150: rijk (VH + subtotalen): twee hoofdstukken, een subgroep, aankoopformules /0,8 en /0,9, een vaste prijs
xlsx(os.path.join(ADM, "01 Offertes/2025/2025-150 Proef/2025-150 Offerte Proef v2.xlsx"), {
    16: K({"A": "Nummer"}), 17: K({"A": "2025/150", "B": ("=TODAY()", 45900)}),
    19: K(kop_vh),
    20: K({"A": "1 – ALGEMEEN", "G": ("=SUM(F21:F23)", 0)}),
    21: K({"A": "Werfvoorbereiding proefpost", "C": 1, "D": "sog", "E": ("=400/0.8", 500), "F": ("=C21*E21", 500)}),
    22: K({"A": "1.2. Container proefpuin 10 m³", "C": 2, "D": "st", "E": ("=320/0.8", 400), "F": ("=C22*E22", 800)}),
    23: K({"A": "Werfbord proef", "C": 1, "D": "st", "E": 150, "F": ("=C23*E23", 150)}),
    24: K({"A": "BUITENSCHRIJNWERK", "G": ("=SUM(F25:F27)", 0)}),
    25: K({"A": "Gelijkvloers", "G": ("=SUM(F26:F27)", 0)}),
    26: K({"A": "Proefraam in hout\nmet dubbel glas", "B": "VH", "C": 3, "D": "m2", "E": ("=900/0.9", 1000), "F": ("=C26*E26", 3000)}),
    27: K({"A": "Proefdeur plaatsen", "C": 1, "D": "wa", "E": ("=200/0.8", 250), "F": ("=C27*E27", 250)}),
    28: K({"A": "Korting op totaalprijs", "C": -1, "D": "sog", "E": 100, "F": -100}),
    29: K({"A": "16/01/2025 Gepresteerde uren volgens werfverslag", "C": 8, "D": "u", "E": 45, "F": 360}),
    30: K({"F": "Subtot.", "G": ("=SUM(G20:G27)", 4600)}),
})
# Q-2025-151: rijk, dezelfde post (zelfde titel en eenheid) met een andere aankoopprijs, en een nieuwe eenheid
xlsx(os.path.join(ADM, "01 Offertes/2025/2025-151 Proef/2025-151 Offerte Proef.xlsx"), {
    19: K(kop_vh),
    20: K({"A": "Algemeen", "G": ("=SUM(F21:F22)", 0)}),
    21: K({"A": "Werfvoorbereiding proefpost", "C": 1, "D": "sog", "E": ("=440/0.8", 550), "F": ("=C21*E21", 550)}),
    22: K({"A": "Proefisolatie per cm", "C": 50, "D": "cm/m²", "E": ("=2/0.8", 2.5), "F": ("=C22*E22", 125)}),
    24: K({"F": "Subtot.", "G": ("=SUM(G20:G22)", 675)}),
})
# Q-2025-151-raming: een variant met hetzelfde nummer (de aankoopprijs mag niet wegvallen achter die van 2025/151)
xlsx(os.path.join(ADM, "01 Offertes/2025/2025-151 Proef/2025-151 Offerte Proef (Raming).xlsx"), {
    19: K(kop_vh),
    20: K({"A": "Algemeen", "G": ("=SUM(F21:F21)", 0)}),
    21: K({"A": "Werfvoorbereiding proefpost", "C": 1, "D": "sog", "E": ("=460/0.8", 575), "F": ("=C21*E21", 575)}),
    23: K({"F": "Subtot.", "G": ("=SUM(G20:G21)", 575)}),
})
# Q-2025-152: in de cel staat per vergissing 2025/151 (zoals in 33 echte bestanden): de verwijzing volgt de bestandsnaam
xlsx(os.path.join(ADM, "01 Offertes/2025/2025-152 Proef/2025-152 Offerte Proef.xlsx"), {
    19: K(kop_vh),
    20: K({"A": "Algemeen", "G": ("=SUM(F21:F21)", 0)}),
    21: K({"A": "Werfvoorbereiding proefpost", "C": 1, "D": "sog", "E": ("=470/0.8", 587.5), "F": ("=C21*E21", 587.5)}),
    23: K({"F": "Subtot.", "G": ("=SUM(G20:G21)", 587.5)}),
})
# Q-2024-140: plat (5 kolommen, geen hoofdstukken): enkel prijsgeheugen bij een bestaande post
xlsx(os.path.join(ADM, "01 Offertes/2024/2024-140 Proef/2024-140 Offerte Proef.xlsx"), {
    19: K({"A": "Beschrijving", "B": "Aantal", "C": "Eenheid", "D": "Stukprijs", "E": "Totaal"}),
    20: K({"A": "Werfvoorbereiding proefpost", "B": 1, "C": "sog", "D": ("=380/0.8", 475), "E": ("=B20*D20", 475)}),
    21: K({"A": "Een post die enkel hier staat", "B": 1, "C": "st", "D": ("=50/0.8", 62.5), "E": ("=B21*D21", 62.5)}),
    23: K({"D": "Subtot.", "E": ("=SUM(E20:E21)", 537.5)}),
})
# Q-2023-101: een andere activiteit (klasse 4): nooit gelezen
xlsx(os.path.join(ADM, "01 Offertes/Andere activiteit/2023-101 Proef.xlsx"), {19: K({"A": "Beschrijving", "B": "Aantal"}), 20: K({"A": "Proefpaneel", "B": 1})})
index("BOWACO_index_offertes.csv", ["offerte_id", "nummer_in_cel", "volgnummer", "jaar_in_nummer", "importklasse", "datum_laatste", "laatste_xlsx"], [
    {"offerte_id": "Q-2025-150", "nummer_in_cel": "2025/150", "volgnummer": "150", "jaar_in_nummer": "2025", "importklasse": "1 rijk (hoofdstukken)", "datum_laatste": "2025-05-12", "laatste_xlsx": "01 Offertes/2025/2025-150 Proef/2025-150 Offerte Proef v2.xlsx"},
    {"offerte_id": "Q-2025-151", "nummer_in_cel": "2025/151", "volgnummer": "151", "jaar_in_nummer": "2025", "importklasse": "1 rijk (hoofdstukken)", "datum_laatste": "2025-09-01", "laatste_xlsx": "01 Offertes/2025/2025-151 Proef/2025-151 Offerte Proef.xlsx"},
    {"offerte_id": "Q-2025-151-raming", "nummer_in_cel": "2025/151", "volgnummer": "151", "jaar_in_nummer": "2025", "importklasse": "1 rijk (hoofdstukken)", "datum_laatste": "2025-09-02", "laatste_xlsx": "01 Offertes/2025/2025-151 Proef/2025-151 Offerte Proef (Raming).xlsx"},
    {"offerte_id": "Q-2025-152", "nummer_in_cel": "2025/151", "volgnummer": "152", "jaar_in_nummer": "2025", "importklasse": "1 rijk (hoofdstukken)", "datum_laatste": "2025-10-01", "laatste_xlsx": "01 Offertes/2025/2025-152 Proef/2025-152 Offerte Proef.xlsx"},
    {"offerte_id": "Q-2024-140", "nummer_in_cel": "2024/140", "volgnummer": "140", "jaar_in_nummer": "2024", "importklasse": "3 plat (prijsgeheugen)", "datum_laatste": "2024-03-04", "laatste_xlsx": "01 Offertes/2024/2024-140 Proef/2024-140 Offerte Proef.xlsx"},
    {"offerte_id": "Q-2023-101", "nummer_in_cel": "2023/101", "volgnummer": "101", "jaar_in_nummer": "2023", "importklasse": "4 andere activiteit (buiten bibliotheek)", "datum_laatste": "2023-02-02", "laatste_xlsx": "01 Offertes/Andere activiteit/2023-101 Proef.xlsx"},
])

# ── Bedrijf: sjabloon en voorwaarden ───────────────────────────────────────
xlsx(os.path.join(ADM, "00 Bedrijf en voorwaarden/02 Sjablonen/basisofferte PROEF.xlsx"), {
    1: K({"A": "PROEF"}), 3: K({"A": "Proefbouw BV"}), 4: K({"A": "Verzonnenstraat 1"}), 5: K({"A": "9999 PROEFDORP"}), 6: K({"A": "België"}),
    7: K({"A": "BE 0000.000.097"}), 8: K({"A": "info@proefbouw.test"}),
    40: K({"A": "VERZONNENSTRAAT 1, 9999 PROEFDORP", "B": "INFO@PROEFBOUW.TEST", "E": "BTW BE 0000.000.097"}),
    41: K({"A": "T +32 (0)9 000 00 00", "B": " WWW.PROEFBOUW.TEST", "E": "BANK BE00 0000 0000 0000 - BIC PROFBEBB"}),
})
docx(os.path.join(ADM, "00 Bedrijf en voorwaarden/01 Algemene voorwaarden/Algemene voorwaarden proef.docx"), [
    ("Kop1", "Algemene voorwaarden"), ("Kop1", "Toepasselijkheid :"), ("Plattetekst", "Deze proefvoorwaarden gelden voor elke verzonnen opdracht."),
    ("Kop1", "Betaling :"), ("Lijstalinea", "binnen de twee weken"), ("Lijstalinea", "zonder korting")])

# ── Prijslijst (docx) ─────────────────────────────────────────────────────
docx(os.path.join(ADM, "06 Prijzen/Prijslijst per vakgebied/Gyproc/2025 - Prijslijst gyproc.docx"), [
    ("", "Prijslijst gyproc Proefplaat"), ("", "Werfvoorbereiding proefpost = 300 €/sog"), ("", "Plafond"), ("", "Plaatsing proefplaat           17€m2"),
    ("", "Uitlatten proef  = 15 € m2"), ("", "Scheidingswand"), ("", "2 x proefplaat                34€m2"), ("", "Plaatsing proefplaat           19€m2")])

# ── Documenten-index ──────────────────────────────────────────────────────
kop_doc = ["doc_id", "pad", "type", "grootte_bytes", "datum", "werf_id", "categorie", "import_actie", "gevoelig"]
index("BOWACO_index_documenten.csv", kop_doc, [
    {"doc_id": "D-00001", "pad": "00 Bedrijf en voorwaarden/01 Algemene voorwaarden/Algemene voorwaarden proef.docx", "type": "docx", "datum": "2025-01-01", "import_actie": "bron QuoteTerms (2.7), na jurist", "gevoelig": "nee"},
    {"doc_id": "D-00002", "pad": "00 Bedrijf en voorwaarden/02 Sjablonen/basisofferte PROEF.xlsx", "type": "xlsx", "datum": "2025-01-01", "import_actie": "bron invoer met de hand (sjabloon/voorwaarden)", "gevoelig": "nee"},
    {"doc_id": "D-00003", "pad": "06 Prijzen/Prijslijst per vakgebied/Gyproc/2025 - Prijslijst gyproc.docx", "type": "docx", "datum": "2025-03-31", "import_actie": "bron prijzen (handmatig, stap 5)", "gevoelig": "nee"},
    {"doc_id": "D-00004", "pad": "06 Prijzen/Prijslijst per vakgebied/Beton/Offerte proef.pdf", "type": "pdf", "datum": "2025-01-13", "import_actie": "bron prijzen (handmatig, stap 5)", "gevoelig": "nee"},
    {"doc_id": "D-00010", "pad": "02 Werven en klanten/Proefstraat 1/13. Vergunningen/vergunning.pdf", "type": "pdf", "grootte_bytes": "120000", "werf_id": "W-901", "categorie": "vergunning", "import_actie": "werf-bestand (vergunning)", "gevoelig": "nee"},
    {"doc_id": "D-00011", "pad": "02 Werven en klanten/Proefstraat 1/02. Plannen/plan.pdf", "type": "pdf", "grootte_bytes": "2000000", "werf_id": "W-901", "categorie": "plan", "import_actie": "werf-bestand (bijlage)", "gevoelig": "nee"},
    {"doc_id": "D-00012", "pad": "02 Werven en klanten/Proefstraat 1/03. Foto's/foto.heic", "type": "heic", "grootte_bytes": "3000000", "werf_id": "W-901", "categorie": "foto", "import_actie": "foto-selectie later (niet in bulk)", "gevoelig": "nee"},
    {"doc_id": "D-00013", "pad": "02 Werven en klanten/Proeflaan 2/Social security/lijst.pdf", "type": "pdf", "grootte_bytes": "1000", "werf_id": "W-902", "categorie": "werfadministratie", "import_actie": "werf-bestand (werfadministratie)", "gevoelig": "ja"},
])
index("BOWACO_index_verkoop.csv", ["verkoop_id", "betalingstermijn"], [{"verkoop_id": "V-1", "betalingstermijn": "15 dagen na datum"}, {"verkoop_id": "V-2", "betalingstermijn": "15 dagen na datum"}, {"verkoop_id": "V-3", "betalingstermijn": "30 dagen"}])

# ── Firma's: beslissingen van 1.2 en de firma-index ────────────────────────
index("BOWACO_validatie_onderaannemers_1.2.csv", ["nr", "code", "ook_geschreven_als", "status", "BESLISSING", "FIRMANAAM", "KBO", "VAKGEBIED"], [
    {"nr": "1", "code": "PROEFA", "ook_geschreven_als": "PRA", "status": "ZEKER (KBO)", "BESLISSING": "firma", "FIRMANAAM": "Proefdak BV", "KBO": "0000000196", "VAKGEBIED": "dak"},
    {"nr": "2", "code": "PROEFB", "status": "ZEKER (KBO)", "BESLISSING": "firma", "FIRMANAAM": "Proefelek BV", "KBO": "0000000295", "VAKGEBIED": "elektriciteit"},
    {"nr": "3", "code": "BOWACO", "status": "voorstel", "BESLISSING": "negeren"},
    {"nr": "4", "code": "JAN", "status": "voorstel", "BESLISSING": ""},
])
index("BOWACO_index_firmas.csv", ["firma_id", "naam", "kbo", "aantal_facturen", "jaren", "soort", "planningscode_voorstel_0_3", "zekerheid_voorstel", "btw_verlegd_aandeel", "bron"], [
    {"firma_id": "F-001", "naam": "PROEFMATERIAAL", "kbo": "0000000394", "aantal_facturen": "40", "jaren": "2023-2026", "soort": "leverancier", "btw_verlegd_aandeel": "0.0", "bron": "aankoopfacturen"},
    {"firma_id": "F-002", "naam": "PROEFDAK", "kbo": "0000000196", "aantal_facturen": "12", "jaren": "2025-2026", "soort": "OA", "btw_verlegd_aandeel": "0.9", "bron": "aankoopfacturen"},
    {"firma_id": "F-003", "naam": "PROEFPLAAT", "kbo": "0000000493", "aantal_facturen": "8", "jaren": "2025", "soort": "OA", "planningscode_voorstel_0_3": "PLAAT", "zekerheid_voorstel": "zeker", "btw_verlegd_aandeel": "1.0", "bron": "aankoopfacturen"},
    {"firma_id": "F-004", "naam": "Proefelek BV", "kbo": "0000000592", "aantal_facturen": "3", "jaren": "2026", "soort": "OA", "bron": "aankoopfacturen"},
    {"firma_id": "F-005", "naam": "PROEFBOEKHOUDER", "kbo": "0000000691", "aantal_facturen": "9", "soort": "diensten", "bron": "aankoopfacturen"},
    {"firma_id": "F-007", "naam": "20260303 PROEFDEUREN - 5600000001.PDF", "kbo": "0000000790", "aantal_facturen": "2", "jaren": "2026", "soort": "leverancier", "bron": "aankoopfacturen"},
    {"firma_id": "F-006", "naam": "ONBEKENDE PROEF", "aantal_facturen": "1", "soort": "", "bron": "aankoopfacturen"},
    {"firma_id": "F-901", "naam": "JAN", "soort": "?", "bron": "OA-lijst 1.2 (planning)"},
])

# ── Werven en planning ─────────────────────────────────────────────────────
index("BOWACO_index_werven.csv", ["werf_id", "map", "straat", "nr", "postcode", "gemeente", "cluster_zelfde_straat", "import_voorstel", "offertes"], [
    {"werf_id": "W-901", "map": "Proefstraat 1 - 9999 Proefdorp", "straat": "Proefstraat", "nr": "1", "postcode": "9999", "gemeente": "Proefdorp", "import_voorstel": "stap 3: werf aanmaken (+ planning/offerte)", "offertes": "2025-150"},
    {"werf_id": "W-902", "map": "Proeflaan 2 - Proefdorp", "straat": "Proeflaan", "nr": "2", "postcode": "", "gemeente": "Proefdorp", "cluster_zelfde_straat": "ja", "import_voorstel": "stap 3: werf aanmaken (+ planning/offerte)"},
    {"werf_id": "W-903", "map": "Oudeproef 3 - 9999 Proefdorp", "straat": "Oudeproef", "nr": "3", "postcode": "9999", "gemeente": "Proefdorp", "import_voorstel": "stap 3 optioneel (historiek)"},
    {"werf_id": "W-904", "map": "Zonproef 4", "straat": "Zonproef", "nr": "4", "import_voorstel": "niet aanmaken (andere activiteit)"},
])
index("BOWACO_index_planning.csv", ["planblok_id", "rij_in_excel", "werf_id", "werf_zekerheid"], [
    {"planblok_id": "PB-001", "rij_in_excel": "6", "werf_id": "W-901", "werf_zekerheid": "1.0"},
    {"planblok_id": "PB-002", "rij_in_excel": "20", "werf_id": "", "werf_zekerheid": ""},
])
maandag = (date(2026, 11, 2) - date(1970, 1, 1)).days


def taak(k, titel, start, dagen, wie):
    return {"key": k, "title": titel, "note": "", "responsible": wie, "status": "planned", "percent": 0, "start": start, "workdays": dagen, "rij": 0,
            "runs": [{"key": k + "r", "name": wie, "from": start, "to": start + dagen + 1, "note": ""}] if wie else [], "appointments": [], "extra": []}


plan = {"bron": "proef", "batch": "inrichting-2b6-planning", "titel": "Proefplanning", "statusGrens": "2026-11-02", "bevindingen": [], "blokkeringen": {"bouwverlof": ["2026-12-28"]}, "blokken": [
    {"code": "B01", "key": "proefblok01", "rij": 6, "header": "Proefstraat 1, 9999 PROEFDORP", "name": "Proefstraat 1, 9999 PROEFDORP", "street": "Proefstraat", "number": "1", "zip": "9999", "city": "PROEFDORP", "vatBp": 600,
     "besluit": {"beslissing": "nieuw", "doel": None, "bron": "standaard"}, "tasks": [taak("proeft01", "Proefdak plaatsen", maandag, 5, "PROEFA"), taak("proeft02", "Proefelektriciteit", maandag + 7, 3, "JAN")]},
    {"code": "B02", "key": "proefblok02", "rij": 20, "header": "Proefplein 9, 9999 PROEFDORP", "name": "Proefplein 9, 9999 PROEFDORP", "street": "Proefplein", "number": "9", "zip": "9999", "city": "PROEFDORP", "vatBp": 2100,
     "besluit": {"beslissing": "nieuw", "doel": None, "bron": "standaard"}, "tasks": [taak("proeft03", "Proefgevel", maandag + 14, 4, "PLAAT")]},
]}
werk = os.environ.get("BOWACO_INRICHTING")
if werk:
    os.makedirs(os.path.join(werk, "plan", "planning"), exist_ok=True)
    json.dump(plan, open(os.path.join(werk, "plan", "planning", "plan.json"), "w"), ensure_ascii=False)

json.dump({"bron": "proef", "soorten": [{"key": "nutsaansluiting", "naam": "Aansluiting nutsvoorziening (proef)", "dagen": 30, "woorden": ["aansluiting"], "openbaarDomein": False}],
           "gemeenten": [{"naam": "Proefdorp", "postcodes": ["9999"], "procedures": [{"soort": "werfzone", "hoe": "portaal", "dagen": 21, "notitie": "Proefprocedure."}, {"soort": "nutsaansluiting", "hoe": "andere", "dagen": 30, "notitie": "Proef."}]}]},
          open(os.path.join(ROOT, "BOWACO_kennisbank_vergunningen_2b6.json"), "w"), ensure_ascii=False)
print("verzonnen documentenmap:", ROOT)
