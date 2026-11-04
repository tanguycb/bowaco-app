#!/usr/bin/env python3 -I
"""Stap 2c.9 (stap 8): ÉÉN werf volledig, voor de demo. Maakt uit de indexen van 0.3 het plan stap8-werf-<code>.json:
de werf (code, adres, status), de firma's die in de documenten van die werf voorkomen, de offerte(s) van de werf (met de
offerte-lezer van stap 4) en ALLE documenten van de werf, elk met een documentsoort en een document in het dossier.

  python3 -I tools/inrichting/lees-werf.py --docs ~/Desktop/Split/bowaco-docs/bowaco --werf W-091 [--bron test]

Leest enkel in de documentenmap (ook wat enkel in iCloud staat: lezen haalt het binnen). Kopieën en omgezette foto's komen
in ~/.bowaco/inrichting/werf/<code>/ (buiten git en buiten iCloud); het plan in ~/.bowaco/inrichting/plan.

Regels (voorlopige keuzes, nog na te kijken):
  - ALLE rijen van de documenten-index met deze werf (de werfmap, ook dubbels en oudere versies in "99", en de facturen
    en offertes die de index aan de werf koppelt). Een dubbel krijgt een eigen document "(dubbel of oudere versie)";
  - NOOIT: een bestand dat de index gevoelig noemt, of waarvan pad of inhoud (Word, Excel, Outlook) op personeelszaken,
    lonen, rijksregister- of identiteitsgegevens of medische gegevens wijst. Die komen apart in het verslag (geweerd);
  - foto's (HEIC, JPEG, PNG) worden zoals in de app een JPEG van hoogstens 1600 px zonder EXIF (geen GPS-locatie, §8.5);
  - documentsoort per categorie van de index; een map "postinterventiedossier" = PID. Een document per (soort, map), met
    hoogstens 50 bestanden (Config.maxFilesPerDoc): daarboven "(deel 2)" enz.;
  - groter dan 25 MB (Config.maxFileBytes) of een soort die de app niet aanvaardt: niet opgeladen, in het verslag;
  - firma's: de aankoopfacturen van de werf en de firma's uit de firma-index waarvan de naam in een pad van de werf staat;
    een map "Offerte OA/<vak>/<firma>" geeft een onderaannemer met dat vak. Geen personen, geen contactgegevens;
  - de klant: geen naam (privacy). Een plaatshouder "Opdrachtgever <code>" met het werfadres, nog na te kijken;
  - offerte: de laatste Excel van elke offerte van de werf (geen variant zoals "raming") als ONTWERP (versie 1), zodat
    prijsvraag, OA-offertes, overnemen, versturen en aanvaarden in de app nagespeeld kunnen worden.
"""
import argparse
import collections
import hashlib
import importlib.util
import os
import re
import shutil
import subprocess
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bron  # noqa: E402

_spec = importlib.util.spec_from_file_location("offerte_lezer", os.path.join(os.path.dirname(os.path.abspath(__file__)), "offerte-lezer.py"))
lezer = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(lezer)

MAX_BYTES = 25_000_000  # Config.maxFileBytes
MAX_PER_DOC = 50  # Config.maxFilesPerDoc
FOTO = {".heic", ".heif", ".jpg", ".jpeg", ".png", ".webp"}
MIME = {
    ".pdf": "application/pdf",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".xls": "application/vnd.ms-excel",
    ".doc": "application/msword",
    ".msg": "application/vnd.ms-outlook",
    ".dwg": "application/acad",
}
# (categorie van de index → documentsoort, label van het document). De eerste treffer wint.
SOORTEN = [
    ("foto", "fotos", "Foto's"),
    ("planning", "andere", "Planning"),
    ("plan", "plannen", "Plannen"),
    ("min-meer", "min-meer", "Min-meerstaat"),
    ("offerte oa", "oa-offerte", "Offerte OA"),
    ("werfverslag", "andere", "Werfverslag"),
    ("oplevering", "pv-voorlopige-oplevering", "Oplevering"),
    ("factuur", "factuur-klant", "Factuur aan de klant"),
    ("aankoopfactuur", "oa-factuur", "Aankoopfactuur"),
    ("offerte", "andere", "Offerte aan de klant"),
]
# Soorten die de app nog niet kent: stap 8 maakt ze (setDocKind), enkel als ze ontbreken.
NIEUWE_SOORTEN = [
    {"key": "fotos", "name": "Foto's van de werf", "rule": "optioneel", "deliverer": "bowaco", "oaVisible": False, "confidential": False},
    {"key": "factuur-klant", "name": "Factuur aan de klant (historiek)", "rule": "optioneel", "deliverer": "bowaco", "oaVisible": False, "confidential": True},
]
VERTROUWELIJK = {"oa-offerte", "oa-factuur", "contract", "factuur-klant"}
GEVOELIG = re.compile(r"\b(loon|lonen|loonbrief|loonfiche|loonbrieven|payslip|personeel|personeelsdossier|rijksregister\w*|insz|identiteitskaart|id kaart|eid kaart|"
                      r"medisch\w*|arbeidsongeschikt\w*|ziektebriefje|doktersattest|dimona|sociaal secretariaat|c4|sollicitatie|arbeidscontract|arbeidsovereenkomst)\b")
