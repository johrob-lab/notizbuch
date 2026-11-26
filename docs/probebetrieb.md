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
8. Probiere am PC noch: **Strg** halten und das Mausrad drehen zoomt die Seite, das Mausrad allein verschiebt sie, der Knopf **Ganze Seite** unten links auf der Seite bringt sie zurück. Am Seitenrand dreht das Mausrad jetzt in die Seite davor oder danach weiter (siehe 3.16).

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

1. Schiebe die Seite bei normaler Größe mit einem Finger schräg. Erwartet: Sie geht nur auf und ab, nicht zur Seite. Am oberen und unteren Rand geht es jetzt in den Tag davor oder danach weiter (siehe 3.16). Zoome dann mit zwei Fingern etwas hinein, lege einen Finger auf die Karte **Morgenbriefing** und ziehe nach links oder rechts. Erwartet: Die ganze Seite wandert mit, aber nur bis zu ihrem Rand.
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
2. Termine in der Woche: Tippe oben auf **Woche**. Erwartet: In der Kopfzeile jedes Tages steht rechts neben dem Wochentag in kleiner grauer Schrift, was an diesem Tag ansteht. In der ersten Zeile stehen die Termine, davor Geburtstage und Jahrestage mit 🎂 oder ♥ (siehe 3.15): ganztägige zuerst und nur mit Titel, dann die anderen nach der Uhrzeit, zum Beispiel „09:30 Zahnarzt · 14:00 Runde“. Steht rechts in der Kopfzeile ein Feiertag, endet die Schrift vor seinem Namen. Vergleiche zwei Tage mit deinem Kalender in Outlook und in Google. Erwartet: Es sind dieselben Termine. Die Termin-Datei hat den Stand des Morgenbriefings von heute früh: Einen Termin, den du danach eingetragen hast, siehst du erst morgen.
3. Zu viele Termine: Passt nicht alles in die Zeile, steht am Ende zum Beispiel „+2“: So viele Termine passen nicht mehr hinein. Ein zu langer Titel endet mit „…“. Tippe dann mit dem Finger auf die Tageszahl dieses Tages. Erwartet: Die Tagesseite geht auf, und die Karte **Besprechungen** zeigt alle Termine des Tages. Tippe oben auf **Woche**, so bist du wieder in der Woche.
4. Prioritäten in der Woche: In der zweiten Zeile stehen die Prioritäten des Tages, jede mit einem kleinen Pfeil davor (▸). Erledigte haben einen Haken (✓) und sind blasser. Sie erscheinen erst, wenn die Abendroutine die Tagesseite abgetippt hat, für heute also frühestens am Abend. Gibt es an einem Tag nur Termine oder nur Prioritäten, bekommen sie beide Zeilen. Wechsle zu Obsidian (vom unteren Rand nach oben wischen, kurz halten, Obsidian antippen) und führe **Git: Pull** aus (Befehlspalette öffnen, „Git: Pull“ tippen), damit du den neuesten Stand holst. Öffne dann die Tagesnotiz eines früheren Tages dieser Woche (`05 Daily Notes/JJJJ-MM-TT.md`). Erwartet: Unter **Handschrift** im Block **Prioritäten** stehen dieselben Zeilen wie in der Woche bei diesem Tag. Hat noch kein Tag dieser Woche Prioritäten, prüfe diesen Schritt nach der nächsten Abendroutine.
5. Darüber schreiben: Wechsle zurück ins Notizbuch. Tippe oben in der Werkzeugleiste auf **Kugelschreiber** und schreib mit dem Stift ein Wort quer über die graue Schrift eines Tages. Erwartet: Die Tinte liegt darüber wie überall auf der Seite, und es geht keine Tagesseite auf. Tippe dann oben in der Werkzeugleiste auf den **Radierer**, rechts daneben auf die Radierart **Ganzer Strich**, und streiche über das Wort. Sonst tippt die Abendroutine es ab. Erwartet: Das Wort ist weg, die graue Schrift steht noch da. Warte, bis oben **Gesichert** steht.
6. Monat: Tippe oben auf **Monat**. Erwartet: In jedem Tageskästchen stehen oben links neben der Tageszahl in sehr kleiner Schrift bis zu zwei Zeilen mit den Terminen, ohne Prioritäten. Davor stehen Geburtstage und Jahrestage mit 🎂 oder ♥ (siehe 3.15). Zum Lesen zoomst du mit zwei Fingern hinein. Tippe danach am rechten Ende der Werkzeugleiste auf **Ganze Seite** (vier Ecken, die nach außen zeigen), so ist die Seite wieder ganz im Bild. Tippe mit dem Finger oben in ein Kästchen, dorthin, wo die Tageszahl steht. Erwartet: Wie bisher geht dieser Tag auf. Tippe oben auf **Monat**, so bist du wieder im Monat.
7. Weit voraus: Tippe am rechten Rand auf den Reiter des nächsten Monats (im November also **DEZ**) und such einen Tag, der mehr als 14 Tage entfernt ist und an dem du einen Termin in Google und einen in Outlook hast. Erwartet: Termine aus Google stehen bis etwa zwei Monate im Voraus da. Termine aus Outlook reichen nur 14 Tage weit, bis du im Ablauf „Outlook-Briefing“ die Änderung gemacht hast: Im Baustein **Kalender** wird aus `,15)` ein `,63)`. Die Anleitung Schritt für Schritt steht in der Notiz „Outlook-Briefing Power Automate“ im Vault. Ab dem Morgenbriefing danach reichen auch die Termine aus Outlook etwa zwei Monate weit. Tage vor dem 09.11.2026 bleiben leer, das ist richtig: Die Termin-Datei kennt sie nicht.
8. Nur auf dem Bildschirm: Wechsle zu Obsidian, führe **Git: Pull** aus (Befehlspalette öffnen, „Git: Pull“ tippen) und öffne die Wochenseite aus Schritt 5: `07 Anhänge/Notizbuch/JJJJ/JJJJ KWnn Woche.svg`. Dabei ist nn die Kalenderwoche, sie steht oben auf der Wochenseite (zum Beispiel **Woche 46**, dann heißt die Datei `2026 KW46 Woche.svg`). Erwartet: Die Seite zeigt Rahmen, Linien und Tageszahlen, aber keine Termine und keine Prioritäten. Die stehen nur auf dem Bildschirm der App, damit sich die Datei nicht mit jedem Termin ändert. Fehlt die Datei noch, warte ein paar Sekunden und führe **Git: Pull** noch einmal aus.
9. Passt etwas nicht, mach ein Bildschirmfoto (obere Taste und eine Lautstärketaste gleichzeitig kurz drücken) und gib kurz Bescheid, was du getan und was du gesehen hast.

- [ ] Klappt

### 3.15 Geburtstage und Jahrestage

In der Woche, im Monat und auf der Tagesseite stehen jetzt auch die Geburtstage (mit Kuchen 🎂) und Jahrestage (mit Herz ♥, zum Beispiel Hochzeitstage) aus deinem Google Kalender und aus Outlook. Sie stehen in rotbrauner Schrift, in derselben Farbe wie die Feiertage. Die App liest sie aus der Datei `04 Ressourcen/Kalender/Geburtstage.md`. Wie die Termine stehen sie nur auf dem Bildschirm der App und nie in der Datei der Seite. Wo: echtes Vault, iPad mit Apple Pencil, dazu Obsidian am iPad. Die Datei mit den Geburtstagen schreibt nur das Morgenbriefing, und das läuft nur im echten Vault. Dauer: etwa 10 Minuten.

Mach diese Probe frühestens nach dem Morgenbriefing am 10.11.2026. Das Morgenbriefing schreibt die Datei `Geburtstage.md` jeden Morgen neu. Die Geburtstage aus Google holt es jeden Montag neu, und sofort, wenn die Datei fehlt. Geburtstage aus Outlook kommen dazu, sobald du im Ablauf „Outlook-Briefing“ den Teil 2b eingerichtet hast (die Anleitung Schritt für Schritt steht in der Notiz „Outlook-Briefing Power Automate“ im Vault), und zwar ab dem nächsten Morgenbriefing jeden Tag. Dazu zählen auch ganztägige Einträge mit „Geburtstag“, „Jahrestag“ oder „Hochzeitstag“ im Titel in deinem normalen Outlook-Kalender. Die stehen dann nicht mehr zusätzlich als Termin da. Bis dahin stehen nur die Geburtstage aus Google da.

1. Neue Version holen: Beende die App am iPad einmal ganz: Wische vom unteren Rand nach oben, halte kurz und wische die App nach oben weg. Öffne sie dann wieder über das Symbol auf dem Home-Bildschirm. Sie lädt sich dabei vielleicht noch einmal kurz selbst neu, danach läuft die neue Version.
2. Woche: Tippe oben auf **Woche** und such einen Tag mit Geburtstag. Hat diese Woche keinen, tippe oben auf **›** (nächste Woche), bis einer kommt. Erwartet: In der Kopfzeile dieses Tages steht am Anfang der ersten Zeile in rotbrauner Schrift „🎂 Name“, bei einem Jahrestag „♥ Name“. Das Herz kann rot oder rotbraun aussehen, beides ist richtig. Die Schrift ist etwas kleiner als die der Termine. Hat der Tag mehrere Geburtstage, steht nur ein Kuchen davor und die Namen folgen nebeneinander, getrennt durch Kommas, zum Beispiel „🎂 Max Beispiel, Paul Beispiel“. Jahrestage kommen danach, getrennt durch ein „♥“. Hat der Tag Termine, steht mindestens der erste davon in grauer Schrift gleich daneben oder, an Tagen ohne Prioritäten, in der zweiten Zeile darunter. Haben die Namen und der erste Termin zusammen in der ersten Zeile Platz, stehen alle Namen ganz da. Zu lange Namen und Termine enden mit „…“. Steht kein 🎂 da, prüfe, ob die App oder die Datei schuld ist: Wechsle zu Obsidian (vom unteren Rand nach oben wischen, kurz halten, Obsidian antippen), führe **Git: Pull** aus (Befehlspalette öffnen, „Git: Pull“ tippen) und öffne die Datei `04 Ressourcen/Kalender/Geburtstage.md`. Erwartet: Dort stehen Zeilen wie `- 2026-11-15 | Name | Geburtstag | Google`. Hat die Datei Zeilen und die App zeigt kein 🎂, wiederhole Schritt 1. Fehlt die Datei oder ist sie leer, wartet sie noch auf das Morgenbriefing. Für die Sprachausgabe VoiceOver nennt die App bei diesem Tag zusätzlich „1 Geburtstag“, das musst du nicht prüfen.
3. Mit Google vergleichen: Öffne die App **Google Kalender**, tippe oben links auf die drei Striche (☰) und schau, dass bei **Geburtstage** ein Haken gesetzt ist. Tippe neben die Liste, such denselben Tag und vergleiche. Erwartet: Jeder Name aus Google steht am selben Tag auch im Notizbuch. Weitere Namen kommen aus Outlook, das ist richtig. Was du in Google erst nach dem letzten Montag eingetragen hast, kommt am nächsten Montag dazu. Wechsle dann zurück ins Notizbuch: Wische vom unteren Rand nach oben, halte kurz und tippe auf das Notizbuch.
4. Monat: Tippe oben auf **Monat** und zoome mit zwei Fingern auf einen Tag mit Geburtstag. Hat dieser Monat keinen, tippe am rechten Rand auf den Reiter des nächsten Monats (im November also **DEZ**). Erwartet: Im Kästchen des Tages steht oben links in sehr kleiner rotbrauner Schrift „🎂 Name“. Die Schrift ist noch etwas kleiner als die der Termine. Mehrere Geburtstage stehen hinter einem einzigen Kuchen, getrennt durch Kommas. Hat der Tag auch Termine, stehen die Geburtstage allein in der ersten Zeile und die Termine in der zweiten: mindestens einer, weitere zählt „+1“, „+2“. Nur wenn Name und Termin beide sehr kurz sind, teilen sie sich die erste Zeile. Hat der Tag keine Termine, gehen die Namen in der zweiten Zeile weiter. Lange Namen enden mit „…“. Tippe danach am rechten Ende der Werkzeugleiste auf **Ganze Seite** (vier Ecken, die nach außen zeigen), so ist die Seite wieder ganz im Bild.
5. Tagesseite: Tippe mit dem Finger oben in das Kästchen dieses Tages, dorthin, wo die Tageszahl steht. Erwartet: Die Tagesseite geht auf. Rechts in der Kopfzeile steht in der zweiten Zeile (auf der Höhe von „KW … · Tagesseite“) in rotbrauner Schrift „🎂 Name“. Hat der Tag mehrere Geburtstage, stehen alle hinter einem Kuchen, getrennt durch Kommas. Die Schrift ist hier so groß wie die Zeile. In der Karte **Kalender** rechts oben hat jeder Tag mit Geburtstag oder Jahrestag oben rechts einen kleinen rotbraunen Punkt. Tage mit Terminen haben wie bisher einen Punkt unten in der Mitte.
6. Nur auf dem Bildschirm: Die Datei einer Tagesseite gibt es erst, wenn einmal etwas darauf geschrieben wurde. Tippe darum oben in der Werkzeugleiste auf **Kugelschreiber** und schreib mit dem Stift ein Wort ins Feld **Notizen**. Tippe dann auf den **Radierer**, rechts daneben auf die Radierart **Ganzer Strich**, und streiche über das Wort, sonst tippt die Abendroutine es ab. Warte, bis oben **Gesichert** steht. Wechsle zu Obsidian (vom unteren Rand nach oben wischen, kurz halten, Obsidian antippen), führe **Git: Pull** aus (Befehlspalette öffnen, „Git: Pull“ tippen) und öffne die Datei `07 Anhänge/Notizbuch/JJJJ/JJJJ-MM-TT Tag.svg` mit dem Datum dieser Tagesseite. Erwartet: Die Seite zeigt Datum, Rahmen und Linien, aber keinen Namen. Fehlt die Datei noch, warte ein paar Sekunden und führe **Git: Pull** noch einmal aus.
7. Passt etwas nicht, mach ein Bildschirmfoto (obere Taste und eine Lautstärketaste gleichzeitig kurz drücken) und gib kurz Bescheid, was du getan und was du gesehen hast.

