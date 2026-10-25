#!/usr/bin/env python3
"""Stap 2.5: de ECHTE offerte (Excel van BOWACO) als gegevens lezen voor de rekentest van de app (enkel lokaal).

Leest het blad als GEGEVENS (geen formules uitvoeren, geen macro's; enkel de XML van het xlsx-bestand) en schrijft per
prijslijn het hoofdstuk, de hoeveelheid, de eenheidsprijs (zoals Excel ze bewaarde) en de kolom F (het lijntotaal: formule of
getypt), plus de hoofdstuksommen (kolom G) en het subtotaal, de btw en het totaal van het blad met hun formules.
Uitvoer: <uit>/rekentest-<nummer>.json met ECHTE prijzen: standaard ~/.bowaco/posten, NOOIT in git. Op de terminal enkel
tellingen. Daarna rekent `node tests/rekentest-echt.mjs <json>` dezelfde offerte met de rekenmodule van de app.

    python3 -I tools/rekentest-echt.py <offerte.xlsx> [--uit ~/.bowaco/posten]
"""
import argparse
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("xlsx")
    ap.add_argument("--uit", default=str(Path.home() / ".bowaco" / "posten"))
    a = ap.parse_args()
    rows = load(a.xlsx)
    nummer = None
    for r in sorted(rows):
        if rows[r].get(1, (None, None))[0] == "Nummer":
            nummer = (rows.get(r + 1, {}).get(1, (None, None))[0] or "").strip()
            break
    if not nummer:
        sys.exit("geen offertenummer gevonden (cel 'Nummer')")
    chapters, items, sums = [], [], []
    cur = None
    for r in sorted(rows):
        d = rows[r]
        A = (d.get(1, (None, None))[0] or "").strip()
        C, D, E, F, G = (d.get(i, (None, None)) for i in (3, 4, 5, 6, 7))
        if G[1] and G[1].upper().startswith("SUM(") and re.match(r"^\d\d\s", A):
            chapters.append({"code": A[:2], "title": A[3:].strip(), "row": r, "sumFormula": G[1], "sumValue": num(G[0])})
            cur = len(chapters) - 1
            continue
        # Subtotaal, btw, totaal (en elke andere rekenformule op een rij die geen prijslijn is): enkel ter vergelijking.
        is_item = num(C[0]) is not None and (D[0] or "").strip() != "" and num(E[0]) is not None
        if cur is not None and not is_item:
            for col, cell in ((6, F), (7, G)):
                if cell[1]:
                    sums.append({"row": r, "col": col, "label": A[:60], "formula": cell[1], "value": num(cell[0])})
        if cur is None or not A:
            continue
        qty, unit, price = num(C[0]), (D[0] or "").strip(), num(E[0])
        if unit and price is not None and qty is not None:
            items.append({
                "row": r, "chapter": cur, "qty": qty, "unit": unit, "price": price, "priceFormula": E[1] or "",
                "F": num(F[0]), "FFormula": F[1] or "",
            })
    out = Path(a.uit).expanduser()
    out.mkdir(parents=True, exist_ok=True, mode=0o700)
    safe = nummer.replace("/", "-")
    data = {"bron": "echt", "offerte": nummer, "bestand": Path(a.xlsx).name, "chapters": chapters, "items": items, "sums": sums}
    (out / f"rekentest-{safe}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"offerte {nummer}: {len(chapters)} hoofdstukken, {len(items)} prijslijnen, {len(sums)} somcellen")
    print(f"→ {out}/rekentest-{safe}.json (ECHTE prijzen: buiten git houden)")


if __name__ == "__main__":
    main()
