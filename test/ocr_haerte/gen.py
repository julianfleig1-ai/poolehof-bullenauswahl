import random, json, os
out = os.path.dirname(os.path.abspath(__file__))
random.seed(42)
# Härtetest der Screenshot-Erkennung – NUR erfundene Kühe. Erzeugt Lely-ähnliche Tabellen in
# verschiedenen Schriften/Größen/Skalierungen; lauf.py fotografiert sie und prüft das Ergebnis.
# Herde: 450 Tiere mit realistischen, teils fast fortlaufenden Ohrmarken (erfunden)
herde = set()
for basis in [817429300, 817648130, 817856110, 818111770, 818111800, 818377020, 818377100, 819005500]:
    for k in range(random.randint(30, 70)): herde.add(f"0{basis + k}")
while len(herde) < 450: herde.add(f"08{random.randint(10000000, 19999999)}")
herde = sorted(herde)
open(f"{out}/netrind.csv", "w").write("Ohrmarke;M-kg;RZS;stl;RZD;RZR;stä\n" + "\n".join(f"DE {h[:2]} {h[2:5]} {h[5:]};{random.randint(-600,900)};{random.randint(80,125)};{random.randint(80,120)};{random.randint(80,120)};{random.randint(80,120)};{random.randint(80,120)}" for h in herde))
varianten = []
fonts = ["Arial", "Verdana", "Tahoma", "Helvetica", "Trebuchet MS", "Segoe UI, Arial"]
for vi, (font, size, dsf, zeilen, kopf, mark) in enumerate([
    ("Arial", 13, 1, 74, True, True), ("Verdana", 12, 1, 74, True, False), ("Tahoma", 13, 1.25, 50, True, True),
    ("Helvetica", 14, 1.5, 40, True, True), ("Trebuchet MS", 13, 1, 60, True, False), ("Arial", 12, 1.25, 74, True, True),
    ("Segoe UI, Arial", 13, 1.5, 30, True, False), ("Arial", 13, 1, 30, False, True)]):
    tiere = random.sample(herde, zeilen - 2) + [f"08{random.randint(20000000,29999999)}" for _ in range(2)]   # 2 nicht in der Herde
    nrs = []
    pool = [1, 7, 11, 17, 71, 111, 117, 171, 177, 711, 1111, 1017, 101, 110, 4, 8, 88, 808, 1001]
    for i in range(zeilen):
        nrs.append(str(pool[i]) if i < len(pool) and vi % 2 == 0 else str(random.randint(1, 1499)))
    random.shuffle(nrs)
    html = f'''<!doctype html><meta charset="utf-8"><style>
body{{margin:0;background:#e9eef5;font-family:{font};font-size:{size}px;color:#222}}
.kopf{{display:flex;justify-content:space-between;padding:8px 12px;font-size:{size+5}px}} .kopf small{{font-size:{size-1}px;align-self:center}}
table{{border-collapse:collapse;margin:0 8px;background:#f6f8fb}} th{{font-weight:normal;font-size:{size-1}px;color:#444;text-align:left;padding:3px 8px;vertical-align:bottom}}
td{{padding:2px 8px;white-space:nowrap}} td.r{{text-align:right}} tr:nth-child(even) td{{background:#eef2f7}} tr.sel td{{background:#a9c0e3}}
.cb{{display:inline-block;width:11px;height:11px;border:1px solid #6b8bb5;border-radius:2px;background:#fff;font-size:10px;line-height:11px;text-align:center;color:#2a5}}
.rot{{background:#c8102e!important;color:#fff}}</style>'''
    if kopf: html += f'<div class="kopf"><span>Kopie von Offene Kühe Reproduktion</span><small>Gesamt: {zeilen} Datensätze</small></div>'
    html += '<table>'
    if kopf: html += '<tr><th></th><th>Kuhnummer</th><th>Lakt.-Nr.</th><th>Laktationstage</th><th>Gruppe</th><th>Reproduktionsstatus</th><th>Tage seit Brunst</th><th>Datum letzte Brunst</th><th>Tagesmilchproduktion (24h) Mw.</th><th>SZZ Angabe</th><th>Lebensnummer</th></tr>'
    soll = []
    for i in range(zeilen):
        sel = mark and random.random() < 0.3
        szz = random.randint(8, 2500); st = random.choice(["Offen", "Offen", "Offen im Zyklus"])
        tage = str(random.randint(0, 48)) if st != "Offen" else ""
        html += f'<tr class="{"sel" if sel else ""}"><td><span class="cb">{"✓" if sel else ""}</span></td><td>{nrs[i]}</td><td class="r">{random.randint(1,6)}</td><td class="r">{random.randint(1,200)}</td><td>{random.choice(["Milchkühe","Milchkühe","Trockensteher","Kälbermilchkühe"])}</td><td>{st}</td><td class="r">{tage}</td><td>{"%02d.%02d.2026" % (random.randint(1,28), random.choice([9,10])) if tage else ""}</td><td class="r">{random.uniform(4,62):.1f}</td><td class="r {"rot" if szz>500 else ""}">{szz}</td><td>DE {tiere[i]}</td></tr>'
        soll.append({"nr": nrs[i], "key": tiere[i], "inHerde": tiere[i] in herde})
    html += '</table>'
    open(f"{out}/v{vi}.html", "w").write(html)
    varianten.append({"id": vi, "font": font, "size": size, "dsf": dsf, "zeilen": zeilen, "kopf": kopf, "mark": mark, "soll": soll})
# V7: zweiter Ausschnitt DERSELBEN Tabelle wie V0 (gleiche Spaltenbreiten), weiter unten, ohne Kopfzeile
h = open(f"{out}/v0.html").read().replace('<div class="kopf">', '<div class="kopf" style="display:none">', 1)
teile = h.split("<tr"); neu = teile[0]
for i, t in enumerate(teile[1:]): neu += "<tr" + ((' style="visibility:collapse"' + t) if i <= 40 else t)
open(f"{out}/v7.html", "w").write(neu)
varianten[7] = {**varianten[0], "id": 7, "kopf": False, "zeilen": 33, "soll": varianten[0]["soll"][40:]}
json.dump(varianten, open(f"{out}/varianten.json", "w"))
print(len(herde), "Tiere,", len(varianten), "Varianten")