- [ ] Klappt

### 3.16 Weiterscrollen

Unter jeder Tagesseite hängt jetzt der nächste Tag und darüber der Tag davor, mit einem schmalen grauen Spalt dazwischen. In der Woche hängen so die Wochen untereinander, im Monat die Monate. Mit einem Finger schiebst du fließend von einer Seite in die nächste. Lässt du los, wird die Seite, die du in die Mitte des Bildschirms geschoben hast, die offene Seite. Sie bleibt dabei genau dort stehen, wo sie gerade ist. Nach ihr richten sich **‹**, **›**, der markierte Monatsreiter und **Ganze Seite**, und nur in ihre Datei schreibt der Stift. Die Seiten darüber und darunter zeigen, was auf ihnen geschrieben ist, und ihre Geburtstage, in Woche und Monat auch ihre Termine. Wo: echtes Vault, iPad mit Apple Pencil, dazu Obsidian am iPad und für Schritt 14 der Firmen-PC. Obsidian gleicht nur das echte Vault ab, darum geht Schritt 9 nicht in der Testkopie. Dauer: etwa 30 Minuten.

Fünf Dinge sind so gewollt:

- Die Seite rollt nicht nach, auch wenn du schwungvoll schiebst. Sie bleibt dort stehen, wo dein Finger loslässt, wie bisher.
- Setzt du den Stift auf die Seite darüber oder darunter, wird sie nur die offene Seite. Das gilt auch für den grauen Spalt davor: Er gehört schon zu ihr. Dieser erste Stiftkontakt schreibt nichts, erst der nächste.
- Die Karten der Tagesseite (**Morgenbriefing**, **Kalender**, **Besprechungen**) stehen nur auf der offenen Seite. Auf den Seiten darüber und darunter sind ihre Rahmen leer. Ebenso zeigt eine Woche ihre Prioritäten erst, wenn sie offen ist.
- Hast du mit dem Stift oder einem Tipp gewechselt, liegt die Mitte des Bildschirms meist noch auf der vorigen Seite. Schiebst du die vorige Seite danach wieder ganz ins Bild und lässt los, bleibt darum die neue Seite offen: Beim Loslassen wird eine Seite nur dann offen, wenn sie erst bei diesem Schieben in die Mitte gekommen ist. Tippe die vorige Seite kurz mit dem Finger an, dann ist sie wieder offen. Mit dem Stift geht das auch, sein erster Kontakt schreibt dann aber nichts.
- Steht nach dem Schreiben **Diese Seite konnte nicht geladen werden**, sind deine neuen Striche erst in der App, noch nicht in der Datei. Bleib auf der Seite, bis der Hinweis weg ist, oder öffne sie später noch einmal, bevor du die App schließt. Erst dann kommen sie in die Datei. Bis dahin lässt sich in den Einstellungen auch das Repository nicht wechseln.

1. Neue Version holen: Beende die App am iPad einmal ganz: Wische vom unteren Rand nach oben, halte kurz und wische die App nach oben weg. Öffne sie dann wieder über das Symbol auf dem Home-Bildschirm. Sie lädt sich dabei vielleicht noch einmal kurz selbst neu, danach läuft die neue Version.
2. Zum nächsten Tag: Tippe oben auf **Heute**. Lege einen Finger auf das Feld **Notizen** und schiebe die Seite nach oben. Erwartet: Unter der Seite kommt nach einem schmalen grauen Spalt der nächste Tag, oben in seinem Kopf steht sein Datum. Das Schieben läuft dabei flüssig wie bisher, auch solange beide Tage zugleich im Bild sind. Schiebe weiter, bis der nächste Tag die Mitte des Bildschirms bedeckt, und lass los. Erwartet: Die Seite bleibt genau dort stehen und springt nicht.
3. Datum prüfen: Tippe am rechten Ende der Werkzeugleiste auf **Ganze Seite** (vier Ecken, die nach außen zeigen). Erwartet: Der nächste Tag steht ganz im Bild, oben im Kopf sein Datum. Er ist jetzt die offene Seite.
4. Weiter und zurück: Schiebe noch einmal nach oben bis zum übernächsten Tag und lass los. Schiebe dann nach unten, bis der Tag davor die Mitte bedeckt, und lass wieder los. Tippe jedes Mal auf **Ganze Seite**. Erwartet: Offen ist immer der Tag, den du in die Mitte geschoben hast. Schiebe zum Schluss nur so weit nach oben, dass unten ein Stück vom nächsten Tag zu sehen ist, und lass los, bevor er die Mitte erreicht. Tippe auf **Ganze Seite**. Erwartet: Es ist noch derselbe Tag offen wie davor.
5. Woche und Monat: Tippe oben auf **Woche** und schiebe nach oben, bis unten die nächste Woche kommt. Erwartet: Schon jetzt stehen bei ihren Tagen die Termine und Geburtstage wie in der offenen Woche (siehe 3.14 und 3.15). Schiebe weiter, bis die nächste Woche die Mitte bedeckt, lass los und tippe auf **Ganze Seite**. Erwartet: Oben steht die nächste Woche, zum Beispiel **Woche 47**. Tippe oben auf **Monat** und mach dasselbe mit dem nächsten Monat. Erwartet: Auch hier läuft das Schieben flüssig, solange zwei Monate im Bild sind. Der nächste Monat ist offen, und am rechten Rand ist jetzt sein Reiter markiert.
6. Hineingezoomt: Bleib im Monat und zoome mit zwei Fingern auf etwa das Dreifache. Schiebe dann mit einem Finger mehrmals nach oben, bis unten der nächste Monat kommt, und weiter, bis er die Mitte des Bildschirms bedeckt. Erwartet: Das Schieben läuft auch hineingezoomt flüssig, auch solange beide Monate im Bild sind. Lass los. Erwartet: Die Seite bleibt so groß, wie sie war, und springt nicht. Am rechten Rand ist jetzt der Reiter dieses Monats markiert. Tippe auf **Ganze Seite**.
7. Stift und Finger auf der Seite darunter: Tippe oben auf **Heute**. Schiebe die Seite nur so weit nach oben, dass unten ein Stück vom nächsten Tag zu sehen ist, und lass los. Setz den Stift auf den nächsten Tag und zieh einen kurzen Strich. Erwartet: Nirgends entsteht ein Strich, weder heute noch auf dem nächsten Tag. Schiebe die Seite mit dem Finger ein kleines Stück und lass los. Tippe auf **Ganze Seite**. Erwartet: Der nächste Tag ist offen, oben steht sein Datum. Das kleine Schieben hat nicht zurückgewechselt. Tippe oben auf **Heute**, schiebe wieder so weit und tippe diesmal mit einem Finger kurz auf den nächsten Tag. Erwartet: Auch so wird er die offene Seite (prüfe es mit **Ganze Seite**).
8. Stift liegen lassen: Tippe oben auf **Heute** und schiebe die Seite so weit nach oben, dass unten der Kopf des nächsten Tages und der leere Rahmen seines **Morgenbriefings** zu sehen sind. Lass los. Leg die Hand wie beim Schreiben auf den Bildschirm, setz den Stift in den Kopf des nächsten Tages neben sein Datum und lass ihn dort liegen. Bewege Hand und Stift ein wenig hin und her, ohne den Stift abzuheben. Erwartet: Die Seite verschiebt sich nicht, und es entsteht kein Strich. Heb Hand und Stift ab. Tippe oben auf **Heute** und mach dasselbe noch einmal, setz den Stift diesmal aber in den leeren Rahmen des **Morgenbriefings** des nächsten Tages. Erwartet: Auch jetzt verschiebt sich die Seite nicht. Tippe zum Schluss auf **Ganze Seite**. Erwartet: Der nächste Tag ist offen, und auf ihm steht kein Strich.
9. Strich vor und nach dem Wechsel: Tippe oben auf **Heute** und schreib mit dem Stift an eine freie Stelle im Feld **Notizen** das Wort „eins“. Schiebe die Seite mit dem Finger nach oben, bis der nächste Tag die Mitte des Bildschirms bedeckt und sein Feld **Notizen** gut zu sehen ist, und lass los. Schreib sofort, ohne Pause, an eine freie Stelle in diesem Feld das Wort „zwei“. Erwartet: Das ganze Wort erscheint sofort, auch sein erster Strich, und bleibt stehen. Das gilt auch auf einem Tag, auf dem noch nichts steht. Seine Datei gibt es dann noch nicht, und die App fragt dafür erst bei GitHub nach. Meist dauert das nur einen Augenblick, bei langsamem Netz länger. Schreiben kannst du trotzdem sofort, gespeichert wird, sobald GitHub geantwortet hat. Fehlt ein Strich oder verschwindet einer nach einem Augenblick wieder, gib Bescheid. Wechsle zu Obsidian (vom unteren Rand nach oben wischen, kurz halten, Obsidian antippen) und führe **Git: Pull** aus (Befehlspalette öffnen, „Git: Pull“ tippen). Öffne die Datei `07 Anhänge/Notizbuch/JJJJ/JJJJ-MM-TT Tag.svg` mit dem Datum von heute und danach die mit dem Datum des nächsten Tages. Erwartet: „eins“ steht nur in der Datei von heute, „zwei“ nur in der des nächsten Tages. Fehlt eine Datei oder ein Wort noch, warte ein paar Sekunden und führe **Git: Pull** noch einmal aus.
10. Aufräumen, damit die Abendroutine die Wörter nicht abtippt: Wechsle zurück ins Notizbuch (vom unteren Rand nach oben wischen, kurz halten, Notizbuch antippen). Tippe oben in der Werkzeugleiste auf den **Radierer**, rechts daneben auf die Radierart **Ganzer Strich** und streiche nur über „zwei“, sonst verschwinden auch andere Striche. Tippe oben auf **Heute** und streiche nur über „eins“. Hast du zu viel erwischt, tippe auf den Pfeil **Rückgängig**. Tippe zum Schluss in der Werkzeugleiste auf **Kugelschreiber**. Erwartet: Beide Wörter sind weg. Warte, bis oben **Gesichert** steht.
11. Blättern wie bisher: Tippe oben auf **›**. Erwartet: Der nächste Tag geht auf wie bisher, mit seinem Kopf oben im Bild. Tippe auf **‹** und dann auf **Heute**. Erwartet: Auch das geht wie bisher.
12. Vollbild mit Ring: Tippe auf das Zahnrad und bei **Werkzeuge im Vollbild** auf **Kreis**. Tippe oben auf **Heute** und dann auf **Vollbild**. Schiebe die Seite mit einem Finger nach oben, bis der nächste Tag die Mitte bedeckt, und lass los. Erwartet: Wie ohne Vollbild bleibt die Seite stehen und springt nicht. Tippe mit dem Finger auf den runden Knopf, so geht der Ring auf, und tippe auf den Knopf mit den vier Ecken, die nach außen zeigen (**Ganze Seite**). Erwartet: Der nächste Tag steht ganz im Bild, oben im Kopf sein Datum. Öffne den Ring wieder und tippe auf **›**. Erwartet: Wie bisher geht der Tag danach auf, mit seinem Kopf oben im Bild. Öffne den Ring und tippe auf **‹**. Erwartet: Wieder ist der Tag offen, zu dem du geschoben hattest. Öffne den Ring noch einmal und tippe auf den Knopf mit den vier Ecken, die nach innen zeigen (**Vollbild aus**).
13. Vollbild mit Lasche: Tippe auf das Zahnrad und bei **Werkzeuge im Vollbild** auf **Tab**. Tippe oben auf **Heute** und dann auf **Vollbild**. Tippe mit dem Finger auf den kleinen Griff mit den drei Punkten am linken Rand. Erwartet: Die Leiste klappt aus. Lege einen Finger in die Mitte der Seite und schiebe nach oben, bis der nächste Tag die Mitte bedeckt. Lass los. Erwartet: Die Leiste bleibt offen. Tippe in ihr auf die vier Ecken nach außen (**Ganze Seite**). Erwartet: Der nächste Tag steht ganz im Bild. Tippe in der Leiste auf **›** und danach auf **‹**. Erwartet: Wie bisher geht erst der Tag danach und dann wieder dieser Tag auf, und die Leiste bleibt dabei offen. Tippe in der Leiste ganz unten auf die vier Ecken nach innen (**Vollbild aus**). Tippe dann auf das Zahnrad und stelle bei **Werkzeuge im Vollbild** wieder die Wahl ein, die dir besser gefällt.
14. Firmen-PC: Öffne die App in Edge und klicke oben auf **Heute**. Dreh das Mausrad nach unten, bis der nächste Tag die Mitte bedeckt, und hör dann auf. Erwartet: Einen Augenblick später ist er die offene Seite. Klicke unten links auf der Seite auf **Ganze Seite**: Oben steht sein Datum. Dreh das Rad ein Stück nach oben, bis oben ein Stück vom Tag davor zu sehen ist, und klicke einmal kurz darauf. Erwartet: Jetzt ist der Tag davor offen (prüfe es mit **Ganze Seite**).
15. Passt etwas nicht, mach ein Bildschirmfoto (obere Taste und eine Lautstärketaste gleichzeitig kurz drücken) und gib kurz Bescheid, was du getan und was du gesehen hast.

