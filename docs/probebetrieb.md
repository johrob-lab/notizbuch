# Probebetrieb

Diese Anleitung führt dich durch den Probebetrieb des Notizbuchs. Zuerst übst du an einer Testkopie mit erfundenen Daten. Danach schreibst du 1 bis 2 Wochen im echten Alltag, und GoodNotes läuft dabei parallel weiter. Am Ende entscheidest du, ob GoodNotes wegfällt.

Du brauchst keine Vorkenntnisse. Jeder Schritt sagt, was du antippst und was danach zu sehen sein muss. Sieht etwas anders aus, hilft der letzte Abschnitt „Wenn etwas schiefgeht“.

## Diese Wörter kommen vor

- **Vault**: dein Notizordner mit allen Notizen. Seine Dateien liegen im Repo `johrob-lab/2-gehirn`. Das ist das echte Vault.
- **Repo** (Repository): ein Ordner auf GitHub. Er hält alle Dateien und merkt sich jeden früheren Stand.
- **Test-Repo**: das Repo `johrob-lab/2-gehirn-test`. Dort liegen nur erfundene Daten.
- **Routine**: ein Ablauf, den die KI zu festen Zeiten von selbst erledigt, zum Beispiel das Morgenbriefing am Morgen und der Abendüberblick am Abend.
- **Token**: ein langer Schlüssel aus Buchstaben und Ziffern, mit dem sich die App bei GitHub ausweist. Wer ihn hat, kann in das Repo schreiben. Gib ihn nie weiter und schreib ihn in keine Notiz.
- **Commit**: ein gespeicherter Stand im Verlauf eines Repos, mit Uhrzeit und Kurztext. Jede Änderung der App wird ein Commit, zum Beispiel `Notizbuch: 2026-10-29.md (iPad)`.
- **Abgleich**: Die App schickt deine Änderungen zu GitHub und holt Änderungen von anderen Geräten. Oben in der Leiste zeigt ein Feld den Stand: **Gesichert**, **Wartet auf Netz · 1 Änderung** (oder mehrere) oder **Zugang erneuern**.
- **Briefing**: der Überblick am Morgen (Termine, offene Punkte, Mails), den eine Routine in die Tagesnotiz schreibt. Die App zeigt ihn in der Karte **Morgenbriefing**.

## 1. Testkopie einrichten

Das machst du einmal, es dauert etwa eine halbe Stunde. Die Testkopie ist ein eigenes, privates Repo. Was du darin ausprobierst, bleibt von deinem echten Vault getrennt.

### 1.1 Prüfen, ob das Test-Repo gefüllt ist

1. Öffne github.com und melde dich an.
2. Öffne das Repo `johrob-lab/2-gehirn-test`.
3. Du siehst die Ordner `02 Projekte`, `04 Ressourcen` und `05 Daily Notes`. Dann ist alles bereit.

Ist das Repo leer, füllst du es zuerst mit den erfundenen Testdaten. Die Schritte stehen in der [README](../README.md) im Abschnitt „Testkopie“. Danach geht es hier weiter.

### 1.2 Token für das Test-Repo anlegen

Mit diesem Token darf die App in das Test-Repo schreiben, und nur dorthin. Lege ihn am besten direkt an dem Gerät an, auf dem du ihn brauchst. Dann kannst du ihn kopieren und in der App einfügen.

1. Öffne github.com und melde dich an.
2. Tippe oben rechts auf dein Profilbild und dann auf **Settings**.
3. Scrolle in der linken Spalte ganz nach unten und tippe auf **Developer settings**.
4. Tippe auf **Personal access tokens** und dann auf **Fine-grained tokens**.
5. Tippe auf **Generate new token**.
6. Trage bei **Token name** `Notizbuch Test` ein.
7. Wähle bei **Expiration** den Eintrag **Custom** und ein Datum in einem Jahr. Merk dir das Datum, die App fragt gleich danach.
8. Wähle bei **Resource owner** den Eintrag `johrob-lab`.
9. Wähle bei **Repository access** den Eintrag **Only select repositories** und dann nur `johrob-lab/2-gehirn-test`. Das echte Vault `2-gehirn` wählst du hier nicht.
10. Öffne **Permissions** (bei manchen Ansichten heißt der Knopf **Add permissions**), suche bei **Repository permissions** den Eintrag **Contents** und stelle **Access** auf **Read and write**. Alles andere bleibt, wie es ist. (**Metadata: Read-only** setzt GitHub von selbst, das ist richtig.)
11. Tippe unten auf **Generate token** und bestätige im Fenster noch einmal mit **Generate token**.
12. Tippe auf das Kopier-Symbol neben dem Token. Er beginnt mit `github_pat_`. GitHub zeigt ihn nur dieses eine Mal.

Der Token bleibt in der Zwischenablage, bis du ihn gleich in die App einfügst. Schreib ihn nirgends auf.

### 1.3 Notizbuch am iPad einrichten

1. Öffne die Adresse der App in Safari. Du findest sie bei GitHub im Repo `notizbuch` unter **Settings → Pages**.
2. Tippe auf das Teilen-Symbol (Quadrat mit Pfeil nach oben), dann auf **Zum Home-Bildschirm** und auf **Hinzufügen**. Gibt es den Schalter **Als Web-App öffnen**, lass ihn eingeschaltet.
3. Schließe Safari und öffne das Notizbuch über das neue Symbol auf dem Home-Bildschirm. Richte es dort ein und nicht in Safari. Beide haben getrennte Speicher, die App sähe deine Eingaben aus Safari nicht.
4. Es erscheint **Notizbuch einrichten**. Tippe in das Feld **Token**, halte den Finger kurz darauf und tippe auf **Einsetzen**.
5. Wähle bei **Repository** den Eintrag `johrob-lab/2-gehirn-test`. Vorgewählt ist `johrob-lab/2-gehirn`, das echte Vault. Prüfe das zweimal.
6. Bei **Gerät** bleibt **iPad** stehen.
7. Bei **Gültig bis** steht ein Datum in einem Jahr. Stelle das Datum ein, das du beim Token gewählt hast.
8. Tippe auf **Prüfen und speichern**. Die App fragt GitHub, ob der Token ins Repo schreiben darf. Nach ein paar Sekunden öffnet sich die Seite von heute.

Erwartet: Oben in der Leiste stehen **Heute**, die Ansichten **Monat**, **Woche** und **Tag** und rechts das Feld **Gesichert**.

### 1.4 Erster Test: Briefing und Haken

Das Test-Repo hat nur für den 29.10.2026 ein Briefing. Diesen Tag öffnest du so:

1. Tippe oben auf **Monat**.
2. Tippe am rechten Rand auf den Reiter **OKT**.
3. Tippe mit dem Finger oben in das Feld mit der 29, dorthin, wo die Tageszahl steht. Mit dem Stift geht das nicht, der Stift schreibt nur.
4. Du siehst die Tagesseite mit der Karte **Morgenbriefing**. Tippe auf das Kästchen vor **Urlaube im Plan nachziehen**. Der Haken erscheint sofort.
5. Oben steht sofort **Gesichert**. Bei GitHub ist der Haken da, sobald du die App verlässt (am PC: sobald du auf einen anderen Tab wechselst oder den Browser minimierst), sonst nach etwa 10 Sekunden.
6. Öffne bei GitHub das Test-Repo und tippe über der Dateiliste auf **Commits** (die Zahl neben dem Uhr-Symbol). Der oberste Commit heißt `Notizbuch: 2026-10-29.md (iPad)`. Tippe darauf: Aus `- [ ]` wurde `- [x]`.

Klappt das, ist die Testkopie bereit.

## 2. Checkliste

Diese sieben Punkte gehören zum Probebetrieb. Mach die Punkte 1 bis 5 zuerst in der Testkopie. Im Alltag danach machst du jeden Punkt mindestens einmal auch im echten Vault. Die Punkte 6 und 7 gehen nur im echten Vault, weil die Routinen (Morgenbriefing und Abendüberblick) dort laufen.

Setz bei jedem Punkt den Haken, wenn alles so war wie unter „Erwartet“. Wenn nicht, schreib dir auf, was du getan und was du gesehen hast (mehr dazu im letzten Abschnitt).

### 2.1 Ein normaler Tag mit Briefing und Haken

Wo: Testkopie, iPad. Dauer: etwa 10 Minuten.

1. Öffne den 29.10.2026 (Schritte in 1.4).
2. Sieh dir die Karte **Morgenbriefing** an. Sie zeigt Termine heute, Offene Punkte und Mails. Der Abschnitt **Morgenbriefing (automatisch)** ist aufgeklappt. Tippe auf die Überschrift **Abendüberblick (automatisch)**: Der Abschnitt klappt auf. Tippe noch einmal darauf: Er klappt zu.
3. Tippe auf das Kästchen vor **Liste Planobjekte ergänzen**. Der Haken erscheint sofort. Tippe noch einmal darauf: Er geht wieder weg. Tippe ein drittes Mal: Er ist wieder da. Im echten Vault hakst du später nur ab, was wirklich erledigt ist.
4. Tippe am Ende einer Zeile auf das kleine Stift-Symbol. Ändere ein Wort und tippe auf **Speichern**.
5. Tippe unten in der Karte in das Feld **Ergänzen**, schreib „Probe“ und tippe auf **Hinzufügen**. Der Schalter **Aufgabe** ist an, es entsteht also eine Aufgabe mit Kästchen. Sie steht im neuen Abschnitt **Ergänzungen**.
6. Oben steht sofort **Gesichert**. Bei GitHub sind deine Änderungen da, sobald du die App verlässt (am PC: sobald du auf einen anderen Tab wechselst oder den Browser minimierst), sonst etwa 10 Sekunden nach der letzten Änderung.
7. Öffne bei GitHub im Test-Repo die Datei `05 Daily Notes/2026-10-29.md`. Die Haken stehen als `[x]` da, deine Ergänzung unter `## Ergänzungen`, und die Markierungen zwischen `%%` am Zeilenende sind noch da.

