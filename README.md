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

## Ordner

- `src/` Code der App
- `tests/` Unit-Tests (`unit`) und Ende-zu-Ende-Tests (`e2e`)
- `docs/reference/` Stift-Test als Vorlage für die Tinte
