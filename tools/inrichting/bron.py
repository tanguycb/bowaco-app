"""Stap 2b.6: gedeelde hulp voor de lezers van de inrichting (enkel standaardbibliotheek; draai met python3 -I).

De lezers lezen de ECHTE documenten van BOWACO (map bowaco-docs, nooit in git) en schrijven een plan (JSON) in een
werkmap buiten git (standaard ~/.bowaco/inrichting/plan). Het plan gaat daarna met tools/inrichting.mjs naar de app.
Dit bestand bevat geen gegevens: enkel leesregels.
"""
import csv
import json
import os
import re
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from datetime import date, datetime, timedelta

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main", "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def werkmap():
    return os.environ.get("BOWACO_INRICHTING", os.path.expanduser("~/.bowaco/inrichting"))


def fold(s):
    """Kleine letters, zonder accenten, enkel letters en cijfers met één spatie (voor vergelijken, nooit om te tonen)."""
    s = unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def lees_index(pad):
    """Een index van 0.3: punt-komma, UTF-8 met BOM."""
    with open(pad, encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh, delimiter=";"))


def schrijf_plan(naam, plan):
    d = os.path.join(werkmap(), "plan")
    os.makedirs(d, mode=0o700, exist_ok=True)
    p = os.path.join(d, naam)
    with open(p, "w", encoding="utf-8") as fh:
        json.dump(plan, fh, ensure_ascii=False, indent=1)
    os.chmod(p, 0o600)
    return p


def vandaag():
    return datetime.now().strftime("%Y-%m-%d %H:%M")


# ── xlsx ────────────────────────────────────────────────────────────────────
def _col(c):
    n = 0
    for ch in c:
        n = n * 26 + ord(ch) - 64
    return n


def xlsx_bladen(pad):
    """[(naam, zichtbaarheid, {rij: {kolom: (waarde, formule)}})] — waarden zoals Excel ze laatst bewaarde."""
    z = zipfile.ZipFile(pad)
    ss = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            ss.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    rmap = {r.get("Id"): r.get("Target") for r in rels}
    out = []
    for s in wb.find("m:sheets", NS):
        t = rmap[s.get("{%s}id" % NS["r"])].lstrip("/")
        if not t.startswith("xl/"):
            t = "xl/" + t
        root = ET.fromstring(z.read(t))
        rows = {}
        for c in root.iter("{%s}c" % NS["m"]):
            m = re.match(r"([A-Z]+)(\d+)", c.get("r"))
            v = c.find("m:v", NS)
            f = c.find("m:f", NS)
            tt = c.get("t")
            if tt == "inlineStr":
                val = "".join(x.text or "" for x in c.iter("{%s}t" % NS["m"]))
            elif v is None:
                val = None
            elif tt == "s":
                val = ss[int(v.text)]
            else:
                val = v.text
            if val is None and f is None:
                continue
            rows.setdefault(int(m.group(2)), {})[_col(m.group(1))] = (val, f.text if f is not None else None)
        out.append((s.get("name"), s.get("state", "visible"), rows))
    return out


