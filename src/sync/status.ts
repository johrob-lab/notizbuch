// Der Zustand des Abgleichs, wie die Oberfläche ihn zeigt.

export type SyncState = 'gesichert' | 'wartet' | 'zugang';
export type SyncStatus = { state: SyncState; pending: number };

/** Der Text der Statusanzeige. */
export function statusLabel(s: SyncStatus): string {
  if (s.state === 'gesichert') return 'Gesichert';
  if (s.state === 'zugang') return 'Zugang erneuern';
  return `Wartet auf Netz · ${s.pending} ${s.pending === 1 ? 'Änderung' : 'Änderungen'}`;
}