- [ ] Klappt

### 3.17 Wochenseite rechts

Die rechte Spalte der Wochenseite sieht jetzt anders aus. Oben steht ein gedruckter Monatskalender, darunter drei Felder: **Wochenziele**, **Prioritäten und Aufgaben** und **Notizen**. Ein Tipp mit dem Finger auf einen Tag im Kalender öffnet die Tagesseite dieses Tages. Die Abendroutine tippt die drei Felder in die Tagesnotiz des Montags dieser Woche ab, und offene Wochenaufgaben stehen dann im Morgenbriefing. Wo: echtes Vault, iPad mit Apple Pencil, dazu Obsidian am iPad. Die Abendroutine läuft nur im echten Vault, darum geht Schritt 8 nicht in der Testkopie. Dauer: etwa 20 Minuten.

Schreib in dieser Probe echte Ziele, Aufgaben und Notizen deiner aktuellen Woche. Dann musst du nichts wieder wegradieren. Nur das Zeichen in Schritt 7 radierst du wieder weg.

1. Neue Version holen: Beende die App am iPad einmal ganz: Wische vom unteren Rand nach oben, halte kurz und wische die App nach oben weg. Öffne sie dann wieder über das Symbol auf dem Home-Bildschirm. Sie lädt sich dabei vielleicht noch einmal kurz selbst neu, danach läuft die neue Version. Mach das auf jedem Gerät, auf dem du das Notizbuch nutzt (iPad, Firmen-PC), bevor du rechts auf einer Wochenseite etwas schreibst. Am Firmen-PC drückst du in Edge die Taste **F5** (oder klickst auf den runden Pfeil zum Neuladen), dann lädt auch er die neue Version. Auch dort muss das passiert sein, bevor du rechts auf einer Wochenseite schreibst. Ein Gerät mit altem Stand legt die Striche rechts sonst wieder in ein einziges großes Feld.
2. Die neue rechte Spalte: Tippe oben auf **Woche**. Erwartet: Rechts steht von oben nach unten zuerst ein Kalender. Sein Titel ist der Monat in Großbuchstaben mit Jahr, zum Beispiel „NOVEMBER 2026“. Darunter steht eine Kopfzeile mit „KW“ und „Mo“ bis „So“ und dann sechs Zeilen mit den Tagen. Links stehen die Kalenderwochen. Die Zeile der Woche, die du gerade offen hast, ist hell grüngrau hinterlegt. Heute ist mit einem Kreis markiert (nur am Bildschirm, nie in der Datei, und nur wenn heute zum gezeigten Monat gehört; sonst siehst du nur den Rahmen um den Tag links). Feiertage des Monats stehen in der rotbraunen Feiertagsfarbe. Tage der Nachbarmonate sind blass. Unter dem Kalender stehen drei Rahmen: **Wochenziele** (5 Zeilen, der Rahmen ist leicht getönt), **Prioritäten und Aufgaben** (9 Zeilen, vor jeder Zeile ein Kreis) und **Notizen** (7 Zeilen).
3. Woche über zwei Monate: Tippe oben auf **›**, bis du bei einer Woche bist, die in zwei Monaten liegt, zum Beispiel 30.11. bis 6.12. Erwartet: Der Kalender zeigt den Monat, in dem der Donnerstag dieser Woche liegt. Die hinterlegte Zeile beginnt mit einem blassen Tag des anderen Monats. Tippe dann so oft auf **‹**, bis du wieder bei der Woche von heute bist.
4. Tag antippen: Tippe mit dem Finger auf eine Zahl im Kalender. Erwartet: Die Tagesseite dieses Tages geht auf. Tippe oben auf **Woche**, so bist du zurück. Tippe jetzt auf einen blassen Tag, also einen Tag des Vormonats oder des Folgemonats. Erwartet: Auch er geht auf. Tippe wieder oben auf **Woche**.
5. Hand auf dem Kalender: Tippe oben in der Werkzeugleiste auf **Kugelschreiber**. Leg die Hand wie beim normalen Schreiben auf den Bildschirm, so dass sie auf dem kleinen Kalender oben rechts ruht, und schreib mit dem Stift ein paar Wörter in das Feld von Montag links. Erwartet: Es geht keine Tagesseite auf, und die Wörter erscheinen auf der Seite. Geht doch eine Tagesseite auf, tippe oben auf **Woche** und gib Bescheid (Schritt 10). Streiche die Wörter danach mit dem **Radierer** und der Radierart **Ganzer Strich** wieder weg, sonst tippt die Abendroutine sie ab, und tippe wieder auf **Kugelschreiber**.
6. Schreiben: Tippe oben in der Werkzeugleiste auf **Kugelschreiber**. Schreib mit dem Stift ein oder zwei echte Ziele dieser Woche in **Wochenziele**, drei Aufgaben in **Prioritäten und Aufgaben** und eine Notiz in **Notizen**. Tippe in der Werkzeugleiste auf die Farbe **Grün (erledigt)** und schreib eine weitere, schon erledigte Aufgabe grün in die nächste freie Zeile. Mach in ihrem Kreis zusätzlich einen grünen Haken. Tippe danach wieder auf eine andere Farbe, zum Beispiel Schwarz, für die offenen Aufgaben. Erwartet: Die Schrift liegt in den Feldern wie sonst auf der Seite. Warte, bis oben **Gesichert** steht.
7. Der Stift tippt nie: Setz den Stift auf eine Zahl im Kalender und zieh einen kleinen Strich. Erwartet: Es geht keine Tagesseite auf, nur das Zeichen entsteht. Ein Stiftzeichen im Kalender gehört zu keinem Feld, und die Abendroutine würde es sonst unter „Frei (Wochenseite)“ abtippen. Tippe darum oben in der Werkzeugleiste auf den **Radierer**, rechts daneben auf die Radierart **Ganzer Strich**, und streiche über das Zeichen. Erwartet: Das Zeichen ist weg, der Kalender ist wieder sauber. Tippe zum Schluss in der Werkzeugleiste wieder auf **Kugelschreiber**, sonst löscht der nächste Strich auf der Seite ganze Zeilen. Erwartet: Der Kugelschreiber ist gewählt. Warte, bis oben **Gesichert** steht.
8. Abendroutine prüfen: Warte, bis die nächste Abendroutine gelaufen ist. Wechsle dann zu Obsidian (vom unteren Rand nach oben wischen, kurz halten, Obsidian antippen) und führe **Git: Pull** aus (Befehlspalette öffnen, „Git: Pull“ tippen). Öffne die Tagesnotiz des Montags dieser Woche (`05 Daily Notes/JJJJ-MM-TT.md`). Erwartet: Unter **Handschrift** stehen drei Blöcke: **Wochenziele**, **Aufgaben der Woche** und **Notizen der Woche**. Jeder beginnt mit der Zeile `Quelle: [[JJJJ KWnn Woche.svg]]`, wobei nn die Kalenderwoche ist. In **Aufgaben der Woche** ist jede Zeile ein Kästchen: Die grüne Aufgabe mit dem Haken steht als `- [x]`, alle anderen als `- [ ]`. Erwartet am nächsten Morgen: Die offenen Aufgaben (`- [ ]`) stehen im Morgenbriefing unter „GoodNotes und Notizbuch“. Fehlt etwas, warte ein paar Minuten und führe **Git: Pull** noch einmal aus.
9. Bekannte Grenze: Schrift, die vor dem Update rechts auf einer Wochenseite stand, kann die Abendroutine nach dem ersten neuen Strich dort ein zweites Mal abtippen. Doppelte Zeilen löschst du einfach in der Tagesnotiz.
10. Passt etwas nicht, mach ein Bildschirmfoto (obere Taste und eine Lautstärketaste gleichzeitig kurz drücken) und gib kurz Bescheid, was du getan und was du gesehen hast.

- [ ] Klappt

### 3.18 Tabelle Arbeitsvorbereitung

Eine Besprechung kann jetzt eine Tabellenseite haben. Im Kopf der Seite wählst du bei **Art** den Eintrag **Tabelle Arbeitsvorbereitung**, und die Seite zeigt eine vorgedruckte Tabelle mit 12 Spalten: Schritt, Monat, Std, ×, ×, Anz., wer, Fahrzeuge, Ressourcen, Mat. €, Fremd € und Bemerkung. Du schreibst mit dem Stift hinein. Die Abendroutine (um 19:00) tippt geänderte Zeilen ab und legt eine Datei `<Besprechung> Tabelle.csv` neben die Seiten ins Vault. Der Knopf **Für Excel herunterladen** im Kopf holt diese Datei, am iPad über das Teilen-Menü, am Firmen-PC als Download. Wo: echtes Vault, iPad mit Apple Pencil, dazu der Firmen-PC und Excel. Die Abendroutine läuft nur im echten Vault, darum geht diese Probe nicht in der Testkopie. Dauer: etwa 30 Minuten an Tag 1, dazu etwa 10 Minuten an Tag 2.

