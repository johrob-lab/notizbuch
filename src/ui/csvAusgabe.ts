// Gibt den Text einer CSV als Datei aus: am iPad über das Teilen-Blatt, am Firmen-PC (und überall, wo Teilen fehlt) als Download.
// Der Text bleibt unverändert, auch ein BOM am Anfang: Excel erkennt daran UTF-8.

/** Wie lange die Adresse der Datei nach dem Klick lebt, damit der Browser sie sicher übernommen hat. */
const REVOKE_AFTER_MS = 10_000;

export async function csvAusgeben(text: string, name: string, weg: 'teilen' | 'laden'): Promise<void> {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  if (weg === 'teilen') {
    const file = new File([blob], name, { type: 'text/csv' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
      return;
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
