import { expect, test } from 'vitest';
import { sseParser } from '../../src/ki/sse';

test('events split across chunks come out whole', () => {
  const p = sseParser();
  expect(p.push('event: ping\nda')).toEqual([]);
  expect(p.push('ta: {"type":"ping"}\n\nevent: x\ndata: 1\n\n')).toEqual([
    { event: 'ping', data: '{"type":"ping"}' },
    { event: 'x', data: '1' },
  ]);
});

test('CRLF and data without space work', () => {
  expect(sseParser().push('event: a\r\ndata:2\r\n\r\n')).toEqual([{ event: 'a', data: '2' }]);
});

test('several data lines join with a newline', () => {
  expect(sseParser().push('data: a\ndata: b\n\n')).toEqual([{ event: 'message', data: 'a\nb' }]);
});

test('comments and empty blocks are skipped', () => {
  expect(sseParser().push(': ok\n\n\n\nevent: a\ndata: 1\n\n')).toEqual([{ event: 'a', data: '1' }]);
});

test('end flushes a last event without blank line', () => {
  const p = sseParser();
  expect(p.push('event: a\ndata: 1')).toEqual([]);
  expect(p.end()).toEqual([{ event: 'a', data: '1' }]);
});