Nimm für die Probe eine Besprechung mit erfundenen Namen, damit nichts Echtes in einer Testdatei landet. Die Beispiele unten sind erfunden.

1. Neue Version holen: Beende die App am iPad einmal ganz: Wische vom unteren Rand nach oben, halte kurz und wische die App nach oben weg. Öffne sie dann wieder über das Symbol auf dem Home-Bildschirm. Am Firmen-PC drückst du in Edge die Taste **F5**. Mach das auf jedem Gerät, bevor du eine Tabellenseite anlegst. Ein Gerät mit altem Stand zeigt eine Tabellenseite nicht an, sondern den Hinweis „Diese Seite stammt aus einer neueren Version der App. Bitte neu laden.“ mit einem Knopf zum Neuladen, und es schreibt die Seite nie.
2. Besprechung öffnen: Tippe oben auf **Tag** und öffne den Tag der Besprechung. Tippe in der Karte **Besprechungen** auf den Termin. Die App legt die Besprechung an und öffnet Seite 1. Erwartet: Über der Schreibfläche stehen **Thema**, **Datum**, **Zeit**, **Ort**, **Projekt** und neu **Art**. Bei **Art** steht **Notizen**.
3. Art umstellen: Tippe auf das Feld **Art** und wähle **Tabelle Arbeitsvorbereitung**. Erwartet: Die Seite zeigt die Tabelle mit den 12 Spaltenköpfen und 27 Zeilen. Am linken Rand jeder Zeile steht klein und blass ihre Nummer. In der Seitenleiste steht neu der Knopf **Für Excel herunterladen**. Steht auf der Seite schon etwas, fragt die App vorher „Auf der Seite steht schon etwas. Art trotzdem ändern?“. Tippe dann auf **Ändern**, um zu wechseln, oder auf **Abbrechen**, um die Seite zu lassen, wie sie ist. In dieser Probe ist die Seite noch leer, die Frage kommt also nicht.
4. Erstes Vorhaben schreiben: Tippe in der Werkzeugleiste auf **Kugelschreiber**. Schreib in Zeile 1 quer über die ganze Zeile einen Punkt „•“ und danach zum Beispiel `Musterbrücke 4711 km 12,345, 120 m × 1,70 m, 120 kg`. Der Punkt am Anfang sagt der Abendroutine: Hier beginnt ein Vorhaben. Alle Zeilen darunter gehören dazu, bis der nächste Punkt kommt.
5. Zwei Schritte schreiben: Schreib in Zeile 2 in die Spalten: Schritt `Vorarbeiten`, Monat `3`, Std `50`, erstes × `2`, wer `KI`, Fahrzeuge `BCR 8`, Ressourcen `SAS ET 8`. Schreib in Zeile 3: Schritt `Einbau`, Monat `4`, Std `120`, erstes × `4`, wer `IB`, Fahrzeuge `HTW 16`, Ressourcen `AZF/SAS/AdB 16`, Fremd € `2000`, Bemerkung `Kran`.
6. Fortsetzung schreiben: Der Platz in Fahrzeuge reicht oft nicht. Schreib in Zeile 4 nur in die Spalte Fahrzeuge `LKW 8` und lass Schritt und Std leer. Erwartet für später: Diese Zeile gehört zum Schritt darüber und hängt dort `LKW 8` an.
7. Summe schreiben: Schreib in Zeile 5 unter die Schritte nur die Zahl `580` (50 × 2 + 120 × 4 Stunden), mit einem Strich darüber. Erwartet für später: Die Summe wird keine eigene Zeile, weil der Block Schritte hat. Excel rechnet selbst.
8. Zweites Vorhaben schreiben: Lass Zeile 6 leer. Schreib in Zeile 7 einen Punkt „•“ und `Musterbahn Lichtraum 40 lm, 8 Konsolen`. Schreib in Zeile 8 etwas, zum Beispiel `Test` in die Spalte Schritt, und streiche die ganze Zeile mit einem Strich quer durch. Schreib in Zeile 9: Schritt `SU`, Monat `9`, Std `48`, erstes × `2`, Anz. `6`, wer `KI`, Fahrzeuge `BCR 48`. Warte, bis oben **Gesichert** steht.
9. Knopf vor dem Abend: Tippe auf **Für Excel herunterladen**. Erwartet: Es kommt keine Datei, sondern der Hinweis „Noch nicht abgetippt. Die CSV kommt mit der Abendroutine.“ Das ist richtig, solange die Abendroutine noch nicht gelaufen ist.
10. Abendroutine abwarten: Warte, bis die Abendroutine nach 19:00 gelaufen ist. Wechsle dann zu Obsidian (vom unteren Rand nach oben wischen, kurz halten, Obsidian antippen) und führe **Git: Pull** aus (Befehlspalette öffnen, „Git: Pull“ tippen). Erwartet im Ordner `07 Anhänge/Notizbuch/JJJJ`: neben den Seiten liegen `<Besprechung> Tabelle.csv` und `<Besprechung> Tabelle.json`. Öffne sie nicht von Hand zum Bearbeiten, sie schreibt nur die Abendroutine. In der Tagesnotiz steht im Block der Besprechung eine Zeile wie `Tabelle S1: 3 Zeilen in der CSV, neu gelesen Zeile 1 bis 5 und 7 bis 9.` und den Link auf die CSV, bei unsicheren Werten dazu ein Zusatz „unsicher Zeile …“. Im Abendüberblick steht unter „Neu aus dem Notizbuch“ `Tabelle <Thema>: CSV neu (3 Zeilen, 0 unsicher)`. Steht dort statt der Zahl „nicht geschrieben“, hat die Routine an diesem Abend etwas Ungültiges gelesen und darum an diesem Abend für alle Besprechungen mit Tabellenseiten nichts geschrieben, nicht nur für diese. Die Zeile „nicht geschrieben“ steht dann bei jeder Besprechung, die an diesem Abend dran gewesen wäre. Die Routine liest die Zeilen am nächsten Abend noch einmal. Steht „nicht gelesen“, konnte sie eine Tabellenseite nicht lesen und behält deren bisherige Zeilen in der CSV. Gib in beiden Fällen Bescheid (Schritt 17).
11. Am iPad herunterladen: Öffne die Tabellenseite wie in Schritt 2: Tippe oben auf **Tag**, öffne den Tag der Besprechung und tippe in der Karte **Besprechungen** auf den Termin. Seite 1 geht auf, es ist die Tabellenseite. Tippe auf **Für Excel herunterladen**. Erwartet: Das Teilen-Menü geht auf. Tippe auf **OneDrive** und wähle den Ordner `Planung\Quellen\2028\Besprechungen`. Erscheint stattdessen der Hinweis „Die CSV ist geladen. Zum Teilen bitte noch einmal tippen.“, hat das Laden zu lange gedauert. Das ist erwartet und kein Fehler: Tippe innerhalb einer Minute noch einmal auf **Für Excel herunterladen**, dann geht das Teilen-Menü auf. Wartest du länger, lädt die App die CSV neu, und der Hinweis kann noch einmal kommen. Erscheint „Zum Herunterladen braucht die App Netz.“, hast du kein Netz: Schalte WLAN ein und tippe noch einmal. Steht im Kopf der Seite „Stand der CSV: TT.MM., HH:MM. Neuere Striche kommen mit der nächsten Abendroutine dazu.“, hast du nach dem Lauf der Abendroutine noch geschrieben. Die CSV kommt trotzdem, sie zeigt den Stand vom Abend. Das ist ebenfalls kein Fehler.
12. In Excel öffnen und prüfen: Öffne die CSV in Excel (am PC im Ordner `Planung\Quellen\2028\Besprechungen`). Erwartet: Die Umlaute stehen richtig, zum Beispiel „Musterbrücke“. Jedes Feld hat seine eigene Spalte (24 Spalten von `Besprechung` bis `Unsicher`). Zahlen haben ein Dezimalkomma und werden nicht zu Datumswerten, zum Beispiel steht in Mass2 `1,7` und nicht „Jän“. Es gibt genau drei Zeilen: `Vorarbeiten`, `Einbau` und `SU`. In `Einbau` steht bei Fahrzeuge `HTW 16, LKW 8`. Die Summe 580 und die durchgestrichene Zeile 8 fehlen. Bei `Vorarbeiten` stehen die drei Maße des ersten Vorhabens: `120` und `m` in Mass1 und Einheit1, `1,7` und `m` in Mass2 und Einheit2, `120` und `kg` in Mass3 und Einheit3. Bei `SU` stehen die Maße `40 lm` und `8 Stk` des zweiten. Die Spalte `Unsicher` zeigt Spalten, die die KI nicht sicher lesen konnte. Prüfe diese Werte gegen die Seite.
13. Am Firmen-PC herunterladen: Öffne das Notizbuch in Edge und gehe wie in Schritt 2 zur Besprechung: Klicke oben auf **Tag**, öffne den Tag der Besprechung und klicke in der Karte **Besprechungen** auf den Termin. Seite 1 geht auf. Klicke auf **Für Excel herunterladen**. Erwartet: Edge lädt die Datei in den Ordner Downloads, mit dem Namen `<Besprechung> Tabelle.csv`. Öffne sie in Excel und prüfe wie in Schritt 12. Der Knopf geht am Firmen-PC auch dann, wenn dort sonst nichts änderbar ist.
14. Am nächsten Tag eine Zahl ändern: Öffne die Tabellenseite wie in Schritt 11, am iPad also über **Tag**, den Tag der Besprechung und den Termin. Radiere mit dem **Radierer** und der Radierart **Ganzer Strich** nur die Zahl in Std von Zeile 2 (`50`) und schreib `60` hinein. Tippe zum Schluss wieder auf **Kugelschreiber**. Warte, bis oben **Gesichert** steht.
15. Nach dem nächsten Lauf prüfen: Warte, bis die Abendroutine gelaufen ist, und lade die CSV wie in Schritt 11 oder 13 neu herunter. Erwartet: Nur Zeile 2 (`Vorarbeiten`) hat sich geändert, Faktor1 ist jetzt `60`. `Einbau` und `SU` sind Zeichen für Zeichen gleich wie am Vortag. In der Tagesnotiz steht „neu gelesen Zeile 2“.
16. Gelöscht heißt fehlt: Das machst du erst, nachdem du in Schritt 15 die neue CSV geprüft hast. Öffne die Tabellenseite wie in Schritt 14, streiche Zeile 9 (`SU`) mit einem Strich quer durch und warte, bis oben **Gesichert** steht. Warte dann auf den Lauf des nächsten Abends und lade die CSV neu herunter. Erwartet: Die Zeile `SU` ist weg, dafür steht das Vorhaben Musterbahn Lichtraum jetzt als Zeile 7 mit leerem Schritt in der CSV, mit den Maßen `40 lm` und `8 Stk`. Es sind also weiter drei Zeilen. Die Tagesnotiz sagt „neu gelesen Zeile 9“. Eine Zeile, die fehlt, heißt für Excel gelöscht oder durchgestrichen.
17. Passt etwas nicht, mach ein Bildschirmfoto (obere Taste und eine Lautstärketaste gleichzeitig kurz drücken) und gib kurz Bescheid, was du getan und was du gesehen hast. Schreib dazu die Uhrzeit und, wenn es eine gab, die genaue Meldung oder den Hinweis auf.

- [ ] Klappt

### 3.19 Besprechungen und Briefing durchgehen

Zwei Neuerungen. Oben in der Leiste steht ein Link **Besprechungen**. Er öffnet eine Liste aller Besprechungen, die neueste oben, mit einer Überschrift pro Monat. Ein Eintrag sieht so aus: `Di 17.11. · 09:00 · Abstimmung Muster 2028 · 2 Seiten`. Die Angabe „2 Seiten“ steht nur, wenn die Besprechung mehr als eine Seite hat. Ein Tipp auf einen Eintrag öffnet die Besprechung. Auf der Tagesseite hat die Karte **Morgenbriefing** außerdem den Knopf **Briefing durchgehen**. Er macht dieselbe Karte so groß wie die Fläche unter den Leisten, mit größerer Schrift, damit du das Briefing in der Besprechung in Ruhe durchgehen kannst. Wo: echtes Vault, iPad mit Apple Pencil, dazu der Firmen-PC. Dauer: etwa 15 Minuten.

