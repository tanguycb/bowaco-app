#!/usr/bin/env python3 -I
"""Stap 1.5: de planning van Alexis (Excel) omzetten naar een importbestand (plan.json).

Gebruik (python3 -I: de planning is gegevens, nooit code; alleen standaardbibliotheek):
  python3 -I tools/plan-analyse.py PLANNING.xlsx --uit MAP [--besluiten blokken.csv] [--batch NAAM]
         [--status-grens 2026-05-04] [--btw 6]

Schrijft in MAP (NIET in git: bevat echte werfnamen, adressen en firmanamen):
  plan.json   alle blokken, taken, weekcellen (als uitvoerders en afspraken) en alle bevindingen

Het script leest alleen. Regels (architectuur 0.4 §1.1):
  - De KOLOM is de weekas, niet de datum in de kopregel: kolom 4 = maandag 14.10.2024, elke kolom +1 week.
    Elke afwijkende kopdatum komt in de bevindingen; de twee taakrijen met gekopieerde weekdatums worden
    geen werf en geen weekcellen.
  - Een cel met enkel een naam of code = die firma werkt die week. Een cel met naam + datum/tekst = dezelfde
    week, plus een AFSPRAAK (dag + uur) met de tekst. Een cel met enkel een datum of tekst met datum = een
    afspraak. BOUWVERLOF/STOP/congé = een blokkering (geen werk, wel in het rapport).
  - Een firma wordt hier NIET gekoppeld: dat doet de backend met de aliassen uit de OA-database (1.2).
  - BOWACO, ALEXIS, KLANT, VERGUNNING, IEDEREEN, NIET en "?" zijn geen firma: de taak krijgt de tijd, geen uitvoerder.
  - Sleutels zijn afgeleid van een hash (geen echte tekst) en blijven gelijk als rijen verschuiven.
"""
import argparse
import csv
import hashlib
import importlib.util
import json
import re
import sys
from collections import Counter, OrderedDict, defaultdict
from datetime import date, timedelta
from difflib import SequenceMatcher
from pathlib import Path

_spec = importlib.util.spec_from_file_location("oa_analyse", str(Path(__file__).with_name("oa-analyse.py")))
oa = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(oa)

BASE = date(2024, 10, 14)  # maandag van kolom 4 (D): de weekas
FIRST_COL = 4
EPOCH = date(1970, 1, 1)
SYSTEEM = {"BOWACO", "ALEXIS", "ALEX", "KLANT", "VERGUNNING", "IEDEREEN", "NIET", "?"}
BLOKKERING = [(r"^BOUWVERLOF\b", "bouwverlof"), (r"^STOP\b", "stop"), (r"^CONG[ÉE]\b", "congé")]
MAX_RUNS = 8  # Config.maxAssignPerTask
MAX_WORKDAYS = 400  # Config.maxWorkdays
DATE_RX = re.compile(r"(?<![\d/])(\d{1,2})\s*[/.\-]\s*(\d{1,2})(?:\s*[/.\-]\s*(\d{4}|\d{2}))?(?![\d/])")
TIME_RX = re.compile(r"(?<!\d)(\d{1,2})\s*(?:u|h|:)\s*(\d{2})?(?!\d)", re.I)


def monday(col):
    return BASE + timedelta(days=(col - FIRST_COL) * 7)


def day_no(d):
    return (d - EPOCH).days


def h(text):
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def excel_date(v):
    try:
        return date(1899, 12, 30) + timedelta(days=int(float(v)))
    except (ValueError, OverflowError):
        return None


def parse_dates(text, monday_of_week):
    """Alle datums (dd/mm of dd/mm/jjjj) in een tekst, jaar gekozen zo dicht mogelijk bij de week van de cel."""
    out = []
    for m in DATE_RX.finditer(text):
        dd, mm, yy = int(m.group(1)), int(m.group(2)), m.group(3)
        if not (1 <= dd <= 31 and 1 <= mm <= 12):
            continue
        cands = []
        years = [int(yy) + (2000 if len(yy) == 2 else 0)] if yy else [monday_of_week.year - 1, monday_of_week.year, monday_of_week.year + 1]
        for y in years:
            try:
                cands.append(date(y, mm, dd))
            except ValueError:
                pass
        if not cands:
            out.append({"pos": m.start(), "end": m.end(), "date": None})
            continue
        best = min(cands, key=lambda c: abs((c - monday_of_week).days))
        # een jaartal in de tekst dat meer dan ± 13 maanden van de kolom ligt, is geen jaartal ("5-6/05" = 5 en 6 mei)
        if yy and abs((best - monday_of_week).days) > 400:
            out.append({"pos": m.start(), "end": m.end(), "date": None})
            continue
        out.append({"pos": m.start(), "end": m.end(), "date": best})
    return out


