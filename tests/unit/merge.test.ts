import { expect, test } from 'vitest';
import { appendErgaenzung, toggleTask } from '../../src/lib/dailyNote';
import { mergeText } from '../../src/lib/merge';
import { fixture, lineOf } from './helpers';

const base = fixture('05 Daily Notes/2026-10-29.md');

test('tick here, routine marks another line there', () => {
  const ours = toggleTask(base, lineOf(base, 'Liste Planobjekte'));
  const theirs = base.replace('%%ob:k3x9 todo:AAMkTEST2%%', '%%ob:k3x9 todo:AAMkTEST2 gemeldet%%');
  const r = mergeText(base, ours, theirs);
  expect(r.ok && r.text).toContain('- [x] Liste Planobjekte');
  expect(r.ok && r.text).toContain('todo:AAMkTEST2 gemeldet');
});

test('same line edit is a conflict', () => {
  const ours = base.replace('Urlaube im Plan nachziehen', 'Urlaube heute nachziehen');
  const theirs = base.replace('Urlaube im Plan nachziehen', 'Urlaube morgen nachziehen');
  expect(mergeText(base, ours, theirs).ok).toBe(false);
});

test('Ergänzung here, Abendüberblick there', () => {
  const ours = appendErgaenzung(base, 'Muster anrufen', true);
  const theirs = base.replace('- nichts', '- nichts\n\n### Termine morgen\n- 09:00 Beispiel');
  const r = mergeText(base, ours, theirs);
  expect(r.ok && r.text).toContain('- [ ] Muster anrufen');
  expect(r.ok && r.text).toContain('### Termine morgen');
});

test('identical changes do not duplicate', () => {
  const ours = appendErgaenzung(base, 'X', true);
  const r = mergeText(base, ours, ours);
  expect(r.ok && r.text).toBe(ours);
});

// Ab hier: weitere Fälle über den Plan hinaus.

test('if only one side changed, that side wins', () => {
  const changed = appendErgaenzung(base, 'Muster anrufen', true);
  expect(mergeText(base, base, changed)).toEqual({ ok: true, text: changed });
  expect(mergeText(base, changed, base)).toEqual({ ok: true, text: changed });
});

test('edits on two neighbouring lines merge, whichever side has which', () => {
  const first = lineOf(base, 'Liste Planobjekte');
  const second = lineOf(base, 'Urlaube im Plan');
  expect(second - first).toBe(1); // Nachbarzeilen, sonst prüft der Test etwas anderes

  const tickFirst = toggleTask(base, first);
  const tickSecond = toggleTask(base, second);
  const both = toggleTask(tickFirst, second);
  expect(both.split('\n').filter((line) => line.startsWith('- [x]'))).toHaveLength(3); // Kontrolle: zwei neue Haken
  expect(mergeText(base, tickFirst, tickSecond)).toEqual({ ok: true, text: both });
  expect(mergeText(base, tickSecond, tickFirst)).toEqual({ ok: true, text: both });
});

test('both sides adding different text at the same place is a conflict', () => {
  const ours = appendErgaenzung(base, 'Eins', true);
  const theirs = appendErgaenzung(base, 'Zwei', true);
  expect(mergeText(base, ours, theirs)).toEqual({ ok: false });
  expect(mergeText(base, theirs, ours)).toEqual({ ok: false });
});

test('one side deleting a line the other side edits is a conflict', () => {
  const at = lineOf(base, 'Urlaube im Plan');
  const deleted = base.split('\n').filter((_, i) => i !== at).join('\n');
  const ticked = toggleTask(base, at);
  expect(mergeText(base, deleted, ticked)).toEqual({ ok: false });
  expect(mergeText(base, ticked, deleted)).toEqual({ ok: false });
});

