import { expect, test } from 'vitest';
import {
  askClaude,
  checkKey,
  failureOf,
  KiError,
  looksLikeKey,
  type ApiMessage,
  type KiFailure,
} from '../../src/ki/claude';
import { errorEvent, messageDelta, messageStart, messageStop, sse, streamOf, textDelta } from './helpers';

const KEY = 'sk-ant-test-0000';
const messages: ApiMessage[] = [{ role: 'user', content: 'Frage' }];
const base = () => ({ key: KEY, model: 'sonnet' as const, system: 'S', messages, signal: new AbortController().signal, onText: () => {} });
const heads = { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2026-10-21', 'anthropic-dangerous-direct-browser-access': 'true' };

test('a question goes to the messages endpoint with the browser headers', async () => {
  const f = streamOf([messageStart(1, 1), messageStop()]);
  await askClaude({ ...base(), key: `  ${KEY} `, fetchFn: f });
  expect(f.calls[0].url).toBe('https://api.anthropic.com/v1/messages');
  expect(f.calls[0].init.method).toBe('POST');
  expect(f.calls[0].init.headers).toEqual(heads);
  expect(JSON.parse(f.calls[0].init.body as string)).toEqual({ model: 'claude-sonnet-5-5', max_tokens: 2048, stream: true, thinking: { type: 'between_tools' }, system: 'S', messages });
  const h = streamOf([messageStop()]);
  await askClaude({ ...base(), model: 'haiku', fetchFn: h });
  expect(JSON.parse(h.calls[0].init.body as string)).toMatchObject({ model: 'claude-haiku-5-5', thinking: { type: 'disabled' } });
});

test('text arrives piece by piece and usage adds up', async () => {
  const second = textDelta('lo');
  const cut = Math.floor(second.length / 2);
  const f = streamOf([messageStart(5000, 1), textDelta('Hal'), second.slice(0, cut), second.slice(cut), messageDelta('end_turn', 100), messageStop()]);
  const got: string[] = [];
  const r = await askClaude({ ...base(), onText: (d) => got.push(d), fetchFn: f });
  expect(got).toEqual(['Hal', 'lo']);
  expect(r).toEqual({ text: 'Hallo', usage: { input_tokens: 5000, output_tokens: 100 }, end: 'fertig' });
});

test('other blocks and unknown events are ignored', async () => {
  const f = streamOf([
    messageStart(10, 1),
    sse('ping', { type: 'ping' }),
    sse('neu', { type: 'neu' }),
    sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hm' } }),
    textDelta('A'),
    messageDelta('end_turn', 2),
    messageStop(),
  ]);
  expect((await askClaude({ ...base(), fetchFn: f })).text).toBe('A');
});

test('a cut answer ends as abgeschnitten', async () => {
  const f = streamOf([messageStart(10, 1), textDelta('A'), messageDelta('max_tokens', 2048), messageStop()]);
  expect((await askClaude({ ...base(), fetchFn: f })).end).toBe('abgeschnitten');
});

test('failureOf sorts every error', () => {
  const table: [number, string | undefined, string | undefined, KiFailure][] = [
    [401, 'authentication_error', undefined, 'key'],
    [403, 'permission_error', undefined, 'key'],
    [402, 'billing_error', undefined, 'credit'],
    [400, 'invalid_request_error', 'You have reached your specified workspace API usage limits.', 'credit'],
    [400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API.', 'credit'],
    [429, 'rate_limit_error', 'You have reached your monthly spend limit.', 'credit'],
    [400, 'invalid_request_error', 'messages: field required', 'unavailable'],
    [429, 'rate_limit_error', 'Number of requests has exceeded your rate limit.', 'unavailable'],
    [500, 'api_error', undefined, 'unavailable'],
    [529, 'overloaded_error', undefined, 'unavailable'],
    [0, 'overloaded_error', 'Overloaded', 'unavailable'],
    [0, 'billing_error', undefined, 'credit'],
    [0, 'authentication_error', undefined, 'key'],
  ];
  for (const [status, type, message, want] of table) expect(failureOf(status, type, message), `${status} ${type}`).toBe(want);
});

const authBody = JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });

