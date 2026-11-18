import type { KiModel } from '../lib/settings';
import { sseParser, type SseEvent } from './sse';

export const API_URL = 'https://api.anthropic.com/v1/messages';
/** Die Probe des Schlüssels: Der Zähler für Token kostet nichts. */
export const COUNT_URL = 'https://api.anthropic.com/v1/messages/count_tokens';
export const API_VERSION = '2026-10-21';
/** Obergrenze für die Länge einer Antwort. Wird sie erreicht, endet die Antwort als `abgeschnitten`. */
export const MAX_TOKENS = 2048;
export const MODEL_IDS: Record<KiModel, string> = { sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5' };

/** Woran eine Frage scheitern kann: kein Netz, der Schlüssel passt nicht, das Guthaben oder Limit ist erreicht, alles andere. */
export type KiFailure = 'offline' | 'key' | 'credit' | 'unavailable';

/** Die Fehlertexte des Fensters, je Grund einer. */
export const FAILURE_TEXT: Record<KiFailure, string> = {
  offline: 'Ohne Netz kann Claude nicht antworten.',
  key: 'Der KI-Schlüssel passt nicht. Bitte in den Einstellungen prüfen.',
  credit: 'Das KI-Guthaben ist für diesen Monat aufgebraucht oder das Limit ist erreicht.',
  unavailable: 'Claude ist gerade nicht erreichbar. Bitte gleich noch einmal.',
};

/**
 * Ein Fehler der Schnittstelle. Seine Meldung ist nur der Grund, nie Text aus der Antwort und nie der Schlüssel:
 * So kann nichts davon in einer Anzeige oder einem Protokoll landen.
 */
export class KiError extends Error {
  readonly reason: KiFailure;
  constructor(reason: KiFailure) {
    super(reason);
    this.name = 'KiError';
    this.reason = reason;
  }
}

/**
 * Ordnet einen Fehler der Schnittstelle einem Grund zu, nach Status und Typ aus dem Körper. Ein Fehler mitten im Strom hat
 * keinen eigenen Status, dann gilt 0. Bei 400 und 429 entscheidet die Meldung, ob es ums Guthaben geht.
 */
export function failureOf(status: number, type?: string, message?: string): KiFailure {
  if (status === 401 || status === 403 || type === 'authentication_error' || type === 'permission_error') return 'key';
  if (status === 402 || type === 'billing_error') return 'credit';
  const money = status === 400 || status === 429 || type === 'invalid_request_error' || type === 'rate_limit_error';
  if (money && /credit|billing|spend|usage limit/i.test(message ?? '')) return 'credit';
  return 'unavailable';
}

export type TextBlock = { type: 'text'; text: string };
export type ImageBlock = { type: 'image'; source: { type: 'base64'; media_type: 'image/png'; data: string } };
export type ApiMessage = { role: 'user' | 'assistant'; content: string | (TextBlock | ImageBlock)[] };
export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};
/** Die Antwort: der Text bis zum Ende, die Zahlen für die Kosten (`null`, wenn nichts ankam) und wie sie endete. */
export type Reply = { text: string; usage: Usage | null; end: 'fertig' | 'gestoppt' | 'abgeschnitten' };