test('an insertion directly next to the other side edit is a conflict, one line further away it merges', () => {
  const at = lineOf(base, 'Liste Planobjekte');
  const ticked = toggleTask(base, at);
  const insertBefore = (index: number) => {
    const lines = base.split('\n');
    lines.splice(index, 0, '- eingeschoben');
    return lines.join('\n');
  };
  expect(mergeText(base, ticked, insertBefore(at))).toEqual({ ok: false }); // direkt vor der geänderten Zeile
  expect(mergeText(base, ticked, insertBefore(at + 1))).toEqual({ ok: false }); // direkt dahinter

  const apart = insertBefore(at + 2); // eine unveränderte Zeile dazwischen
  expect(mergeText(base, ticked, apart)).toEqual({ ok: true, text: toggleTask(apart, at) });
});

test('equal line counts are not enough to merge line by line', () => {
  // Beide tauschen L0 und L1, ours löscht L2, theirs löscht L3. Im Konfliktbereich haben alle drei Fassungen zwei
  // Zeilen, aber theirs fügt dort L0 ein und löscht L3, ersetzt also nichts: Stelle für Stelle käme L2 zurück, und die
  // Löschung von ours ginge verloren.
  const original = 'L0\nL1\nL2\nL3';
  const ours = 'L1\nL0\nL3';
  const theirs = 'L1\nL0\nL2';
  expect(mergeText(original, ours, theirs)).toEqual({ ok: false });
  expect(mergeText(original, theirs, ours)).toEqual({ ok: false });
});

test('replacing several lines next to a replaced line still merges line by line', () => {
  const lines = (...replaced: string[]) => ['L0', ...replaced, 'L4', 'L5'].join('\n');
  const original = lines('L1', 'L2', 'L3');
  const ours = lines('A1', 'A2', 'L3'); // zwei Zeilen durch zwei ersetzt
  const theirs = lines('L1', 'L2', 'B3'); // die Nachbarzeile ersetzt
  const both = lines('A1', 'A2', 'B3');
  expect(mergeText(original, ours, theirs)).toEqual({ ok: true, text: both });
  expect(mergeText(original, theirs, ours)).toEqual({ ok: true, text: both });
});

test('no line is lost or brought back, for every small combination of replacing, deleting and inserting', () => {
  // Drei Zeilen. Jede Seite behält, löscht oder ersetzt jede davon durch "X" und fügt höchstens ein "X" ein. Beide
  // Seiten schreiben dasselbe "X", wie bei Leerzeilen: Gleicher Text an verschiedenen Stellen darf nichts verwechseln.
  const original = ['B0', 'B1', 'B2'];
  const sides = new Map<string, string[]>();
  for (let code = 0; code < 27 * 5; code++) {
    const fates = [code % 3, Math.floor(code / 3) % 3, Math.floor(code / 9) % 3]; // 0 behalten, 1 löschen, 2 ersetzen
    const insertAt = Math.floor(code / 27) - 1; // -1: nichts einfügen
    const lines: string[] = [];
    original.forEach((line, i) => {
      if (insertAt === i) lines.push('X');
      if (fates[i] === 0) lines.push(line);
      if (fates[i] === 2) lines.push('X');
    });
    if (insertAt === original.length) lines.push('X');
    sides.set(lines.join('\n'), lines);
  }

  const count = (lines: string[], text: string) => lines.filter((line) => line === text).length;
  const problems: string[] = [];
  let merged = 0;
  for (const [oursText, ours] of sides) {
    for (const [theirsText, theirs] of sides) {
      if ([oursText, theirsText].includes(original.join('\n')) || oursText === theirsText) continue; // Schnellwege
      const r = mergeText(original.join('\n'), oursText, theirsText);
      if (!r.ok) continue;
      merged++;
      const out = r.text.split('\n');
      const detail = `ours: ${ours.join(' ')} | theirs: ${theirs.join(' ')} | Ergebnis: ${out.join(' ')}`;
      // Eine Ausgangszeile bleibt genau dann stehen, wenn beide Seiten sie behalten haben, in der alten Reihenfolge.
      const kept = original.filter((line) => ours.includes(line) && theirs.includes(line));
      if (out.filter((line) => original.includes(line)).join() !== kept.join()) problems.push(`Ausgangszeilen: ${detail}`);
      // Kein "X" geht verloren, und es entstehen keine neuen.
      const xs = count(out, 'X');
      if (xs < Math.max(count(ours, 'X'), count(theirs, 'X')) || xs > count(ours, 'X') + count(theirs, 'X')) problems.push(`X: ${detail}`);
    }
  }
  expect(problems.slice(0, 3)).toEqual([]);
  expect(merged).toBeGreaterThan(100); // die Prüfung läuft nicht leer
});

