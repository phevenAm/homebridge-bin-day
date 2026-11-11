/** Parses "HH:MM" (24h). Falls back to the default if it's missing or wrong. */
export function parseTime(value: string | undefined, fallback: string): [number, number] {
  const m = (value ?? '').trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  const use = m ? m : (fallback.match(/^(\d{1,2}):(\d{2})$/) as RegExpMatchArray);
  return [Number(use[1]), Number(use[2])];
}

/**
 * True from alertTime the evening before collection, until endTime on collection day.
 * date is YYYY-MM-DD, read as local time.
 */
export function isAlertActive(
  date: string,
  now: Date,
  alert: [number, number],
  end: [number, number],
): boolean {
  const [y, m, d] = date.split('-').map(Number);
  const start = new Date(y, m - 1, d - 1, alert[0], alert[1]);
  const stop = new Date(y, m - 1, d, end[0], end[1]);
  return now >= start && now < stop;
}