test('an error answer and an error event become KiError', async () => {
  const e1 = await askClaude({ ...base(), fetchFn: streamOf([authBody], { status: 401 }) }).catch((e) => e);
  expect(e1).toBeInstanceOf(KiError);
  expect(e1.reason).toBe('key');
  const e2 = await askClaude({ ...base(), fetchFn: streamOf([messageStart(1, 1), errorEvent('overloaded_error', 'Overloaded')]) }).catch((e) => e);
  expect(e2).toBeInstanceOf(KiError);
  expect(e2.reason).toBe('unavailable');
});

test('no network is offline', async () => {
  const fetchFn = (async () => {
    throw new TypeError('Failed to fetch');
  }) as typeof fetch;
  const e = await askClaude({ ...base(), fetchFn }).catch((x) => x);
  expect(e).toBeInstanceOf(KiError);
  expect(e.reason).toBe('offline');
});

test('Stopp keeps what arrived', async () => {
  const ac = new AbortController();
  // Der Strom hält nach dem ersten Stück an, bis das Signal abbricht. Das geschieht nach dem ersten onText.
  const f = streamOf([messageStart(5000, 1) + textDelta('Hal'), textDelta('x')], { hold: true });
  const r = await askClaude({ ...base(), signal: ac.signal, onText: () => ac.abort(), fetchFn: f });
  expect(r).toEqual({ text: 'Hal', usage: { input_tokens: 5000, output_tokens: 1 }, end: 'gestoppt' });
});

test('Stopp before the first piece gives an empty answer, not offline', async () => {
  const ac = new AbortController();
  const fetchFn = (async () => {
    ac.abort();
    throw new DOMException('The operation was aborted.', 'AbortError');
  }) as typeof fetch;
  expect(await askClaude({ ...base(), signal: ac.signal, fetchFn })).toEqual({ text: '', usage: null, end: 'gestoppt' });
  const held = new AbortController();
  held.abort();
  const r = await askClaude({ ...base(), signal: held.signal, fetchFn: streamOf([messageStart(1, 1), textDelta('A')], { hold: true }) });
  expect(r.text).toBe('');
  expect(r.end).toBe('gestoppt');
});

test('the key never shows up in an error', async () => {
  const offline = (async () => {
    throw new TypeError(`Failed to fetch ${KEY}`);
  }) as typeof fetch;
  const runs = [
    streamOf([authBody.replace('invalid x-api-key', KEY)], { status: 401 }),
    streamOf([JSON.stringify({ type: 'error', error: { type: 'api_error', message: KEY } })], { status: 500 }),
    offline,
    streamOf([errorEvent('overloaded_error', KEY)]),
  ];
  for (const fetchFn of runs) {
    const e = await askClaude({ ...base(), fetchFn }).catch((x) => x);
    expect(e).toBeInstanceOf(KiError);
    expect(e.message).not.toContain(KEY);
    expect(String(e)).not.toContain(KEY);
  }
});

test('checkKey asks the free token counter', async () => {
  const ok = streamOf(['{}']);
  expect(await checkKey(` ${KEY} `, 'sonnet', ok)).toBeNull();
  expect(ok.calls[0].url).toBe('https://api.anthropic.com/v1/messages/count_tokens');
  expect(ok.calls[0].init.headers).toEqual(heads);
  expect(JSON.parse(ok.calls[0].init.body as string)).toEqual({ model: 'claude-sonnet-5-5', messages: [{ role: 'user', content: 'Hallo' }] });
  expect(await checkKey(KEY, 'sonnet', streamOf([authBody], { status: 401 }))).toBe('key');
  const off = (async () => {
    throw new TypeError('Failed to fetch');
  }) as typeof fetch;
  expect(await checkKey(KEY, 'sonnet', off)).toBe('offline');
  expect(await checkKey(KEY, 'sonnet', streamOf(['{}'], { status: 529 }))).toBe('unavailable');
});

test('looksLikeKey', () => {
  for (const k of ['sk-ant-api03-Ab_c-9', '  sk-ant-test-0000 ']) expect(looksLikeKey(k), k).toBe(true);
  for (const k of ['', 'abc', 'sk-ant-', 'sk-ant-a b']) expect(looksLikeKey(k), k).toBe(false);
});
