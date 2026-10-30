import { REPOS } from '../lib/access';
import { AccessForm, type AccessValues } from './AccessForm';

// Die Einrichtung: Sie erscheint, solange auf diesem Gerät noch keine Einstellungen gespeichert sind. Danach öffnet die App den
// heutigen Tag. Geprüft und gespeichert wird in der App (`onSubmit`), hier steht nur, was man eintragen muss.

type Props = {
  /** Prüft den Zugang und speichert ihn. Liefert den Text, was nicht geklappt hat, oder `null`. */
  onSubmit(values: AccessValues): Promise<string | null>;
};

export function Setup({ onSubmit }: Props) {
  return (
    <section class="einrichten">
      <h1>Notizbuch einrichten</h1>
      <p>
        Trag hier den Zugang zu deinem Vault ein. Der Token bleibt nur auf diesem Gerät. Er braucht bei GitHub die Berechtigung „Contents:
        Read and write“ für das Repository.
      </p>
      <AccessForm repo={REPOS[0]} device="iPad" onSubmit={onSubmit} />
    </section>
  );
}