test('the same edit on both sides is taken once, also next to other changes', () => {
  const tick = lineOf(base, 'Liste Planobjekte');
  const occurrences = (text: string, part: string) => text.split(part).length - 1;

  // Beide haken dieselbe Zeile ab, jede Seite ändert weit davon entfernt noch etwas anderes.
  const ticked = toggleTask(base, tick);
  const ours = appendErgaenzung(ticked, 'Muster anrufen', true);
  const theirs = ticked.replace('- nichts', '- nichts\n\n### Termine morgen\n- 09:00 Beispiel');
  const sameTick = mergeText(base, ours, theirs);
  expect(sameTick.ok && occurrences(sameTick.text, '- [x] Liste Planobjekte')).toBe(1);
  expect(sameTick.ok && sameTick.text).toContain('- [ ] Muster anrufen');
  expect(sameTick.ok && sameTick.text).toContain('### Termine morgen');

  // Beide fügen dieselben neuen Zeilen an derselben Stelle ein (ein Abschnitt, vier Zeilen), dazu je eine eigene Änderung.
  const shared = appendErgaenzung(base, 'Muster anrufen', true);
  const sameInsert = mergeText(
    base,
    toggleTask(shared, tick),
    shared.replace('- nichts', '- nichts\n\n### Termine morgen\n- 09:00 Beispiel'),
  );
  expect(sameInsert.ok && occurrences(sameInsert.text, '## Ergänzungen')).toBe(1);
  expect(sameInsert.ok && occurrences(sameInsert.text, '- [ ] Muster anrufen')).toBe(1);
  expect(sameInsert.ok && sameInsert.text).toContain('- [x] Liste Planobjekte');
  expect(sameInsert.ok && sameInsert.text).toContain('### Termine morgen');

  // Beide haken dieselbe Zeile ab, eine Seite markiert zusätzlich die Nachbarzeile.
  const marked = toggleTask(base.replace('%%ob:k3x9 todo:AAMkTEST2%%', '%%ob:k3x9 todo:AAMkTEST2 gemeldet%%'), tick);
  expect(mergeText(base, ticked, marked)).toEqual({ ok: true, text: marked });
  expect(mergeText(base, marked, ticked)).toEqual({ ok: true, text: marked });
});

test('a note with Windows line endings keeps them', () => {
  const crlf = base.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
  const first = lineOf(crlf, 'Liste Planobjekte');
  const second = lineOf(crlf, 'Urlaube im Plan');
  const ours = toggleTask(crlf, first);
  const theirs = toggleTask(crlf, second);
  const r = mergeText(crlf, ours, theirs);
  expect(r).toEqual({ ok: true, text: toggleTask(ours, second) });
  expect(r.ok && r.text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/); // nach dem Abzug aller \r\n bleibt kein Umbruch übrig
});

test('a note over 3000 lines is a conflict instead of a slow merge', () => {
  const note = (count: number) => Array.from({ length: count }, (_, i) => `Zeile ${i}`);
  const change = (lines: string[], at: number) => lines.map((line, i) => (i === at ? `${line} geändert` : line));
  const text = (lines: string[]) => lines.join('\n');

  // Genau 3000 Zeilen werden noch zusammengeführt.
  const atLimit = note(3000);
  const bothChanged = text(change(change(atLimit, 100), 2000));
  expect(mergeText(text(atLimit), text(change(atLimit, 100)), text(change(atLimit, 2000)))).toEqual({ ok: true, text: bothChanged });

  // Eine Zeile mehr, in jeder einzelnen der drei Fassungen: Konflikt. Ohne die Grenze ließe sich jeder dieser Fälle zusammenführen.
  const over = note(3001);
  expect(mergeText(text(over), text(change(over, 100)), text(change(over, 2000)))).toEqual({ ok: false });
  const shorter = over.slice(0, 3000); // beide Seiten kürzen um dieselbe letzte Zeile, nur base ist zu lang
  expect(mergeText(text(over), text(change(shorter, 100)), text(change(shorter, 2000)))).toEqual({ ok: false });
  expect(mergeText(text(atLimit), text([...change(atLimit, 100), 'neu']), text(change(atLimit, 2000)))).toEqual({ ok: false });
  expect(mergeText(text(atLimit), text(change(atLimit, 100)), text([...change(atLimit, 2000), 'neu']))).toEqual({ ok: false });

  // Hat eine Seite nichts geändert, gilt die andere ohne Vergleich, auch bei langen Notizen.
  expect(mergeText(text(over), text(over), text(change(over, 5)))).toEqual({ ok: true, text: text(change(over, 5)) });
  expect(mergeText(text(over), text(change(over, 5)), text(over))).toEqual({ ok: true, text: text(change(over, 5)) });
});

