/** Ein Ereignis aus einem SSE-Strom (Server-Sent Events): sein Name und die Daten, mehrere Zeilen mit `\n` verbunden. */
export type SseEvent = { event: string; data: string };

/**
 * Setzt einen Strom aus Textstücken zu SSE-Ereignissen zusammen. Ein Ereignis endet mit einer Leerzeile (`\n` oder `\r\n`),
 * ein Stück darf mitten in einer Zeile enden. `event:` und `data:` gelten mit oder ohne Leerzeichen danach, Zeilen mit
 * `:` am Anfang sind Kommentare. Ohne `event:` heißt das Ereignis `message`, ein Block ohne `data` fällt weg.
 * `end()` gibt ein letztes Ereignis zurück, nach dem keine Leerzeile mehr kam.
 */
export function sseParser(): { push(chunk: string): SseEvent[]; end(): SseEvent[] } {
  let rest = '';

  function block(text: string): SseEvent | null {
    let event = 'message';
    const data: string[] = [];
    for (const line of text.split('\n')) {
      if (line === '' || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    return data.length ? { event, data: data.join('\n') } : null;
  }

  return {
    push(chunk) {
      rest = (rest + chunk).replace(/\r\n/g, '\n');
      const parts = rest.split('\n\n');
      rest = parts.pop() ?? '';
      const out: SseEvent[] = [];
      for (const p of parts) {
        const e = block(p);
        if (e) out.push(e);
      }
      return out;
    },
    end() {
      const e = block(rest);
      rest = '';
      return e ? [e] : [];
    },
  };
}
