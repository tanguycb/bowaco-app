#!/usr/bin/env python3
"""Genereert tests/rollen-hervat.mjs uit tests/rollen.mjs (stap 2b.4).

Voor een draft waarop de rollentest halverwege afbrak (netwerkfout; een tweede volledige run kan niet, P-A bestaat al):
de kop (lijn 1 t/m vóór R1) en de hulpfuncties blijven letterlijk die van rollen.mjs, de gegevens van de eerste helft
worden op de draft opgezocht, en de controles lopen verder vanaf het toewijzen van «tegels». Opnieuw genereren na elke
wijziging aan rollen.mjs:   python3 tools/maak-hervat.py
"""
import re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
L = (root / "tests/rollen.mjs").read_text().split("\n")
cut = next(i for i, l in enumerate(L) if 'const tgA = byKey(pA, "tegels").assignments[0];' in l)
r1 = next(i for i, l in enumerate(L) if 'await sec("── R1 anoniem' in l)
head, tail = L[:r1], L[cut:]

def decl(name, after=130):
    for i, l in enumerate(L[:cut]):
        if re.match(r"^const " + name + r"\b", l) and i > after:
            j, txt = i, l
            bal = lambda t: t.count("(") + t.count("{") + t.count("[") - t.count(")") - t.count("}") - t.count("]")
            while (bal(txt) > 0 or not re.search(r";\s*(//.*)?$", txt.rstrip())) and j + 1 < len(L):
                j += 1
                txt += "\n" + L[j]
            return txt
    raise SystemExit(f"declaratie {name} niet gevonden")

pure = "INTERN org invite redeem mk ids eq cert blob oaFilter orgIn12 pIn find row dayOf wd fmt tIn plan byKey START".split()
headtxt = "\n".join(head)
pre = ["", "// ── Hervatten: hulpfuncties uit rollen.mjs (letterlijk) ──"] + [decl(n, 0 if n == "INTERN" else 130) for n in pure if not re.search(r"^(const|let|function) " + n + r"\b", headtxt, re.M)]
mid = '''
// ── Gegevens van de afgebroken run, opgezocht op de draft (er wordt niets opnieuw aangemaakt) ──
const ame = await admin.me();
const adminId = ame.person[0].id;
const wlId = (await wl.me()).person[0].id;
const oaDakId = (await oa2.me()).person[0].id;
const allOrgs = await admin.listOrgs(false);
const orgBy = (n) => { const o = allOrgs.find((x) => x.name === n); if (!o) throw new Error(`hervatten: firma ${n} niet gevonden`); return { ok: o }; };
const orgX = orgBy("Proef Tegels BV");
const orgY = orgBy("Proef Dak NV");
const orgArch = orgBy("Proef Architecten");
const orgKlant = orgBy("Familie Proef");
const orgElek = orgBy("Proef Elektro BV");
const worksAll = await admin.listWorks();
const A = worksAll.find((w) => w.code === "P-A").id;
const B = worksAll.find((w) => w.code === "P-B").id;
const tpls = await calc.listTemplates();
const std = tpls.find((t) => t.key === "standaardrenovatie");
const invAdmRow = (await admin.listInvites(0n, 500n)).find((i) => i.personName === "Code van admin");
const invAdm = { ok: { inviteId: invAdmRow ? invAdmRow.id : 0n } };
let pA = await plan(wl);
'''
banner = '''// Rollentest HERVAT (stap 2b.4): gegenereerd door tools/maak-hervat.py uit tests/rollen.mjs. Voor een draft waarop de rollentest
// halverwege afbrak: de gegevens van de eerste helft worden opgezocht en de controles lopen verder vanaf het toewijzen van «tegels».
// Alleen met GECLAIMD=1 op een draft; draait NIET opnieuw wat al gebeurd is.
'''
(root / "tests/rollen-hervat.mjs").write_text(banner + "\n".join(head + pre) + mid + "\n" + "\n".join(tail))
print("tests/rollen-hervat.mjs geschreven:", len(head), "kop,", len(tail), "staart")