// Kleiner Zufallsgenerator (mulberry32): jeder Lauf prüft dieselben Fälle.
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('no line is lost or doubled, whatever the two sides change', () => {
  const random = seeded(2026);
  const pick = (n: number) => Math.floor(random() * n);
  const original = Array.from({ length: 10 }, (_, i) => `Zeile ${i}`);

  // Jede Seite ändert eine bis drei Stellen: ersetzen, löschen oder einfügen. Neue Texte tragen den Namen der
  // Seite, und gelöscht wird nur in der eigenen Hälfte der Zeilen (A gerade, B ungerade). So ändern die Seiten nie
  // dasselbe gleich: Gleiche Änderungen zählen einmal und würden die Zählung unten verfälschen (sie prüft der
  // Test oben).
  const edit = (side: string, parity: number): string[] => {
    const slots: string[][] = original.map((line) => [line]); // Platz i: was aus Zeile i wird
    slots.push([]); // Platz hinter der letzten Zeile
    for (let k = 0, n = 1 + pick(3); k < n; k++) {
      const text = `${side} neu ${k}`;
      switch (pick(3)) {
        case 0:
          slots[pick(original.length)] = [text];
          break;
        case 1:
          slots[2 * pick(original.length / 2) + parity] = [];
          break;
        default:
          slots[pick(slots.length)].unshift(text);
      }
    }
    return slots.flat();
  };

  const count = (lines: string[], text: string) => lines.filter((line) => line === text).length;
  const problems: string[] = [];
  let merged = 0;
  let conflicts = 0;
  for (let run = 0; run < 3000; run++) {
    const a = edit('A', 0);
    const b = edit('B', 1);
    const r = mergeText(original.join('\n'), a.join('\n'), b.join('\n'));
    if (!r.ok) {
      conflicts++;
      continue;
    }
    merged++;
    const out = r.text.split('\n');
    const detail = `A: ${a.join(' | ')}\nB: ${b.join(' | ')}\nErgebnis: ${out.join(' | ')}`;

    // Jede Zeile kommt so oft vor wie in A und B zusammen, abzüglich der Ausgangsfassung.
    for (const text of new Set([...original, ...a, ...b])) {
      if (count(out, text) !== count(a, text) + count(b, text) - count(original, text)) {
        problems.push(`"${text}" fehlt oder steht doppelt\n${detail}`);
      }
    }
    // Die Reihenfolge der Zeilen jeder Seite bleibt erhalten.
    for (const side of [a, b]) {
      const mine = new Set(side);
      const kept = new Set(out);
      const same = JSON.stringify(out.filter((line) => mine.has(line))) === JSON.stringify(side.filter((line) => kept.has(line)));
      if (!same) problems.push(`Reihenfolge verändert\n${detail}`);
    }
  }

  expect(problems.slice(0, 3)).toEqual([]);
  // Die Probe darf nicht leer laufen: Beide Seiten ändern immer etwas, und es gibt Fälle, die sich
  // zusammenführen lassen, und solche, die nicht.
  expect(merged).toBeGreaterThan(500);
  expect(conflicts).toBeGreaterThan(500);
});