Erwartet: Jeder Haken zeigt sich sofort. Oben steht sofort **Gesichert**. Bei GitHub gibt es Commits wie `Notizbuch: 2026-10-29.md (iPad)`.

- [ ] Klappt

### 2.2 Eine Besprechung über zwei Seiten

Wo: Testkopie, iPad mit Stift. Dauer: etwa 15 Minuten.

1. Öffne den 29.10.2026. In der Karte **Besprechungen** steht der Termin **08:00 Abstimmung Beispiel 2027**.
2. Tippe auf den Termin. Die App legt die Besprechung an und öffnet ihre erste Seite. Über der Schreibfläche stehen die Kopfdaten **Thema**, **Datum**, **Zeit**, **Ort** und **Projekt**, daneben **Seite 1 von 1**, **+ Seite** und **Seite löschen**.
3. Wähle bei **Projekt** den Eintrag **Beispielprojekt A**.
4. Schreib mit dem Stift ein paar Zeilen. Schreib eine Zeile mit der Farbe **Rot (offen)** und eine mit **Grün (erledigt)**. Im echten Vault macht die Abendroutine daraus Aufgaben.
5. Tippe auf **+ Seite**. Seite 2 geht auf (**Seite 2 von 2**), die Kopfdaten sind übernommen. Schreib wieder ein paar Zeilen.
6. Tippe oben in der Leiste auf **‹**. Seite 1 ist da, mit allen deinen Strichen. Tippe auf **›**: Seite 2 ist wieder da.
7. Tippe oben auf **Tag**. Die Karte **Besprechungen** zeigt jetzt **Besprechung · 2 Seiten**.
8. Öffne bei GitHub im Test-Repo den Ordner `07 Anhänge/Notizbuch/2026`. Dort liegen `2026-10-29 0800 Abstimmung Beispiel 2027 S1.svg` und `2026-10-29 0800 Abstimmung Beispiel 2027 S2.svg`, sobald du die App verlassen hast, sonst 2 Minuten nach dem letzten Strich (der Wechsel zur Tagesseite in Schritt 7 lädt noch nichts hoch). GitHub zeigt eine SVG-Datei als Bild, du erkennst deine Schrift.
9. Probiere zum Schluss das Löschen (nur in der Testkopie): Öffne Seite 2 und tippe auf **Seite löschen**. Es erscheint die Frage „Seite wirklich löschen?“. Tippe auf **Abbrechen**: Es passiert nichts. Tippe noch einmal auf **Seite löschen** und diesmal auf **Löschen**: Seite 2 verschwindet, Seite 1 geht auf.

Besprechungen ohne Termin legst du in der Karte **Besprechungen** mit **+ Besprechung** an: Trage Thema und Zeit ein und tippe auf **Anlegen**.

Erwartet: Zwei Seiten, jede mit ihren Strichen, die Kopfdaten auf beiden gleich, die Dateien bei GitHub. Gelöscht wird nur nach der Frage und nur mit **Löschen**.

- [ ] Klappt

### 2.3 Offline schreiben (Flugmodus) und danach abgleichen

Wo: Testkopie, iPad. Dauer: etwa 10 Minuten. Flugmodus heißt: Das iPad ist ohne Netz, die App muss dann alles selbst behalten.

1. Öffne den 29.10.2026 und warte, bis **Gesichert** dasteht.
2. Schalte den Flugmodus ein: iPad **Einstellungen → Flugmodus** (oder im Kontrollzentrum das Flugzeug-Symbol, das du mit einem Wisch vom oberen rechten Rand nach unten öffnest).
3. Geh zurück in die App. Schreib mit dem Stift in **Notizen**, hake einen Punkt ab und ergänze einen Eintrag im Feld **Ergänzen**. Oben steht jetzt **Wartet auf Netz** mit einer Zahl.
4. Beende die App ganz: Wische vom unteren Rand nach oben, halte kurz und wische die App nach oben weg.
5. Öffne die App wieder. Der Flugmodus bleibt an. Alle Striche, der Haken und die Ergänzung sind da, oben steht noch **Wartet auf Netz**.
6. Schalte den Flugmodus aus. Nach einigen Sekunden, spätestens nach 3 Minuten, steht **Gesichert** da.
7. Prüfe bei GitHub unter **Commits**: Es gibt neue Commits für `2026-10-29 Tag.svg` und `2026-10-29.md`.

Erwartet: Nichts geht verloren, auch nicht durch das Beenden der App. Sobald das Netz da ist, gleicht die App von selbst ab.

- [ ] Klappt

### 2.4 Dieselbe Notiz in Obsidian und in der App ändern

Wo: Testkopie, iPad und ein PC. Dauer: etwa 15 Minuten. In der Testkopie ersetzt die Bearbeiten-Funktion von github.com die Notiz-App Obsidian. Im echten Vault änderst du die Notiz in Obsidian und lädst sie mit dem Git-Plugin hoch.

**Teil A: Verschiedene Zeilen**

1. Schalte am iPad den Flugmodus ein (wie in 2.3).
2. Tippe in der App am 29.10.2026 auf das Kästchen vor **Urlaube im Plan nachziehen**. Seit 1.4 ist es abgehakt, der Haken geht also weg. Auch das ist eine Änderung am Kästchen. Oben steht **Wartet auf Netz** mit einer Zahl.
3. Öffne am PC github.com, das Test-Repo und die Datei `05 Daily Notes/2026-10-29.md`. Klicke über dem Dateiinhalt auf das Stift-Symbol (**Edit file**).
4. Hänge an die Mail-Zeile (`- Max Muster, Freigabe Beispiel …`) ein paar Wörter an. Das ist eine andere Zeile als der Haken. Klicke auf **Commit changes…** und im Fenster auf **Commit changes**.
5. Schalte am iPad den Flugmodus aus und warte, bis **Gesichert** dasteht.

Erwartet: In der Karte **Morgenbriefing** stehen beide Änderungen, deine Änderung am Kästchen und die Wörter vom PC. Es gibt keine Meldung über eine Konfliktkopie.

**Teil B: Dieselbe Zeile**

1. Schalte am iPad den Flugmodus wieder ein.
2. Tippe in der App auf das Kästchen vor **Liste Planobjekte ergänzen**. Seit 2.1 ist es abgehakt, der Haken geht also weg. Auch das ist eine Änderung am Kästchen.
3. Ändere am PC bei GitHub in der Datei genau diese Zeile (die mit `Liste Planobjekte ergänzen`), zum Beispiel ein Wort im Text, aber nichts zwischen den `%%`. Speichere mit **Commit changes**.
4. Schalte am iPad den Flugmodus aus und warte einen Moment.

Erwartet: Oben erscheint die Meldung **Konfliktkopie angelegt: 2026-10-29 (Konflikt).md**. Sie bleibt, bis du auf das **×** daneben tippst. Die Datei `2026-10-29.md` behält die Fassung vom PC. Deine Fassung aus der App, mit deiner Änderung am Kästchen, steht in der neuen Datei `05 Daily Notes/2026-10-29 (Konflikt).md`. Nichts wird still überschrieben.

Im echten Vault holst du Änderungen aus der App in Obsidian mit dem Befehl **Git: Pull** (Befehlspalette öffnen, „Git: Pull“ tippen).

- [ ] Klappt

### 2.5 Am Firmen-PC in Edge abhaken

Wo: Testkopie, dann echtes Vault, Firmen-PC. Dauer: etwa 15 Minuten. Am PC kannst du alles ansehen, abhaken und tippen. Schreiben mit der Maus gibt es nicht, das macht nur der Stift am iPad.

1. Lege am PC (wie in 1.2) einen eigenen Token an und nenne ihn `Notizbuch PC`. So kannst du ihn einzeln widerrufen.
2. Öffne die Adresse der App in Edge. Arbeite in einem normalen Fenster, nicht in **InPrivate**: Dort verschwindet der Zugang beim Schließen.
3. Fülle **Notizbuch einrichten** aus: Token mit **Strg + V** einfügen, bei **Repository** `johrob-lab/2-gehirn-test`, bei **Gerät** **Firmen-PC**, bei **Gültig bis** das Datum des Tokens. Klicke auf **Prüfen und speichern**.
4. Öffne den 29.10.2026 (Monat, Reiter **OKT**, Klick auf die 29). Du siehst die Seite mit den Karten, aber ohne Werkzeugleiste.
5. Klicke in der Karte **Morgenbriefing** ein Kästchen an und ergänze im Feld **Ergänzen** einen Eintrag.
6. Warte, bis oben **Gesichert** steht. Bei GitHub heißt der Commit jetzt `Notizbuch: 2026-10-29.md (Firmen-PC)`.
7. Hole am iPad die App in den Vordergrund. Innerhalb von Sekunden, spätestens nach 3 Minuten, steht der Haken auch dort.
8. Probiere am PC noch: **Strg** halten und das Mausrad drehen zoomt die Seite, das Mausrad allein verschiebt sie, der Knopf **Ganze Seite** unten links auf der Seite bringt sie zurück.

Hinweis: Die App lädt sich nach einer neuen Version selbst neu, in einem ruhigen Moment (nicht beim Schreiben): sofort, wenn du seit dem Öffnen oder Zurückkehren noch nichts angefasst hast, sonst eine Minute nach deiner letzten Eingabe. Nach dem Online-Gang dieser neuen Stifte lade den Firmen-PC einmal mit **F5** neu, danach läuft dort die neue Version. Das gilt auch nach jedem späteren Update.

