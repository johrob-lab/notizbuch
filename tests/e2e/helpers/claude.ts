import type { Page, Route } from '@playwright/test';

// Die Schnittstelle von Claude, gespielt über page.route: Es geht keine Anfrage ins Netz. `requests` hält jede POST-Anfrage
// (Köpfe kleingeschrieben, Körper als JSON). `next` ist die Antwort auf die nächste Frage, `count` die auf die Probe des Schlüssels.

export type ClaudeRequest = { url: string; headers: Record<string, string>; body: any };

export type ClaudeReply =
  | { text: string; input?: number; output?: number; stop?: 'end_turn' | 'max_tokens' }
  | { status: number; type: string; message: string }
  | 'offline';

export type ClaudeMock = {
  requests: ClaudeRequest[];
  next: ClaudeReply;
  count: { status: number; type?: string; message?: string } | 'offline';
};

const CORS = { 'access-control-allow-origin': '*' };

/** Ein Ereignis des Stroms im Format von Server-Sent Events. */
const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

/** Der Strom einer Textantwort: Der Text kommt in Stücken zu je 5 Zeichen. */
function stream(reply: { text: string; input?: number; output?: number; stop?: 'end_turn' | 'max_tokens' }): string {
  const chunks = reply.text.match(/[\s\S]{1,5}/g) ?? [];
  return [
    event('message_start', { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', content: [], usage: { input_tokens: reply.input ?? 5000, output_tokens: 1 } } }),
    event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    ...chunks.map((text) => event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })),
    event('content_block_stop', { type: 'content_block_stop', index: 0 }),
    event('message_delta', { type: 'message_delta', delta: { stop_reason: reply.stop ?? 'end_turn' }, usage: { output_tokens: reply.output ?? 100 } }),
    event('message_stop', { type: 'message_stop' }),
  ].join('');
}

const errorBody = (type: string, message: string) => JSON.stringify({ type: 'error', error: { type, message } });

/** Spielt die Schnittstelle. Vor `openSeeded` aufrufen, damit die Route steht, bevor die App etwas fragt. */
export async function mockClaude(page: Page): Promise<ClaudeMock> {
  const mock: ClaudeMock = { requests: [], next: { text: 'Hallo.', input: 5000, output: 100 }, count: { status: 200 } };

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

    const reply = mock.next;
    if (reply === 'offline') return route.abort('internetdisconnected');
    if ('status' in reply) return route.fulfill({ status: reply.status, headers: CORS, contentType: 'application/json', body: errorBody(reply.type, reply.message) });
    return route.fulfill({ status: 200, headers: { ...CORS, 'cache-control': 'no-cache' }, contentType: 'text/event-stream', body: stream(reply) });
  });

  return mock;
}

/** Breite und Höhe eines PNG (Base64 ohne Präfix), gelesen aus dem Block IHDR: Bytes 16 bis 19 und 20 bis 23. */
export function pngSize(base64: string): { w: number; h: number } {
  const bytes = Buffer.from(base64.slice(0, 64), 'base64');
  return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
}