RRN = re.compile(r"\b\d{2}\.\d{2}\.\d{2}-\d{3}\.\d{2}\b")
VORMEN = re.compile(r"\b(bv|bvba|nv|vof|cv|commv|srl|sa|sprl|bvba|vzw)\b")


def gevoelig_pad(pad):
    return GEVOELIG.search(bron.fold(pad))


def gevoelige_inhoud(pad, ext):
    """Een eenvoudige blik in Word, Excel en Outlook (pdf en foto's niet: zie het verslag)."""
    try:
        if ext in (".docx", ".xlsx", ".pptx"):
            z = zipfile.ZipFile(pad)
            tekst = " ".join(z.read(n).decode("utf-8", "ignore") for n in z.namelist() if n.endswith(".xml") and ("word/" in n or "sharedStrings" in n or "slides/" in n))
        elif ext == ".msg":
            b = open(pad, "rb").read()
            tekst = b.decode("utf-16-le", "ignore") + " " + b.decode("latin-1", "ignore")
        else:
            return None
    except Exception:
        return None
    tekst = re.sub(r"<[^>]+>", " ", tekst)
    if RRN.search(tekst):
        return "een rijksregisternummer in de inhoud"
    m = re.search(r"\b(rijksregister\w*|insz|loonfiche|loonbrief|identiteitskaart)\b", bron.fold(tekst))
    return f"«{m.group(1)}» in de inhoud" if m else None


def strip_jpeg(data):
    """Enkel APP0 (JFIF) en APP2 (ICC) blijven: EXIF/XMP (APP1, met GPS), IPTC (APP13), commentaar weg."""
    if data[:2] != b"\xff\xd8":
        return data
    out, i = bytearray(b"\xff\xd8"), 2
    while i + 4 <= len(data):
        if data[i] != 0xFF:
            break
        m = data[i + 1]
        if m == 0xDA:  # begin van de beelddata: de rest ongewijzigd
            out += data[i:]
            return bytes(out)
        n = int.from_bytes(data[i + 2:i + 4], "big")
        if m in (0xE0, 0xE2) or not (0xE1 <= m <= 0xEF or m == 0xFE):
            out += data[i:i + 2 + n]
        i += 2 + n
    return bytes(out) if len(out) > 2 else data


def oriëntatie(pad):
    try:
        uit = subprocess.run(["sips", "-g", "orientation", pad], capture_output=True, text=True, timeout=60).stdout
        m = re.search(r"orientation:\s*(\d+)", uit)
        return int(m.group(1)) if m else 1
    except Exception:
        return 1


def naar_jpeg(src, dst):
    """Zoals de app (Werven.tsx shrinkPhoto): JPEG, langste zijde ≤ 1600 px, kwaliteit 82 %, zonder EXIF. Een EXIF-draaiing
    wordt eerst in de pixels gezet (anders staat de foto na het weghalen van EXIF scheef)."""
    tmp = dst + ".tmp.jpg"
    r = subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "82", "-Z", "1600", src, "--out", tmp], capture_output=True, text=True, timeout=120)
    if r.returncode != 0 or not os.path.exists(tmp):
        raise RuntimeError("omzetten mislukt")
    graden = {3: 180, 6: 90, 8: 270}.get(oriëntatie(tmp))
    if graden:
        subprocess.run(["sips", "-r", str(graden), tmp], capture_output=True, timeout=120)
    data = strip_jpeg(open(tmp, "rb").read())
    os.remove(tmp)
    with open(dst, "wb") as fh:
        fh.write(data)
    os.chmod(dst, 0o600)


