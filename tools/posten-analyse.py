#!/usr/bin/env python3
"""Stap 2.2: een klantofferte (Excel van BOWACO) lezen als VOORLOPIGE bron voor de postenbibliotheek.

Leest het blad als GEGEVENS (geen formules uitvoeren, geen macro's; enkel de XML van het xlsx-bestand) en maakt:
  - <uit>/posten-<nummer>.json   hoofdstukken, posten (titel, lastenboektekst, eenheid, contractvorm, VH, hoeveelheid)
                                 en per post de prijs zoals de offerte ze rekent: aankoopprijs + 20 % marge (`X/0.8`),
                                 een vaste verkoopprijs, of een samengestelde formule (bevinding voor 0.3);
  - <uit>/posten-<nummer>.md     een rapport met de bevindingen (eenheden, contractvormen, formules, dubbels).
Beide bevatten ECHTE bedrijfsgegevens (aankoopprijzen, marges, klant): standaard naar ~/.bowaco/posten, NOOIT in git
(.gitignore: posten*.json, posten*.md, BOWACO_posten_*). Op de terminal komen enkel tellingen, geen bedragen of adressen.

    python3 -I tools/posten-analyse.py <offerte.xlsx> [--uit ~/.bowaco/posten]

Alles wat hieruit volgt is VOORLOPIG tot stap 0.3 (analyse van 10–20 offertes): zie architectuur §12.2 (B1–B6, B9, B13).
"""
import argparse
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter, OrderedDict
from datetime import date, timedelta
from pathlib import Path

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
# Schrijfwijzen in de offerte → sleutel van de eenheden in de app (Config.defaultUnits). "d/lm" = "dlm" (te bevestigen, B4).
UNITS = {"sog": "sog", "st": "st", "st.": "st", "stuk": "st", "stuks": "st", "m2": "m2", "m²": "m2", "lm": "lm", "u": "u", "uur": "u",
         "m3": "m3", "m³": "m3", "kg": "kg", "set": "set", "post": "post", "maand": "maand", "punt": "punt", "dlm": "dlm", "d/lm": "dlm"}
REGIE = re.compile(r"werken welke niet besproken zijn", re.I)
# Hoofdstuktitels zoals in de startlijst van de app (Config.defaultLibChapters): de offerte schrijft ze soms anders.
CHAPTER_NAMES = {
    "technieken – sanitair + chauffage": "Technieken – Sanitair en chauffage",
    "technieken – ventilatie (raming- indicatie)": "Technieken – Ventilatie",
    "binnenafwerking – buitenaanleg en tuin": "Buitenaanleg en tuin",
}


def col2n(c):
    n = 0
    for ch in c:
        n = n * 26 + ord(ch) - 64
    return n


def load(path):
    z = zipfile.ZipFile(path)
    ss = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            ss.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
    rows = {}
    root = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    for c in root.iter("{%s}c" % NS["m"]):
        m = re.match(r"([A-Z]+)(\d+)", c.get("r"))
        v = c.find("m:v", NS)
        f = c.find("m:f", NS)
        t = c.get("t")
        if t == "inlineStr":
            val = "".join(x.text or "" for x in c.iter("{%s}t" % NS["m"]))
        elif v is None:
            val = None
        elif t == "s":
            val = ss[int(v.text)]
        else:
            val = v.text
        if val is None and f is None:
            continue
        rows.setdefault(int(m.group(2)), {})[col2n(m.group(1))] = (val, f.text if f is not None else None)
    return rows


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def cents(x):
    return int(round(x * 100))


def eur(c):
    return "–" if c is None else f"{c / 100:.2f}"


def fold(t):
    return re.sub(r"[^a-z0-9]", "", (t or "").lower())


def form_of(title, text, vh):
    s = (title + " " + text).lower()
    if re.search(r"volgens (de )?offerte|in bijlage|zie bijlage", s):
        return "perAttachment"
    if re.search(r"\bbudget\b", s):
        return "budget"
    if re.search(r"raming|richtprijs|indicatie|stelpost", s):
        return "estimate"
    if re.search(r"\bregie\b", s):
        return "regie"
    if vh:
        return "vh"
    return "fixed"


