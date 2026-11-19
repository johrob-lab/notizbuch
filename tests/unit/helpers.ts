import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Läuft nur in Tests (Node). Der erfundene Mini-Vault liegt in tests/fixtures/vault/.
// Nicht `new URL('…', import.meta.url)` schreiben: Vite macht daraus eine Asset-URL ohne file-Schema.
const VAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'vault');

/** Liest eine Datei aus dem erfundenen Mini-Vault, zum Beispiel `05 Daily Notes/2026-10-29.md`. */
export function fixture(path: string): string {
  return readFileSync(join(VAULT_DIR, path), 'utf8');
}

/** Index der ersten Zeile, die `text` enthält, oder -1. */
export function lineOf(md: string, text: string): number {
  return md.split('\n').findIndex((line) => line.includes(text));
}

/** Eine aufgezeichnete Anfrage des falschen `fetch`. */
export type Call = { url: string; init: RequestInit };

/**
 * Ein falsches `fetch`, das einen Strom aus `chunks` liefert (Text, als UTF-8 in Stücken). `status` ist der Status der Antwort
 * (`ok` folgt daraus). Mit `hold` hält der Strom nach dem ersten Stück an, bis das Signal der Anfrage abbricht, und endet dann
 * mit einem Fehler wie ein abgebrochener Abruf. Mit `release` hält er dort nur an, bis `release` erfüllt ist, und liefert dann
 * den Rest. Bricht das Signal vorher ab, endet er wie bei `hold`. Gemerkt werden URL und `init` jeder Anfrage in `calls`.
 */
export function streamOf(chunks: string[], o: { status?: number; hold?: boolean; release?: Promise<void> } = {}): typeof fetch & { calls: Call[] } {
  const calls: Call[] = [];
  const status = o.status ?? 200;
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const signal = init?.signal ?? undefined;
    const enc = new TextEncoder();
    let i = 0;
    let released = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i === 1 && (o.hold || (o.release && !released))) {
          return new Promise<void>((resolve, reject) => {
            const abort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
            if (signal?.aborted) return abort();
            signal?.addEventListener('abort', abort, { once: true });
            void o.release?.then(() => {
              released = true;
              resolve();
            });
          });
        }
        if (i < chunks.length) controller.enqueue(enc.encode(chunks[i++]));
        else controller.close();
      },
    });
    return { ok: status >= 200 && status < 300, status, body } as unknown as Response;
  }) as typeof fetch & { calls: Call[] };
  fn.calls = calls;
  return fn;
}

/** Ein SSE-Ereignis im Format der Claude-Schnittstelle. */
export function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export const messageStart = (input: number, output: number) =>
  sse('message_start', { type: 'message_start', message: { usage: { input_tokens: input, output_tokens: output } } });
export const textDelta = (text: string) =>
  sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
export const messageDelta = (stop: string, output: number) =>
  sse('message_delta', { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: output } });
export const messageStop = () => sse('message_stop', { type: 'message_stop' });
export const errorEvent = (type: string, message: string) => sse('error', { type: 'error', error: { type, message } });