9. Klicke oben auf **Vollbild** und klicke mit der Maus auf den runden Knopf unten rechts (er zeigt drei Punkte). Erwartet: Ein Ring geht auf mit **‹**, **Heute**, **›**, den vier Ecken nach außen (**Ganze Seite**) und den vier Ecken nach innen (**Vollbild aus**), sonst nichts. Klicke auf **Vollbild aus**. Erwartet: Die Leisten sind wieder da.

Erwartet: Abhaken und Tippen klappen am PC, und die Änderungen sind am iPad zu sehen.

- [ ] Klappt

### 2.6 Am nächsten Morgen prüfen: richtig abgetippt, Haken in Outlook angekommen

Wo: echtes Vault. Dieser Punkt braucht zwei Tage: einen Abend zum Schreiben und den Morgen danach.

**Vorbereitung: ins echte Vault wechseln**

1. Lege bei GitHub einen zweiten Token an (wie in 1.2). Diesmal wählst du bei **Repository access** nur `johrob-lab/2-gehirn` und nennst ihn `Notizbuch`. Der Token der Testkopie hat dort keine Rechte.
2. Warte in der App, bis oben **Gesichert** steht. Warten noch Änderungen, lässt die App den Wechsel nicht zu und sagt zum Beispiel „Erst sichern: Es wartet noch 1 Änderung.“
3. Tippe auf das Zahnrad, dann bei **Zugang** auf **Zugang ändern**.
4. Füge den neuen Token ein, wähle bei **Repository** `johrob-lab/2-gehirn`, stelle **Gültig bis** ein und tippe auf **Prüfen und speichern**.
5. Die App leert dabei ihre Kopien der Testkopie, damit nichts davon im echten Vault landet. Dann lädt sie das echte Vault. Tippe auf **Heute**.

Ab jetzt sind es echte Daten. Die App schreibt nur in `05 Daily Notes/` und `07 Anhänge/Notizbuch/`, alles andere ist für sie gesperrt. Jede Änderung ist ein Commit, den du bei GitHub zurückholen kannst.

**Am PC ins echte Vault wechseln**

Der Token `Notizbuch PC` aus 2.5 sieht nur das Test-Repo. Für das echte Vault bekommt der PC einen eigenen Token mit eigenem Namen und eigenem Ablaufdatum. So kannst du ihn einzeln widerrufen.

1. Öffne am PC github.com und melde dich an.
2. Klicke oben rechts auf dein Profilbild und dann auf **Settings**.
3. Scrolle in der linken Spalte ganz nach unten und klicke auf **Developer settings**.
4. Klicke auf **Personal access tokens** und dann auf **Fine-grained tokens**.
5. Klicke auf **Generate new token**.
6. Trage bei **Token name** `Notizbuch PC Vault` ein.
7. Wähle bei **Expiration** den Eintrag **Custom** und ein Datum in einem Jahr. Merk dir das Datum, die App fragt gleich danach.
8. Wähle bei **Resource owner** den Eintrag `johrob-lab`.
9. Wähle bei **Repository access** den Eintrag **Only select repositories** und dann nur `johrob-lab/2-gehirn`.
10. Öffne **Permissions** (bei manchen Ansichten heißt der Knopf **Add permissions**), suche bei **Repository permissions** den Eintrag **Contents** und stelle **Access** auf **Read and write**. Alles andere bleibt, wie es ist.
11. Klicke unten auf **Generate token** und bestätige im Fenster noch einmal mit **Generate token**.
12. Klicke auf das Kopier-Symbol neben dem Token. Er beginnt mit `github_pat_`. GitHub zeigt ihn nur dieses eine Mal.
13. Wechsle in Edge zum Notizbuch und warte, bis oben **Gesichert** steht. Klicke auf das Zahnrad und dann bei **Zugang** auf **Zugang ändern**.
14. Füge den Token mit **Strg + V** ein, wähle bei **Repository** `johrob-lab/2-gehirn`, stelle bei **Gültig bis** das Datum aus Schritt 7 ein und klicke auf **Prüfen und speichern**. Die App leert dabei ihre Kopien der Testkopie und lädt das echte Vault.

**Am Abend**

1. Öffne am iPad die Tagesseite von heute. Schreib in **Notizen** zwei, drei Sätze, in **Prioritäten** eine Zeile und in **Aufgaben** zwei Zeilen, davon eine in **Grün (erledigt)**. Im Feld **Aufgaben** ist jede Zeile eine Aufgabe, und Grün heißt erledigt. In den anderen Feldern machen nur rote und grüne Zeilen eine Aufgabe.
2. Hake im Briefing zwei Punkte ab, die wirklich erledigt sind und die du aus Outlook kennst.
3. Lege eine Besprechung an und schreib auf eine Seite ein paar Zeilen (wie in 2.2).
4. Warte, bis oben **Gesichert** steht. Mehr musst du am Abend nicht tun: Die Abendroutine tippt die Handschrift ab und meldet die Haken an Outlook.

**Am nächsten Morgen**

1. Öffne das Notizbuch. Das Briefing von heute steht in der Karte **Morgenbriefing**, ohne dass du in Obsidian **Git: Pull** gemacht hast.
2. Führe in Obsidian **Git: Pull** aus und öffne die Tagesnotiz von gestern. Sie liegt als `05 Daily Notes/JJJJ-MM-TT.md` im Vault, mit dem Datum von gestern.
3. Suche den Abschnitt **Handschrift**. Öffne daneben deine Tagesseite von gestern: Sie liegt als `07 Anhänge/Notizbuch/JJJJ/JJJJ-MM-TT Tag.svg` im Vault, und Obsidian zeigt sie als Bild. Stimmt jedes Wort? Stimmen Zahlen und Umlaute? Schreib falsch gelesene Wörter auf.
4. Suche den Abschnitt **Besprechungen**. Steht dort der Text deiner Besprechungsseiten?
5. Prüfe die Aufgaben: Deine Zeilen aus dem Feld **Aufgaben** stehen als Aufgaben mit Kästchen da, die grüne mit Haken.
6. Öffne Outlook. Die Punkte, die du gestern in der App abgehakt hast, sind dort erledigt, so wie sonst nach dem Abhaken in Obsidian.

Erwartet: Die Handschrift steht richtig abgetippt in der richtigen Tagesnotiz, und die Haken sind in Outlook angekommen.

Gut zu wissen: Schreibst du dieselbe Seite an zwei Geräten und bleibt eines davon bis nach dem Abendlauf ohne Netz, übernimmt die Abendroutine die Striche dieses Geräts nicht mehr. Dann öffne in Obsidian die Datei `07 Anhänge/Notizbuch/_Verarbeitet.md`, lösche die Zeile mit dem Namen dieser Seite und lade die Änderung mit dem Git-Plugin hoch. Das Löschen dieser Zeile ist erlaubt, auch wenn in der Datei „Nicht von Hand ändern“ steht, denn die Datei nennt diesen Fall selbst. Am nächsten Abend vergleicht die Routine die ganze Seite mit der Tagesnotiz und ergänzt, was fehlt.

- [ ] Klappt

### 2.7 GoodNotes läuft parallel

Wo: echtes Vault, während der ganzen 1 bis 2 Wochen.

1. Schreib weiter in GoodNotes, wie du es gewohnt bist. Schalte weder die GoodNotes-Erinnerungen noch die Verarbeitung ab. Beides bleibt aktiv, bis du dich am Ende entschieden hast.
2. Schreib an mindestens einem Tag dieselbe Besprechung in beiden Apps mit, zum Beispiel 15 Minuten lang.
3. Am nächsten Morgen stehen in der Tagesnotiz zwei Abschnitte nebeneinander: **Besprechungen** (aus dem Notizbuch) und **Besprechungen (GoodNotes)**. Vergleiche, welcher Text besser abgetippt ist und was du in welcher App schneller aufschreibst.
4. Notiere jeden Tag kurz, was gut und was schlecht war (mehr dazu im letzten Abschnitt).

Erwartet: Beide Wege laufen nebeneinander, ohne sich zu stören. Du kannst am Ende vergleichen.

- [ ] Klappt

## 3. Am iPad zusätzlich prüfen

Diese Punkte lassen sich nur mit dem echten iPad und dem echten Apple Pencil prüfen. Mach sie in der Testkopie. Für alles mit Briefing und Kalender öffnest du den 29.10.2026, zum Schreiben reicht jede Tagesseite. Setz bei jedem Punkt den Haken, wenn alles so war wie unter „Erwartet“.

### 3.1 Apple Pencil: Vorhersage, Handballen, Zwei-Finger-Tipp

1. Tippe oben auf das Zahnrad. Prüfe, dass bei **Vorhersage** **an** gewählt ist, und tippe dann auf **Heute**.
2. Schreib schnell Schleifen und Wörter. Schalte dann **Vorhersage** auf **aus** (Zahnrad, **Vorhersage**, **aus**, **Heute**) und schreib dasselbe noch einmal. Mit **an** soll die Linie weniger hinter der Stiftspitze herhängen. Probiere auch die vier Stufen bei **Glättung** (Standard ist **mittel**) und lass die Wahl stehen, die dir am besten gefällt.
3. Schreib mehrere Zeilen und leg die Hand dabei so auf, wie du es sonst tust. Erwartet: Die Hand hinterlässt keine Striche, die Seite verschiebt oder zoomt sich nicht, und nichts wird abgehakt.
4. Schreib einen Strich und tippe dann mit zwei Fingern gleichzeitig kurz aufs Papier. Der letzte Strich verschwindet. Der Pfeil **Wiederholen** in der Werkzeugleiste holt ihn zurück.

