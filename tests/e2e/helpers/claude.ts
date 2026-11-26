import type { Page, Route } from '@playwright/test';

// Die Schnittstelle von Claude, gespielt über page.route: Es geht keine Anfrage ins Netz. `requests` hält jede POST-Anfrage
// (Köpfe kleingeschrieben, Körper als JSON). Die Antworten kommen der Reihe nach aus `queue`, danach immer `next`. `count` ist die
// Antwort auf die Probe des Schlüssels.

export type ClaudeRequest = { url: string; headers: Record<string, string>; body: any };

/** Eine Antwort mit Text. */
export type ClaudeTextReply = { text: string; input?: number; output?: number; stop?: 'end_turn' | 'max_tokens' };

/**
 * Ein Werkzeugschritt wie von Sonnet: zuerst ein Denkblock mit `signature: 'sig-test'`, dann wahlweise Text, dann je Werkzeug
 * ein `tool_use` mit der `id` `toolu_test_<n>` (n zählt über alle Antworten des Mocks, ab 1). Endet mit `stop_reason: 'tool_use'`.
 */
export type ClaudeToolReply = { tools: { name: string; input: unknown }[]; text?: string; thinking?: string };

export type ClaudeReply = ClaudeTextReply | ClaudeToolReply | { status: number; type: string; message: string } | 'offline';

export type ClaudeMock = {
  requests: ClaudeRequest[];
  /** Die Antwort auf jede Frage, sobald `queue` leer ist. */
  next: ClaudeReply;
  /** Antworten für die nächsten Anfragen, der Reihe nach. Sie kommen vor `next` und warten nie auf `gate`. */
  queue: ClaudeReply[];
  /**
   * Solange das ein Versprechen ist, wartet die Antwort aus `next` darauf. Hat die App die Anfrage inzwischen abgebrochen
   * („Stopp“), geht die Antwort still ins Leere.
   */
  gate: Promise<void> | null;
  count: { status: number; type?: string; message?: string } | 'offline';
};

const CORS = { 'access-control-allow-origin': '*' };

/** Ein Ereignis des Stroms im Format von Server-Sent Events. */
const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

const messageStart = (input: number) =>
  event('message_start', { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', content: [], usage: { input_tokens: input, output_tokens: 1 } } });
const blockStart = (index: number, block: unknown) => event('content_block_start', { type: 'content_block_start', index, content_block: block });
const blockDelta = (index: number, delta: unknown) => event('content_block_delta', { type: 'content_block_delta', index, delta });
const blockStop = (index: number) => event('content_block_stop', { type: 'content_block_stop', index });
const messageEnd = (stop: string, output: number) => [
  event('message_delta', { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: output } }),
  event('message_stop', { type: 'message_stop' }),
];

/** Der Textblock `index`: Der Text kommt in Stücken zu je 5 Zeichen. */
function textBlock(index: number, text: string): string[] {
  const chunks = text.match(/[\s\S]{1,5}/g) ?? [];
  return [blockStart(index, { type: 'text', text: '' }), ...chunks.map((piece) => blockDelta(index, { type: 'text_delta', text: piece })), blockStop(index)];
}

/** Der Strom einer Textantwort. */
function stream(reply: ClaudeTextReply): string {
  return [messageStart(reply.input ?? 5000), ...textBlock(0, reply.text), ...messageEnd(reply.stop ?? 'end_turn', reply.output ?? 100)].join('');
}

/** Der Strom eines Werkzeugschritts. `nextId` vergibt die Nummer jedes Aufrufs. */
function toolStream(reply: ClaudeToolReply, nextId: () => number): string {
  const parts = [
    messageStart(3000),
    blockStart(0, { type: 'thinking', thinking: '', signature: '' }),
    blockDelta(0, { type: 'thinking_delta', thinking: reply.thinking ?? 'Ich suche im Vault.' }),
    blockDelta(0, { type: 'signature_delta', signature: 'sig-test' }),
    blockStop(0),
  ];
  let index = 1;
  if (reply.text !== undefined) parts.push(...textBlock(index++, reply.text));
  for (const tool of reply.tools) {
    const json = JSON.stringify(tool.input);
    parts.push(
      blockStart(index, { type: 'tool_use', id: `toolu_test_${nextId()}`, name: tool.name, input: {} }),
      // Die Eingabe in zwei Stücken, wie sie auch die echte Schnittstelle schickt.
      blockDelta(index, { type: 'input_json_delta', partial_json: json.slice(0, 5) }),
      blockDelta(index, { type: 'input_json_delta', partial_json: json.slice(5) }),
      blockStop(index),
    );
    index++;
  }
  parts.push(...messageEnd('tool_use', 50));
  return parts.join('');
}

const errorBody = (type: string, message: string) => JSON.stringify({ type: 'error', error: { type, message } });

/** Spielt die Schnittstelle. Vor `openSeeded` aufrufen, damit die Route steht, bevor die App etwas fragt. */
export async function mockClaude(page: Page): Promise<ClaudeMock> {
  const mock: ClaudeMock = { requests: [], next: { text: 'Hallo.', input: 5000, output: 100 }, queue: [], gate: null, count: { status: 200 } };
  let toolIds = 0;

  await page.route('https://api.anthropic.com/v1/**', async (route: Route) => {
    const request = route.request();
    // Die Vorabfrage des Browsers (CORS) ist keine Anfrage der App und wird nicht festgehalten.
    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: { ...CORS, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' },
      });
      return;
    }
    const url = request.url();
    mock.requests.push({ url, headers: request.headers(), body: request.postDataJSON() });

    if (url.endsWith('/count_tokens')) {
      const count = mock.count;
      if (count === 'offline') return route.abort('internetdisconnected');
      if (count.status === 200) return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '{"input_tokens":9}' });
      return route.fulfill({ status: count.status, headers: CORS, contentType: 'application/json', body: errorBody(count.type ?? 'api_error', count.message ?? '') });
    }

    const queued = mock.queue.shift();
    const reply = queued ?? mock.next;
    const answer = async (): Promise<void> => {
      if (reply === 'offline') return route.abort('internetdisconnected');
      if ('status' in reply) return route.fulfill({ status: reply.status, headers: CORS, contentType: 'application/json', body: errorBody(reply.type, reply.message) });
      const body = 'tools' in reply ? toolStream(reply, () => ++toolIds) : stream(reply);
      return route.fulfill({ status: 200, headers: { ...CORS, 'cache-control': 'no-cache' }, contentType: 'text/event-stream', body });
    };
    const gate = queued === undefined ? mock.gate : null;
    if (gate === null) return answer();
    await gate;
    // Hat die App die Anfrage inzwischen abgebrochen, wartet niemand mehr auf die Antwort. Chromium verwirft sie still, ein Fehler
    // von Playwright dabei zählt hier ebenso wenig.
    await answer().catch(() => undefined);
  });

  return mock;
}

/** Breite und Höhe eines PNG (Base64 ohne Präfix), gelesen aus dem Block IHDR: Bytes 16 bis 19 und 20 bis 23. */
export function pngSize(base64: string): { w: number; h: number } {
  const bytes = Buffer.from(base64.slice(0, 64), 'base64');
  return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
}
