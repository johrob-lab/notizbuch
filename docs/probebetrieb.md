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
5. Warte drei Sekunden. Oben steht **Gesichert**.
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
6. Warte drei Sekunden. Oben steht **Gesichert**.
7. Öffne bei GitHub im Test-Repo die Datei `05 Daily Notes/2026-10-29.md`. Die Haken stehen als `[x]` da, deine Ergänzung unter `## Ergänzungen`, und die Markierungen zwischen `%%` am Zeilenende sind noch da.

Erwartet: Jeder Haken zeigt sich sofort. Nach ein paar Sekunden steht **Gesichert** da. Bei GitHub gibt es Commits wie `Notizbuch: 2026-10-29.md (iPad)`.

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
8. Öffne bei GitHub im Test-Repo den Ordner `07 Anhänge/Notizbuch/2026`. Dort liegen `2026-10-29 0800 Abstimmung Beispiel 2027 S1.svg` und `2026-10-29 0800 Abstimmung Beispiel 2027 S2.svg`. GitHub zeigt eine SVG-Datei als Bild, du erkennst deine Schrift.
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
2. Tippe in der App am 29.10.2026 auf das Kästchen vor **Urlaube im Plan nachziehen**. Oben steht **Wartet auf Netz** mit einer Zahl.
3. Öffne am PC github.com, das Test-Repo und die Datei `05 Daily Notes/2026-10-29.md`. Klicke über dem Dateiinhalt auf das Stift-Symbol (**Edit file**).
4. Hänge an die Mail-Zeile (`- Max Muster, Freigabe Beispiel …`) ein paar Wörter an. Das ist eine andere Zeile als der Haken. Klicke auf **Commit changes…** und im Fenster auf **Commit changes**.
5. Schalte am iPad den Flugmodus aus und warte, bis **Gesichert** dasteht.

Erwartet: In der Karte **Morgenbriefing** stehen beide Änderungen, dein Haken und die Wörter vom PC. Es gibt keine Meldung über eine Konfliktkopie.

**Teil B: Dieselbe Zeile**

1. Schalte am iPad den Flugmodus wieder ein.
2. Tippe in der App auf das Kästchen vor **Liste Planobjekte ergänzen**.
3. Ändere am PC bei GitHub in der Datei genau diese Zeile (die mit `Liste Planobjekte ergänzen`), zum Beispiel ein Wort im Text, aber nichts zwischen den `%%`. Speichere mit **Commit changes**.
4. Schalte am iPad den Flugmodus aus und warte einen Moment.

Erwartet: Oben erscheint die Meldung **Konfliktkopie angelegt: 2026-10-29 (Konflikt).md**. Sie bleibt, bis du auf das **×** daneben tippst. Die Datei `2026-10-29.md` behält die Fassung vom PC. Deine Fassung aus der App steht in der neuen Datei `05 Daily Notes/2026-10-29 (Konflikt).md`. Nichts wird still überschrieben.

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

Ab jetzt sind es echte Daten. Die App schreibt nur in `05 Daily Notes/` und `07 Anhänge/Notizbuch/`, alles andere ist für sie gesperrt. Jede Änderung ist ein Commit, den du bei GitHub zurückholen kannst. Am PC machst du denselben Wechsel mit **Zahnrad → Zugang → Zugang ändern**.

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

1. Lege einen Finger auf die Karte **Morgenbriefing** und ziehe nach links oder rechts. Erwartet: Die ganze Seite wandert mit.
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