def price_of(sell, formula):
    """(soort, aankoop in cent of None, verkoop in cent, uitleg). Soort: margin20 · composite · fixed."""
    f = (formula or "").replace(" ", "")
    m = re.fullmatch(r"(\d+(?:\.\d+)?)/0\.8", f)
    if m:
        return "margin20", cents(float(m.group(1))), cents(sell), "X/0.8"
    m = re.fullmatch(r"\((\d+(?:\.\d+)?)/0\.8\)\+(\d+(?:\.\d+)?)", f)
    if m:
        a, b = float(m.group(1)), float(m.group(2))
        return "composite", cents(a + b), cents(sell), "(X/0.8)+Y: deel met marge + deel zonder marge"
    if f:
        return "fixed", None, cents(sell), "formule zonder /0.8"
    return "fixed", None, cents(sell), "vaste verkoopprijs"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("xlsx")
    ap.add_argument("--uit", default=str(Path.home() / ".bowaco" / "posten"))
    a = ap.parse_args()
    rows = load(a.xlsx)
    nummer = None
    datum = None
    for r in sorted(rows):
        if rows[r].get(1, (None, None))[0] == "Nummer":
            nummer = (rows.get(r + 1, {}).get(1, (None, None))[0] or "").strip()
            d = num(rows.get(r + 1, {}).get(3, (None, None))[0])
            if d:
                datum = (date(1899, 12, 30) + timedelta(days=int(d))).isoformat()
            break
    if not nummer:
        sys.exit("geen offertenummer gevonden (cel 'Nummer')")
    chapters = []
    items = []
    texts = []
    findings = []
    units_raw = Counter()
    cur = None
    last_item_row = None
    for r in sorted(rows):
        d = rows[r]
        A = (d.get(1, (None, None))[0] or "").strip()
        B = (d.get(2, (None, None))[0] or "").strip()
        C, D, E = d.get(3, (None, None)), d.get(4, (None, None)), d.get(5, (None, None))
        G = d.get(7, (None, None))
        if G[1] and G[1].upper().startswith("SUM(") and re.match(r"^\d\d\s", A):
            code, title = A[:2], A[3:].strip()
            title = re.sub(r"\s+-\s+", " – ", title)
            norm = CHAPTER_NAMES.get(title.lower())
            if norm:
                findings.append(f"hoofdstuk {code} «{title}» → «{norm}» (zoals de startlijst; in de offerte anders geschreven)")
            chapters.append({"code": code, "title": norm or title, "titleRaw": title, "row": r, "sumFormula": G[1]})
            cur = len(chapters) - 1
            last_item_row = None
            continue
        if cur is None or not A:
            continue
        qty, unit, sell = num(C[0]), (D[0] or "").strip(), num(E[0])
        if unit and sell is not None and qty is not None:
            units_raw[unit] += 1
            lines = [x.rstrip() for x in A.split("\n")]
            first = re.sub(r"^postomschrijving:\s*", "", lines[0].strip(), flags=re.I)
            rest = "\n".join(lines[1:]).strip("\n")
            title = first if len(first) <= 160 else first[:157].rstrip() + "…"
            text = rest if len(first) <= 160 else (first + ("\n" + rest if rest else ""))
            if REGIE.search(A):
                title = "Werken in regie (niet besproken in de offerte)"
                text = A.strip()
            kind, cost, sellc, why = price_of(sell, E[1])
            vh = B.upper() == "VH"
            ukey = UNITS.get(unit.lower())
            if ukey is None:
                findings.append(f"r{r}: onbekende eenheid «{unit}»")
            items.append({
                "row": r, "chapter": cur, "title": title, "text": text, "unit": ukey or unit.lower(), "unitRaw": unit,
                "form": form_of(title, text, vh), "vh": vh, "qtyMilli": int(round(qty * 1000)), "price": kind,
                "costCents": cost, "sellCents": sellc, "formula": E[1] or "", "why": why,
                "typedTotal": num(d.get(6, (None, None))[0]), "totalFormula": d.get(6, (None, None))[1] or "",
            })
            last_item_row = r
            continue
        if last_item_row is not None and r == last_item_row + 1:
            items[-1]["text"] = (items[-1]["text"] + "\n" + A).strip("\n")
            last_item_row = r
            continue
        texts.append({"row": r, "chapter": cur, "text": A[:200]})
    # Ontdubbelen: dezelfde titel + tekst + eenheid = één post (de regielijn staat in bijna elk hoofdstuk).
    groups = OrderedDict()
    for it in items:
        k = fold(it["title"]) + "|" + fold(it["text"]) + "|" + it["unit"]
        groups.setdefault(k, []).append(it)
    posts = []
    for k, its in groups.items():
        first = its[0]
        sells = sorted({x["sellCents"] for x in its})
        posts.append({**first, "key": f"{nummer}:r{first['row']}", "occurrences": [x["row"] for x in its], "sellsSeen": sells})
    # Bevindingen voor 0.3 (zonder bedragen in de terminal).
    for it in items:
        if it["totalFormula"] == "" and it["typedTotal"] is not None and abs(it["typedTotal"] * 100 - it["sellCents"] * it["qtyMilli"] / 1000) > 1:
            findings.append(f"r{it['row']}: totaal ingetikt i.p.v. berekend (aantal × prijs klopt niet)")
        if it["price"] == "composite":
            findings.append(f"r{it['row']}: samengestelde prijs {it['formula']} (deel zonder marge: handelswaarde?) → B5")
        if it["price"] == "fixed" and it["formula"]:
            findings.append(f"r{it['row']}: formule zonder /0.8 ({it['formula']}) → vaste verkoopprijs, geen aankoopprijs")
        if it["qtyMilli"] == 0:
            findings.append(f"r{it['row']}: hoeveelheid 0 (prijs zichtbaar, niet meegeteld: optie of PM?) → B14")
    for i, c in enumerate(chapters):
        nxt = chapters[i + 1]["row"] if i + 1 < len(chapters) else None
        m = re.match(r"SUM\(F(\d+):F(\d+)\)", c["sumFormula"].upper())
        if m and nxt and int(m.group(2)) >= nxt:
            findings.append(f"hoofdstuk {c['code']} {c['title']}: som {c['sumFormula']} loopt door in het volgende hoofdstuk (→ 2.5)")
    out = Path(a.uit).expanduser()
    out.mkdir(parents=True, exist_ok=True, mode=0o700)
    safe = nummer.replace("/", "-")
    data = {"bron": "echt", "offerte": nummer, "datum": datum, "bestand": Path(a.xlsx).name,
            "chapters": [{"code": c["code"], "title": c["title"], "order": (i + 1) * 10} for i, c in enumerate(chapters)],
            "posts": posts, "textLines": texts, "units": dict(units_raw), "findings": findings}
    (out / f"posten-{safe}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    forms = Counter(p["form"] for p in posts)
    kinds = Counter(p["price"] for p in posts)
    md = [f"# Postenanalyse offerte {nummer} (VOORLOPIG, ECHTE PRIJZEN — niet in git, niet delen)", "",
          f"Bestand: {Path(a.xlsx).name} · datum {datum} · {len(chapters)} hoofdstukken · {len(items)} prijslijnen → {len(posts)} posten na ontdubbelen · {len(texts)} tekstlijnen", "",
          "## Hoofdstukken (B1)", ""] + [f"- {c['code']} {c['title']}" for c in chapters] + ["",
          "## Eenheden zoals geschreven (B4)", ""] + [f"- {u}: {n}" for u, n in units_raw.most_common()] + ["",
          "## Contractvorm afgeleid uit tekst en VH-vlag (B3)", ""] + [f"- {k}: {n}" for k, n in forms.most_common()] + ["",
          "## Prijsvorm (B5)", ""] + [f"- {k}: {n}" for k, n in kinds.most_common()] + ["",
          "## Posten", "", "| rij | hfst | titel | eenheid | vorm | prijs | aankoop | verkoop | x |", "|---|---|---|---|---|---|---|---|---|"] + [
          f"| {p['row']} | {chapters[p['chapter']]['code']} | {p['title'][:60].replace('|', '/')} | {p['unit']} | {p['form']} | {p['price']} | {eur(p['costCents'])} | {eur(p['sellCents'])} | {len(p['occurrences'])} |"
          for p in posts] + ["", "## Bevindingen", ""] + [f"- {x}" for x in findings]
    (out / f"posten-{safe}.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print(f"offerte {nummer} ({datum}): {len(chapters)} hoofdstukken, {len(items)} prijslijnen → {len(posts)} posten (ontdubbeld), {len(texts)} tekstlijnen")
    print("eenheden:", ", ".join(f"{u} {n}" for u, n in units_raw.most_common()))
    print("contractvorm:", ", ".join(f"{k} {n}" for k, n in forms.most_common()))
    print("prijsvorm:", ", ".join(f"{k} {n}" for k, n in kinds.most_common()))
    print(f"bevindingen: {len(findings)}")
    print(f"→ {out}/posten-{safe}.json en .md (ECHTE prijzen: buiten git houden)")


if __name__ == "__main__":
    main()
