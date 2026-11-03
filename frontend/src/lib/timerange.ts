/**
 * Absolute time ranges used across the dashboard. Ranges are day-granular
 * (start of first day to end of last day, capped at "now") and are sent to
 * the API as epoch-millisecond start/end query params.
 */
import { startOfDay, endOfDay, subDays, isSameDay, format } from 'date-fns';

export interface TimeRange {
  /** inclusive start, epoch ms */
  start: number;
  /** inclusive end, epoch ms (never in the future) */
  end: number;
}

export interface DayRange {
  from: Date;
  to: Date;
}

/** Convert calendar dates to the epoch range the API consumes. */
export function toTimeRange(range: DayRange): TimeRange {
  const now = Date.now();
  return {
    start: Math.min(startOfDay(range.from).getTime(), now),
    end: Math.min(endOfDay(range.to).getTime(), now),
  };
}

/** "Last n days" including today: n=7 covers today plus the previous 6 days. */
export function lastNDays(n: number): DayRange {
  const today = new Date();
  return { from: startOfDay(subDays(today, n - 1)), to: today };
}

export function hoursOf(range: TimeRange): number {
  return Math.max(1, Math.round((range.end - range.start) / 3_600_000));
}

export const rangeQuery = (r: TimeRange) => `start=${r.start}&end=${r.end}`;

export function formatDayRange(range: DayRange): string {
  const fmt = (d: Date) => format(d, 'MMM d, yyyy');
  return isSameDay(range.from, range.to) ? fmt(range.from) : `${fmt(range.from)} – ${fmt(range.to)}`;
}

/** Label for presets so the trigger can show "Last 7 days" instead of dates. */
export function matchPreset(range: DayRange, presets: number[]): number | null {
  for (const n of presets) {
    const p = lastNDays(n);
    if (isSameDay(range.from, p.from) && isSameDay(range.to, p.to)) return n;
  }
  return null;
}