def sha256(pad):
    h = hashlib.sha256()
    with open(pad, "rb") as fh:
        for b in iter(lambda: fh.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def soort_van(categorie, rel):
    if "postinterventiedossier" in bron.fold(rel):
        return "pid", "PID"
    c = bron.fold(categorie)
    for pat, kind, label in SOORTEN:
        if c.startswith(bron.fold(pat)):
            return kind, label
    return "andere", "Ander document"


def map_titel(rel_map):
    """'03. Foto's/20240220_Storten beton' → "20240220 Storten beton": zonder nummering en zonder de eerste map (die is de soort)."""
    delen = [re.sub(r"^\d{1,2}[._]\s*", "", d).replace("_", " ").strip() for d in rel_map.split("/") if d]
    return " / ".join(d for d in delen[1:] if d)


def kern(naam):
    """Firmanaam zonder rechtsvorm, zonder spaties: 'Proef Projects BV' → 'proefprojects'."""
    return VORMEN.sub(" ", bron.fold(naam)).replace(" ", "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--docs", required=True)
    ap.add_argument("--werf", required=True)
    ap.add_argument("--uit")
    ap.add_argument("--bron", default="echt", choices=["echt", "test"])
    a = ap.parse_args()
    if a.bron == "test" and not os.path.exists(os.path.join(a.docs, "VERZONNEN-PROEFMAP")):
        sys.exit("--bron test enkel voor een verzonnen proefmap (merkbestand VERZONNEN-PROEFMAP ontbreekt)")
    code = a.werf.strip().upper()
    root = os.path.join(a.docs, "Bowaco Administratie")
    werk = os.path.join(bron.werkmap(), "werf", code)
    for d in ("bron", "app"):
        os.makedirs(os.path.join(werk, d), mode=0o700, exist_ok=True)

    w = next((x for x in bron.lees_index(os.path.join(a.docs, "BOWACO_index_werven.csv")) if x["werf_id"] == code), None)
    if not w:
        sys.exit(f"werf {code} niet in de werf-index")
    straat, nr, pc, gem = (w.get(k, "").strip() for k in ("straat", "nr", "postcode", "gemeente"))
    titel = lambda s: s if not s.isupper() else s.title()  # noqa: E731
    werf = {"code": code, "naam": (f"{titel(straat)} {nr}".strip() + (f", {titel(gem)}" if gem else ""))[:80],
            "adres": {"street": titel(straat)[:80], "number": nr[:20], "zip": pc[:20], "city": titel(gem)[:80], "country": "BE"},
            "vatBp": 600, "map": w.get("map", ""), "status": "request",
            "nakijken": f"werf voor de demo (stap 8): alle documenten van de werfmap; adres uit de mapnaam; btw 6 % voorlopig; status «aanvraag» zodat offerte → oplevering nagespeeld kan worden (laatste datum in de map {w.get('laatste_datum_in_map', '?')})"}

    # ── Documenten ─────────────────────────────────────────────────────────
    rijen = [d for d in bron.lees_index(os.path.join(a.docs, "BOWACO_index_documenten.csv")) if d.get("werf_id") == code]
    bestanden, geweerd, fouten = [], [], []
    tel = collections.Counter()
    for d in sorted(rijen, key=lambda x: x["doc_id"]):
        pad = d["pad"]
        ext = os.path.splitext(pad)[1].lower()
        naam = os.path.basename(pad)
        i = pad.find((w.get("map") or "\0") + "/")
        rel = pad[i + len(w["map"]) + 1:] if i >= 0 else ""
        dubbel = (d.get("import_actie") or "").startswith("niet: dubbel") or pad.startswith("99 ")
        if (d.get("gevoelig") or "nee") != "nee":
            geweerd.append({"doc": d["doc_id"], "reden": f"gevoelig volgens de index ({d.get('gevoelig')})"})
            continue
        if gevoelig_pad(pad):
            geweerd.append({"doc": d["doc_id"], "reden": "naam of map wijst op personeelszaken of persoonsgegevens"})
            continue
        src = os.path.join(root, pad)
        kopie = os.path.join(werk, "bron", d["doc_id"] + ext)
        try:
            if not (os.path.exists(kopie) and os.path.getsize(kopie) > 0):
                if shutil.disk_usage(os.path.expanduser("~")).free < 3e9:
                    sys.exit("minder dan 3 GB vrij: gestopt")
                shutil.copyfile(src, kopie)  # lezen haalt het bestand uit iCloud; de documentenmap blijft ongewijzigd
                os.chmod(kopie, 0o600)
                tel["gekopieerd"] += 1
            else:
                tel["al gekopieerd"] += 1
        except OSError as e:
            fouten.append({"doc": d["doc_id"], "reden": f"niet te lezen ({type(e).__name__})"})
            continue
        inhoud = gevoelige_inhoud(kopie, ext)
        if inhoud:
            geweerd.append({"doc": d["doc_id"], "reden": inhoud})
            continue
        kind, label = soort_van(d.get("categorie") or "", rel)
        if ext in FOTO:
            appnaam = re.sub(r"\.[^.]+$", "", naam) + ".jpg"
            app = os.path.join(werk, "app", d["doc_id"] + ".jpg")
            mime = "image/jpeg"
            try:
                if not (os.path.exists(app) and os.path.getsize(app) > 0):
                    naar_jpeg(kopie, app)
                    tel["foto omgezet"] += 1
            except Exception as e:
                fouten.append({"doc": d["doc_id"], "reden": f"foto niet om te zetten ({e})"})
                continue
        else:
            appnaam, app, mime = naam, kopie, MIME.get(ext)
        grootte = os.path.getsize(app)
        reden = None
        if not mime:
            reden = f"soort {ext or '(geen)'} niet toegelaten in de app"
        elif grootte > MAX_BYTES:
            reden = f"te groot ({grootte / 1e6:.1f} MB > 25 MB)"
        mtitel = map_titel(os.path.dirname(rel)) if rel else ""
        dtitel = (label + (" " + mtitel if mtitel and kind != "pid" else (" – " + mtitel if mtitel else ""))).strip()
        if dubbel:
            dtitel += " (dubbel of oudere versie)"
        bestanden.append({"doc": d["doc_id"], "naam": appnaam[:200], "bronNaam": naam, "pad": pad, "categorie": d.get("categorie") or "", "soort": kind,
                          "documentTitel": dtitel, "vertrouwelijk": kind in VERTROUWELIJK, "mime": mime or "", "bytes": grootte, "bronBytes": int(d.get("grootte_bytes") or 0),
                          "sha256": sha256(app), "bestand": app, "omgezet": app != kopie, "dubbel": dubbel, "nietOpladen": reden,
                          "inWerfmap": bool(rel)})
    # Een document per (soort, titel); boven 50 bestanden "(deel n)". Vaste volgorde (doc_id) = dezelfde verdeling bij elke run.
    groepen = collections.OrderedDict()
    for b in bestanden:
        if not b["nietOpladen"]:
            groepen.setdefault((b["soort"], b["documentTitel"]), []).append(b)
    for (kind, t), lijst in groepen.items():
        for k, b in enumerate(lijst):
            deel = k // MAX_PER_DOC
            titel_d = t if len(lijst) <= MAX_PER_DOC else f"{t} (deel {deel + 1})"
            b["documentTitel"] = titel_d[:80]
    for b in bestanden:
        b["documentTitel"] = b["documentTitel"][:80]

    # ── Firma's ────────────────────────────────────────────────────────────
    firmas = {f["firma_id"]: f for f in bron.lees_index(os.path.join(a.docs, "BOWACO_index_firmas.csv"))}
    aankoop = [x for x in bron.lees_index(os.path.join(a.docs, "BOWACO_index_aankoop.csv")) if x.get("werf_id") == code]
    paden = [bron.fold(r["pad"]).replace(" ", "") for r in rijen]
    gevonden = collections.OrderedDict()
    for x in aankoop:
        if x.get("firma_id") in firmas:
            gevonden.setdefault(x["firma_id"], "aankoopfactuur van de werf")
    for fid, f in firmas.items():
        if (f.get("bron") or "").startswith("OA-lijst"):
            continue
        for n in [f.get("naam") or ""] + [s for s in re.split(r"[|;]", f.get("schrijfwijzen") or "") if s.strip()]:
            k = kern(lezer_firmanaam(n))
            if len(k) >= 5 and any(k in p for p in paden):
                gevonden.setdefault(fid, "naam in de documenten van de werf")
                break
    soort_firma = {"OA": "subcontractor", "firma": "subcontractor", "leverancier": "supplier", "nutsbedrijf": "authority", "overheid": "authority", "verzekering": "other"}
    frijen, fniet = [], []
    # Dezelfde firma meer dan eens in de firma-index (andere schrijfwijze of een KBO uit een factuur): de rij met de meeste
    # facturen blijft, de andere gaan niet naar de app (anders een KBO-conflict in importOrgs).
    beste = {}
    for fid in gevonden:
        k = kern(lezer_firmanaam(firmas[fid].get("naam") or ""))
        if k not in beste or int(firmas[fid].get("aantal_facturen") or 0) > int(firmas[beste[k]].get("aantal_facturen") or 0):
            beste[k] = fid
    for fid, waarom in gevonden.items():
        f = firmas[fid]
        if beste.get(kern(lezer_firmanaam(f.get("naam") or ""))) != fid:
            fniet.append({"firma": fid, "reden": f"zelfde firma als {beste[kern(lezer_firmanaam(f.get('naam') or ''))]} (andere rij in de firma-index)"})
            continue
        s = (f.get("soort") or "").strip()
        naam = lezer_firmanaam((f.get("naam") or "").strip())
        if s not in soort_firma or not naam or re.match(r"^(re|fw|fwd)\s*:", naam, re.I):
            fniet.append({"firma": fid, "reden": f"soort «{s or '?'}» (geen firma voor de app)"})
            continue
        kbo = re.sub(r"\D", "", f.get("kbo") or "") or None
        frijen.append({"key": fid, "kind": soort_firma[s], "name": naam[:80], "kbo": kbo, "aliases": [], "trades": [],
                       "notes": f"Nog na te kijken: uit de documenten van werf {code} ({waarom}); soort «{s}» uit de firma-index."})
    # Een map "Offerte OA/<vak>/<firma>": een onderaannemer met dat vak (enkel als die naam nog niet gevonden is).
    bekend = {kern(r["name"]) for r in frijen}
    for b in bestanden:
        if b["soort"] != "oa-offerte" or not b["inWerfmap"]:
            continue
        i = b["pad"].find(w["map"] + "/")
        delen = [x for x in b["pad"][i + len(w["map"]) + 1:].split("/")[:-1]]
        if len(delen) >= 3:
            vak, firma = delen[1].strip(), delen[2].strip()
            if kern(firma) and kern(firma) not in bekend and not any(kern(firma) in kern(r["name"]) or kern(r["name"]) in kern(firma) for r in frijen):
                bekend.add(kern(firma))
                frijen.append({"key": f"{code}:oa:{kern(firma)[:30]}", "kind": "subcontractor", "name": firma[:80], "kbo": None, "aliases": [], "trades": [],
                               "notes": f"Nog na te kijken: map van een OA-offerte in werf {code}, vak «{vak}» (vakgebied nog te kiezen); geen ondernemingsnummer bekend."})
    klant = {"name": f"Opdrachtgever {code}"[:80], "notes": f"Nog na te kijken: plaatshouder voor de klant van werf {code} (de naam staat niet in de indexen; privacy). Adres = het werfadres."}

    # ── Offerte(s) ─────────────────────────────────────────────────────────
    offertes, nietOfferte = [], []
    for o in bron.lees_index(os.path.join(a.docs, "BOWACO_index_offertes.csv")):
        if o.get("werf_id") != code:
            continue
        if o.get("variant") or not o.get("laatste_xlsx") or (o.get("importklasse") or "")[:1] not in "12":
            nietOfferte.append({"offerte": o["offerte_id"], "reden": "variant (" + o["variant"] + ")" if o.get("variant") else "geen leesbare Excel (klasse " + (o.get("importklasse") or "?") + ")"})
            continue
        kop = os.path.join(werk, "bron", o["offerte_id"] + ".xlsx")
        if not os.path.exists(kop):
            shutil.copyfile(os.path.join(root, o["laatste_xlsx"]), kop)
            os.chmod(kop, 0o600)
        res = lezer.lees(kop)
        if not res or not res["lijnen"]:
            nietOfferte.append({"offerte": o["offerte_id"], "reden": "geen prijslijnen gevonden"})
            continue
        hoofdstukken, lijnen, overgeslagen = [], [], 0
        for l in res["lijnen"]:
            eerste = re.sub(r"^postomschrijving:\s*", "", l["tekst"].split("\n")[0].strip(), flags=re.I)
            nrm = re.match(r"^(\d+(?:\.\d+)*\.?[a-z]?\.?)\s*(?=[^\W\d_])", eerste)
            if nrm and "." in nrm.group(1):
                eerste = eerste[nrm.end():]
            if lezer.SKIP.search(l["tekst"]) or l["qty"] < 0 or l["prijs"] < 0 or not eerste:
                overgeslagen += 1
                continue
            h = (l["hoofdstuk"] or "Zonder hoofdstuk in de Excel (nog na te kijken)").strip()[:120]
            if h not in hoofdstukken:
                hoofdstukken.append(h)
            kost, marge, uitleg = lezer.prijsvorm(l)
            lijnen.append({"hoofdstuk": h, "subgroep": (l.get("subgroep") or "")[:80], "titel": eerste[:160].strip(), "tekst": l["tekst"][:4000] if "\n" in l["tekst"] else "",
                           "qtyMilli": round(l["qty"] * 1000), "eenheid": bron.eenheid(l["eenheid"]) or "st", "vorm": lezer.contractvorm(l, l["hoofdstuk"]),
                           "kostCents": kost, "margeBp": marge, "verkoopCents": round(l["prijs"] * 100), "prijsvorm": uitleg})
        offertes.append({"id": o["offerte_id"], "nummer": (o.get("nummer_in_cel") or o["offerte_id"][2:].replace("-", "/", 1)).strip(), "dag": (o.get("datum_laatste") or "")[:10],
                         "totaalIndexCents": round(float(o["totaal_excl_btw"]) * 100) if bron.getal(o.get("totaal_excl_btw")) is not None else None,
                         "hoofdstukken": hoofdstukken, "lijnen": lijnen, "overgeslagen": overgeslagen + res.get("onvolledig", 0)})

    plan = {"bron": a.bron, "stap": 8, "gemaakt": bron.vandaag(), "werf": werf, "klant": klant, "firmas": {"rijen": frijen, "nietInDeApp": fniet},
            "soorten": NIEUWE_SOORTEN, "offertes": offertes, "nietAlsOfferte": nietOfferte, "bestanden": bestanden, "geweerd": geweerd, "fouten": fouten,
            "telling": {"indexrijen": len(rijen), "inWerfmap": sum(1 for b in bestanden if b["inWerfmap"]) + 0, **tel}}
    p = bron.schrijf_plan(a.uit or f"stap8-werf-{code}.json", plan)
    op = [b for b in bestanden if not b["nietOpladen"]]
    print(f"werf {code}: indexrijen {len(rijen)} · bestanden {len(bestanden)} (op te laden {len(op)}, {sum(b['bytes'] for b in op) / 1e6:.1f} MB; niet {len(bestanden) - len(op)}) · "
          f"geweerd {len(geweerd)} · fouten {len(fouten)} · documenten {len({(b['soort'], b['documentTitel']) for b in op})} · firma's {len(frijen)} · offertes {len(offertes)} ({sum(len(o['lijnen']) for o in offertes)} lijnen)")
    print(f"plan: {p}")


def lezer_firmanaam(naam):
    """Zoals lees-firmas.py: een bestandsnaam van een factuur ("20260303 FIRMA - 5600000001.PDF") → de firmanaam."""
    if re.search(r"\.pdf$", naam, re.I) or re.match(r"^\d{8}\s", naam):
        naam = re.sub(r"\.pdf$", "", re.sub(r"^\d{8}\s+", "", naam), flags=re.I)
        naam = naam.split(" - ")[0].strip()
    return naam


if __name__ == "__main__":
    main()
