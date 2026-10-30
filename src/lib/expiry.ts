import { addDays, formatDay, isValidDay, todayVienna, type Day } from './dates';

// Wann der Token abläuft, und die Warnung davor. Gerechnet wird in Kalendertagen nach Wiener Zeit, nie in Stunden: Ein Tag
// ist ein Tag, auch wenn zwischen Sommer- und Winterzeit eine Stunde dazukommt oder fehlt.

/** So viele Kalendertage vor dem Ablauf beginnt die Warnung. Sie bleibt, bis der Token erneuert ist, auch danach. */
const WARN_DAYS = 14;
const HOUR_MS = 3_600_000;

/**
 * Der Text der Warnung, oder `null`, wenn der Token noch länger als 14 Tage gilt oder sein Ablauf nicht bekannt ist. Der
 * Tag des Ablaufs und heute sind Tage in Wien. Ein Token, der schon abgelaufen ist, wird weiter gewarnt.
 */
export function expiryWarning(expiry: Date | null, now: Date): string | null {
  if (expiry === null || Number.isNaN(expiry.getTime()) || Number.isNaN(now.getTime())) return null;
  const last = todayVienna(expiry);
  // `YYYY-MM-DD` ordnet sich als Text wie der Kalender.
  if (last > addDays(todayVienna(now), WARN_DAYS)) return null;
  return `Dein Zugang läuft am ${formatDay(last)} ab. Bitte rechtzeitig erneuern.`;
}

/**
 * Der letzte Augenblick dieses Tages in Wien (23:59:59,999 Uhr). Wer am Ende des Tages noch zugreifen kann, hat für diesen
 * Tag einen gültigen Zugang: Das Datum, das man eingibt, ist der letzte Tag, an dem der Token geht.
 */
export function endOfDayVienna(day: Day): Date {
  const nextDay = addDays(day, 1);
  const midnightUtc = Date.parse(`${nextDay}T00:00:00Z`);
  // Um Mitternacht in Wien ist der Versatz zu UTC 2 Stunden (Sommerzeit) oder 1 Stunde (Winterzeit). Die Umstellung liegt
  // nachts um 2 oder 3 Uhr, also nie an der Grenze zwischen zwei Tagen: Der Anfang des nächsten Tages ist einer der beiden.
  const summer = midnightUtc - 2 * HOUR_MS;
  const startOfNext = todayVienna(new Date(summer)) === nextDay ? summer : midnightUtc - HOUR_MS;
  return new Date(startOfNext - 1);
}

/** Der Tag in einem Jahr. Den 29. Februar gibt es im Jahr danach nicht, dann gilt der 28. */
export function defaultExpiry(today: Day): Day {
  const [year, month, day] = [Number(today.slice(0, 4)), today.slice(5, 7), today.slice(8, 10)];
  const sameDay = `${year + 1}-${month}-${day}`;
  return isValidDay(sameDay) ? sameDay : `${year + 1}-${month}-28`;
}

/**
 * Das Ablaufdatum, das gilt: das, was GitHub in seiner Antwort genannt hat (genau auf die Sekunde), sonst der Tag aus der
 * Einrichtung als sein letzter Augenblick in Wien, sonst keins. Ein Tag, der kein Tag im Kalender ist, zählt nicht.
 */
export function knownExpiry(client: { lastTokenExpiry: Date | null }, typed: Day | undefined): Date | null {
  if (client.lastTokenExpiry !== null) return client.lastTokenExpiry;
  return typed !== undefined && isValidDay(typed) ? endOfDayVienna(typed) : null;
}