- [ ] Klappt

### 3.2 Schnellwechsel mit aufliegender Hand

1. Suche den runden Knopf unten rechts (**Werkzeug wechseln**). Er zeigt das Symbol des Werkzeugs, das gerade gilt.
2. Schreib in seiner Nähe mit aufliegender Hand. Erwartet: Der Knopf wechselt nicht von allein.
3. Tippe mit dem Stift auf den Knopf. Er wechselt zwischen Kugelschreiber und Radierer. Radiere einen Strich weg.
4. Tippe mit dem Finger auf den Knopf. Erwartet: Es passiert nichts.
5. Zieh den Knopf mit dem Finger an einen anderen Ort. Erwartet: Er bleibt dort, auch nach einem Neustart der App.

- [ ] Klappt

### 3.3 Gesten auf den Karten und der Knopf „Ganze Seite“

1. Schiebe die Seite bei normaler Größe mit einem Finger schräg. Erwartet: Sie geht nur auf und ab, nicht zur Seite. Zoome dann mit zwei Fingern etwas hinein, lege einen Finger auf die Karte **Morgenbriefing** und ziehe nach links oder rechts. Erwartet: Die ganze Seite wandert mit, aber nur bis zu ihrem Rand.
2. Zoome mit zwei Fingern, von denen einer auf einer Karte beginnt. Erwartet: Die Seite zoomt.
3. Ziehe mit einem Finger senkrecht in einer Karte, deren Inhalt länger ist als die Karte. Ist die Karte noch kurz, ergänze im Feld **Ergänzen** mehrere Einträge, bis sie überläuft. Erwartet: Die Liste in der Karte scrollt, nicht die Seite.
4. Tippe auf den Knopf **Ganze Seite** (vier Ecken, die nach außen zeigen) am rechten Ende der Werkzeugleiste. Erwartet: Die Seite ist wieder ganz im Bild.
5. Schreib mit dem Stift in **Notizen**, während deine Handkante auf einem Kästchen der Karte aufliegt. Erwartet: Das Kästchen bleibt, wie es war.

- [ ] Klappt

### 3.4 Scribble in den Eingabefeldern

Scribble heißt: Du schreibst mit dem Stift in ein Textfeld, und das iPad macht daraus Text. Es muss unter iPad **Einstellungen → Apple Pencil** eingeschaltet sein.

1. Schreib mit dem Stift ein Wort in das Feld **Ergänzen** der Karte **Morgenbriefing** und tippe auf **Hinzufügen**.
2. Öffne eine Besprechung und schreib in die Felder **Thema** und **Ort** der Kopfdaten.

Erwartet: Das Geschriebene wird zu Text im Feld. Auf dem Papier darunter entsteht kein Strich.

- [ ] Klappt

### 3.5 Datum und Uhrzeit wählen

1. Öffne eine Besprechung und tippe bei **Datum** auf das Feld. Es öffnet sich das Auswahlfenster des iPads. Wähle einen anderen Tag. Die Kopfzeile auf dem Papier zeigt das neue Datum. Der Dateiname bleibt gleich, das ist Absicht.
2. Wähle bei **Zeit** eine andere Uhrzeit.
3. Leere das Feld **Zeit** und tippe woanders hin. Erwartet: Das Feld zeigt wieder die letzte gültige Zeit.
4. Stelle Datum und Zeit wieder auf die alten Werte.

- [ ] Klappt

### 3.6 Kalenderzellen in der kleinen Monatsansicht

1. Öffne den 29.10.2026. Die Karte **Kalender** zeigt den Oktober. Tage mit Terminen sind markiert.
2. Tippe nacheinander mit dem Finger und mit dem Stift auf den 28., 29., 30. und 31. Erwartet: Jedes Mal geht der Tag auf, den du meinst.

Die Zellen sind klein, etwa 34 mal 16 bis 19 Punkte. Schreib auf, wenn du oft danebentippst.

- [ ] Klappt

### 3.7 App im Hintergrund und zurück

1. Schreib am 29.10.2026 mit dem Stift ein paar Striche und hake einen Punkt ab. Warte nicht auf **Gesichert**.
2. Verlasse die App mit einem Wisch vom unteren Rand nach oben.
3. Schau nach etwa 10 Sekunden bei GitHub unter **Commits**. Erwartet: Der Commit ist schon da, denn die App schickt beim Verlassen sofort ab.
4. Öffne die App wieder. Erwartet: Striche und Haken sind da.
5. Wiederhole es einmal mit gesperrtem iPad (Seitentaste drücken, eine Minute warten, entsperren).

- [ ] Klappt

### 3.8 Zweites Fenster zeigt den Hinweis

Das Notizbuch schreibt nur in einem Fenster. Ein zweites Fenster liest nur und sagt es.

1. Öffne dieselbe Adresse noch einmal im selben Programm. Am Firmen-PC ist das ein zweiter Tab in Edge, am iPad ein zweiter Tab in Safari (wenn du das Notizbuch dort benutzt).
2. Erwartet im zweiten Fenster: Unter der Leiste steht **Das Notizbuch ist schon in einem anderen Fenster offen.** Es gibt kein Feld mit dem Stand des Abgleichs, keine Werkzeuge, kein Feld **Ergänzen**, und die Kästchen sind gesperrt.
3. Schließe das erste Fenster und lade das zweite neu. Erwartet: Jetzt darf es schreiben.

- [ ] Klappt

### 3.9 Ablaufdatum des Tokens

1. Tippe auf das Zahnrad. Unter **Zugang** steht bei **Token** zum Beispiel „gespeichert, gültig bis 29.10.2027“.
2. Vergleiche das Datum mit dem bei GitHub (**Settings → Developer settings → Fine-grained tokens**, bei deinem Token steht **Expires on**). Erwartet: Beide Daten sind gleich.
3. Trag dir das Datum zusätzlich in deinen Kalender ein. Die App erinnert dich 14 Tage vorher mit dem Hinweis „Dein Zugang läuft am … ab. Bitte rechtzeitig erneuern.“ oben und unter **Zugang**.

- [ ] Klappt

### 3.10 Vollbild

Vollbild blendet die Leisten aus, die Seite füllt den Bildschirm. Die Werkzeuge stehen dann in einem Ring um einen runden Knopf (**Kreis**, so ist es eingestellt) oder in einer Lasche am linken Rand (**Tab**). Beides ist neu, prüfe es gründlich. Merke dir den Weg heraus: In beiden Fällen gibt es dafür einen Knopf mit vier Ecken, die nach innen zeigen (**Vollbild aus**). Er ist der einzige Weg zurück, denn das Zahnrad ist im Vollbild weg.

Der Ring um den runden Knopf:

1. Öffne den 29.10.2026 und tippe oben auf **Vollbild**. Erwartet: Die Leisten sind weg. Unten rechts steht der runde Knopf mit dem Kugelschreiber. Zeigt er den Radierer, tippe einmal mit dem Stift darauf. Er kann an einem anderen Ort stehen, wenn du ihn verschoben hast. Der Stand des Abgleichs oben kann bleiben.
2. Tippe kurz mit dem Stift auf den runden Knopf. Erwartet: Er zeigt jetzt den Radierer, es geht nichts auf. Halte dann den Stift etwa eine halbe Sekunde auf dem Knopf. Erwartet: Der Ring geht auf, der Knopf wechselt nichts.
3. Schließe den Ring, indem du mit dem Stift auf die Seite neben den Ring tippst. Tippe dann mit dem Stift auf den runden Knopf, bis wieder der Kugelschreiber zu sehen ist. Erwartet: Der Ring ist zu, auf dem Papier ist kein Strich.
4. Tippe mit dem Finger auf den runden Knopf. Erwartet: Der Ring geht auf. Tippe auf eine Farbe, zum Beispiel die rote. Erwartet: Der Ring schließt sich, und der nächste Strich ist rot.
5. Öffne den Ring wieder mit dem Finger und tippe auf die Seite neben dem Ring, am besten auf ein Kästchen der Karte **Morgenbriefing**. Erwartet: Der Ring schließt sich, auf dem Papier entsteht kein Strich, und der Zustand des Kästchens darunter ändert sich nicht.
6. Öffne den Ring und tippe auf das Wort **Heute**. Erwartet: Die Seite wechselt zu heute, der Ring ist zu. Öffne ihn wieder und tippe auf **›** (nächster Tag). Erwartet: Es kommt der nächste Tag, der Ring ist zu, und du kannst gleich mit dem Stift schreiben.
7. Zoome mit zwei Fingern in die Seite hinein, öffne den Ring und tippe auf den Knopf mit den vier Ecken, die nach außen zeigen (**Ganze Seite**). Erwartet: Die Seite ist wieder ganz im Bild.
8. Prüfe die Hand: Leg beim Schreiben mehrere Zeilen lang die Hand auf den runden Knopf. Leg sie dann auf den Knopf, schreib mit dem Stift einen Strich und heb die Hand erst danach ab. Erwartet: Der Ring geht nie von allein auf, und geschrieben ist trotzdem.
9. Öffne den Ring und tippe auf den Knopf mit den vier Ecken, die nach innen zeigen (**Vollbild aus**). Erwartet: Die Leisten sind wieder da.

Die Lasche am linken Rand:

10. Tippe auf das Zahnrad, dann bei **Werkzeuge im Vollbild** auf **Tab**. Tippe oben auf **Heute** und dann auf **Vollbild**. Erwartet: Am linken Rand, in der Mitte der Höhe, steht ein kleiner Griff mit drei Punkten. Der runde Knopf unten rechts wechselt nur noch das Werkzeug.
11. Tippe mit dem Finger auf den Griff. Erwartet: Eine Leiste klappt aus. Von oben nach unten stehen darin Kugelschreiber und Radierer (die Symbole von Stift und Radierer), beim Kugelschreiber dazu Farben und Breiten (beim Radierer Größen und Stück oder Strich), der Pfeil nach links (Rückgängig) und der Pfeil nach rechts (Wiederholen), dann **‹**, **Heute**, **›**, die vier Ecken nach außen (**Ganze Seite**) und ganz unten die vier Ecken nach innen (**Vollbild aus**). Ist der Bildschirm zu niedrig, schiebe die Leiste mit dem Finger nach oben und unten. Tippe noch einmal auf den Griff. Erwartet: Die Leiste klappt zu.
12. Klappe die Leiste aus und tippe auf eine Farbe. Erwartet: Die Leiste bleibt offen. Schreib einen Strich auf die Seite. Erwartet: Der Strich ist da, und die Leiste bleibt offen.
13. Prüfe die Hand an der Lasche: Leg die Hand auf den Griff und schreib mit dem Stift einen Strich. Heb die Hand erst danach ab. Erwartet: Die Leiste klappt nicht auf oder zu. Mach dasselbe mit der Hand auf einem Knopf der ausgeklappten Leiste, zum Beispiel dem Pfeil nach links. Erwartet: Nichts wird rückgängig gemacht, und der Strich bleibt.
14. Tippe in der Leiste auf die vier Ecken nach innen (**Vollbild aus**). Erwartet: Die Leisten sind wieder da. Stelle bei **Werkzeuge im Vollbild** die Wahl ein, die dir besser gefällt.

Am Firmen-PC prüfst du den Ring bei 2.5: Schalte dort oben auf **Vollbild**, klicke mit der Maus auf den runden Knopf (er zeigt drei Punkte) und erwarte **‹**, **Heute**, **›**, die vier Ecken nach außen und die vier Ecken nach innen. Klicke zuletzt auf **Vollbild aus**.

- [ ] Klappt

### 3.11 Neue Stifte und die Füllfeder

Neben dem Kugelschreiber gibt es **Fineliner** und **Füllfeder**. Der Bleistift steht nicht mehr zur Wahl, alte Bleistiftstriche auf Seiten bleiben aber sichtbar. Die Füllfeder hat vier Regler, die du in einem Fenster einstellst, und sie schreibt wie Tinte: Schnelle Striche werden dünner und laufen lang spitz aus, langsame bleiben satt. Wo: Testkopie, iPad mit Apple Pencil, am besten die Tagesseite vom 30.10.2026 (die Beispielseite `stifte`, falls sie im Test-Repo liegt) oder eine leere Tagesseite. Für den Vergleich in Schritt 12 brauchst du GoodNotes. Dauer: etwa 45 Minuten.

1. Neue Version holen: Beende die App am iPad einmal ganz: Wische vom unteren Rand nach oben, halte kurz und wische die App nach oben weg. Öffne sie dann wieder über das Symbol auf dem Home-Bildschirm. Sie lädt sich dabei vielleicht noch einmal kurz selbst neu, danach läuft die neue Version. Erwartet: Links in der Werkzeugleiste stehen vier Symbole: Kugelschreiber, Fineliner, Füllfeder und Radierer. Einen Bleistift gibt es dort nicht mehr. Steht er noch da, beende die App noch einmal und öffne sie wieder.
2. Tippe oben in der Werkzeugleiste nacheinander auf **Kugelschreiber**, **Fineliner** und **Füllfeder**. Schreib mit jedem Stift ein paar Wörter in das Feld **Notizen**. Erwartet: Jeder Stift sieht anders aus, und der gewählte Knopf ist hervorgehoben.
3. Wähle die Farbe **Blau** und wechsle dann zwischen Kugelschreiber, Fineliner und Füllfeder. Erwartet: Die Farbe bleibt Blau. Tippe zum Schluss auf **Kugelschreiber**. Dann wählt in Schritt 4 der erste Tipp die Füllfeder nur aus, und erst der zweite öffnet ihr Fenster.
4. Strich-Stabilisierung zurück auf 14 %: Tippe oben in der Werkzeugleiste auf **Füllfeder** und gleich danach noch einmal auf **Füllfeder**. Erwartet: Unter dem Knopf geht das Fenster **Füllfeder** mit vier Reglern auf. Der unterste heißt **Strich-Stabilisierung**, sein Wert steht rechts neben dem Namen. Zeigt er nicht **14 %**, zieh den runden Knopf dieses Reglers mit dem Stift, bis dort **14 %** steht (hattest du ihn ganz nach rechts gedreht, muss er fast ganz nach links). Die drei Regler darüber sollen **Scharf**, **25 %** und **33 %** zeigen, sonst stelle sie ebenso ein. Tippe dann mit dem Stift neben das Fenster. Erwartet: Das Fenster geht zu, die Füllfeder bleibt gewählt, und auf der Seite entsteht kein Strich.
5. Füllfeder mit den Startwerten: Die Füllfeder ist noch gewählt. Tippe nicht noch einmal auf ihren Knopf, sonst geht das Fenster wieder auf. Schreib ein paar Zeilen mit Schrägstrichen, Bögen und Kreisen. Erwartet: Die Ränder sind glatt, die Enden der Striche laufen spitz aus, und Striche nach rechts unten sind breiter als Aufstriche. Setz den Stift auf und halte ihn eine Sekunde ruhig. Erwartet: Es entsteht kein Klecks, nur ein kleiner runder Punkt. Zoome dann mit zwei Fingern auf etwa das Dreifache und schreib noch einmal. Erwartet: Auch gezoomt sind die Ränder glatt und es gibt keinen Klecks beim Verweilen.
6. Langsam und schnell: Tippe am rechten Ende der Werkzeugleiste auf **Ganze Seite** (vier Ecken, die nach außen zeigen), so ist die Seite wieder in normaler Größe. Schreib auf einer freien Zeile einen geraden Strich von etwa 5 cm ganz langsam, etwa 3 Sekunden lang. Schreib darunter denselben Strich schnell in einem Schwung und heb den Stift dabei in der Bewegung ab. Erwartet: Der schnelle Strich ist deutlich dünner, etwa halb so breit wie der langsame, und sein Ende läuft lang und spitz aus, etwa 2 bis 4 mm. Der langsame Strich ist satt und endet kurz, nach weniger als 1 mm. Setz dann den Stift auf, warte einen Augenblick und zieh langsam los. Erwartet: Der Anfang ist stumpf. Setz zum Vergleich schon in der Bewegung auf, wie bei einem schnellen Abstrich. Erwartet: Dieser Anfang läuft länger spitz an.
7. Druck: Schreib dieselbe Zeile einmal mit festem und einmal mit leichtem Druck. Erwartet: Fester Druck gibt eine breitere Linie, leichter Druck eine feinere. Die Linie bricht nirgends ab.
8. Fenster mit den Reglern öffnen: Tippe in der Werkzeugleiste noch einmal auf die schon gewählte **Füllfeder**. Erwartet: Unter dem Knopf geht ein Fenster **Füllfeder** auf. Oben steht eine Vorschau, eine liegende Welle, darunter vier Regler: **Schärfe der Spitze**, **Druckempfindlichkeit**, **Rundung der Spitze** und **Strich-Stabilisierung**. Die Startwerte sind **Scharf**, **25 %**, **33 %** und **14 %**. Die Welle ist links langsam und rechts schnell geschrieben: Zum rechten Ende hin wird sie dünner und läuft dort länger spitz aus als links. Tippe neben das Fenster. Erwartet: Das Fenster geht zu, und auf der Seite entsteht dabei kein Strich.
9. Jeden Regler ausprobieren: Öffne das Fenster wieder und schiebe einen Regler nach dem anderen einmal ganz nach links (0 %) und ganz nach rechts (100 %). Sieh dir dabei jedes Mal die Vorschau an. Erwartet: Die Vorschau ändert sich sofort und ist nie ein Klecks, nie leer und nie unterbrochen. Bei **Schärfe der Spitze** steht links **Rund** (die Enden laufen nicht spitz aus) und rechts **Scharf** (die Enden laufen spitz aus). Bei **Druckempfindlichkeit** links wirkt der Druck nicht, die Breite bleibt gleich, rechts schwankt die Breite stark mit dem Druck. Bei **Rundung der Spitze** links ist die Feder ganz flach, die Breite hängt stark von der Richtung ab, rechts ist die Spitze rund und die Linie überall gleich breit. Bei **Strich-Stabilisierung** links glättet die Füllfeder nur ganz leicht und folgt dem Stift fast genau, rechts glättet sie das Zittern der Hand stark. Die **Glättung** in den Einstellungen (Zahnrad) gilt nur für Kugelschreiber und Fineliner, die Füllfeder hat dafür ihre eigenen Regler in diesem Fenster. Stelle alle vier Regler danach wieder auf die Startwerte.
10. Neue Einstellung auf der Seite: Stelle **Schärfe der Spitze** auf **Rund** und schließe das Fenster mit einem Tipp daneben. Schreib ein paar Wörter. Erwartet: Die neuen Striche sehen anders aus als die vom Start, die alten Striche bleiben unverändert. Öffne das Fenster auch aus Ring und Lasche: Tippe oben auf **Vollbild**, öffne den Ring (Finger auf den runden Knopf) und tippe auf die schon gewählte **Füllfeder**. Erwartet: Das Fenster geht in der Mitte der Seite auf. Wechsle dann in den Einstellungen (Zahnrad) bei **Werkzeuge im Vollbild** auf **Tab**, öffne die Lasche am linken Rand und tippe dort auf die schon gewählte **Füllfeder**. Erwartet: Auch hier geht das Fenster auf. Beende mit **Vollbild aus**. Stelle **Schärfe der Spitze** wieder auf **Scharf**.
11. Spitze beim Schweben: Das klappt nur auf iPads, deren Apple Pencil das Schweben erkennt. Wähle die **Füllfeder**, halte den Stift knapp über das Papier, ohne es zu berühren, und bewege ihn langsam. Erwartet: Unter der Stiftspitze steht eine kleine Ellipse, die zeigt, wie die Füllfeder gleich schreiben würde. Sie liegt so, wie der letzte Strich lag. Wechsle auf den **Kugelschreiber** und schwebe noch einmal. Erwartet: Es erscheint keine Ellipse. Auf iPads ohne Schwebe-Erkennung siehst du die Ellipse nie, das ist in Ordnung.
12. Dasselbe Wort in GoodNotes und im Notizbuch: Schreib in GoodNotes mit der Füllfeder das Wort **Test** und dieselben Zeilen wie in Schritt 5, so wie du sonst schreibst. Schreib dann im Notizbuch mit der Füllfeder (Startwerte, also **Strich-Stabilisierung** auf **14 %**) dasselbe Wort und dieselben Zeilen, gleich groß und im selben Tempo. Schreib im Notizbuch dahinter noch eine Reihe kleiner Schleifen, **llll** und **eeee**, für den Vergleich in Schritt 13. Mach in beiden Apps ein Bildschirmfoto: obere Taste und eine Lautstärketaste gleichzeitig kurz drücken (bei einem iPad mit Home-Taste obere Taste und Home-Taste). Öffne die App **Fotos** und vergleiche die beiden Bilder. Erwartet: Im Notizbuch sieht das Wort ähnlich aus wie in GoodNotes: Die Linie ist ruhig und zittert nicht, schnelle Striche sind dünner und laufen lang spitz aus, langsame bleiben satt, die Breite wechselt mit der Richtung, und Aufstriche sind fein. Schreib auf, was dir anders vorkommt, zum Beispiel zu breit, zu fein, zu steif, zu wenig dick und dünn oder zu unruhig, und welcher Regler es besser macht. Sehen die Ränder der Linie bei mittlerem Tempo rau oder zackig aus, mach davon ein Bildschirmfoto und gib Bescheid.
13. Stabilisierung vergleichen: Tippe in der Werkzeugleiste noch einmal auf die schon gewählte **Füllfeder**, das Fenster geht auf. Zieh den Regler **Strich-Stabilisierung** auf **40 %** und tippe neben das Fenster. Schreib dasselbe Wort **Test** wie in Schritt 12 und dahinter eine Reihe kleiner Schleifen, zum Beispiel **llll** und **eeee**, so groß und so schnell wie sonst. Mach dasselbe noch einmal mit **70 %**. Vergleiche die drei Stufen 14 % (aus Schritt 12), 40 % und 70 % und schreib auf: Ab welcher Stufe ist die Linie ruhig und zittert nicht mehr? Ab welcher Stufe fangen die kleinen Schleifen an zuzugehen? Gut ist die Stufe, bei der die Linie ruhig ist und die Schleifen noch offen sind. Zum Vergleich: Das alte 100 % entspricht jetzt etwa 45 %. Lass den Regler auf der Stufe, die dir am besten gefällt, und schreib sie auf.
14. Alte Bleistiftstriche: Öffne eine ältere Seite, auf der du früher mit dem Bleistift geschrieben hast (zum Beispiel die Beispielseite `stifte`). Erwartet: Die Bleistiftstriche sind noch da, grau und körnig, und scheinen ein wenig durch. Sie lassen sich wie früher radieren.
15. Teil-Radieren: Schreib mit der Füllfeder eine lange Linie. Tippe oben in der Werkzeugleiste auf den **Radierer** und rechts daneben auf die Radierart **Nur Stück**. Streiche einmal quer mitten durch die Linie. Erwartet: Nur das Stück in der Mitte verschwindet, die beiden Enden bleiben mit gleicher Farbe und Breite stehen. Tippe auf den Pfeil **Rückgängig**. Erwartet: Die Linie ist wieder ganz.
16. Ring und Lasche: Tippe oben auf **Vollbild**. Öffne den Ring (Finger auf den runden Knopf) und zähle die Knöpfe außen. Erwartet: Es sind 11 Knöpfe, alle gut zu treffen, darunter die drei Stifte. Wähle die Füllfeder und schreib. Öffne danach die Lasche am linken Rand. Erwartet: Die drei Stifte stehen auch dort, und der Wechsel klappt. Beende mit **Vollbild aus**.
17. Verzögerung messen: Tippe oben auf das Zahnrad, dann bei **Messung anzeigen** auf **an** und oben auf **Heute**. Schreib mit einem Stift schnell Schleifen. Nach dem Abheben steht unten links über der Seite eine kleine Zeile, zum Beispiel „Arbeit 0,4 ms (max 1,2) · Bild 8,3 ms · Punkte je Bewegung 6“. Schreib sie dir mit dem Namen des Stifts auf. Mach das mit allen drei Stiften, einmal mit **Vorhersage** an und einmal aus (Zahnrad, **Vorhersage**, **an** oder **aus**, **Heute**). Tippe vor jedem neuen Stift auf das Zahnrad und dann auf **Heute**, so beginnt die Messung neu. Erwartet: Bei keinem Stift hängt die Linie spürbar hinter der Spitze her. Stelle zum Schluss **Messung anzeigen** wieder auf **aus**.
18. Warte, bis oben **Gesichert** steht. Am nächsten Morgen prüfst du, ob die Abendroutine alles abgetippt hat: Öffne die Tagesnotiz in Obsidian. Erwartet: Das Geschriebene aller drei Stifte steht im Abschnitt **Handschrift** oder **Besprechungen**, und nichts fehlt.

