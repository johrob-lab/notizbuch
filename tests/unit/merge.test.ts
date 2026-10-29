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
