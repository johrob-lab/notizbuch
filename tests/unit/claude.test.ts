import { afterEach, expect, test } from 'vitest';
import {
  askClaude,
  checkKey,
  failureOf,
  KiError,
  looksLikeKey,
  type ApiMessage,
  type KiFailure,
  type SystemBlock,
  type ToolDefinition,
} from '../../src/ki/claude';
import {
  blockStart,
  blockStop,
  errorEvent,
  inputJsonDelta,
  messageDelta,
  messageStart,
  messageStop,
  signatureDelta,
  sse,
  streamOf,
  textDelta,
  textDeltaAt,
  thinkingDelta,
} from './helpers';

const KEY = 'sk-ant-test-0000';
const messages: ApiMessage[] = [{ role: 'user', content: 'Frage' }];
const base = () => ({ key: KEY, model: 'sonnet' as const, system: 'S', messages, signal: new AbortController().signal, onText: () => {} });
const heads = { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2026-10-21', 'anthropic-dangerous-direct-browser-access': 'true' };
const tools: ToolDefinition[] = [
  { name: 'suchen', description: 'Sucht im Vault.', input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
];
const bodyOf = (f: { calls: { init: RequestInit }[] }, n = 0) => JSON.parse(f.calls[n].init.body as string);

/** Was der Browser über das Netz sagt, für die Dauer eines Tests. */
function setOnLine(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
}
afterEach(() => {
  delete (navigator as { onLine?: boolean }).onLine;
});

test('a question goes to the messages endpoint with the browser headers', async () => {
  const f = streamOf([messageStart(1, 1), messageStop()]);
  await askClaude({ ...base(), key: `  ${KEY} `, fetchFn: f });
  expect(f.calls[0].url).toBe('https://api.anthropic.com/v1/messages');
  expect(f.calls[0].init.method).toBe('POST');
  expect(f.calls[0].init.headers).toEqual(heads);
  expect(JSON.parse(f.calls[0].init.body as string)).toEqual({ model: 'claude-sonnet-5-5', max_tokens: 4096, stream: true, thinking: { type: 'between_tools' }, system: 'S', messages });
  const h = streamOf([messageStop()]);
  await askClaude({ ...base(), model: 'haiku', fetchFn: h });
  expect(JSON.parse(h.calls[0].init.body as string)).toMatchObject({ model: 'claude-haiku-5-5', thinking: { type: 'disabled' } });
});

test('Körper: Werkzeuge gehen nur mit, wenn es welche gibt, und dann immer mit tool_choice', async () => {
  const system: SystemBlock[] = [
    { type: 'text', text: 'Feste Regeln', cache_control: { type: 'ephemeral' } },
    { type: 'text', text: 'Heute ist Do 26.11.2026.' },
  ];
  const f = streamOf([messageStop()]);
  await askClaude({ ...base(), system, tools, fetchFn: f });
  expect(bodyOf(f)).toEqual({
    model: 'claude-sonnet-5-5',
    max_tokens: 4096,
    stream: true,
    thinking: { type: 'between_tools' },
    system,
    messages,
    tools,
    tool_choice: { type: 'auto' },
  });
  const none = streamOf([messageStop()]);
  await askClaude({ ...base(), tools, toolChoice: 'none', fetchFn: none });
  expect(bodyOf(none).tool_choice).toEqual({ type: 'none' });
  expect(bodyOf(none).tools).toEqual(tools);
  // Ohne Werkzeuge weder tools noch tool_choice, auch wenn eine Wahl genannt ist: Die Schnittstelle nimmt sie nur mit Werkzeugen.
  for (const toolChoice of [undefined, 'none' as const]) {
    const without = streamOf([messageStop()]);
    await askClaude({ ...base(), toolChoice, fetchFn: without });
    expect(Object.keys(bodyOf(without)).sort()).toEqual(['max_tokens', 'messages', 'model', 'stream', 'system', 'thinking']);
  }
});

test('text arrives piece by piece and usage adds up', async () => {
  const second = textDelta('lo');
  const cut = Math.floor(second.length / 2);
  const f = streamOf([messageStart(5000, 1), textDelta('Hal'), second.slice(0, cut), second.slice(cut), messageDelta('end_turn', 100), messageStop()]);
  const got: string[] = [];
  const r = await askClaude({ ...base(), onText: (d) => got.push(d), fetchFn: f });
  expect(got).toEqual(['Hal', 'lo']);
  expect(r).toEqual({
    text: 'Hallo',
    usage: { input_tokens: 5000, output_tokens: 100 },
    end: 'fertig',
    content: [{ type: 'text', text: 'Hallo' }],
    stop: 'end_turn',
  });
});

test('Werkzeugaufruf im Strom: Denkblock, Text und tool_use kommen ganz und in ihrer Reihenfolge', async () => {
  const f = streamOf([
    messageStart(1200, 1),
    blockStart(0, { type: 'thinking', thinking: '', signature: '' }),
    thinkingDelta(0, 'Erst nach TFZF '),
    thinkingDelta(0, 'suchen.'),
    signatureDelta(0, 'sig-test'),
    blockStop(0),
    blockStart(1, { type: 'text', text: '' }),
    textDeltaAt(1, 'Ich suche '),
    textDeltaAt(1, 'in den Notizen.'),
    blockStop(1),
    blockStart(2, { type: 'tool_use', id: 'toolu_1', name: 'suchen', input: {} }),
    inputJsonDelta(2, '{"text"'),
    inputJsonDelta(2, ':"TF'),
    inputJsonDelta(2, 'ZF"}'),
    blockStop(2),
    messageDelta('tool_use', 60),
    messageStop(),
  ]);
  const got: string[] = [];
  const r = await askClaude({ ...base(), tools, onText: (d) => got.push(d), fetchFn: f });
  expect(r.content).toEqual([
    { type: 'thinking', thinking: 'Erst nach TFZF suchen.', signature: 'sig-test' },
    { type: 'text', text: 'Ich suche in den Notizen.' },
    { type: 'tool_use', id: 'toolu_1', name: 'suchen', input: { text: 'TFZF' } },
  ]);
  expect(r.stop).toBe('tool_use');
  expect(r.end).toBe('fertig');
  expect(r.text).toBe('Ich suche in den Notizen.');
  expect(r.usage).toEqual({ input_tokens: 1200, output_tokens: 60 });
  // Nur der Text geht an onText, nichts vom Denken und nichts vom JSON.
  expect(got).toEqual(['Ich suche ', 'in den Notizen.']);
});

test('ein Werkzeug ohne Eingabe bekommt ein leeres Objekt', async () => {
  const f = streamOf([
    messageStart(10, 1),
    blockStart(0, { type: 'tool_use', id: 'toolu_2', name: 'auflisten', input: {} }),
    blockStop(0),
    messageDelta('tool_use', 9),
    messageStop(),
  ]);
  const r = await askClaude({ ...base(), tools, fetchFn: f });
  expect(r.content).toEqual([{ type: 'tool_use', id: 'toolu_2', name: 'auflisten', input: {} }]);
  expect(r.end).toBe('fertig');
});

test('redacted_thinking bleibt, wie es kam', async () => {
  const f = streamOf([
    messageStart(10, 1),
    blockStart(0, { type: 'redacted_thinking', data: 'verschluesselt' }),
    blockStop(0),
    blockStart(1, { type: 'text', text: '' }),
    textDeltaAt(1, 'Gefunden.'),
    blockStop(1),
    messageDelta('end_turn', 5),
    messageStop(),
  ]);
  const r = await askClaude({ ...base(), tools, fetchFn: f });
  expect(r.content).toEqual([
    { type: 'redacted_thinking', data: 'verschluesselt' },
    { type: 'text', text: 'Gefunden.' },
  ]);
  expect(r.text).toBe('Gefunden.');
});

test('kaputtes JSON eines Werkzeugs: Die Antwort ist abgeschnitten', async () => {
  // max_tokens mitten in der Eingabe: Das Ende des Blocks kommt nie.
  const cut = streamOf([
    messageStart(10, 1),
    blockStart(0, { type: 'tool_use', id: 'toolu_1', name: 'suchen', input: {} }),
    inputJsonDelta(0, '{"text":'),
    messageDelta('max_tokens', 4096),
    messageStop(),
  ]);
  const r = await askClaude({ ...base(), tools, fetchFn: cut });
  expect(r.end).toBe('abgeschnitten');
  expect(r.stop).toBe('max_tokens');
  expect(r.content).toEqual([{ type: 'tool_use', id: 'toolu_1', name: 'suchen', input: {} }]);
  // Ein Block mit unlesbarem Ende oder ganz ohne Ende ist unvollständig, auch wenn der Grund tool_use heißt.
  const unlesbar = [blockStart(0, { type: 'tool_use', id: 'toolu_1', name: 'suchen', input: {} }), inputJsonDelta(0, '{"text":'), blockStop(0)];
  const ohneEnde = [blockStart(0, { type: 'tool_use', id: 'toolu_1', name: 'suchen', input: {} }), inputJsonDelta(0, '{"text":"TFZF"}')];
  for (const blocks of [unlesbar, ohneEnde]) {
    const f = streamOf([messageStart(10, 1), ...blocks, messageDelta('tool_use', 9), messageStop()]);
    const s = await askClaude({ ...base(), tools, fetchFn: f });
    expect(s.end).toBe('abgeschnitten');
    expect(s.stop).toBe('tool_use');
    expect(s.content).toEqual([{ type: 'tool_use', id: 'toolu_1', name: 'suchen', input: {} }]);
  }
});

test('ohne message_start fehlen die Zahlen', async () => {
  const f = streamOf([textDelta('A'), messageDelta('end_turn', 7), messageStop()]);
  expect((await askClaude({ ...base(), fetchFn: f })).usage).toBeNull();
});

test('Zahlen aus message_delta überschreiben nur, was eine Zahl ist', async () => {
  const start = sse('message_start', {
    type: 'message_start',
    message: { usage: { input_tokens: 40, output_tokens: 1, cache_creation_input_tokens: 2000, cache_read_input_tokens: 0 } },
  });
  const delta = sse('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn' },
    usage: { input_tokens: null, cache_read_input_tokens: 3000, output_tokens: 90 },
  });
  const r = await askClaude({ ...base(), fetchFn: streamOf([start, textDelta('A'), delta, messageStop()]) });
  expect(r.usage).toEqual({ input_tokens: 40, output_tokens: 90, cache_creation_input_tokens: 2000, cache_read_input_tokens: 3000 });
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
  const f = streamOf([messageStart(10, 1), textDelta('A'), messageDelta('max_tokens', 4096), messageStop()]);
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

const failedFetch = (async () => {
  throw new TypeError('Failed to fetch');
}) as typeof fetch;

test('no network is offline', async () => {
  setOnLine(false);
  const e = await askClaude({ ...base(), fetchFn: failedFetch }).catch((x) => x);
  expect(e).toBeInstanceOf(KiError);
  expect(e.reason).toBe('offline');
});

test('Fehlercode: HTTP-Status, Typ aus dem Strom oder Netzfehler', async () => {
  const badRequest = JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'messages.1: unexpected tool_use_id' } });
  const e400 = await askClaude({ ...base(), fetchFn: streamOf([badRequest], { status: 400 }) }).catch((x) => x);
  expect(e400).toBeInstanceOf(KiError);
  expect(e400.reason).toBe('unavailable');
  expect(e400.code).toBe('400');
  const e401 = await askClaude({ ...base(), fetchFn: streamOf([authBody], { status: 401 }) }).catch((x) => x);
  expect([e401.reason, e401.code]).toEqual(['key', '401']);
  const overloaded = await askClaude({ ...base(), fetchFn: streamOf([messageStart(1, 1), textDelta('Teil'), errorEvent('overloaded_error', 'Overloaded')]) }).catch((x) => x);
  expect(overloaded).toBeInstanceOf(KiError);
  expect([overloaded.reason, overloaded.code]).toEqual(['unavailable', 'overloaded_error']);
  // fetch lehnt mit TypeError ab: Ohne Netz sagt das auch der Browser. Sonst war es kein fehlendes Netz.
  setOnLine(false);
  const offline = await askClaude({ ...base(), fetchFn: failedFetch }).catch((x) => x);
  expect([offline.reason, offline.code]).toEqual(['offline', null]);
  setOnLine(true);
  const netz = await askClaude({ ...base(), fetchFn: failedFetch }).catch((x) => x);
  expect(netz).toBeInstanceOf(KiError);
  expect([netz.reason, netz.code]).toEqual(['unavailable', 'Netzfehler']);
});