function headers(key: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-api-key': key.trim(),
    'anthropic-version': API_VERSION,
    // Ohne diesen Kopf lehnt die Schnittstelle Aufrufe aus dem Browser ab.
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

type ErrorBody = { error?: { type?: unknown; message?: unknown } };

/** Liest den Körper einer Fehlerantwort als JSON; scheitert das, gibt es keine Angaben. */
async function errorOf(res: Response): Promise<{ type?: string; message?: string }> {
  try {
    const text = await new Response(res.body).text();
    const e = (JSON.parse(text) as ErrorBody).error;
    return { type: typeof e?.type === 'string' ? e.type : undefined, message: typeof e?.message === 'string' ? e.message : undefined };
  } catch {
    return {};
  }
}

/** Ein Abbruch des Signals zählt nie als Fehler, auch wenn fetch dann mit AbortError oder TypeError ablehnt. */
function isAbort(signal: AbortSignal): boolean {
  return signal.aborted;
}

/**
 * Stellt eine Frage und liest die Antwort als Strom. `onText` bekommt jedes Stück Text, sobald es ankommt. Bricht das
 * Signal ab, endet die Antwort mit dem bisherigen Text als `gestoppt`, ohne Fehler. Sonst wirft ein Fehler einen `KiError`.
 * Der Schlüssel geht nur in den Kopf der Anfrage.
 */
export async function askClaude(o: {
  key: string;
  model: KiModel;
  system: string;
  messages: ApiMessage[];
  signal: AbortSignal;
  onText(delta: string): void;
  fetchFn?: typeof fetch;
}): Promise<Reply> {
  let text = '';
  let usage: Usage | null = null;
  let stop: string | null = null;
  const gestoppt = (): Reply => ({ text, usage, end: 'gestoppt' });

  try {
    // Das globale fetch erst hier lesen, nicht beim Laden des Moduls: Tests ersetzen es mit vi.stubGlobal.
    const send = o.fetchFn ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    const res = await send(API_URL, {
      method: 'POST',
      headers: headers(o.key),
      body: JSON.stringify({ model: MODEL_IDS[o.model], max_tokens: MAX_TOKENS, stream: true, system: o.system, messages: o.messages }),
      signal: o.signal,
    });
    if (!res.ok) {
      const e = await errorOf(res);
      throw new KiError(failureOf(res.status, e.type, e.message));
    }
    if (!res.body) throw new KiError('unavailable');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parser = sseParser();

    const handle = (ev: SseEvent): void => {
      let data: any;
      try {
        data = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (ev.event === 'message_start') {
        const u = data?.message?.usage;
        if (u) usage = { ...u };
      } else if (ev.event === 'message_delta') {
        if (typeof data?.delta?.stop_reason === 'string') stop = data.delta.stop_reason;
        // Jedes message_delta bringt die Zahlen bis dahin mit und überschreibt, was es nennt.
        if (data?.usage) usage = { input_tokens: 0, output_tokens: 0, ...(usage ?? {}), ...data.usage };
      } else if (ev.event === 'content_block_delta') {
        if (data?.delta?.type === 'text_delta' && typeof data.delta.text === 'string') {
          text += data.delta.text;
          o.onText(data.delta.text);
        }
      } else if (ev.event === 'error') {
        throw new KiError(failureOf(0, data?.error?.type, data?.error?.message));
      }
    };

    for (;;) {
      if (isAbort(o.signal)) {
        void reader.cancel().catch(() => {});
        return gestoppt();
      }
      const { done, value } = await reader.read();
      if (done) break;
      for (const ev of parser.push(decoder.decode(value, { stream: true }))) handle(ev);
    }
    for (const ev of parser.push(decoder.decode())) handle(ev);
    for (const ev of parser.end()) handle(ev);
  } catch (e) {
    if (isAbort(o.signal)) return gestoppt();
    if (e instanceof KiError) throw e;
    // fetch und der Strom lehnen nur bei Netzproblemen ab. Die ursprüngliche Meldung kann den Schlüssel enthalten und bleibt draußen.
    throw new KiError(e instanceof TypeError ? 'offline' : 'unavailable');
  }

  if (isAbort(o.signal)) return gestoppt();
  return { text, usage, end: stop === 'max_tokens' ? 'abgeschnitten' : 'fertig' };
}

/** Ob die Eingabe nach einem KI-Schlüssel aussieht: `sk-ant-` und danach nur Buchstaben, Ziffern, `_` und `-`. */
export function looksLikeKey(key: string): boolean {
  return /^sk-ant-[A-Za-z0-9_-]+$/.test(key.trim());
}

/**
 * Prüft den Schlüssel beim Speichern am kostenlosen Zähler für Token. `null` heißt: Der Schlüssel passt.
 * Sonst der Grund, warum nicht.
 */
export async function checkKey(key: string, model: KiModel, fetchFn?: typeof fetch): Promise<KiFailure | null> {
  try {
    const send = fetchFn ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    const res = await send(COUNT_URL, {
      method: 'POST',
      headers: headers(key),
      body: JSON.stringify({ model: MODEL_IDS[model], messages: [{ role: 'user', content: 'Hallo' }] }),
    });
    if (res.ok) return null;
    const e = await errorOf(res);
    return failureOf(res.status, e.type, e.message);
  } catch (e) {
    return e instanceof TypeError ? 'offline' : 'unavailable';
  }
}
