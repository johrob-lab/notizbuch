import type { KiModel } from '../lib/settings';
import { sseParser, type SseEvent } from './sse';

export const API_URL = 'https://api.anthropic.com/v1/messages';
/** Die Probe des Schlüssels: Der Zähler für Token kostet nichts. */
export const COUNT_URL = 'https://api.anthropic.com/v1/messages/count_tokens';
export const API_VERSION = '2026-10-21';
/** Obergrenze für die Länge einer Antwort. Wird sie erreicht, endet die Antwort als `abgeschnitten`. */
export const MAX_TOKENS = 4096;
export const MODEL_IDS: Record<KiModel, string> = { sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5' };
// Ohne Angabe denken beide Modelle vorab, das ist die Vorgabe. Die Denk-Token gehen von max_tokens ab, die Antwort würde kürzer und
// käme spät. Sie soll sofort kommen. Jedes Modell nimmt nur seinen eigenen Wert, der jeweils andere gibt 400.
export const THINKING: Record<KiModel, { type: 'between_tools' | 'disabled' }> = {
  sonnet: { type: 'between_tools' },
  haiku: { type: 'disabled' },
};

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
 * So kann nichts davon in einer Anzeige oder einem Protokoll landen. `code` ist die Spur zur Ursache für die Zeile
 * „Fehlercode …“: der HTTP-Status (`'400'`), der Typ eines Fehlers im Strom (`'overloaded_error'`), `'Netzfehler'` oder `null`.
 */
export class KiError extends Error {
  readonly reason: KiFailure;
  readonly code: string | null;
  constructor(reason: KiFailure, code: string | null = null) {
    super(reason);
    this.name = 'KiError';
    this.reason = reason;
    this.code = code;
  }
}

/** Der Typ eines Fehlers im Strom als Spur, nur wenn er wie ein Typ aussieht (`overloaded_error`). So kommt kein fremder Text mit. */
function typeCode(type: unknown): string | null {
  return typeof type === 'string' && /^[a-z_]{1,64}$/.test(type) ? type : null;
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

// `cache_control` markiert das Ende eines Stücks für den Zwischenspeicher (prompt caching): Alles bis dahin liest Claude
// bei der nächsten Anfrage billiger aus dem Speicher.
export type TextBlock = { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } };
export type ImageBlock = {
  type: 'image';
  source: { type: 'base64'; media_type: 'image/png'; data: string };
  cache_control?: { type: 'ephemeral' };
};
/** Das Denken von Claude zwischen Werkzeugen. Es geht samt `signature` unverändert zurück, sonst lehnt die Schnittstelle ab. */
export type ThinkingBlock = { type: 'thinking'; thinking: string; signature: string };
/** Verschlüsseltes Denken: `data` geht unverändert zurück. */
export type RedactedThinkingBlock = { type: 'redacted_thinking'; data: string };
/** Claude ruft ein Werkzeug auf. */
export type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: unknown };
/** Das Ergebnis eines Werkzeugs, zum Aufruf mit derselben `id`. */
export type ToolResultBlock = {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
  cache_control?: { type: 'ephemeral' };
};
/** Was in einer Antwort von Claude stehen kann. */
export type AssistantBlock = TextBlock | ThinkingBlock | RedactedThinkingBlock | ToolUseBlock;
/** Ein Teil der Regeln an Claude. */
export type SystemBlock = { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } };
export type ApiMessage = { role: 'user' | 'assistant'; content: string | (TextBlock | ImageBlock | ToolResultBlock | AssistantBlock)[] };
/** Ein Werkzeug, das Claude aufrufen darf (Name, Beschreibung, JSON-Schema der Eingabe). */
export type ToolDefinition = { name: string; description: string; input_schema: Record<string, unknown> };
export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};
/**
 * Die Antwort: der ganze Text, die Zahlen für die Kosten (`null`, wenn sie fehlen), wie sie endete, alle Blöcke in ihrer
 * Reihenfolge (so gehen sie nach einem Werkzeugschritt zurück) und der Grund des Endes laut Schnittstelle (`stop_reason`).
 */
export type Reply = {
  text: string;
  usage: Usage | null;
  end: 'fertig' | 'gestoppt' | 'abgeschnitten';
  content: AssistantBlock[];
  stop: string | null;
};

const USAGE_KEYS = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'] as const;

/** Übernimmt aus `next` jede der vier Zahlen, die wirklich eine Zahl ist. Anderes, auch `null`, lässt den alten Wert stehen. */
function withNumbers(usage: Usage, next: Record<string, unknown>): Usage {
  const merged: Usage = { ...usage };
  for (const key of USAGE_KEYS) {
    const value = next[key];
    if (typeof value === 'number' && Number.isFinite(value)) merged[key] = value;
  }
  return merged;
}

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

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * Stellt eine Frage und liest die Antwort als Strom. `onText` bekommt jedes Stück Text, sobald es ankommt. Bricht das
 * Signal ab, endet die Antwort mit dem bisherigen Text als `gestoppt`, ohne Fehler. Sonst wirft ein Fehler einen `KiError`.
 * Der Schlüssel geht nur in den Kopf der Anfrage. Mit `tools` darf Claude Werkzeuge aufrufen, `toolChoice: 'none'` verbietet
 * es für diese Anfrage. Ohne `tools` geht beides nicht mit.
 */