def parse_times(text):
    out = []
    for m in TIME_RX.finditer(text):
        hh = int(m.group(1))
        mi = int(m.group(2) or 0)
        if hh > 23 or mi > 59:
            continue
        # "10u" of "7u30" of "7:30"; een los getal zonder u/h/: wordt nooit een uur
        out.append({"pos": m.start(), "end": m.end(), "time": "%d:%02d" % (hh, mi)})
    return out


def clean_text(t):
    return re.sub(r"\s+", " ", (t or "").replace(" ", " ")).strip()


def address_parts(header):
    t = clean_text(header)
    m = re.search(r"(?<!\d)(\d{4})\s+(.+)$", t)
    street, number, zip_, city = t, "", "", ""
    if m:
        zip_ = m.group(1)
        city = m.group(2).strip()
        before = t[: m.start()].strip(" ,-–")
        n = re.search(r"\s(\d+[A-Za-z]?(?:\s*[-–]\s*\d+[A-Za-z]?)?)$", before)
        if n:
            number, street = n.group(1).replace(" ", ""), before[: n.start()].strip(" ,-–")
        else:
            street = before
    else:
        n = re.search(r"\s(\d+[A-Za-z]?)$", t)
        if n:
            number, street = n.group(1), t[: n.start()].strip(" ,-–")
    return street[:80], number[:20], zip_[:20], city[:80]


def street_key(header):
    """Sleutel om twee schrijfwijzen van hetzelfde adres te herkennen: tekst vóór ' - ' of ',', zonder spaties."""
    t = clean_text(header)
    t = re.split(r"\s[-–]\s|,", t)[0]
    return oa.fold(t)


