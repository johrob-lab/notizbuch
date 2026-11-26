import { describe, expect, test } from 'vitest';
import { EXCEL_KOPF, NICHT_LESBAR, ZU_GROSS } from '../../src/lib/sperrenExcel';
import { excelStandHolen } from '../../src/ui/excelHolen';
import { onNoteWrite } from '../../src/ui/noteQueue';
import { FAILED } from '../../src/ui/texts';

const PFAD = '07 Anhänge/Notizbuch/2027/Sperren IB 2027 Excel.csv';
const O = { fachlinie: 'IB' as const, jahr: 2027 };

function csv(fachlinie: string): string {
  const werte = EXCEL_KOPF.split(';').map((k) => (k === 'Fachlinie' ? fachlinie : k === 'Datum' ? '2027-03-01' : k === 'Abschnitt' ? 'Muster Abschnitt 1' : k === 'Stand' ? '2026-11-26 09:40' : ''));
  return '﻿' + [EXCEL_KOPF, werte.join(';')].join('\r\n') + '\r\n';
}

function datei(name: string, inhalt: string | Uint8Array, size?: number) {
  const bytes = typeof inhalt === 'string' ? new TextEncoder().encode(inhalt) : inhalt;
  const state = { gelesen: false };
  return {
    state,
    file: {
      name,
      size: size ?? bytes.length,
      arrayBuffer: async () => {
        state.gelesen = true;
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      },
    },
  };
}

function engine(failWrite = false) {
  const calls: string[] = [];
  const writes: { path: string; text: string; kind: string }[] = [];
  return {
    calls,
    writes,
    engine: {
      lookupFresh: async (path: string) => {
        calls.push(`lookupFresh ${path}`);
        return { text: null, unknown: false };
      },
      write: async (path: string, text: string, kind: 'md' | 'svg') => {
        calls.push(`write ${path}`);
        if (failWrite) throw new Error('kaputt');
        writes.push({ path, text, kind });
      },
    },
  };
}

describe('excelStandHolen', () => {
  test('gültige Datei mit BOM und CRLF wird unverändert geschrieben', async () => {
    const e = engine();
    const text = csv('IB');
    const heard: string[] = [];
    onNoteWrite(e.engine, (p) => heard.push(p));
    const d = datei('Sperren IB 2027 Excel.csv', text);
    const meldung = await excelStandHolen(d.file, { engine: e.engine, ...O });
    expect(meldung).toBe('Excel-Stand übernommen: 1 Sperre, davon 0 aus dem Notizbuch.');
    expect(e.calls).toEqual([`lookupFresh ${PFAD}`, `write ${PFAD}`]);
    expect(e.writes).toEqual([{ path: PFAD, text, kind: 'md' }]);
    expect(e.writes[0].text.startsWith('﻿')).toBe(true);
    expect(heard).toEqual([PFAD]);
  });

  test('kein UTF-8: nicht lesbar, nichts geschrieben', async () => {
    const e = engine();
    const d = datei('Sperren IB 2027 Excel.csv', new Uint8Array([0xff, 0xfe]));
    expect(await excelStandHolen(d.file, { engine: e.engine, ...O })).toBe(NICHT_LESBAR);
    expect(e.calls).toEqual([]);
  });

  test('über 1 MB: zu groß, die Datei wird nicht gelesen', async () => {
    const e = engine();
    const d = datei('Sperren IB 2027 Excel.csv', csv('IB'), 1_000_001);
    expect(await excelStandHolen(d.file, { engine: e.engine, ...O })).toBe(ZU_GROSS);
    expect(d.state.gelesen).toBe(false);
    expect(e.calls).toEqual([]);
  });

  test('genau 1 MB geht noch', async () => {
    const e = engine();
    const d = datei('Sperren IB 2027 Excel.csv', csv('IB'), 1_000_000);
    expect(await excelStandHolen(d.file, { engine: e.engine, ...O })).toContain('übernommen');
  });

  test('falsche Fachlinie: Meldung, nichts geschrieben', async () => {
    const e = engine();
    const d = datei('Sperren Lehne 2027 Excel.csv', csv('Lehne'));
    expect(await excelStandHolen(d.file, { engine: e.engine, ...O })).toBe('Die Datei ist für Lehne 2027, offen ist IB 2027.');
    expect(e.calls).toEqual([]);
  });

  test('Schreiben scheitert: FAILED', async () => {
    const e = engine(true);
    const d = datei('Sperren IB 2027 Excel.csv', csv('IB'));
    expect(await excelStandHolen(d.file, { engine: e.engine, ...O })).toBe(FAILED);
  });

  test('Lesen der Datei scheitert: wirft nicht', async () => {
    const e = engine();
    const file = { name: 'x.csv', size: 10, arrayBuffer: async () => Promise.reject(new Error('weg')) };
    expect(await excelStandHolen(file, { engine: e.engine, ...O })).toBe(NICHT_LESBAR);
  });
});
