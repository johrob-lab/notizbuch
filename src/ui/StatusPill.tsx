import type { Signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { statusLabel, type SyncEngine } from '../sync/engine';

function useSignalValue<T>(source: Signal<T>): T {
  const [value, setValue] = useState(source.value);
  useEffect(() => source.subscribe(setValue), [source]);
  return value;
}

/** Der Stand des Abgleichs als Text: Gesichert, Wartet auf Netz oder Zugang erneuern. Immer genau diese Texte. */
export function StatusPill({ engine }: { engine: Pick<SyncEngine, 'status'> }) {
  const status = useSignalValue(engine.status);
  return (
    <span class={`status status-${status.state}`} data-testid="status" role="status">
      {statusLabel(status)}
    </span>
  );
}