Nimm für die Probe einen Tag, an dem das Morgenbriefing schon in der Tagesnotiz steht und mindestens eine Aufgabe zum Abhaken enthält. Die Probe ändert im echten Vault nur eines: die Häkchen, die du in Schritt 5, 6 und 8 setzt. Nimm sie wieder zurück, indem du das Kästchen noch einmal antippst (am PC anklicken). Lass keinen Probetext stehen: Die App löscht im Morgenbriefing nie einen Eintrag, ein Testeintrag ließe sich dort nicht mehr entfernen.

1. Neue Version holen: Beende die App am iPad einmal ganz: Wische vom unteren Rand nach oben, halte kurz und wische die App nach oben weg. Öffne sie dann wieder über das Symbol auf dem Home-Bildschirm. Am Firmen-PC drückst du in Edge die Taste **F5**. Mach das auf jedem Gerät, bevor du etwas prüfst.
2. Liste öffnen: Tippe oben in der Leiste auf **Besprechungen**. Halte das iPad dafür quer. Erwartet: Die Liste geht auf, die Adresse endet auf `#/besprechungen`. Die neueste Besprechung steht oben, darüber eine Überschrift mit Monat und Jahr, zum Beispiel „November 2026“. Jeder Eintrag hat Wochentag und Datum, Uhrzeit und Thema, getrennt durch einen Punkt in der Mitte. Hat eine Besprechung mehrere Seiten, steht am Ende „· 2 Seiten“ (die Anzahl, nicht die Nummern). Die Pfeile **‹** und **›** sind aus, **Heute** bringt dich zur Tagesseite von heute, und **Vollbild** gibt es auf der Liste nicht. Tippe auf einen Eintrag. Erwartet: Die Besprechung geht auf, bei mehreren Seiten mit der ersten vorhandenen. Tippe oben wieder auf **Besprechungen**, um zur Liste zurückzukommen.
3. Hochformat: Drehe das iPad ins Hochformat. Erwartet: Auf den meisten iPads steht nur noch **Bespr.** auf dem Knopf, denn der Name wird kurz, wenn das Fenster schmaler als 900 Punkte ist. Auf einem großen iPad mit 12,9 oder 13 Zoll (etwa 1024 Punkte breit) bleibt **Besprechungen** stehen, das ist richtig. Auf jedem Gerät bleibt die Leiste eine einzige Zeile und bricht nicht um, und der Knopf öffnet die Liste. Tippe darauf, die Liste geht genauso auf. Drehe das iPad danach wieder ins Querformat. Wahlweise am PC: Zieh das Edge-Fenster schmaler, bis aus **Besprechungen** **Bespr.** wird, und wieder breiter, bis der lange Name zurückkommt.
4. Ohne Netz: Tippe zuerst oben auf **Heute**, denn die Liste soll in diesem Schritt neu aufgehen. Schalte den Flugmodus ein (Einstellungen, Flugmodus). Schau dann oben rechts am Bildschirmrand neben der Akku-Anzeige: Das WLAN-Symbol (der kleine Fächer) muss weg sein. Steht es noch da, hat sich das iPad gemerkt, dass WLAN im Flugmodus an bleibt, und das iPad ist noch im Netz. Schalte WLAN dann unter Einstellungen, WLAN aus. Wechsle zurück ins Notizbuch und tippe oben auf **Besprechungen**. Erwartet: Die Liste bleibt nicht beim Laden hängen. Die Besprechungen, die auf diesem Gerät liegen, stehen gleich da, zum Beispiel die, die du in Schritt 2 geöffnet hast. Bei einer Besprechung mit mehreren Seiten kann dabei „· 2 Seiten“ fehlen: Auf dem Gerät liegt oft nur die Seite, die du geöffnet hast, und ohne Netz zählt die Liste nur, was auf dem Gerät liegt. Das ist richtig so. Darüber kann kurz „Besprechungen werden geladen“ stehen, danach steht dort der Hinweis „Ohne Netz siehst du nur die Besprechungen auf diesem Gerät.“ Lass die Liste offen, schalte den Flugmodus wieder aus (und WLAN wieder ein, falls du es eben ausgeschaltet hast) und wechsle zurück ins Notizbuch. Erwartet: Sobald das Netz wieder da ist, verschwindet der Hinweis von selbst, und es stehen auch die Besprechungen aus dem Vault in der Liste, wieder mit „· 2 Seiten“. Tippe dann oben noch einmal auf **Besprechungen**. Erwartet: Die Liste lädt neu (dabei kann kurz „Besprechungen werden geladen“ erscheinen) und steht danach wieder vollständig da, ohne Hinweis. So lädst du die Liste jederzeit von Hand neu, zum Beispiel wenn der Hinweis einmal stehen bleibt, obwohl das Netz wieder da ist.
5. Briefing durchgehen: Tippe oben auf **Tag** und öffne einen Tag mit Morgenbriefing. Tippe in der Karte **Morgenbriefing** auf **Briefing durchgehen**. Erwartet: Die Karte füllt die ganze Fläche unter Leiste und Werkzeugleiste, die Schrift ist größer. Die Abschnitte sind so offen oder zu wie vorher. Oben bleiben die Leiste und die Werkzeugleiste sichtbar. Tippe ein Kästchen an. Erwartet: Es ist abgehakt. Gibt es einen zugeklappten Abschnitt (mit ▸ vor dem Namen, an einem vergangenen Tag etwa **Abendüberblick (automatisch)**), tippe darauf. Erwartet: Er klappt auf. Tippe unten in das Feld **Ergänzen**, tippe ein Wort und lösche es mit der Rücktaste wieder. Tippe nicht auf **Hinzufügen**. Erwartet: Das Feld nimmt den Text an, und in der Liste erscheint nichts Neues. Das Rad und der Schnellwechsel liegen an ihrem Platz unten rechts und decken dort einen Teil von **Hinzufügen** zu. Zieh sie bei Bedarf mit dem Finger weg. Tippe auf **Fertig**. Erwartet: Die Karte schrumpft zurück auf ihren Platz auf der Tagesseite. Das Häkchen und der aufgeklappte Abschnitt sind noch da. Öffne die große Ansicht noch einmal, tippe auf **›** oder **‹**, um den Tag zu wechseln. Erwartet: Die große Ansicht ist zu, und die andere Tagesseite zeigt ihre Karte normal.
6. Im Vollbild: Geh mit **‹** oder **›** zurück zum Tag aus Schritt 5. Tippe oben in der Leiste auf **Vollbild** und in der Karte **Morgenbriefing** wieder auf **Briefing durchgehen**. Erwartet: Die Karte füllt jetzt den ganzen Bildschirm, oben rechts steht **Fertig**. Der Stand zeigt sich nur, solange etwas noch nicht gesichert ist. Damit du ihn sicher siehst: Schalte den Flugmodus ein (wie in Schritt 4, ohne WLAN-Symbol), wechsle zurück ins Notizbuch, hake ein Kästchen ab und warte etwa 15 Sekunden. Erwartet: Oben in der Zeile von **Fertig**, links daneben, steht der Stand, etwa „Wartet auf Netz · 1 Änderung“, und verdeckt nichts von der Karte. Eine Meldung (etwa, dass der Zugang bald abläuft) schwebt gleich unter dieser Zeile. Nimm das Häkchen wieder zurück, schalte den Flugmodus wieder aus (und WLAN wieder ein, falls du es ausgeschaltet hast) und wechsle zurück ins Notizbuch. Erwartet: Nach kurzer Zeit ist der Stand wieder weg. Hast du in den Einstellungen bei **Werkzeuge im Vollbild** **Tab** gewählt, liegt am linken Rand auf halber Höhe die Lasche. Erwartet: Die Kästchen beginnen rechts von ihr, keines liegt darunter. Tippe auf **Fertig** und verlasse das Vollbild über das Rad oder die Lasche mit **Vollbild aus**.
7. Stift und Finger auf der großen Ansicht: Öffne **Briefing durchgehen** noch einmal und wähle in der Werkzeugleiste **Kugelschreiber**. Schreib mit dem Stift ein paar Striche auf die große Karte. Erwartet: Es entsteht keine Tinte. Tippe auf **Fertig**. Erwartet: Auf der Tagesseite darunter ist kein neuer Strich. Öffne die große Ansicht wieder. Wische mit einem Finger über die Karte, ziehe zwei Finger auseinander und tippe mit zwei Fingern kurz auf die Karte. Erwartet: Die Seite darunter bewegt sich nicht, zoomt nicht und nimmt nichts zurück. Die Karte selbst scrollt, wenn sie länger ist als die Fläche. Tippe auf **Fertig**. Erwartet: Die Tagesseite steht genau wie vorher.
8. Am Firmen-PC: Öffne das Notizbuch in Edge und drücke **F5**. Lass das Notizbuch dabei nur in einem einzigen Edge-Tab offen, denn ein zweiter Tab liest nur, und dort lässt sich nichts abhaken. Klicke oben auf **Besprechungen**. Erwartet: Die Liste geht auf wie in Schritt 2. Klicke auf **Heute**. Die Tagesseite von heute geht auf. Klicke in der Karte **Morgenbriefing** auf **Briefing durchgehen** und drücke die Taste **Esc**. Erwartet: Die große Ansicht schließt sich. Öffne sie noch einmal, klicke in ein Kästchen und drücke dann **Esc**. Erwartet: Sie schließt sich auch jetzt. Öffne sie ein drittes Mal, klicke unten in das Feld **Ergänzen**, ohne etwas zu tippen, und drücke dort **Esc**. Erwartet: Die große Ansicht bleibt offen, denn in einem Textfeld gehört **Esc** dem Feld. (Im Feld zum Bearbeiten eines Eintrags bricht **Esc** das Bearbeiten ab und verwirft, was du dort getippt hast.) Drücke jetzt, noch im Feld **Ergänzen**, dreimal die Taste **Tab**. Erwartet: Der Rahmen springt auf den Schalter **Aufgabe**, dann auf **Hinzufügen** und dann auf den ersten Monatsreiter am rechten Rand, und er ist dabei immer zu sehen. Drehe das Mausrad über der offenen Karte. Erwartet: Die Seite darunter bewegt sich nicht. Klicke dann auf **Fertig**. Erwartet: Sie schließt sich.
9. Passt etwas nicht, mach ein Bildschirmfoto (obere Taste und eine Lautstärketaste gleichzeitig kurz drücken) und gib kurz Bescheid, was du getan und was du gesehen hast. Schreib dazu die Uhrzeit und, wenn es eine gab, die genaue Meldung auf.

- [ ] Klappt

### 3.20 Frag Claude

Neu ist ein Knopf mit drei Funken ganz rechts in der Werkzeugleiste. Er öffnet unter der Werkzeugleiste ein Fenster, in dem du Claude (die KI) etwas zu der offenen Seite fragst. Die Antwort kommt Wort für Wort, darunter steht, was sie gekostet hat. Du kannst sie kopieren oder in **Ergänzungen** der Tagesnotiz übernehmen. Claude bekommt nur dann etwas von dir, wenn du **Fragen** tippst. Damit das geht, brauchst du einen Schlüssel (das ist eine Art Passwort für die Verbindung zu Claude) und Guthaben. Beides richtest du in den Schritten 2 bis 5 in der Claude Console ein. Die Console ist das Verwaltungsportal von Claude und auf Englisch, darum stehen ihre Knöpfe hier auf Englisch. Wo: echtes Vault, iPad mit Apple Pencil, dazu ein Computer für die Console und der Firmen-PC. Dauer: etwa 25 Minuten.

Frag in der Probe nichts Echtes oder Vertrauliches. Das Bild der Seite geht an Claude, nimm also eine Tagesseite mit harmlosem Inhalt.