export async function askClaude(o: {
  key: string;
  model: KiModel;
  system: string | SystemBlock[];
  messages: ApiMessage[];
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none';
  signal: AbortSignal;
  onText(delta: string): void;
  fetchFn?: typeof fetch;
}): Promise<Reply> {
  let text = '';
  let usage: Usage | null = null;
  let stop: string | null = null;
  // Die Blöcke der Antwort je `index`. Ein tool_use sammelt sein JSON in `openTools` und bekommt `input` erst an seinem Ende.
  // Bleibt sein JSON unlesbar oder kommt kein Ende, bleibt er dort: Dann ist die Antwort abgeschnitten.
  const blocks = new Map<number, AssistantBlock>();
  const openTools = new Map<number, string>();
  const content = (): AssistantBlock[] => [...blocks].sort(([a], [b]) => a - b).map(([, block]) => block);
  const gestoppt = (): Reply => ({ text, usage, end: 'gestoppt', content: content(), stop });

  /** Hängt Text an den Textblock `index` an, legt ihn an, wenn es ihn noch nicht gibt, und gibt das Stück weiter. */
  const addText = (index: number, piece: string): void => {
    let block = blocks.get(index);
    if (!block) blocks.set(index, (block = { type: 'text', text: '' }));
    if (block.type !== 'text') return;
    block.text += piece;
    text += piece;
    o.onText(piece);
  };

  const startBlock = (index: number, b: any): void => {
    if (b?.type === 'text') {
      blocks.set(index, { type: 'text', text: '' });
      if (textOf(b.text) !== '') addText(index, b.text);
    } else if (b?.type === 'thinking') {
      blocks.set(index, { type: 'thinking', thinking: textOf(b.thinking), signature: textOf(b.signature) });
    } else if (b?.type === 'redacted_thinking') {
      blocks.set(index, { type: 'redacted_thinking', data: textOf(b.data) });
    } else if (b?.type === 'tool_use') {
      blocks.set(index, { type: 'tool_use', id: textOf(b.id), name: textOf(b.name), input: {} });
      openTools.set(index, '');
    }
  };

  const addDelta = (index: number, d: any): void => {
    const block = blocks.get(index);
    if (d?.type === 'text_delta' && typeof d.text === 'string') addText(index, d.text);
    else if (d?.type === 'thinking_delta' && typeof d.thinking === 'string' && block?.type === 'thinking') block.thinking += d.thinking;
    // Die Signatur kommt in einem Stück kurz vor dem Ende des Denkblocks.
    else if (d?.type === 'signature_delta' && typeof d.signature === 'string' && block?.type === 'thinking') block.signature = d.signature;
    else if (d?.type === 'input_json_delta' && typeof d.partial_json === 'string') {
      const json = openTools.get(index);
      if (json !== undefined) openTools.set(index, json + d.partial_json);
    }
  };

  const stopBlock = (index: number): void => {
    const block = blocks.get(index);
    const json = openTools.get(index);
    if (block?.type !== 'tool_use' || json === undefined) return;
    try {
      block.input = JSON.parse(json || '{}');
      openTools.delete(index);
    } catch {
      // Unlesbar: `input` bleibt `{}`, der Aufruf bleibt offen.
    }
  };

  try {
    // Das globale fetch erst hier lesen, nicht beim Laden des Moduls: Tests ersetzen es mit vi.stubGlobal.
    const send = o.fetchFn ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    const res = await send(API_URL, {
      method: 'POST',
      headers: headers(o.key),
      body: JSON.stringify({
        model: MODEL_IDS[o.model],
        max_tokens: MAX_TOKENS,
        stream: true,
        thinking: THINKING[o.model],
        system: o.system,
        messages: o.messages,
        // Erzwingen lässt sich ein Werkzeug nicht: Mit Denken lehnt die Schnittstelle das ab. Darum nur `auto` oder `none`.
        ...(o.tools ? { tools: o.tools, tool_choice: { type: o.toolChoice ?? 'auto' } } : {}),
      }),
      signal: o.signal,
    });
    if (!res.ok) {
      const e = await errorOf(res);
      throw new KiError(failureOf(res.status, e.type, e.message), String(res.status));
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
      const index: number = typeof data?.index === 'number' ? data.index : 0;
      if (ev.event === 'message_start') {
        const u = data?.message?.usage;
        if (u && typeof u === 'object') usage = withNumbers({ input_tokens: 0, output_tokens: 0 }, u);
      } else if (ev.event === 'message_delta') {
        if (typeof data?.delta?.stop_reason === 'string') stop = data.delta.stop_reason;
        // Jedes message_delta bringt die Zahlen bis dahin mit und überschreibt, was es nennt. Ohne message_start fehlen sie.
        if (usage && data?.usage && typeof data.usage === 'object') usage = withNumbers(usage, data.usage);
      } else if (ev.event === 'content_block_start') {
        startBlock(index, data?.content_block);
      } else if (ev.event === 'content_block_delta') {
        addDelta(index, data?.delta);
      } else if (ev.event === 'content_block_stop') {
        stopBlock(index);
      } else if (ev.event === 'error') {
        throw new KiError(failureOf(0, data?.error?.type, data?.error?.message), typeCode(data?.error?.type));
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
    // fetch und der Strom lehnen bei Netzproblemen mit TypeError ab. Ohne Netz sagt das auch der Browser, sonst scheiterte der
    // Weg anders (Verbindung abgelehnt, abgebrochen). Die ursprüngliche Meldung kann den Schlüssel enthalten und bleibt draußen.
    if (e instanceof TypeError) throw navigator.onLine === false ? new KiError('offline') : new KiError('unavailable', 'Netzfehler');
    throw new KiError('unavailable');
  }

  if (isAbort(o.signal)) return gestoppt();
  const cut = stop === 'max_tokens' || openTools.size > 0;
  return { text, usage, end: cut ? 'abgeschnitten' : 'fertig', content: content(), stop };
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