def last_word_suffix(header):
    """'Steendam 60 - 9000 Gent App' → 'app' (een deel van het project achter de plaats)."""
    m = re.search(r"(?<!\d)\d{4}\s+\S+\s+(.+)$", clean_text(header))
    return oa.fold(m.group(1)) if m else ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("planning")
    ap.add_argument("--uit", required=True)
    ap.add_argument("--besluiten", help="CSV (punt-komma) met kolommen BLOK en BESLISSING: nieuw · vervolg van Bnn · deelwerf van Bnn · negeren")
    ap.add_argument("--batch", default="planning-2026-05-08")
    ap.add_argument("--status-grens", default="2026-05-04", help="taken die vóór deze maandag eindigen, krijgen de status klaar")
    ap.add_argument("--btw", type=int, default=6, choices=[6, 21])
    args = ap.parse_args()
    grens = date.fromisoformat(args.status_grens)
    uit = Path(args.uit)
    uit.mkdir(parents=True, exist_ok=True)

    rows = oa.load_sheet(args.planning, "sheet1")
    issues = []  # {blok, rij, kolom, soort, tekst, ernst}

    def issue(blok, rij, kol, soort, tekst, ernst="let op"):
        issues.append({"blok": blok, "rij": rij, "kolom": kol, "soort": soort, "tekst": tekst, "ernst": ernst})

    # ── Blokken en taakrijen ────────────────────────────────────────────────
    blocks = []
    cur = None
    for r in sorted(rows):
        row = rows[r]
        a = clean_text(row.get(1))
        c = clean_text(row.get(3))
        nums = [k for k, v in row.items() if k >= FIRST_COL and oa.is_num(v)]
        if a and not c and len(nums) >= 5:
            cur = {"rij": r, "header": a, "head_cols": {k: excel_date(row[k]) for k in nums}, "rows": []}
            blocks.append(cur)
            continue
        if cur is None:
            continue
        cells = {k: v for k, v in row.items() if k >= FIRST_COL and str(v).strip() != ""}
        if not a and not c and not cells and not clean_text(row.get(2)):
            continue
        if a.startswith("*Betreft") or "levertermijnen" in a.lower() and a.startswith("*"):
            continue
        cur["rows"].append({"rij": r, "taak": a, "notitie": clean_text(row.get(2)), "c": c, "cells": cells})

    # Namen die de planning zelf als naam gebruikt (hele cel of kolom C): om "NAAM tekst" te kunnen splitsen.
    bekend = set()
    for b in blocks:
        for t in b["rows"]:
            for n in oa.split_names(t["c"]):
                if oa.looks_like_name(n) or n in SYSTEEM:
                    bekend.add(n)
            for k, v in t["cells"].items():
                if not oa.is_num(v):
                    for n in oa.split_names(clean_text(v)):
                        if (oa.looks_like_name(n) and len(n) >= 2) or n in SYSTEEM:
                            bekend.add(n)
    bekend |= SYSTEEM

    def split_cell(text):
        """(naam | None, rest) : langste beginstuk van ≤ 3 woorden dat een bekende naam is."""
        words = clean_text(text).split(" ")
        for n in (3, 2, 1):
            if len(words) >= n:
                cand = oa.norm(" ".join(words[:n]))
                if cand in bekend and cand not in {"OF", "EN", "NIET"} or (n == 1 and cand == "NIET" and len(words) == 1):
                    return cand, " ".join(words[n:]).strip()
        return None, clean_text(text)

    out_blocks = []
    stat = Counter()
    blokkeer = defaultdict(set)  # soort → weken (maandag)
    seen_block_keys = Counter()
    for bi, b in enumerate(blocks, 1):
        code = "B%02d" % bi
        bk = "b" + h(oa.fold(b["header"]))[:12]
        seen_block_keys[bk] += 1
        if seen_block_keys[bk] > 1:
            bk += "#%d" % seen_block_keys[bk]
        # Kopdatums controleren tegen de weekas
        afw = []
        for k, d in sorted(b["head_cols"].items()):
            if d is None or d != monday(k):
                afw.append(k)
        if afw:
            runs, start = [], afw[0]
            for i in range(1, len(afw) + 1):
                if i == len(afw) or afw[i] != afw[i - 1] + 1:
                    runs.append((start, afw[i - 1]))
                    if i < len(afw):
                        start = afw[i]
            voorbeeld = b["head_cols"].get(afw[0])
            issue(code, b["rij"], "", "kopdatums", "%d kopdatums wijken af van de weekas (kolommen %s; bv. kolom %d: %s i.p.v. %s). De kolom is gebruikt." % (
                len(afw), ", ".join("%d–%d" % x if x[0] != x[1] else str(x[0]) for x in runs[:6]) + (" …" if len(runs) > 6 else ""),
                afw[0], voorbeeld.strftime("%d.%m.%Y") if voorbeeld and voorbeeld.year > 1950 else "geen geldige datum", monday(afw[0]).strftime("%d.%m.%Y")), "info")
            stat["kopdatums_afwijkend_blokken"] += 1
        weekcols = sorted(b["head_cols"])
        tasks = []
        seen_task_keys = Counter()
        for tr in b["rows"]:
            title = tr["taak"]
            if not title:
                title = "(zonder naam)"
                issue(code, tr["rij"], "A", "taak zonder naam", "taakrij zonder naam; als «(zonder naam)» overgenomen", "let op")
            extra_notes = []
            notitie = tr["notitie"]
            if len(title) > 80:
                extra_notes.append("Volledige titel in de planning: " + title)
                issue(code, tr["rij"], "A", "titel te lang", "titel langer dan 80 tekens ingekort; de volledige titel staat in de notitie", "info")
                title = title[:79].rstrip() + "…"
            numeric = {k: v for k, v in tr["cells"].items() if oa.is_num(v)}
            tekst = {k: clean_text(v) for k, v in tr["cells"].items() if not oa.is_num(v)}
            if len(numeric) >= 5:
                issue(code, tr["rij"], "", "gekopieerde weekdatums", "«%s»: rij met een gekopieerde rij weekdatums (%d cellen); geen weekcellen gelezen" % (title, len(numeric)), "let op")
                stat["gekopieerde_rijen"] += 1
                numeric = {}
            # Verantwoordelijke (kolom C)
            c_names = oa.split_names(tr["c"])
            responsible = None
            uitvoering = []
            for n in c_names:
                if n in SYSTEEM:
                    uitvoering.append(n)
                elif responsible is None:
                    responsible = n
                else:
                    extra_notes.append("Tweede verantwoordelijke in de planning: " + n)
            if tr["c"] and not c_names:
                issue(code, tr["rij"], "C", "onleesbare cel", "kolom C «%s» is niet leesbaar als naam" % tr["c"], "let op")
            # Cellen
            work_cells = []  # (col, naam | None, rest, ruwe tekst)
            appts = []
            vrij = []
            blok_cells = []
            for k in sorted(set(tekst) | set(numeric)):
                wk = monday(k)
                if k in numeric:
                    d = excel_date(numeric[k])
                    if d is None or d.year < 2019 or d.year > 2079:
                        issue(code, tr["rij"], k, "onleesbare cel", "«%s»: datum in cel %s niet leesbaar" % (title, numeric[k]), "let op")
                        stat["onleesbaar"] += 1
                        continue
                    appts.append({"col": k, "idx": 0, "date": d, "time": None, "text": d.strftime("%d/%m/%Y"), "name": None, "week": False})
                    continue
                raw = tekst[k]
                nraw = oa.norm(raw)
                soort = next((s for rx, s in BLOKKERING if re.search(rx, nraw)), None)
                if soort:
                    blokkeer[soort].add(wk)
                    blok_cells.append((k, soort))
                    continue
                dates = parse_dates(raw, wk)
                times = parse_times(raw)
                # naam: ofwel de hele cel (één of meer namen), ofwel een bekend beginstuk
                whole = oa.split_names(raw)
                name, rest = None, raw
                if whole and all((n in bekend) for n in whole) and not dates and not times:
                    for n in whole:
                        work_cells.append((k, n, "", raw))
                    continue
                if not dates and not times and whole and all(oa.looks_like_name(n) for n in whole) and len(raw) <= 30:
                    # een onbekende maar duidelijke naam (komt enkel in deze cel voor): als naam
                    for n in whole:
                        work_cells.append((k, n, "", raw))
                    continue
                name, rest = split_cell(raw)
                if name is not None:
                    # wat overblijft na het weghalen van datum en uur is een opmerking bij de week; de datum zit in de afspraak
                    rest = DATE_RX.sub(" ", rest)
                    rest = TIME_RX.sub(" ", rest)
                    rest = clean_text(re.sub(r"(^|\s)(en|om|op|-|–)(?=\s|$)", " ", rest)).strip(" -–,;()!")
                    work_cells.append((k, name, rest, raw))
                if dates or times:
                    if any(x["date"] is None for x in dates):
                        issue(code, tr["rij"], k, "onleesbare cel", "«%s»: «%s» bevat een onmogelijke datum" % (title, raw), "let op")
                        stat["onleesbaar"] += 1
                    ok = [x for x in dates if x["date"] is not None]
                    if ok:
                        for i, dt in enumerate(ok):
                            nxt = ok[i + 1]["pos"] if i + 1 < len(ok) else len(raw)
                            after = [x for x in times if x["pos"] >= dt["end"] and x["pos"] < nxt]
                            before = [x for x in times if x["end"] <= dt["pos"]] if i == 0 else []
                            tm = (after or before or [None])[0]
                            if abs((dt["date"] - wk).days) > 7 + 6 and abs((dt["date"] - wk).days - 3) > 10:
                                issue(code, tr["rij"], k, "datum buiten de week", "«%s»: datum %s ligt %d dagen van de week van de cel (%s)" % (title, dt["date"].strftime("%d/%m/%Y"), abs((dt["date"] - wk).days), wk.strftime("%d.%m")), "info")
                            appts.append({"col": k, "idx": i, "date": dt["date"], "time": tm["time"] if tm else None, "text": raw, "name": name, "week": False})
                    elif not ok:
                        vrij.append((k, raw))  # niets verloren laten gaan: de tekst komt in de notitie van de taak
                    elif times and name is None:
                        # uur zonder datum: vangnet = de maandag van de week
                        appts.append({"col": k, "idx": 0, "date": wk, "time": times[0]["time"], "text": raw, "name": name, "week": True})
                        issue(code, tr["rij"], k, "afspraak zonder datum", "«%s»: «%s» heeft een uur maar geen datum; maandag van de week als vangnet" % (title, raw), "info")
                    continue
                if name is None:
                    vrij.append((k, raw))
            # Weken van werk → start, duur, uitvoerders
            work_cols = sorted({c[0] for c in work_cells})
            appt_cols = sorted({a["col"] for a in appts})
            zonder_week = False
            if work_cols:
                c0, c1 = work_cols[0], work_cols[-1]
            elif appt_cols:
                c0, c1 = appt_cols[0], appt_cols[0]
                issue(code, tr["rij"], "", "afspraak zonder werkweek", "«%s»: enkel een afspraak (geen naam in een weekcel); de taak duurt de week van de afspraak" % title, "info")
            else:
                zonder_week = True
                c0 = c1 = (weekcols[0] if weekcols else FIRST_COL)
                issue(code, tr["rij"], "", "taak zonder week", "«%s»: geen enkele weekcel; staat in de eerste week van het blok met 1 werkdag, graag een week kiezen" % title, "let op")
                stat["zonder_week"] += 1
            workdays = (c1 - c0 + 1) * 5
            if zonder_week:
                workdays = 1
            if workdays > MAX_WORKDAYS:
                issue(code, tr["rij"], "", "te lang", "«%s»: %d weken; ingekort tot %d werkdagen" % (title, c1 - c0 + 1, MAX_WORKDAYS), "let op")
                workdays = MAX_WORKDAYS
            # Reeksen per firma (aaneensluitende weken), met de celtekst als notitie
            per = OrderedDict()
            for (k, n, rest, raw) in work_cells:
                if n in SYSTEEM:
                    if n not in uitvoering:
                        uitvoering.append(n)
                    continue
                per.setdefault(n, []).append((k, rest))
            runs = []
            for n, cs in per.items():
                cs.sort()
                grp = [cs[0]]
                for x in cs[1:]:
                    if x[0] == grp[-1][0] + 1:
                        grp.append(x)
                    else:
                        runs.append((n, grp))
                        grp = [x]
                runs.append((n, grp))
            if len(runs) > MAX_RUNS:
                issue(code, tr["rij"], "", "veel reeksen", "«%s»: %d reeksen per firma/week; samengevoegd per firma tot één bereik" % (title, len(runs)), "info")
                merged = []
                for n, cs in per.items():
                    cs.sort()
                    merged.append((n, cs))
                runs = merged
                if len(runs) > MAX_RUNS:
                    issue(code, tr["rij"], "", "te veel firma's", "«%s»: %d firma's; enkel de eerste %d zijn overgenomen" % (title, len(runs), MAX_RUNS), "let op")
                    runs = runs[:MAX_RUNS]
            tk_base = "t" + h(oa.fold(title) + "|" + str(oa.fold(tr["c"])))[:10]
            seen_task_keys[tk_base] += 1
            tkey = bk + "/" + tk_base + ("#%d" % seen_task_keys[tk_base] if seen_task_keys[tk_base] > 1 else "")
            jsruns = []
            for n, cs in runs:
                notes = []
                for k, rest in cs:
                    if rest:
                        notes.append("wk %s: %s" % (monday(k).strftime("%d.%m"), rest))
                jsruns.append({"key": tkey + "/a:" + h(n)[:6] + ":" + str(cs[0][0]), "name": n, "col0": cs[0][0], "col1": cs[-1][0],
                               "from": day_no(monday(cs[0][0])), "to": day_no(monday(cs[-1][0]) + timedelta(days=4)), "note": " · ".join(notes)[:1000]})
            jsappts = []
            for a in appts:
                jsappts.append({"key": tkey + "/p:c%d.%d" % (a["col"], a["idx"]), "col": a["col"], "day": day_no(a["date"]), "date": a["date"].isoformat(), "time": a["time"], "text": a["text"][:1000], "name": a["name"], "weekFallback": a["week"]})
            # Notitie
            notes = []
            if notitie:
                notes.append(notitie)
            notes.extend(extra_notes)
            non_bowaco = [u for u in uitvoering if u != "BOWACO"]
            if non_bowaco:
                notes.append("Uitvoering volgens de planning: " + ", ".join(non_bowaco))
            for k, raw in vrij:
                notes.append("wk %s: %s" % (monday(k).strftime("%d.%m"), raw))
                issue(code, tr["rij"], k, "vrije tekst", "«%s»: tekst zonder naam of datum «%s» in de notitie gezet" % (title, raw), "info")
                stat["vrije_tekst"] += 1
            for k, soort in blok_cells:
                notes.append("wk %s: %s" % (monday(k).strftime("%d.%m"), soort.upper()))
            if responsible is None and not uitvoering and not tr["c"]:
                if work_cols:
                    issue(code, tr["rij"], "C", "geen verantwoordelijke", "«%s»: week ingevuld maar geen verantwoordelijke" % title, "info")
            if responsible and responsible not in per and per:
                issue(code, tr["rij"], "C", "verantwoordelijke werkt niet", "«%s»: verantwoordelijke %s staat niet in de weekcellen (daar: %s)" % (title, responsible, ", ".join(per)), "info")
                stat["verantwoordelijke_verschilt"] += 1
            eind = monday(c1) + timedelta(days=4)
            klaar = (not zonder_week) and eind < grens
            tasks.append({
                "key": tkey, "rij": tr["rij"], "title": title, "note": "\n".join(notes)[:1000], "responsible": responsible,
                "status": "done" if klaar else "planned", "percent": 100 if klaar else 0,
                "start": day_no(monday(c0)), "workdays": workdays, "week0": monday(c0).isoformat(), "week1": monday(c1).isoformat(),
                "runs": jsruns, "appointments": jsappts, "uitvoering": uitvoering,
                "extra": [("planning-rij", str(tr["rij"]))] + ([("uitvoering", ",".join(uitvoering))] if uitvoering else []) + ([("zonder-week", "ja")] if zonder_week else []),
            })
            stat["taken"] += 1
            stat["runs"] += len(jsruns)
            stat["afspraken"] += len(jsappts)
            stat["weekcellen"] += len(work_cells)
        sdate = min((t["week0"] for t in tasks), default="")
        edate = max((t["week1"] for t in tasks), default="")
        street, number, zip_, city = address_parts(b["header"])
        out_blocks.append({
            "code": code, "key": bk, "rij": b["rij"], "header": b["header"], "name": clean_text(b["header"])[:80],
            "street": street, "number": number, "zip": zip_, "city": city, "vatBp": args.btw * 100,
            "tasks": tasks, "van": sdate, "tot": edate,
            "streetKey": street_key(b["header"]), "suffix": last_word_suffix(b["header"]),
        })
        stat["blokken"] += 1

    # ── Voorstel per blok: nieuwe werf, vervolg of deelwerf ─────────────────
    for i, blk in enumerate(out_blocks):
        blk["voorstel"] = {"beslissing": "nieuw", "doel": None, "zekerheid": "", "reden": ""}
        for j in range(i):
            other = out_blocks[j]
            if other["voorstel"]["beslissing"] != "nieuw":
                continue
            ka, kb = blk["streetKey"], other["streetKey"]
            if not ka or not kb:
                continue
            if oa.fold(blk["header"]) == oa.fold(other["header"]):
                blk["voorstel"] = {"beslissing": "vervolg", "doel": other["code"], "zekerheid": "zeker", "reden": "dezelfde naam en hetzelfde adres als %s" % other["code"]}
            elif ka == kb and blk["suffix"] and other["suffix"] and blk["suffix"] != other["suffix"]:
                blk["voorstel"] = {"beslissing": "deelwerf", "doel": other["code"], "zekerheid": "vermoedelijk", "reden": "zelfde adres als %s, ander deel van het project («%s» ↔ «%s»)" % (other["code"], blk["suffix"], other["suffix"])}
            elif ka == kb:
                blk["voorstel"] = {"beslissing": "vervolg", "doel": other["code"], "zekerheid": "zeker", "reden": "zelfde adres als %s" % other["code"]}
            elif (ka.startswith(kb) or kb.startswith(ka)) and min(len(ka), len(kb)) >= 6:
                blk["voorstel"] = {"beslissing": "vervolg", "doel": other["code"], "zekerheid": "vermoedelijk", "reden": "adres begint hetzelfde als %s" % other["code"]}
            elif SequenceMatcher(None, re.sub(r"\d", "", ka), re.sub(r"\d", "", kb)).ratio() >= 0.9 and len(ka) >= 8:
                blk["voorstel"] = {"beslissing": "vervolg", "doel": other["code"], "zekerheid": "vermoedelijk", "reden": "bijna dezelfde straatnaam als %s (spelling?)" % other["code"]}
            if blk["voorstel"]["beslissing"] != "nieuw":
                break

    # ── Beslissingen (optioneel): de eigenaar of Alexis vult BESLISSING in ──
    besl = {}
    if args.besluiten:
        txt = Path(args.besluiten).read_text(encoding="utf-8-sig")
        for r in csv.DictReader(txt.splitlines(), delimiter=";"):
            if r.get("BLOK") and (r.get("BESLISSING") or "").strip():
                besl[r["BLOK"].strip()] = r["BESLISSING"].strip()
    by_code = {b["code"]: b for b in out_blocks}
    for blk in out_blocks:
        v = blk["voorstel"]
        wens = besl.get(blk["code"])
        # standaard: enkel een ZEKER voorstel wordt gevolgd; vermoedelijke blijven een nieuwe werf tot iemand beslist
        d, doel, bron = ("nieuw", None, "standaard")
        if v["beslissing"] != "nieuw" and v["zekerheid"] == "zeker":
            d, doel, bron = v["beslissing"], v["doel"], "voorstel"
        if wens:
            low = wens.lower()
            m = re.match(r"(vervolg|deelwerf) van (B\d+)$", wens.strip(), re.I)
            if low == "nieuw":
                d, doel, bron = "nieuw", None, "beslissing"
            elif low == "negeren":
                d, doel, bron = "negeren", None, "beslissing"
            elif m and m.group(2).upper() in by_code and m.group(2).upper() != blk["code"]:
                d, doel, bron = m.group(1).lower(), m.group(2).upper(), "beslissing"
            else:
                issue(blk["code"], blk["rij"], "", "beslissing onbekend", "BESLISSING «%s» niet begrepen: voorstel gevolgd" % wens, "let op")
        blk["besluit"] = {"beslissing": d, "doel": doel, "bron": bron}
    for blk in out_blocks:
        t = blk["besluit"]["doel"]
        if t and out_blocks.index(by_code[t]) >= out_blocks.index(blk):
            issue(blk["code"], blk["rij"], "", "beslissing onbekend", "doel %s ligt niet vóór dit blok: nieuwe werf" % t, "let op")
            blk["besluit"] = {"beslissing": "nieuw", "doel": None, "bron": "standaard"}

    plan = {
        "bron": Path(args.planning).name, "batch": args.batch, "titel": "Planning Alexis " + Path(args.planning).name[:8],
        "statusGrens": grens.isoformat(), "blokken": out_blocks, "bevindingen": issues,
        "blokkeringen": {k: sorted(x.isoformat() for x in v) for k, v in blokkeer.items()},
        "telling": dict(stat),
    }
    (uit / "plan.json").write_text(json.dumps(plan, ensure_ascii=False, indent=1), encoding="utf-8")
    n_taken = sum(len(b["tasks"]) for b in out_blocks)
    print("blokken %d · taken %d · uitvoerreeksen %d · afspraken %d · bevindingen %d" % (len(out_blocks), n_taken, stat["runs"], stat["afspraken"], len(issues)))
    print("voorstel: %s" % dict(Counter(b["voorstel"]["beslissing"] + "/" + (b["voorstel"]["zekerheid"] or "-") for b in out_blocks)))
    print("besluit : %s" % dict(Counter(b["besluit"]["beslissing"] for b in out_blocks)))
    print("blokkeringen (weken): %s" % {k: len(v) for k, v in blokkeer.items()})
    print("geschreven: %s" % (uit / "plan.json"))


if __name__ == "__main__":
    main()