1. Neue Version holen: Beende die App am iPad einmal ganz: Wische vom unteren Rand nach oben, halte kurz und wische die App nach oben weg. Öffne sie dann wieder über das Symbol auf dem Home-Bildschirm. Am Firmen-PC drückst du in Edge die Taste **F5**. Mach das auf jedem Gerät, bevor du etwas prüfst.
2. Guthaben verknüpfen: Öffne auf claude.ai die Einstellungen und dort **Billing** (Abrechnung). Im Abschnitt **API credits** tippst du auf **Link organization**. Wähle die Console-Organisation, die du nehmen willst, oder lege eine neue an. Lies die Bedingungen und tippe noch einmal auf **Link organization**. Öffne dann `platform.claude.com/settings/billing` und schau bei **Promotional credits** nach. Erwartet: Dort stehen 100 $. Wichtig: Die Verknüpfung kannst du später nicht selbst ändern. Überlege dir die Organisation also vorher.
3. Workspace anlegen: Ein Workspace ist ein eigener Bereich in der Console, in dem Schlüssel und Kosten getrennt von allem anderen laufen. Öffne `platform.claude.com/settings/workspaces` und tippe auf **Create workspace**. Als Name schreibst du `Notizbuch`, die Farbe ist egal. Tippe noch einmal auf **Create workspace**. Erwartet: Der Workspace **Notizbuch** steht in der Liste.
4. Limit setzen: Öffne `platform.claude.com/settings/spend-limits`. Wähle unter **Workspace limits** den Workspace **Notizbuch**. Tippe bei **Monthly spend limit** auf **Set limit**, trage `20` ein und speichere. Erwartet: Das Limit von 20 $ steht beim Workspace. Mehr als das kann in einem Monat nicht abgebucht werden.
5. Schlüssel anlegen: Öffne `platform.claude.com/settings/keys` und tippe auf **Create key**. Als Name schreibst du `Notizbuch iPad`. Wähle den Workspace **Notizbuch**. Als Ablauf wählst du die längste Dauer, die die Console anbietet. Lege den Schlüssel an und kopiere ihn. Die Console zeigt ihn nur dieses eine Mal. Leg ihn nirgends sonst ab, keine Notiz, keine Mail. Füge ihn gleich in Schritt 6 ein.
6. Schlüssel in die App: Tippe in der App auf das Zahnrad und such den Abschnitt **KI**. Tippe in das Feld **KI-Schlüssel**, füge den Schlüssel ein und tippe auf **Prüfen und speichern**. Erwartet: Auf dem Knopf steht kurz „Wird geprüft …“, unter dem Feld dann „Gespeichert.“, und über dem Feld steht „Schlüssel: gespeichert“. Das Feld ist wieder leer, der Schlüssel ist nirgends zu sehen. Das ist richtig so. Steht stattdessen „Ohne Netz lässt sich der Schlüssel nicht prüfen.“, obwohl das iPad online ist, schreib die Meldung genau auf. Bei **Modell** ist **Sonnet (genauer)** schon gewählt, lass es so.
7. Knopf finden: Öffne die Tagesseite von heute. Erwartet: Ganz rechts in der Werkzeugleiste steht ein neuer Knopf mit drei Funken. Er heißt **Frag Claude**. Drehe das iPad ins Hochformat und wieder zurück. Erwartet: Der Knopf bleibt, und die Werkzeugleiste bleibt in beiden Lagen eine einzige Zeile.
8. Frage stellen: Schreib vorher mit dem Stift ein paar Wörter auf die Seite. Tippe dann auf die Funken. Erwartet: Das Fenster geht unter der Werkzeugleiste rechts auf, die Monatsreiter bleiben frei, und die Tastatur geht auf. Unter dem Feld **Was willst du wissen?** steht der Schalter **Seite mitschicken** mit dem Namen der Seite, zum Beispiel „Do 29.10.2026“. Halte das iPad einmal im Querformat, während die Tastatur offen ist. Erwartet: Das Feld, der Schalter und **Fragen** bleiben über der Tastatur zu sehen. Tippe auf das Mikrofon der Tastatur, sag „Was steht auf dieser Seite?“ und tippe auf **Fragen**. Erwartet: Die Tastatur geht zu. Während die Antwort kommt, steht statt **Fragen** der Knopf **Stopp**. Die ersten Worte der Antwort kommen nach ein paar Sekunden, und sie kommt dann Wort für Wort. Endet jede Frage mit „Claude ist gerade nicht erreichbar. Bitte gleich noch einmal.“, obwohl Schritt 6 geklappt hat, schreib die Meldung genau auf. Claude nennt etwas, das du von Hand auf die Seite geschrieben hast, so weißt du, dass das Bild angekommen ist. Der Hinweis „Das Bild der Seite ließ sich nicht erstellen. Claude bekam nur die Angaben zur Seite.“ darf nicht kommen. Unter der Antwort steht eine Kostenzeile, etwa „≈ 1,2 Cent“. Stelle dann noch eine Frage: Tippe erst in das Feld **Was willst du wissen?**, damit die Tastatur aufgeht, sag oder tippe die Frage und tippe diesmal auf die Eingabetaste der Tastatur. Erwartet: Auf ihr steht „Senden“, und ein Tipp darauf schickt die Frage genauso ab wie **Fragen**.
9. Blättern und nachfragen: Tippe bei offenem Fenster auf **›**. Erwartet: Das Fenster bleibt offen, und der Schalter nennt den neuen Tag. Tippe auf **Neue Frage** und frag zum Beispiel „Und was steht hier?“. Erwartet: Die Antwort kommt wieder Wort für Wort, mit eigener Kostenzeile. Tippe dann bei offenem Fenster auf **‹**, um zurück zu heute zu kommen. Erwartet: Das Fenster bleibt offen, und der Schalter nennt wieder den Tag von heute.
10. Kopieren und übernehmen: Tippe auf **Neue Frage** und frag „Fass die Seite in einem Satz zusammen“. Tippe unter der Antwort auf **Kopieren**. Erwartet: Der Knopf zeigt zwei Sekunden lang „Kopiert“. Öffne die Notizen-App und füge den Text ein. Erwartet: Die Antwort steht dort so, wie Claude sie geschrieben hat. Wechsle zurück ins Notizbuch und tippe auf **In Ergänzungen übernehmen**. Erwartet: Kurz steht „Wird übernommen …“, dann „Übernommen“, und der Knopf ist gesperrt. Tippe auf **Schließen** und schau auf der Tagesseite von heute in die Karte **Morgenbriefing**. Erwartet: Dort stehen unter **Ergänzungen** die Zeile `Claude, HH:MM: Fass die Seite in einem Satz zusammen` (mit der Uhrzeit der Frage) und darunter die Antwort. Jede Zeile der Antwort ist ein eigener Punkt, nummerierte Zeilen behalten ihre Nummer. Die Zeilen bleiben stehen, auch wenn du sie nicht mehr brauchst. Lösche sie bei Bedarf in Obsidian. Achte dort darauf: Eine Zeile mit `- [ ]` ginge am nächsten Abend als Aufgabe nach Outlook.
11. Stift, Finger und Hand: Tippe auf **Frag Claude**, damit das Fenster offen ist. Schreib mit dem Pencil in das Feld **Was willst du wissen?**. Erwartet: Das iPad macht aus deiner Handschrift Text im Feld. Tippe gleich danach, noch bevor du etwas anderes tust, mit einem Finger auf **Fragen**. Erwartet: Die Frage geht ab wie sonst auch. Schreib dann mit dem Stift auf das Fenster, aber außerhalb des Felds. Erwartet: Es entsteht keine Tinte. Wische mit dem Finger über das Fenster. Erwartet: Die Seite darunter bleibt stehen. Schreib neben dem Fenster auf die Seite, während deine Hand auf dem Fenster liegt. Erwartet: Im Fenster passiert nichts, und die Tastatur bleibt zu. Schließe das Fenster mit **Schließen**. Schreib danach auf der Seite und blättere mit dem Finger. Erwartet: Beides geht wie immer. Öffne auf der Tagesseite das Fenster noch einmal, so dass es über der kleinen Kalenderkarte liegt, und tippe auf **Schließen**. Erwartet: Das Fenster schließt sich, und es geht kein Tag auf.
12. Ohne Netz: Schalte den Flugmodus ein (Einstellungen, Flugmodus, und wie in 3.19 darauf achten, dass das WLAN-Symbol weg ist). Wechsle zurück ins Notizbuch, öffne das Fenster, schreib eine Frage und tippe auf **Fragen**. Erwartet: „Ohne Netz kann Claude nicht antworten.“ Deine Frage bleibt im Feld stehen. Schalte den Flugmodus wieder aus (und WLAN wieder ein, falls du es ausgeschaltet hast), wechsle zurück ins Notizbuch und tippe noch einmal auf **Fragen**. Erwartet: Es klappt.
13. Vollbild: Tippe oben in der Leiste auf **Vollbild**. Erwartet: Im Rad (und, wenn bei **Werkzeuge im Vollbild** **Tab** gewählt ist, in der Lasche am linken Rand) gibt es den Eintrag **Frag Claude**. Tippe darauf. Erwartet: Das Fenster geht auf. Verlasse das Vollbild über das Rad oder die Lasche mit **Vollbild aus**.
14. Am Firmen-PC: Öffne das Notizbuch in Edge und drücke **F5**. Öffne die Einstellungen. Erwartet: Es gibt dort keinen Abschnitt **KI**. In der Werkzeugleiste gibt es keinen Knopf mit den drei Funken. Frag Claude gibt es nur am iPad.
15. Wahlweise Kosten ansehen: Öffne in der Console `platform.claude.com` und dort **Usage**. Erwartet: Im Workspace **Notizbuch** stehen die paar Cent, die deine Fragen gekostet haben.
16. Passt etwas nicht, mach ein Bildschirmfoto (obere Taste und eine Lautstärketaste gleichzeitig kurz drücken) und gib kurz Bescheid, was du getan und was du gesehen hast. Schreib dazu die Uhrzeit und, wenn es eine gab, die genaue Meldung auf.

- [ ] Klappt

### 3.21 Sperrenkalender

Die Sperrenseite zeigt jetzt zwei Monate je Seite, zum Beispiel „März und April 2027“, und je Tag drei Schreibfelder: Platz 1 links, Platz 2 in der Mitte, Platz 3 rechts. Jedes Feld nimmt eine Sperre auf: Du schreibst mit dem Stift den Abschnitt so hin, wie er in deiner Liste heißt, und Gleis und Uhrzeit dürfen danach folgen, zum Beispiel „Gl. 2 8-14“. Es gibt eine Seite für **IB** und eine für **Lehne**. Neu ist auch der Excel-Stand: Das Makro in deiner Sperren-Datei schreibt alle Sperren aus Excel in eine Datei (`Sperren IB 2027 Excel.csv` im Ordner Downloads). Am Firmen-PC holst du sie mit dem Knopf **Stand aus Excel holen** in die App. Danach stehen die abgestimmten Sperren grau in den freien Plätzen. Das Grau ist nur zum Ansehen: Es kommt nie in deine Seite und nie in die Liste für Excel, und es nimmt keinen Tipp an. Schreibst du mit dem Stift in einen grauen Platz, bleibt deine Schrift stehen, und das Grau rückt in den nächsten freien Platz. Das Morgenbriefing erinnert dich weiter rechtzeitig, die Sperre bei der Betra anzumelden (Betra steht für Betriebs- und Bauanweisung), und zeigt dir, wann eine neue Sperrenliste einzulesen ist. Die Liste für Excel lässt sich auf der Seite herunterladen. Ein Makro (ein kleines Programm in Excel) übernimmt sie in die Sperren-Datei. Wie das geht, steht im Vault in der Notiz „Sperren einlesen“. Wo: echtes Vault, iPad mit Apple Pencil, am zweiten und dritten Tag dazu der Firmen-PC mit Excel. Dauer: etwa 60 Minuten, verteilt auf drei Tage.

Schreib für die Probe zwei Abschnitte aus deiner Liste hin, aber nimm welche, die es ruhig geben darf. Die Probe legt echte Erinnerungen an. In diesem Text heißen sie „Muster Abschnitt 1“ und „Muster Abschnitt 2“.

