/** Generic calendar helpers (local time). */

export const DAY = 86_400_000;

export function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Calendar-day difference a - b (negative = a is before b). */
export function dayDiff(a: number, b: number): number {
  return Math.round((startOfDay(a) - startOfDay(b)) / DAY);
}