- [ ] Klappt

### 3.12 Abgleich

Die App lädt seltener hoch, damit Obsidian am iPad nicht mit vielen Commits kurz hintereinander kämpft. Handschrift geht hoch, wenn du 2 Minuten lang nicht schreibst, spätestens 10 Minuten nach der ersten Änderung. Haken, Ergänzungen und bearbeitete Zeilen gehen 10 Sekunden nach der letzten Änderung hoch. Verlässt du die App, geht alles sofort hoch. Oben steht dabei die ganze Zeit **Gesichert**: Deine Änderungen liegen sofort sicher auf dem iPad, nur das Hochladen wartet. Bevor die App die Tagesnotiz ändert, holt sie deren neuesten Stand von GitHub. Antwortet GitHub nicht innerhalb von 2 Sekunden (schlechtes Netz), arbeitet sie mit dem Stand auf dem iPad weiter und vereint beide Stände beim Hochladen. Wo: echtes Vault, iPad mit Stift und Obsidian. Obsidian gleicht nur das echte Vault ab, darum geht dieser Punkt nicht in der Testkopie. Dauer: etwa 20 Minuten.

Schreib echte Notizen und hake nur ab, was wirklich erledigt ist: Die Abendroutine tippt die Handschrift ab und meldet jeden Haken an Outlook.

1. Merk dir die Uhrzeit. Lege eine Besprechung mit zwei Seiten an: Tippe oben auf **Heute**, in der Karte **Besprechungen** auf einen Termin von heute (oder auf **+ Besprechung**, trage Thema und Zeit ein und tippe auf **Anlegen**) und dann auf **+ Seite**. Schreib jetzt 10 Minuten lang mit dem Stift abwechselnd auf beiden Seiten: ein paar Zeilen auf Seite 2, oben in der Leiste **‹** zu Seite 1, ein paar Zeilen, **›** zurück zu Seite 2 und so weiter. Mach dabei nie 2 Minuten Pause und bleib in der App.
2. Hör auf zu schreiben und warte 2 Minuten. Bleib dabei in der App.
3. Öffne in Safari github.com, das Repo `johrob-lab/2-gehirn` und tippe über der Dateiliste auf **Commits** (die Zahl neben dem Uhr-Symbol). Zähle seit der Uhrzeit aus Schritt 1 die Commits, deren Text mit `S1.svg (iPad)` endet, und die mit `S2.svg (iPad)`. Erwartet: je Seite höchstens 2 Commits.
4. Wechsle zurück ins Notizbuch: Wische vom unteren Rand nach oben, halte kurz und tippe auf das Notizbuch. Tippe oben auf **Heute** und hake in der Karte **Morgenbriefing** kurz hintereinander drei Punkte ab. Warte 10 Sekunden in der App. Sieh dann bei GitHub unter **Commits** nach (wie in Schritt 3). Erwartet: Es gibt genau einen neuen Commit `Notizbuch: JJJJ-MM-TT.md (iPad)` mit dem Datum von heute. Tippe darauf: Bei allen drei Punkten wurde aus `- [ ]` ein `- [x]`.
5. Wechsle zurück ins Notizbuch, schreib auf der Tagesseite im Feld **Notizen** ein paar Wörter und wechsle sofort zu Obsidian (vom unteren Rand nach oben wischen, kurz halten, Obsidian antippen). Führe in Obsidian **Git: Pull** aus (Befehlspalette öffnen, „Git: Pull“ tippen) und öffne die Datei `07 Anhänge/Notizbuch/JJJJ/JJJJ-MM-TT Tag.svg` mit dem Datum von heute. Erwartet: Die Seite ist da, mit den Wörtern von eben. Fehlen sie noch, warte ein paar Sekunden und führe **Git: Pull** noch einmal aus.
6. Wechsle zurück ins Notizbuch und hake in der Karte **Morgenbriefing** einen Punkt ab. Wechsle zu Obsidian, führe **Git: Pull** aus und öffne die Tagesnotiz von heute (`05 Daily Notes/JJJJ-MM-TT.md`). Erwartet: Der Punkt steht dort als `- [x]`. Fehlt der Haken noch, warte ein paar Sekunden und führe **Git: Pull** noch einmal aus. Bis auf diesen Haken ist der Abschnitt **Morgenbriefing (automatisch)** unverändert, ebenso **Abendüberblick (automatisch)**, wenn es ihn schon gibt: Nichts fehlt, nichts ist doppelt.

