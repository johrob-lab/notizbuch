import { describe, expect, it } from 'vitest';
import { tickLine } from '../../src/lib/briefingEdit';
import { splitBase, vorbereitetFuer } from '../../src/lib/vorbereitet';

const NOTE = [
  '---',
  'date: 2026-10-29',
  '---',
  '# 2026-10-29',
  '',
  '## Morgenbriefing (automatisch)',
  '- [ ] Nicht gemeint',
  '',
  '## Besprechungen (vorbereitet)',
  '',
  '### 08:30 Abstimmung Beispiel',
  'Quelle: Einladung Muster',
  '**Sperren 2027**',
  '- [ ] Liste [[Projekt A|prüfen]] %%ob:ab12%%',
  '- [x] Termin fixiert',
  '- Hinweis ohne Kästchen',
  '',
  '### Jour fixe',
  '- [ ] Punkt Jour fixe',
  '',
  '## Abendüberblick (automatisch)',
  '- [ ] Auch nicht gemeint',
].join('\n');

describe('splitBase', () => {
  it('teilt Tag, Uhrzeit und Thema', () => {
    expect(splitBase('2026-10-29 0830 Abstimmung Beispiel')).toEqual({ day: '2026-10-29', zeit: '0830', thema: 'Abstimmung Beispiel' });
    expect(splitBase('2026-10-29  Ohne Zeit')).toEqual({ day: '2026-10-29', zeit: '', thema: 'Ohne Zeit' });
    expect(splitBase('kein Name')).toBeNull();
  });
});

describe('vorbereitetFuer', () => {
  it('liest den Block mit gleicher Uhrzeit und gleichem Thema', () => {
    const block = vorbereitetFuer(NOTE, '2026-10-29 0830 Abstimmung Beispiel');
    expect(block?.heading).toBe('08:30 Abstimmung Beispiel');
    expect(block?.zeilen).toEqual([
      { art: 'titel', text: 'Sperren 2027' },
      { art: 'aufgabe', text: 'Liste prüfen', done: false, line: 13, source: '- [ ] Liste [[Projekt A|prüfen]] %%ob:ab12%%' },
      { art: 'aufgabe', text: 'Termin fixiert', done: true, line: 14, source: '- [x] Termin fixiert' },
      { art: 'text', text: 'Hinweis ohne Kästchen' },
    ]);
  });

  it('findet den Block an der Uhrzeit, wenn das Thema anders heißt', () => {
    expect(vorbereitetFuer(NOTE, '2026-10-29 0830 Anderes Thema')?.heading).toBe('08:30 Abstimmung Beispiel');
  });

  it('findet den Block am Thema, auch ohne Uhrzeit in der Überschrift und bei anderer Schreibung', () => {
    expect(vorbereitetFuer(NOTE, '2026-10-29 1400 jour FIXE')?.zeilen).toHaveLength(1);
  });

  it('gibt nichts ohne passenden Block, ohne Notiz oder ohne Abschnitt', () => {
    expect(vorbereitetFuer(NOTE, '2026-10-29 1000 Fremd')).toBeNull();
    expect(vorbereitetFuer(null, '2026-10-29 0830 Abstimmung Beispiel')).toBeNull();
    expect(vorbereitetFuer('# 2026-10-29\n\n### 08:30 Abstimmung Beispiel\n- [ ] x', '2026-10-29 0830 Abstimmung Beispiel')).toBeNull();
  });

  it('nimmt bei zwei Blöcken mit gleicher Uhrzeit nur den mit passendem Thema', () => {
    const md = '## Besprechungen (vorbereitet)\n### 09:00 A\n- [ ] a\n### 09:00 B\n- [ ] b';
    expect(vorbereitetFuer(md, '2026-10-29 0900 B')?.zeilen[0]).toMatchObject({ text: 'b' });
    expect(vorbereitetFuer(md, '2026-10-29 0900 C')).toBeNull();
  });

  it('liefert Zeilen, die sich mit tickLine abhaken lassen, auch mit Windows-Zeilenenden', () => {
    const md = NOTE.replace(/\n/g, '\r\n');
    const task = vorbereitetFuer(md, '2026-10-29 0830 Abstimmung Beispiel')?.zeilen[1];
    if (task?.art !== 'aufgabe') throw new Error('keine Aufgabe');
    const result = tickLine(md, task.line, task.source);
    expect(result.ok && result.text.split('\r\n')[13]).toBe('- [x] Liste [[Projekt A|prüfen]] %%ob:ab12%%');
  });
});