def getal(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def excel_dag(n):
    return (date(1899, 12, 30) + timedelta(days=int(n))).isoformat()


# ── docx ────────────────────────────────────────────────────────────────────
def docx_alineas(pad):
    """[(stijl, tekst)] per alinea, tabellen als 'cel | cel'."""
    z = zipfile.ZipFile(pad)
    root = ET.fromstring(z.read("word/document.xml"))
    body = root.find(W + "body")
    out = []

    def para(p):
        st = p.find(f"{W}pPr/{W}pStyle")
        txt = "".join((t.text or "") if t.tag == W + "t" else ("\t" if t.tag == W + "tab" else "\n") for t in p.iter() if t.tag in (W + "t", W + "tab", W + "br"))
        return (st.get(W + "val") if st is not None else "", txt.strip())

    for el in body:
        if el.tag == W + "p":
            out.append(para(el))
        elif el.tag == W + "tbl":
            for tr in el.iter(W + "tr"):
                cells = [" ".join(para(p)[1] for p in tc.iter(W + "p")).strip() for tc in tr.iter(W + "tc")]
                out.append(("tabel", " | ".join(cells)))
    return [(s, t) for s, t in out if t]


# ── eenheden en hoofdstukken (0.3 §2.1) ────────────────────────────────────
EENHEDEN = {"stuks": "st", "stuk": "st", "p": "st", "tp": "st", "st.": "st", "m²": "m2", "m2/": "m2", "m": "m", "m³": "m3", "uur": "u", "h": "u",
            "m2perlaag": "m2/laag", "perlaag": "m2/laag", "m²/laag": "m2/laag", "m2/laag": "m2/laag", "cmperm2": "cm/m2", "cm/m²": "cm/m2", "cmperm²": "cm/m2",
            "d/lm": "dlm", "%": "pct", "sgo": "sog", "forfait": "sog", "ff": "sog", "werkdagen": "werkdag", "dagen": "dag", "weken": "week", "maanden": "maand", "zakken": "zak"}


def eenheid(u):
    u = (u or "").strip().lower().replace("`", "").replace(" ", "")
    u = EENHEDEN.get(u, u)
    return u.replace("²", "2").replace("³", "3")


# Hoofdstukken in werkvolgorde (0.3 §2.1 en vraag D6: de korte lijst uit de dagelijkse offerte, niet de 19 startlijst-hoofdstukken van 2.2).
# (code, titel, zoekpatroon op de gevouwen hoofdstuktitel). De eerste treffer wint; "Overige" vangt de rest.
HOOFDSTUKKEN = [
    ("01", "Algemeen", r"^algemeen|werfinrichting|inrichting van de bouwplaats|algemene kosten|werfvoorbereiding|voorbereiding|gebouwprestaties|proeven"),
    ("02", "Afdekken te behouden delen", r"afdekken|bescherm"),
    ("03", "Afbraakwerken", r"afbraak|slopen|sloop"),
    ("04", "Grondwerken en funderingen", r"grondwerk|fundering|uitgraving|graafwerk"),
    ("05", "Riolering", r"riolering|ondergrondse|afvoer|drainage|septische"),
    ("06", "Ruwbouw", r"ruwbouw|metsel|structu|gewapend beton|beton|staal|stalen|ligger|stabiliteit|aanpassingswerken|stut|hardsteen|arduin|gevel|houtskelet|bovenbouw|opbouw|mazout"),
    ("07", "Dakwerken", r"^dak|dakwerk|dakrenovatie|plat dak|zink|goot|groendak"),
    ("08", "Buitenschrijnwerk", r"buitensch|ramen|glazen wand|glaswerk|poort|dorpel"),
    ("09", "Elektriciteit", r"elektr|verlichting"),
    ("10", "Sanitair en chauffage", r"sanitair|sanitaire|chauffage|verwarming|loodgiet|warmtepomp"),
    ("11", "Ventilatie", r"ventilatie"),
    ("12", "Airco", r"airco"),
    ("13", "Binnenplaatafwerking", r"binnenplaat|gyproc|plaatafwerking|valse plafond|voorzetwand"),
    ("14", "Pleisterwerken", r"pleister|crepi|kaleien|kaleiwerk|kalleiwerk|cementeren"),
    ("15", "Isolatie", r"isolatie|\bpur\b|thermisch|vocht|kelderdichting|cementering"),
    ("16", "Chape", r"chape|dekvloer|egalisatie"),
    ("17", "Vloeren en faience", r"vloer|faience|tegel|betegeling|parket|laminaat"),
    ("18", "Schilderwerken", r"schilder"),
    ("19", "Binnenschrijnwerk", r"binnenschrijnwerk|schrijnwerk|binnendeur|trap|timmerwerk|meubilair"),
    ("20", "Keuken", r"keuken"),
    ("21", "Injecteren, zandstralen en stelling", r"injecter|zandstra|stelling|gevelreinig"),
    ("22", "Buitenaanleg", r"buitenaanleg|tuin|terras|verharding|oprit"),
    ("23", "Opties en meerwerken", r"^extra|optie|meerwerk|meerprijs"),
    ("99", "Overige", r"$^"),
]


def hoofdstuk(titel):
    """De code van het genormaliseerde hoofdstuk voor een hoofdstuktitel (of een posttitel bij een lijst zonder hoofdstukken)."""
    t = re.sub(r"^\s*\d+\s*", "", fold(titel))
    for code, _, pat in HOOFDSTUKKEN:
        if re.search(pat, t):
            return code
    return "99"


def postsleutel(titel, eenheid, soort="o"):
    """Importsleutel van een post: hash van de gevouwen titel + eenheid ("o" = uit een offerte, "p" = uit een prijslijst)."""
    import hashlib
    return f"{soort}:" + hashlib.sha1(fold(titel).encode()).hexdigest()[:12] + ":" + eenheid
