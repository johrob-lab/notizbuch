# Notizbuch

Notizbuch ist eine Web-App (PWA) zum Schreiben mit dem Apple Pencil am iPad. Sie lässt sich zum Home-Bildschirm hinzufügen und startet auch ohne Netz. Die Daten liegen nicht auf einem fremden Server, sondern in einem privaten GitHub-Repo, auf das die App mit einem persönlichen Zugriffstoken zugreift. Dieses Repo enthält nur den Code, keine Notizen.

## Befehle

Voraussetzung ist Node.js 22. Einmalig `npm install`, danach:

| Befehl | Was passiert |
| --- | --- |
| `npm run dev` | Entwicklungsserver starten |
| `npm run build` | App bauen (Ordner `dist`) |
| `npm run preview` | gebaute App lokal ansehen |
| `npm test` | Unit-Tests mit Vitest |
| `npm run e2e` | Ende-zu-Ende-Tests mit Playwright (baut die App vorher selbst) |

## Veröffentlichung

Bei jedem Push auf `main` baut GitHub Actions die App und veröffentlicht sie mit GitHub Pages unter dem Pfad `/notizbuch/`.

## Testkopie

Bevor das Notizbuch das echte Vault anfasst, läuft es gegen ein privates Test-Repo mit erfundenen Daten (`johrob-lab/2-gehirn-test`). Wie der Probebetrieb abläuft, steht in [docs/probebetrieb.md](docs/probebetrieb.md). Die beiden Skripte hier brauchen Node.js 22. Alles, was sie erzeugen oder hochladen, ist erfunden: keine echten Notizen, keine Namen von Personen oder Firmen, keine Token.

### Test-Repo füllen

`node scripts/seed-test-vault.mjs` lädt die Dateien aus `tests/fixtures/vault/` in das Test-Repo. Dafür ist kein `npm install` nötig.

1. Zuerst ein Probelauf: `node scripts/seed-test-vault.mjs --dry-run` listet auf, was hochgeladen würde. GitHub wird dabei nicht gefragt, ein Token ist nicht nötig.
2. Einen Token bereithalten: ein fine-grained Token nur für das Test-Repo mit „Contents: Read and write“ (Schritte in [docs/probebetrieb.md](docs/probebetrieb.md), Abschnitt 1.2). Gib ihn so ein, dass er nicht im Verlauf der Eingabeaufforderung landet:
   - macOS und Linux: `read -rs GITHUB_TOKEN && export GITHUB_TOKEN`, dann den Token einfügen und Enter drücken (er bleibt unsichtbar).
   - Windows PowerShell: `$env:GITHUB_TOKEN = Read-Host "Token"` (die Eingabe bleibt dabei sichtbar, der Token landet aber nicht im Verlauf)
3. Hochladen: `node scripts/seed-test-vault.mjs`

| Angabe | Bedeutung |
| --- | --- |
| `GITHUB_TOKEN` | Pflicht, außer bei `--dry-run`. Das Skript gibt den Token nie aus. |
| `REPO` | Das Ziel als `besitzer/name`. Standard ist `johrob-lab/2-gehirn-test`. Der Name muss auf `-test` enden, sonst bricht das Skript ab: Das echte Vault wird nie beschrieben. |
| `--dry-run` | Nur auflisten, nichts hochladen. |
| `--force` | Vorhandene Dateien überschreiben. Ohne den Schalter werden sie übersprungen. |

Das Skript schreibt in den Standardzweig des Repos, die App liest und schreibt immer `main`. Beides passt zusammen, solange der Standardzweig `main` heißt (bei neuen Repos ist das so).

### Beispielseiten erzeugen

`node scripts/make-samples.mjs <Ausgabeordner>` schreibt sechs erfundene Seiten als SVG, so wie die App sie speichert. Dafür ist einmal `npm install` nötig. Im Ausgabeordner entstehen drei Unterordner:

- `lauf1/` Tagesseite, Besprechung über zwei Seiten und Woche, Stand 29.10.2026 abends
- `monat/` Monatsseite Oktober 2026
- `lauf3-nachtrag/` dieselbe Tagesseite, am Nachmittag weitergeschrieben (der Anfang bleibt Strich für Strich gleich)

Darin liegen die Dateien so, wie sie im Vault liegen (`07 Anhänge/Notizbuch/2026/…`). Jeder Lauf ergibt dieselben Dateien. Sie gehören nur in eine Testkopie, nie in das echte Vault.

## Ordner

- `src/` Code der App
- `tests/` Unit-Tests (`unit`), Ende-zu-Ende-Tests (`e2e`) und der erfundene Mini-Vault für Tests und Testkopie (`fixtures/vault`)
- `scripts/` Skripte für die Testkopie (Test-Repo füllen, Beispielseiten erzeugen)
- `docs/probebetrieb.md` Anleitung für den Probebetrieb
- `docs/reference/` Stift-Test als Vorlage für die Tinte
