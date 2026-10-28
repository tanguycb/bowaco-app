#!/usr/bin/env python3 -I
"""Stap 2b.6: kopieert de bronbestanden die de lezers nodig hebben uit de documentenmap (deels enkel in iCloud) naar de
werkmap ~/.bowaco/inrichting/bron (buiten iCloud en buiten git). Leest enkel; wist en verplaatst niets in de
documentenmap. Een bestand dat al gekopieerd is, wordt overgeslagen. Stopt als er minder dan 3 GB vrij is.

  python3 -I tools/inrichting/kopieer-bronnen.py --docs ~/Desktop/Split/bowaco-docs/bowaco
"""
import argparse
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bron  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--docs", required=True)
    a = ap.parse_args()
    root = os.path.join(a.docs, "Bowaco Administratie")
    werk = os.path.join(bron.werkmap(), "bron")
    teller = {"gekopieerd": 0, "al aanwezig": 0, "ontbreekt": 0}

    def kopie(rel, doel, naam):
        os.makedirs(os.path.join(werk, doel), mode=0o700, exist_ok=True)
        dst = os.path.join(werk, doel, naam)
        if os.path.exists(dst) and os.path.getsize(dst) > 0:
            teller["al aanwezig"] += 1
            return
        if shutil.disk_usage(os.path.expanduser("~")).free < 3e9:
            sys.exit("minder dan 3 GB vrij: gestopt")
        src = os.path.join(root, rel)
        if not os.path.exists(src):
            teller["ontbreekt"] += 1
            print(f"  ontbreekt: {naam}")
            return
        shutil.copyfile(src, dst)  # lezen haalt het bestand uit iCloud
        os.chmod(dst, 0o600)
        teller["gekopieerd"] += 1

    for o in bron.lees_index(os.path.join(a.docs, "BOWACO_index_offertes.csv")):
        if o.get("laatste_xlsx") and (o.get("importklasse") or "")[:1] in "123":
            kopie(o["laatste_xlsx"], "offertes", o["offerte_id"] + ".xlsx")
    av, sjabloon = [], []
    for d in bron.lees_index(os.path.join(a.docs, "BOWACO_index_documenten.csv")):
        act, pad = d.get("import_actie") or "", d["pad"]
        naam = os.path.basename(pad).lower()
        ext = os.path.splitext(naam)[1]
        if act.startswith("bron QuoteTerms") and ext == ".docx" and naam.startswith("algemene voorwaarden"):
            av.append(d)
        elif act.startswith("bron invoer met de hand") and naam.startswith("basisofferte") and ext == ".xlsx":
            sjabloon.append(d)
        elif act.startswith("bron prijzen") or "06 Prijzen/Eigen prijzen" in pad:
            kopie(pad, "prijzen", d["doc_id"] + ext)
        elif act.startswith("bron planningsimport"):
            kopie(pad, "planning", "planning.xlsx")
    # Voorwaarden: de volledigste versie (het grootste bestand; een korte samenvatting telt niet); sjabloon: het jongste.
    for lijst, naam, sleutel in ((av, "voorwaarden.docx", lambda x: int(x.get("grootte_bytes") or 0)), (sjabloon, "sjabloon.xlsx", lambda x: x.get("datum") or "")):
        if lijst:
            kopie(max(lijst, key=sleutel)["pad"], "bedrijf", naam)
        else:
            print(f"  geen bron voor {naam}")
    print(" · ".join(f"{k} {v}" for k, v in teller.items()) + f" → {werk}")


if __name__ == "__main__":
    main()