1. Neue Version holen: Beende die App am iPad einmal ganz: Wische vom unteren Rand nach oben, halte kurz und wische die App nach oben weg. Öffne sie dann wieder über das Symbol auf dem Home-Bildschirm. Am Firmen-PC drückst du in Edge die Taste **F5**. Mach das auf jedem Gerät, bevor du etwas prüfst.
2. Seite öffnen: Tippe oben in der Leiste auf **Sperren**. Erwartet: Es geht die Seite `Sperren IB` auf, mit den zwei Monaten, die gerade laufen, nebeneinander. Im Kopf steht der Name in dieser Form: „Sperren IB, März und April 2027“, nur eben mit deinen zwei Monaten. Der erste Monat eines Jahres heißt hier „Jänner“. Wochenenden und Feiertage sind hinterlegt, und am Montag steht die Kalenderwoche (KW). Jeder Tag hat eine Zeile mit drei Feldern nebeneinander.
3. Blättern und wechseln: Tippe auf **›**, bis „Jänner und Februar 2027“ offen ist. Erwartet: Jeder Tipp springt um zwei Monate weiter. Hast du noch keinen Excel-Stand geholt, steht im Kopf „Noch kein Excel-Stand für IB 2027“. Tippe dann auf **Lehne** und danach wieder auf **IB**. Erwartet: Die zwei Monate bleiben gleich, nur die Fachlinie wechselt.
4. Sperren eintragen und die Feldgröße prüfen: Such Mitte Februar 2027 zwei Werktage hintereinander, zum Beispiel den 15. und den 16. Halte das iPad im Hochformat. Schreib zuerst in normaler Größe mit dem Pencil, mit deiner gewohnten Schrift und nicht extra klein: am 15. in **Platz 1** (das linke Feld der Zeile) den Abschnitt „Muster Abschnitt 1“ und am 16. in **Platz 3** (das rechte Feld) einen zweiten Abschnitt „Muster Abschnitt 2“. Zoome dann mit zwei Fingern in die Seite hinein. Schreib am 16. in **Platz 1** wieder „Muster Abschnitt 1“, danach im selben Feld Gleis und Uhrzeit, zum Beispiel „Gl. 2 8-14“. Schreib im gezoomten Bild auch in Platz 3 am 16. hinter „Muster Abschnitt 2“ noch „Gl. 1“. Zoome mit zwei Fingern wieder heraus. **Platz 2** (das mittlere Feld) bleibt in diesem Schritt überall leer. Erwartet: Die Schrift bleibt in jedem Fall in ihrem Feld, auch in Platz 3 am rechten Rand. Schreib dir auf, ob die Felder groß genug zum Schreiben sind, bei normaler Größe und beim Hineinzoomen. Das beurteilst du. Damit liegt die Sperre schon im Zeitraum der Erinnerung, die Betra-Anmeldung steht also bald an.
5. Hochkant und quer: Das iPad ist nach Schritt 4 schon im Hochformat. Dreh es ins Querformat und wieder zurück ins Hochformat. Erwartet: In beiden Lagen ist die Leiste oben eine einzige Zeile, und im Kopf der Seite sind **IB**, **Lehne**, **Stand aus Excel holen** und **Für Excel herunterladen** gut zu lesen.
6. Am nächsten Morgen: Öffne die Tagesseite und schau in die Karte **Morgenbriefing**. Erwartet: Dort stehen zwei Zeilen „Betra anmelden bis …“: eine für „Muster Abschnitt 1“ (15. bis 16.02.) und eine für „Muster Abschnitt 2“ (16.02.). Jeder Abschnitt ist eine eigene Sperre mit eigener Erinnerung. Je nach Datum ist jede Zeile normal, gelb und fett oder rot und fett. Dazu steht eine Zeile „Sperren IB 2027 einlesen (n neu)“, wobei n die Zahl der neuen Sperren ist.
7. Betra-Nr. eintragen: Tippe an der Zeile „Betra anmelden bis …“ mit „Muster Abschnitt 1“ in das Feld für die Betra-Nr. Die Zeile mit „Muster Abschnitt 2“ lässt du in dieser Probe unberührt. Tippe zuerst etwas Falsches ein, zum Beispiel `123`, und tippe dann auf **Eintragen**. Erwartet: Es kommt der Hinweis „Bitte nur die Betra-Nr. eintragen, 5 bis 8 Ziffern.“, und nichts wird gespeichert. Lösche die Eingabe, tippe die richtige Nummer ein (nur Ziffern, 5 bis 8 Stellen) und tippe wieder auf **Eintragen**. Erwartet: An der Zeile von „Muster Abschnitt 1“ steht „Betra-Nr. …“ mit deiner Nummer. Die Zeile von „Muster Abschnitt 2“ bleibt, wie sie war.
8. Am Firmen-PC die Liste laden: Öffne das Notizbuch in Edge und lass es dabei nur in einem einzigen Edge-Tab offen. Klicke oben in der Leiste auf **Sperren** und dann auf **›**, bis „Jänner und Februar 2027“ offen ist. Steht dort **Lehne** als gewählt, klicke auf **IB**. Klicke dann auf **Für Excel herunterladen**. Erwartet: Im Download-Ordner liegt die Datei `Sperren IB 2027.csv`. Eine Seite des Jahres 2027 genügt, die Liste enthält das ganze Jahr.
9. Makro neu einspielen und einlesen: Leg zuerst eine **Kopie** deiner Sperren-Datei IB an, nie das Original (Anleitung „Sperren einlesen“, Abschnitt „Erster Lauf mit einer Kopie“, Schritte 1 bis 5). Spiel dann in der Kopie das neue Makro ein (drei Plätze je Tag, dazu **SperrenAusgeben**): Anleitung „Sperren einlesen“, Abschnitt „Neue Version einspielen“, erst das alte Modul entfernen, dann die neue `SperrenEinlesen.bas` importieren. Drücke `Alt+F8` → **Blattschutz_AlleEntsperren** → **Ausführen** und gib das Kennwort ein. Drücke dann `Alt+F8` → **SperrenEinlesen** → **Ausführen**. Wähle im Fenster zur Dateiauswahl `Sperren IB 2027.csv` aus **Downloads** → **Öffnen**. Erwartet: Das Makro zeigt einen Bericht mit den neuen Zeilen, und darunter steht die Frage „Eintragungen jetzt nach Datum sortieren?“. Bericht und Frage stehen im selben Fenster, und nach **Ja** ist der Bericht weg. Lies den Bericht darum zuerst und schreib dir zwei der neuen Sperren auf. Klicke dann auf **Ja**. Die Zeilen stehen im Blatt Eintragungen, und in der Spalte AI steht „NB IB-2027-…“, bei Sperren in Platz 3 mit der Endung „-3“. Danach erscheint die Meldung „Excel-Stand geschrieben: Downloads\Sperren IB 2027 Excel.csv (n Sperren)“ im Fenster „Sperren ausgeben“. Erwartet: Die Datei `Sperren IB 2027 Excel.csv` liegt neu in **Downloads**. Klicke **OK**.
10. Excel-Stand in die App holen (Firmen-PC): Öffne das Notizbuch in Edge, klicke auf **Sperren** → **IB** und öffne mit **›** oder **‹** eine Seite des Jahres 2027. Klicke auf **Stand aus Excel holen**. Wähle im Fenster `Sperren IB 2027 Excel.csv` aus **Downloads** → **Öffnen**. Erwartet: Im Kopf steht „Excel-Stand vom TT.MM.JJJJ, HH:MM“, und darunter die Meldung „Excel-Stand übernommen: n Sperren, davon k aus dem Notizbuch.“ (bei einer einzigen Sperre „1 Sperre“). Das k ist die Zahl der Sperren, die vom Notizbuch stammen, also deine aus Schritt 4. Die abgestimmten Sperren stehen grau in den Plätzen, und deine eigenen Einträge stehen als Schrift da und nicht noch einmal grau. Blättere ein paar Seiten weiter: Das Grau ist auf allen Seiten des Jahres da. Warte, bis oben **Gesichert** steht. Wählst du aus Versehen die Datei der anderen Fachlinie, kommt „Die Datei ist für Lehne 2027, offen ist IB 2027.“ und es wird nichts übernommen.
11. Am iPad: Beende die App wie in Schritt 1 und öffne die Seite `Sperren IB` mit dem Jahr 2027 noch einmal. Erwartet: Im Kopf steht „Excel-Stand vom …“, und das Grau ist da. Suche einen Tag, an dem **Platz 1** grau ist, und schreib mit dem Pencil quer über diese graue Sperre, zum Beispiel ein kurzes „Test“. Erwartet: Deine Schrift bleibt stehen, und das graue Feld rückt in den nächsten freien Platz am selben Tag. Tippe mit dem Finger auf eine graue Sperre. Erwartet: Es passiert nichts. Radiere dann dein „Test“ mit dem **Radierer** und der Radierart **Ganzer Strich** wieder weg. Erwartet: Das Grau steht wieder in Platz 1. Optional, einmal am iPad selbst: Das iPad kann den Excel-Stand auch direkt holen, ohne den Firmen-PC. Lege dafür die Datei `Sperren IB 2027 Excel.csv` vorher in einen Ordner, den das iPad sieht, zum Beispiel in **iCloud Drive** → einen Ordner `Probe`. Tippe auf der Seite `Sperren IB` auf **Stand aus Excel holen**. Erwartet: Das Auswahlfenster von iOS geht auf. Tippe unten auf **Durchsuchen**, dann auf den Ordner, in dem die Datei liegt, zum Beispiel **iCloud Drive** oder **Auf meinem iPad**, und tippe die Datei `Sperren IB 2027 Excel.csv` an. Erwartet: Das Fenster schließt sich, im Kopf steht „Excel-Stand vom …“, und die Meldung „Excel-Stand übernommen: n Sperren, davon k aus dem Notizbuch.“ erscheint wie in Schritt 10.
12. Nur ausgeben: Bleib in der Kopie aus Schritt 9 (oder öffne sie wieder, falls du sie zugemacht hast). Drücke `Alt+F8` → **SperrenAusgeben** → **Ausführen**. Der Blattschutz darf dabei an bleiben. Erwartet: Dieselbe Meldung „Excel-Stand geschrieben: Downloads\Sperren IB 2027 Excel.csv (n Sperren)“ im Fenster „Sperren ausgeben“, mit derselben Zahl wie in Schritt 9. Klicke **OK**. Die Datei in **Downloads** hat jetzt eine neue Uhrzeit, in der Mappe ändert sich nichts.
13. Zweiter Lauf: Lass `Alt+F8` → **SperrenEinlesen** noch einmal mit derselben Liste `Sperren IB 2027.csv` laufen. Erwartet: Der Bericht nennt keine neuen Zeilen, und in der Datei ändert sich nichts. Danach kommt wieder die Meldung „Excel-Stand geschrieben: …“ mit derselben Zahl.
14. Kopie schließen: Schließ die Kopie ohne zu speichern und lösch sie (Anleitung „Sperren einlesen“, „Erster Lauf mit einer Kopie“, Schritte 8 und 9).
15. In Outlook: Schau am Abend nach Schritt 4 in die Liste **Obsidian**. Erwartet: Dort liegen zwei To-dos „Betra anmelden bis …“, eins für „Muster Abschnitt 1“ und eins für „Muster Abschnitt 2“. Schau am Abend nach Schritt 7 noch einmal nach. Erwartet: Das To-do für „Muster Abschnitt 1“ ist erledigt, das für „Muster Abschnitt 2“ bleibt offen.
16. Deine Uhrzeit bleibt, die Betra-Nr. kommt dazu (am Tag nach Schritt 7, bevor du die neue Liste in die echte Datei einliest): Die Abendroutine hat deine Betra-Nr. aus Schritt 7 in die Liste übernommen. Erwartet am Morgen in der Karte **Morgenbriefing**: Die Zeile „Betra anmelden bis …“ für „Muster Abschnitt 1“ ist weg, die für „Muster Abschnitt 2“ steht weiter da, und es steht wieder „Sperren IB 2027 einlesen (n neu)“ da, weil die Betra-Nr. noch nach Excel muss. Lade am Firmen-PC die Liste noch einmal herunter wie in Schritt 8. Erwartet: Im Download-Ordner liegt eine zweite Liste, meist `Sperren IB 2027 (1).csv`. Lass die Liste aus Schritt 8 liegen, du brauchst beide. Leg wie in Schritt 9 eine neue **Kopie** deiner Sperren-Datei IB an, nie das Original (Anleitung „Sperren einlesen“, Abschnitt „Erster Lauf mit einer Kopie“, Schritte 1 bis 5). Steht unter **Alt+F8** kein **SperrenEinlesen**, spiel das Makro ein wie in Schritt 9. Lies zuerst die alte Liste aus Schritt 8 ein, so wie in der Anleitung unter „Jedes Mal“, Schritte 4 bis 7, aber wähl im Fenster zur Dateiauswahl diesmal die ältere Datei `Sperren IB 2027.csv`, nicht die neueste. Stehen deine Sperren schon in der Datei, ändert dieser Lauf nichts. Klick dann im Blatt Eintragungen in der Zeile vom 16.02.2027 mit „Muster Abschnitt 1“ auf die Zelle in Spalte E (von), tipp eine andere Uhrzeit ein, zum Beispiel `9:00`, und drück **Enter**. Lies danach die neue Liste ein (`Sperren IB 2027 (1).csv`, „Jedes Mal“, Schritte 5 bis 7). Erwartet: Im Bericht steht „Betra-Nr. ergänzt: 2“ (je eine Zeile für den 15. und den 16. mit „Muster Abschnitt 1“) und „Im Notizbuch geändert: 0“. In Spalte B beider Zeilen steht deine Betra-Nr. aus Schritt 7. In Spalte B der Zeile vom 16. mit „Muster Abschnitt 2“ bleibt es leer, denn für diese Sperre hast du keine Nummer eingetragen. Prüfe bei „Betra-Nr. ergänzt“ an einem Tag mit zwei Sperren von Hand, dass die Nummer in der Zeile mit „Muster Abschnitt 1“ gelandet ist (Spalte C). In Spalte E der Zeile vom 16. steht weiter `9:00`, und in Spalte AI steht nur die Kennung „NB IB-2027-…“, ohne „im Notizbuch geändert“ davor. Schließ die Kopie danach ohne zu speichern und lösch sie (Anleitung „Sperren einlesen“, „Erster Lauf mit einer Kopie“, Schritte 8 und 9).
17. Passt etwas nicht, mach ein Bildschirmfoto (obere Taste und eine Lautstärketaste gleichzeitig kurz drücken) und gib kurz Bescheid, was du getan und was du gesehen hast. Schreib dazu die Uhrzeit und, wenn es eine gab, die genaue Meldung auf.