Erwartet: Wenige Commits, auch wenn du lange am Stück schreibst. Was du in der App änderst, ist in Obsidian nach **Git: Pull** da, und die Tagesnotiz behält alles, was die Routinen geschrieben haben.

- [ ] Klappt

### 3.13 Gezoomt schreiben, speichern und neu öffnen

Seit diesem Update speichert die App jeden Strich zehnmal genauer. Alte Füllfeder-Striche, die beim gezoomten Schreiben zerfranst sind, glättet sie, wenn du eine Seite öffnest. Und sie zeichnet die Ränder der Füllfeder rund statt eckig. Wo: echtes Vault, iPad mit Apple Pencil, die Tagesseite vom 04.11.2026 (dort stehen die zerfransten kleinen Schleifen) und eine leere Tagesseite. Dauer: etwa 15 Minuten.

1. Zuerst alle Geräte aktualisieren: Beende die App auf jedem Gerät, auf dem du das Notizbuch benutzt, einmal ganz und öffne sie wieder. Am iPad: Wische vom unteren Rand nach oben, halte kurz und wische die App nach oben weg. Öffne sie dann wieder über das Symbol auf dem Home-Bildschirm. Am Firmen-PC: Schließe das Fenster mit dem Notizbuch und öffne die Adresse der App wieder in Edge. Die App lädt sich dabei vielleicht noch einmal kurz selbst neu, danach läuft die neue Version. Schreib erst danach auf einer Seite. Der Grund: Eine alte Version, die irgendwo noch offen ist, würde beim Speichern alle Striche einer Seite wieder grob runden.
2. Alte Seite: Öffne die Tagesseite vom 04.11.2026. Tippe dazu oben auf **Monat**, am rechten Rand auf den Reiter **NOV** und mit dem Finger oben in das Feld mit der 4, dorthin, wo die Tageszahl steht. Zoome mit zwei Fingern auf die kleinen Schleifen, zum Beispiel ein **eee**. Erwartet: Die Schleifen sind glatt, nicht zerfranst, und so groß wie vorher.
3. Gezoomt schreiben: Öffne eine leere Tagesseite. Tippe dazu oben auf **Heute** und dann so oft auf **›** (nächster Tag), bis eine Seite ohne Striche kommt. Tippe oben in der Werkzeugleiste auf **Füllfeder**. Geht dabei das Fenster mit den Reglern auf, war sie schon gewählt: Tippe dann neben das Fenster, es geht zu. Zoome mit zwei Fingern auf etwa das Sechsfache: Die Linien im Feld **Notizen** liegen dann etwa sechsmal so weit auseinander wie bei ganzer Seite. Schreib eine Reihe kleiner Schleifen, **eeee** und **llll**, so groß, wie du sonst schreibst. Erwartet: Die Ränder sind rund. Auch wenn du ganz nah heranzoomst, siehst du keine Ecken.
4. Gesehen ist gespeichert: Mach ein Bildschirmfoto: obere Taste und eine Lautstärketaste gleichzeitig kurz drücken (bei einem iPad mit Home-Taste obere Taste und Home-Taste). Warte, bis oben **Gesichert** steht. Beende die App ganz (wie in Schritt 1) und öffne sie wieder. Öffne dieselbe Seite wie in Schritt 3 und zoome gleich weit auf dieselben Schleifen. Öffne zum Vergleich das Bildschirmfoto in der App **Fotos**. Erwartet: Die Schleifen sehen genau so aus wie auf dem Bildschirmfoto. Nichts zittert oder franst aus.
5. Stabilisierung: Tippe in der Werkzeugleiste noch einmal auf die schon gewählte **Füllfeder**. Erwartet: Das Fenster **Füllfeder** geht auf. Zieh den runden Knopf des untersten Reglers **Strich-Stabilisierung** mit dem Stift, bis rechts neben dem Namen etwa **14 %** steht. Tippe neben das Fenster, es geht zu. Tippe am rechten Ende der Werkzeugleiste auf **Ganze Seite** (vier Ecken, die nach außen zeigen), so ist die Seite wieder in normaler Größe. Schreib dasselbe Wort wie sonst, zum Beispiel **Test**, so groß und so schnell, wie du es gewohnt bist. Erwartet: Die Linie ist ruhig und hängt nicht hinter dem Stift her. Wirkt sie zu unruhig oder zu eckig, gib Bescheid.
6. Große Seite: Öffne wieder die Tagesseite vom 04.11.2026 (wie in Schritt 2) und schreib einen kurzen Strich. Warte, bis oben **Gesichert** steht, und dann noch etwa 2 Minuten, ohne zu schreiben: Handschrift geht spätestens etwa 2 Minuten nach dem letzten Strich hoch (siehe 3.12). Benutzt du die App auch am Firmen-PC, öffne dort in Edge dieselbe Seite (oben auf **Monat**, Reiter **NOV**, Klick auf die 4). Erwartet: Der neue Strich ist auch dort, spätestens nach 3 Minuten. Diese Seite ist jetzt etwas über 1 MB groß. So prüfst du, dass auch so große Seiten gespeichert und geladen werden.
7. Aufräumen: Die Probe-Striche aus den Schritten 3, 5 und 6 würde die Abendroutine sonst in deine Tagesnotizen abtippen. Tippe oben in der Werkzeugleiste auf den **Radierer** und rechts daneben auf die Radierart **Ganzer Strich**. Streiche mit dem Stift über die Schleifen und das Wort auf der Seite aus Schritt 3. Öffne dann die Tagesseite vom 04.11.2026 (wie in Schritt 2) und streiche nur über den kurzen Strich aus Schritt 6, sonst verschwinden auch alte Striche. Hast du zu viel erwischt, tippe auf den Pfeil **Rückgängig**. Erwartet: Die Probe-Striche sind weg, alles andere steht noch da. Warte, bis oben **Gesichert** steht.
8. Passt etwas nicht, mach ein Bildschirmfoto und gib kurz Bescheid, was du getan und was du gesehen hast.

- [ ] Klappt

### 3.14 Termine und Prioritäten in Woche und Monat

Auf der Wochenseite steht jetzt bei jedem Tag, was ansteht: oben die Termine aus der Termin-Datei (`04 Ressourcen/Kalender/Termine.md`, die schreibt das Morgenbriefing jeden Morgen) und darunter die Prioritäten des Tages, also der Text, den die Abendroutine aus dem Feld **Prioritäten** der Tagesseite abtippt. Auf der Monatsseite stehen bei jedem Tag die Termine. Beides steht nur auf dem Bildschirm der App und nie in der Datei der Seite. Wo: echtes Vault, iPad mit Apple Pencil, dazu Obsidian am iPad. Die Prioritäten tippt nur die Abendroutine ab, und die läuft nur im echten Vault. Dauer: etwa 15 Minuten.

Mach diese Probe frühestens nach dem ersten Morgenbriefing, das nach dem Update kommt (das Morgenbriefing ist die Routine, die jeden Morgen die Termin-Datei neu schreibt). Erst dann reicht die Termin-Datei etwa zwei Monate in die Zukunft. Termine aus Outlook stehen erst so weit voraus da, wenn du im Ablauf „Outlook-Briefing“ die Änderung gemacht hast (siehe Schritt 7).

