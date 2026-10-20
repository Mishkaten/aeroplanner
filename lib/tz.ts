// Time zones with daylight saving. Uses the browser's (and Node's) IANA time zone data through Intl, so no
// library is shipped. A station without a valid time zone falls back to its fixed utcOffsetMinutes.
import { MIN } from "./time";
import type { Airport } from "./types";

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatter(tz: string): Intl.DateTimeFormat | null {
  if (formatters.has(tz)) return formatters.get(tz)!;
  let f: Intl.DateTimeFormat | null = null;
  try {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
  } catch {
    f = null;
  }
  formatters.set(tz, f);
  return f;
}

export const isValidTz = (tz: string | undefined | null): tz is string => !!tz && formatter(tz) !== null;

/** Minutes east of UTC that the zone uses at this instant, or null for an unknown zone. */
export function offsetAt(tz: string, instantMs: number): number | null {
  const f = formatter(tz);
  if (!f) return null;
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(instantMs))) if (part.type !== "literal") p[part.type] = Number(part.value);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(instantMs / 1000) * 1000) / MIN);
}

type OffsetSource = Pick<Airport, "tzId" | "utcOffsetMinutes">;

/** The offset an airport uses at an instant: its time zone when it has one, else its fixed offset. */
export function airportOffset(a: OffsetSource, instantMs: number): number {
  return (isValidTz(a.tzId) ? offsetAt(a.tzId, instantMs) : null) ?? a.utcOffsetMinutes;
}

/** True when the airport's offset changes during the year (it observes daylight saving). */
export function observesDst(a: OffsetSource, year: number): boolean {
  if (!isValidTz(a.tzId)) return false;
  const jan = offsetAt(a.tzId, Date.UTC(year, 0, 15));
  const jul = offsetAt(a.tzId, Date.UTC(year, 6, 15));
  return jan !== jul;
}

export interface LocalToUtc {
  utcMs: number;
  /** The wall clock time does not exist (clocks jump forward): the result is the instant just after the gap. */
  nonexistent: boolean;
  /** The wall clock time happens twice (clocks go back): the earlier of the two is used. */
  ambiguous: boolean;
}

/** Converts a local wall clock time (given as if it were UTC, in ms) at a station into the real UTC instant. */
export function localToUtc(a: OffsetSource, localAsUtcMs: number): LocalToUtc {
  const off = (t: number) => airportOffset(a, t);
  const day = 24 * 3600_000;
  // the two offsets in force around the wall time give the only possible instants
  const before = localAsUtcMs - off(localAsUtcMs - day) * MIN;
  const after = localAsUtcMs - off(localAsUtcMs + day) * MIN;
  const valid = [...new Set([before, after])].filter((t) => t + off(t) * MIN === localAsUtcMs);
  if (valid.length === 0) return { utcMs: before, nonexistent: true, ambiguous: false };
  return { utcMs: Math.min(...valid), nonexistent: false, ambiguous: valid.length === 2 };
}

/** "UTC+2" or "UTC+5:30" */
export function formatUtcOffset(minutes: number): string {
  const m = Math.abs(minutes);
  return `UTC${minutes < 0 ? "-" : "+"}${Math.floor(m / 60)}${m % 60 ? `:${String(m % 60).padStart(2, "0")}` : ""}`;
}

/** A zone that matches a fixed offset all year, for stations stored before time zones existed. */
export function tzForFixedOffset(minutes: number): string | undefined {
  if (minutes === 330) return "Asia/Kolkata";
  if (minutes % 60 !== 0 || Math.abs(minutes) > 14 * 60) return undefined;
  const h = minutes / 60;
  return h === 0 ? "Etc/UTC" : `Etc/GMT${h > 0 ? "-" : "+"}${Math.abs(h)}`;
}