test('Stopp keeps what arrived', async () => {
  const ac = new AbortController();
  // Der Strom hält nach dem ersten Stück an, bis das Signal abbricht. Das geschieht nach dem ersten onText.
  const f = streamOf([messageStart(5000, 1) + textDelta('Hal'), textDelta('x')], { hold: true });
  const r = await askClaude({ ...base(), signal: ac.signal, onText: () => ac.abort(), fetchFn: f });
  expect(r).toEqual({ text: 'Hal', usage: { input_tokens: 5000, output_tokens: 1 }, end: 'gestoppt', content: [{ type: 'text', text: 'Hal' }], stop: null });
});

test('Stopp before the first piece gives an empty answer, not offline', async () => {
  const ac = new AbortController();
  const fetchFn = (async () => {
    ac.abort();
    throw new DOMException('The operation was aborted.', 'AbortError');
  }) as typeof fetch;
  expect(await askClaude({ ...base(), signal: ac.signal, fetchFn })).toEqual({ text: '', usage: null, end: 'gestoppt', content: [], stop: null });
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
    streamOf([JSON.stringify({ type: 'error', error: { type: KEY, message: KEY } })], { status: 500 }),
    offline,
    streamOf([errorEvent('overloaded_error', KEY)]),
    // Auch ein Typ, der keiner ist, wird keine Spur.
    streamOf([errorEvent(KEY, KEY)]),
    streamOf([errorEvent(`overloaded_error ${KEY}`, 'Overloaded')]),
  ];
  for (const online of [true, false]) {
    setOnLine(online);
    for (const fetchFn of runs) {
      const e = await askClaude({ ...base(), fetchFn }).catch((x) => x);
      expect(e).toBeInstanceOf(KiError);
      expect(e.message).not.toContain(KEY);
      expect(String(e)).not.toContain(KEY);
      expect(String(e.code)).not.toContain(KEY);
      expect(String(e.code)).not.toContain('sk-ant');
    }
  }
  const odd = await askClaude({ ...base(), fetchFn: streamOf([errorEvent(KEY, 'x')]) }).catch((x) => x);
  expect(odd.code).toBeNull();
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