1. Neue Version holen: Beende die App am iPad einmal ganz: Wische vom unteren Rand nach oben, halte kurz und wische die App nach oben weg. Öffne sie dann wieder über das Symbol auf dem Home-Bildschirm. Sie lädt sich dabei vielleicht noch einmal kurz selbst neu, danach läuft die neue Version.
2. Termine in der Woche: Tippe oben auf **Woche**. Erwartet: In der Kopfzeile jedes Tages steht rechts neben dem Wochentag in kleiner grauer Schrift, was an diesem Tag ansteht. In der ersten Zeile stehen die Termine: ganztägige zuerst und nur mit Titel, dann die anderen nach der Uhrzeit, zum Beispiel „09:30 Zahnarzt · 14:00 Runde“. Steht rechts in der Kopfzeile ein Feiertag, endet die Schrift vor seinem Namen. Vergleiche zwei Tage mit deinem Kalender in Outlook und in Google. Erwartet: Es sind dieselben Termine. Die Termin-Datei hat den Stand des Morgenbriefings von heute früh: Einen Termin, den du danach eingetragen hast, siehst du erst morgen.
3. Zu viele Termine: Passt nicht alles in die Zeile, steht am Ende zum Beispiel „+2“: So viele Termine passen nicht mehr hinein. Ein zu langer Titel endet mit „…“. Tippe dann mit dem Finger auf die Tageszahl dieses Tages. Erwartet: Die Tagesseite geht auf, und die Karte **Besprechungen** zeigt alle Termine des Tages. Tippe oben auf **Woche**, so bist du wieder in der Woche.
4. Prioritäten in der Woche: In der zweiten Zeile stehen die Prioritäten des Tages, jede mit einem kleinen Pfeil davor (▸). Erledigte haben einen Haken (✓) und sind blasser. Sie erscheinen erst, wenn die Abendroutine die Tagesseite abgetippt hat, für heute also frühestens am Abend. Gibt es an einem Tag nur Termine oder nur Prioritäten, bekommen sie beide Zeilen. Wechsle zu Obsidian (vom unteren Rand nach oben wischen, kurz halten, Obsidian antippen) und führe **Git: Pull** aus (Befehlspalette öffnen, „Git: Pull“ tippen), damit du den neuesten Stand holst. Öffne dann die Tagesnotiz eines früheren Tages dieser Woche (`05 Daily Notes/JJJJ-MM-TT.md`). Erwartet: Unter **Handschrift** im Block **Prioritäten** stehen dieselben Zeilen wie in der Woche bei diesem Tag. Hat noch kein Tag dieser Woche Prioritäten, prüfe diesen Schritt nach der nächsten Abendroutine.
5. Darüber schreiben: Wechsle zurück ins Notizbuch. Tippe oben in der Werkzeugleiste auf **Kugelschreiber** und schreib mit dem Stift ein Wort quer über die graue Schrift eines Tages. Erwartet: Die Tinte liegt darüber wie überall auf der Seite, und es geht keine Tagesseite auf. Tippe dann oben in der Werkzeugleiste auf den **Radierer**, rechts daneben auf die Radierart **Ganzer Strich**, und streiche über das Wort. Sonst tippt die Abendroutine es ab. Erwartet: Das Wort ist weg, die graue Schrift steht noch da. Warte, bis oben **Gesichert** steht.
6. Monat: Tippe oben auf **Monat**. Erwartet: In jedem Tageskästchen stehen oben links neben der Tageszahl in sehr kleiner Schrift bis zu zwei Zeilen mit den Terminen, ohne Prioritäten. Zum Lesen zoomst du mit zwei Fingern hinein. Tippe danach am rechten Ende der Werkzeugleiste auf **Ganze Seite** (vier Ecken, die nach außen zeigen), so ist die Seite wieder ganz im Bild. Tippe mit dem Finger oben in ein Kästchen, dorthin, wo die Tageszahl steht. Erwartet: Wie bisher geht dieser Tag auf. Tippe oben auf **Monat**, so bist du wieder im Monat.
7. Weit voraus: Tippe am rechten Rand auf den Reiter des nächsten Monats (im November also **DEZ**) und such einen Tag, der mehr als 14 Tage entfernt ist und an dem du einen Termin in Google und einen in Outlook hast. Erwartet: Termine aus Google stehen bis etwa zwei Monate im Voraus da. Termine aus Outlook reichen nur 14 Tage weit, bis du im Ablauf „Outlook-Briefing“ die Änderung gemacht hast: Im Baustein **Kalender** wird aus `,15)` ein `,63)`. Die Anleitung Schritt für Schritt steht in der Notiz „Outlook-Briefing Power Automate“ im Vault. Ab dem Morgenbriefing danach reichen auch die Termine aus Outlook etwa zwei Monate weit. Tage vor dem 09.11.2026 bleiben leer, das ist richtig: Die Termin-Datei kennt sie nicht.
8. Nur auf dem Bildschirm: Wechsle zu Obsidian, führe **Git: Pull** aus (Befehlspalette öffnen, „Git: Pull“ tippen) und öffne die Wochenseite aus Schritt 5: `07 Anhänge/Notizbuch/JJJJ/JJJJ KWnn Woche.svg`. Dabei ist nn die Kalenderwoche, sie steht oben auf der Wochenseite (zum Beispiel **Woche 46**, dann heißt die Datei `2026 KW46 Woche.svg`). Erwartet: Die Seite zeigt Rahmen, Linien und Tageszahlen, aber keine Termine und keine Prioritäten. Die stehen nur auf dem Bildschirm der App, damit sich die Datei nicht mit jedem Termin ändert. Fehlt die Datei noch, warte ein paar Sekunden und führe **Git: Pull** noch einmal aus.
9. Passt etwas nicht, mach ein Bildschirmfoto (obere Taste und eine Lautstärketaste gleichzeitig kurz drücken) und gib kurz Bescheid, was du getan und was du gesehen hast.

- [ ] Klappt

## 4. Die 1 bis 2 Wochen und die Entscheidung

Im Alltag brauchst du nichts Besonderes zu tun. Schreib im Notizbuch, wie du es später willst, und lass GoodNotes nebenher laufen. Wenn etwas nicht klappt, schreib dir jedes Mal auf:

- das Datum und die Uhrzeit,
- das Gerät (iPad oder Firmen-PC) und die Seite oder Datei,
- was du zuletzt getan hast und ob der Flugmodus an war,
- die genaue Meldung, wenn es eine gab, und was oben im Feld des Abgleichs stand.

Nach 1 bis 2 Wochen gehst du diese Sätze durch. Sie sind das Ziel des Probebetriebs:

- [ ] Das Briefing steht morgens in der App, ohne „Git: Pull“.
- [ ] Jede Handschrift steht am selben Abend abgetippt in der richtigen Tagesnotiz.
- [ ] Abhaken in der App kommt wie bisher in Outlook an.
- [ ] Schreiben geht auch ohne Netz, und nichts geht verloren.
- [ ] Am Firmen-PC lässt sich alles ansehen, abhaken und tippen.
- [ ] Beim Stift passt das Schriftbild, und das Tempo ist mindestens „geht so“.
- [ ] Ich brauche GoodNotes für Tagesnotizen und Besprechungen nicht mehr.

Sind alle Sätze erfüllt, entscheidest du, dass GoodNotes wegfällt. Wie der Übergang dann läuft, steht im Konzept im Abschnitt „Übergang von GoodNotes“. Fehlt noch etwas, laufen beide Wege weiter, und du sammelst, was noch nicht passt.

## Wenn etwas schiefgeht

Deine Änderungen liegen zuerst auf dem Gerät und gehen erst danach zu GitHub. Eine Meldung bedeutet darum fast nie, dass etwas verloren ist.

| Du siehst | Das heißt | Das tust du |
| --- | --- | --- |
| *Bitte den Token eingeben.* oder *Der Token enthält ungültige Zeichen.* | Das Feld **Token** ist leer, oder es steht etwas darin, das nicht zu einem Token gehört. | Füge den Token noch einmal ein. Er besteht nur aus Buchstaben, Ziffern und Unterstrichen. |
| *Das Ablaufdatum muss in der Zukunft liegen.* | Bei **Gültig bis** steht ein Tag von gestern oder früher. | Stelle ein Datum nach heute ein, am besten das Datum, das du bei GitHub gewählt hast. |
| *Der Zugang klappt nicht. Bitte Token prüfen.* | GitHub lehnt den Token ab, oder der Token darf dieses Repo nicht sehen. | Kopiere den Token noch einmal. Prüfe bei GitHub, dass beim Token das richtige Repo gewählt ist. |
| *Der Token darf nicht schreiben. Bitte beim Token „Contents: Read and write“ wählen.* | Die Berechtigung ist zu klein. | Lege den Token neu an (Schritte in 1.2) und wähle **Read and write**. |
| *Keine Verbindung. Bitte später noch einmal.* | Das Gerät hat kein Netz, oder GitHub antwortet nicht. | Prüfe das WLAN und versuche es noch einmal. |
| *GitHub nimmt gerade keine weiteren Anfragen an. Bitte später noch einmal.* | GitHub bremst, weil in kurzer Zeit sehr viel angefragt wurde. | Warte ein paar Minuten. |
| **Zugang erneuern** im Feld des Abgleichs | Der Token ist abgelaufen oder wurde widerrufen. | Tippe darauf. Du landest in den Einstellungen. Tippe auf **Zugang ändern** und trage einen neuen Token ein. Was noch wartet, bleibt erhalten. |
| **Wartet auf Netz · n Änderungen** bleibt stehen | Die Änderungen sind auf dem Gerät gesichert, aber noch nicht bei GitHub. | Prüfe das Netz. Die App versucht es von selbst, wenn das Netz zurück ist, wenn du sie verlässt und wieder öffnest, und alle 3 Minuten. |
| *Konfliktkopie angelegt: …* | Dieselbe Zeile wurde an zwei Orten geändert. | Siehe 2.4. Vergleiche beide Dateien und übernimm von Hand, was du behalten willst. |
| *Abgleich hat nicht geklappt: …* | Eine Datei ließ sich nicht hochladen oder holen. | Schreib dir den Dateinamen und die Uhrzeit auf (siehe Abschnitt 4). Arbeite an anderen Seiten normal weiter. |
| *Abgleich hat nicht geklappt. Neuer Versuch folgt.* | Beim Abgleich ging etwas schief, das keine einzelne Datei betrifft. | Nichts weiter tun, die App versucht es von selbst wieder. Kommt die Meldung immer wieder, schreib dir die Uhrzeit auf (siehe Abschnitt 4). |
| *Das Notizbuch ist schon in einem anderen Fenster offen.* | Dieses Fenster liest nur. | Schließe das andere Fenster und lade dieses neu. |
| *Noch kein Briefing für diesen Tag* | Für diesen Tag gibt es keine Tagesnotiz. | Im Test-Repo: Öffne den 29.10.2026. Im echten Vault: Prüfe, ob die Morgenroutine gelaufen ist. |
| *Briefing offline nicht verfügbar* | Die Tagesnotiz liegt noch nicht auf dem Gerät, und es gibt kein Netz. | Schalte das Netz ein und öffne die Seite noch einmal. |
| *Die letzte Änderung konnte nicht auf diesem Gerät gespeichert werden.* | Der Speicher des Geräts hat die Änderung nicht angenommen. | Prüfe, ob das iPad Speicherplatz hat. Starte die App neu und schreib dir auf, was zuletzt fehlt. |

Du kannst jederzeit zur Testkopie zurück: Zahnrad, **Zugang ändern**, bei **Repository** `johrob-lab/2-gehirn-test` wählen, den Token der Testkopie einfügen und **Prüfen und speichern** antippen. Auch dabei muss zuerst **Gesichert** dastehen.