- [ ] Klappt

### 3.22 Frag Claude im ganzen Gehirn

Das Fenster **Frag Claude** kennt jetzt nicht mehr nur die offene Seite, sondern dein ganzes Vault („Gehirn“). Das iPad hält dafür eine Kopie aller Notizen und der Listen im Ordner `07 Anhänge/Notizbuch/`. Dateien mit „recovery“, „passw“, „token“ oder „.key“ im Namen, versteckte Ordner und die `CLAUDE.md` sind nicht dabei. Die Kopie liegt nur auf dem iPad. Sie geht nur an GitHub, um sich aufzufrischen, und an Claude geht nur, was du mit **Fragen** abschickst. Claude sucht in der Kopie selbst. Über der Antwort steht für jeden Suchschritt eine graue Zeile, zum Beispiel „Sucht „TFZF“ … 3 Treffer“. Unter der Antwort stehen die **Quellen**, also die Notizen, aus denen sie stammt. Claude kann nichts ändern. Schreiben geht weiter nur über **In Ergänzungen übernehmen**. Wo: echtes Vault, iPad mit Apple Pencil, dazu ein Computer für die Console. Dauer: etwa 30 Minuten. Voraussetzung: 3.20 ist erledigt, der Schlüssel ist gespeichert und es ist Guthaben da.

Eine Frage mit Suche kostet etwa 2 bis 6 Cent (mit dem Modell **Sonnet (genauer)**). Die Kosten stehen unter der Antwort in der Kostenzeile, zum Beispiel „≈ 3,5 Cent“. Das Limit hast du in 3.20 in der Claude Console im Workspace **Notizbuch** gesetzt. Mehr als das kann nicht abgebucht werden.

Die Fragen unten stellst du so, wie sie hier stehen, sie fragen nach deinen echten Notizen. Die Antworten gehen an Claude, frag also nur, was du Claude auch zeigen willst.

1. Neue Version holen: Beende die App am iPad einmal ganz: Wische vom unteren Rand nach oben, halte kurz und wische die App nach oben weg. Öffne sie dann wieder über das Symbol auf dem Home-Bildschirm. Mach das, bevor du etwas prüfst.
2. Erstes Laden: Öffne die Tagesseite von heute und tippe ganz rechts in der Werkzeugleiste auf die drei Funken (**Frag Claude**). Erwartet: Das Fenster geht auf, und unter den Knöpfen steht eine Zeile wie „Gehirn wird geladen … 40 von 130“. Die erste Zahl wächst. Du kannst schon fragen, während sie läuft, Claude erfährt dann, dass die Kopie noch nicht vollständig ist. Warte für diese Probe, bis die Zeile weg ist. Erwartet: Die Zeile verschwindet, wenn alles da ist, und es bleibt keine Zeile zurück. Das erste Laden dauert je nach Größe des Vaults ein paar Minuten. Bricht es ab, weil das Netz weg ist, steht „Gehirn: 40 von 130 Notizen da, der Rest kommt mit Netz.“ Dann machst du mit Netz weiter, der Rest wird beim nächsten Öffnen oder bei der nächsten Frage nachgeholt.
3. Erste Frage: Tippe in das Feld **Was willst du wissen?** und schreib oder sag: `Was findest du zum Thema Bestellung TFZF Lehne im April?` Lass den Schalter **Seite mitschicken** an oder schalte ihn aus, beides ist in Ordnung. Tippe auf **Fragen**. Erwartet: Statt **Fragen** steht **Stopp**. Über der Antwort erscheinen graue Zeilen, eine je Suchschritt, zum Beispiel „Sucht „TFZF“ … 3 Treffer“ oder „Liest Tagesnotiz Mi 25.11.2026“. Dann kommt die Antwort Wort für Wort. Unter ihr steht die Überschrift **Quellen** mit einem Knopf je Quelle, dann die Kostenzeile „≈ … Cent“. Es sind höchstens 8 Schritte. Wird die Grenze erreicht, steht „Grenze von 8 Schritten erreicht“, und Claude sagt in der Antwort, dass die Suche abgebrochen wurde.
4. Zweite Frage: Tippe auf **Neue Frage** und frag: `Gibt es für die Schulung STE schon eine Einladung?` Tippe auf **Fragen**. Erwartet: Wie in Schritt 3: graue Suchzeilen, dann die Antwort mit **Quellen**. Wo nichts steht, sagt Claude das, statt etwas zu erfinden.
5. Quelle mit Datum: Tippe unter der Antwort auf eine Quelle, die ein Datum trägt, zum Beispiel „Do 26.11.2026“. Erwartet: Der Tag geht in der App auf, und das Fenster **Frag Claude** bleibt offen. Steht bei der Quelle ein Abschnitt in Klammern, zum Beispiel „Do 26.11.2026 (Besprechung Beispiel)“, ist es derselbe Tag.
6. Andere Quelle: Tippe auf eine Quelle ohne Datum, zum Beispiel eine Notiz aus `02 Projekte` oder eine Liste mit „.csv“ im Namen. Erwartet: Im Fenster steht der Name der Quelle als Überschrift und darunter die Notiz zum Lesen, bei einer Liste Zeile für Zeile. Hat die Quelle einen Abschnitt, springt die Ansicht dorthin. Darunter steht der Knopf **Zurück zur Antwort**. Tippe darauf. Erwartet: Die Antwort steht wieder da, mit den Quellen. Die Notiz lässt sich hier nicht ändern.
7. Übernehmen: Tippe unter der Antwort auf **In Ergänzungen übernehmen**. Erwartet: Kurz steht „Wird übernommen …“, dann „Übernommen“. Tippe auf **Schließen**, öffne in Obsidian die Tagesnotiz von heute und schau in den Abschnitt **Ergänzungen**. Erwartet: Dort stehen die Zeile `Claude, HH:MM: …` mit der Frage, die Punkte der Antwort und als letzter Punkt eine Zeile wie `Quellen: [[2026-11-26]], [[Sperren Abschnitte Lehne]]`. Die Namen sind Links, ein Tipp darauf öffnet die Notiz. Lösche die Zeilen danach in Obsidian, wenn du sie nicht brauchst, und achte auf `- [ ]`, das ginge am Abend als Aufgabe nach Outlook.
8. Wieder öffnen ohne neues Laden: Tippe auf **Schließen** und gleich wieder auf die drei Funken. Erwartet: Es steht keine Zeile „Gehirn wird geladen …“. Die Kopie ist schon da, und nichts wird neu geladen, solange sich im Vault nichts geändert hat. Schreib in Obsidian oder in der App eine Änderung in eine Notiz, warte bis oben **Gesichert** steht und öffne das Fenster noch einmal. Erwartet: Es wird nur nachgeholt, was neu ist, die Zeile steht höchstens kurz da, und die Frage nach der geänderten Notiz findet den neuen Stand.
9. Ohne Netz: Schalte den Flugmodus ein (Einstellungen, Flugmodus, und darauf achten, dass das WLAN-Symbol weg ist). Wechsle zurück ins Notizbuch, öffne das Fenster, schreib eine Frage und tippe auf **Fragen**. Erwartet: „Ohne Netz kann Claude nicht antworten.“ Deine Frage bleibt im Feld stehen. Schalte den Flugmodus wieder aus, tippe noch einmal auf **Fragen**. Erwartet: Es klappt.
10. Kosten ansehen: Öffne am Computer `platform.claude.com` und dort **Usage**. Erwartet: Im Workspace **Notizbuch** stehen für die Fragen aus dieser Probe etwa 2 bis 6 Cent je Frage mit Suche. Das passt zu den Zahlen der Kostenzeile unter den Antworten. Ist eine Frage deutlich teurer, schreib die Frage und die Zahl auf.
11. Passt etwas nicht, mach ein Bildschirmfoto (obere Taste und eine Lautstärketaste gleichzeitig kurz drücken) und gib kurz Bescheid, was du getan und was du gesehen hast. Schreib dazu die Uhrzeit und, wenn es eine gab, die genaue Meldung auf.

Als Fehler gilt:

- In Schritt 2 steht die Ladezeile weiter da, obwohl alles geladen ist, oder sie fehlt, während noch geladen wird.
- In Schritt 3 oder 4 gibt es keine grauen Suchzeilen, oder die Antwort nennt Dinge, die in keiner deiner Notizen stehen. Auch eine Quelle, die nicht zur Antwort passt, ist ein Fehler. Eine genannte Notiz, die es nicht gibt, darf nicht unter **Quellen** stehen.
- Eine Quelle oder eine graue Zeile nennt eine Datei, die Claude nicht sehen darf (mit „recovery“, „passw“, „token“ oder „.key“ im Namen, aus einem versteckten Ordner oder die `CLAUDE.md`). Das ist der schwerste Fehler. Schreib den Namen auf und frag nicht weiter.
- Claude kennt die Notiz von heute nicht, obwohl sie im Vault steht und die Kopie vollständig ist.
- In Schritt 5 schließt sich das Fenster, oder der Tag geht nicht auf.
- In Schritt 6 fehlt der Knopf **Zurück zur Antwort**, oder die Notiz lässt sich ändern.
- In Schritt 7 fehlt die Zeile `Quellen:` oder ihre Links führen ins Leere.
- In Schritt 8 wird beim zweiten Öffnen wieder alles neu geladen.
- In Schritt 9 hängt das Fenster, statt „Ohne Netz kann Claude nicht antworten.“ zu zeigen.
- In Schritt 10 kostet eine Frage deutlich mehr als 6 Cent, oder Claude hat mehr als 8 Schritte gebraucht.

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
