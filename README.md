# Poolehof Bullenauswahl

Filtert Bullenkataloge von **WWS, RBW, Prismagen (STG Germany), Semex und
CRI Genetics** nach Julians Zuchtkriterien – deutsche (RZ-Skala) und
amerikanische (TPI-Skala) Werte nebeneinander. Läuft komplett unabhängig,
ohne Claude: eine kostenlose GitHub Action holt die Daten monatlich neu,
die Web-Seite liegt kostenlos auf GitHub Pages.

**Live:** _(Link kommt hierher, sobald Pages aktiviert ist)_

## Aufbau

## Aktualisieren

Ein Befehl, egal ob lokal oder in der GitHub Action:

```bash
python3 scraper/refresh.py            # alle Quellen
python3 scraper/refresh.py WWS RBW    # nur einzelne
```

`refresh.py` prüft jedes Ergebnis, bevor es die alten Daten ersetzt:

| Prüfung | Wogegen sie schützt |
|---|---|
| Gültiges JSON, Bullen haben Namen | Scraper läuft, liefert aber Müll |
| Mindestanzahl Bullen pro Quelle | Website umgebaut, Tabelle nicht mehr gefunden |
| ≥80 % der Bullen haben einen Gesamtzuchtwert | Website antwortet, aber Felder heißen anders (genau dieser Fall ist bei CRI schon einmal aufgetreten) |
| Kein Einbruch auf <50 % des letzten Standes | Halbe Liste abgeschnitten / Teilausfall |

Fällt eine Quelle durch, bleiben **ihre alten Daten unverändert stehen**
(lieber leicht veraltet als leer), die anderen werden trotzdem
aktualisiert. Der Fehler landet in `docs/data/status.json`, wird in der
Web-App oben als Warnung angezeigt, und die GitHub Action wird rot –
GitHub schickt dann automatisch eine E-Mail an den Repo-Besitzer.

```
scraper/           Python-Skripte, ein Skript pro Firma
  refresh.py            ruft alle Quellen ab + Plausibilitätsprüfung
  scrape_wws.py         curl/requests – kein Login, kein Anti-Bot
  scrape_prismagen.py   curl/requests – holt zusätzlich Strichlänge/Stärke
                        pro Bulle von der Detailseite (DE- und US-Skala)
  scrape_semex.py       curl/requests – semex.com Sire-Directory (US-Skala,
                        der deutsche Katalog ist nur ein Bilder-Flipbook)
  scrape_rbw.py         Playwright (Chromium) – RBW sichert seine
                        Bullen-API mit einem AltCha-Proof-of-Work, der
                        nur im echten Browser gelöst wird
  scrape_cri.py         Playwright (Chromium) – läuft auf demselben
                        "EasyBull"-System wie RBW, liefert zusätzlich
                        Strichlänge/Stärke (RZ-Skala)
  easybull_common.py    gemeinsamer Code für RBW + CRI (beide auf
                        derselben Plattform)

data/               Rohdaten der Scraper (lokale Kopie/Backup)
docs/               Die eigentliche Web-App (GitHub Pages Quelle)
  index.html            liest docs/data/*.json, keine Datenbank nötig
  data/*.json           von der GitHub Action aktuell gehalten

.github/workflows/refresh.yml   die automatische monatliche Aktualisierung
```

## Einmalige Einrichtung (GitHub)

1. Leeres Repository auf github.com anlegen (z.B. `poolehof-bullenauswahl`).
2. In diesem Ordner:
   ```bash
   git remote add origin https://github.com/<DEIN-USERNAME>/<REPO-NAME>.git
   git add -A
   git commit -m "Erste Version"
   git push -u origin main
   ```
3. Auf GitHub: **Settings → Pages** → "Deploy from a branch" → Branch `main`,
   Ordner `/docs` → Speichern. Nach ~1 Minute ist die Seite unter
   `https://<DEIN-USERNAME>.github.io/<REPO-NAME>/` erreichbar.
4. In `docs/index.html` die Zeile mit `renderRefreshLine()` einmal auf
   den echten Repo-Namen anpassen (aktuell ein Platzhalter).
5. Fertig – ab jetzt läuft alles von selbst:
   - **Automatisch:** am 1. jeden Monats aktualisiert die Action alle
     5 Quellen und veröffentlicht die neuen Daten.
   - **Manuell:** GitHub → Reiter "Actions" → "Bullendaten aktualisieren"
     → "Run workflow" – sofort neu abrufen, egal von welchem Gerät.
   - **Ansehen:** Die Pages-URL einfach im Browser öffnen (auch am
     Stall-PC ohne Python/Claude) – Lesezeichen/Startseite setzen.

## Kriterien bearbeiten

Der "Bearbeiten"-Knopf in der App speichert Änderungen nur lokal im
Browser (localStorage) – auf einem anderen Gerät erscheinen wieder die
Standardkriterien, bis sie dort auch angepasst werden.

## Strichlänge & Stärke

Diese beiden Einzelmerkmale stehen bei **keiner** Quelle in der
Übersichtsliste – nur auf der jeweiligen Bull-Detailseite. Deshalb holt
jeder Scraper zusätzlich die Detailseite pro Bulle (ein Aufruf je Bulle,
deshalb dauert ein Durchlauf ein paar Minuten).

| Quelle | Skala | Woher |
|---|---|---|
| RBW | RZ (>100) | Detailseite, Exterieur-Tabelle |
| CRI Genetics | RZ bzw. US, je nach Bulle | Detailseite, Exterieur-Tabelle |
| Prismagen | RZ + US (beide Ansichten) | Detailseite je `?zuchtwerte=de/us` |
| WWS | US-Linear (>0,0) | Detailseite, Linearprofil |
| Semex | US-Linear (>0,0) | Detailseite, "Teat Length" / "Strength" |

Die Skala wird am Betrag erkannt (RZ-Werte liegen um 100, US-Linearwerte
zwischen etwa -5 und +5) und landet im passenden Feld `…_de` bzw. `…_us`.

## Bekannte Lücken

- **Semex:** Der deutsche Katalog ist nur ein gescanntes Bilder-Flipbook
  (kein Text, keine verlässliche Automatik möglich). Die Semex-Bullen
  hier kommen stattdessen vom internationalen semex.com Sire-Directory –
  im Zweifel bei Semex Deutschland nachfragen, ob genau diese Bullen auch
  dort bestellbar sind.
- Bei Semex haben 4 von 54 Bullen (ganz junge genomische) noch kein
  Linearprofil auf der Detailseite – dort steht in der Spalte „–“.
