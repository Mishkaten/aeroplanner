import { UTCDate } from "@date-fns/utc";
import { format } from "date-fns";
import type { IsoDate, IsoInstant } from "./types";

// All times are UTC instants. date-fns formats through UTCDate so the user's
// time zone never leaks in. No Date.now() or Math.random() in application logic.

export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export const DEMO_CLOCK: IsoInstant = "2026-09-13T14:00:00Z";
export const DEMO_CLOCK_MS = Date.parse(DEMO_CLOCK);

export const ms = (iso: IsoInstant): number => Date.parse(iso);

export function iso(timeMs: number): IsoInstant {
  return new Date(timeMs).toISOString().replace(".000Z", "Z");
}

export const utcDate = (instant: IsoInstant | number): IsoDate =>
  new Date(typeof instant === "number" ? instant : Date.parse(instant)).toISOString().slice(0, 10);

export const dateMs = (date: IsoDate): number => Date.parse(`${date}T00:00:00Z`);

export const addDaysIso = (date: IsoDate, days: number): IsoDate => utcDate(dateMs(date) + days * DAY);

/** ISO weekday of a UTC calendar date: Monday 1 to Sunday 7. */
export function isoWeekday(date: IsoDate): number {
  const d = new Date(dateMs(date)).getUTCDay();
  return d === 0 ? 7 : d;
}

const f = (timeMs: number, pattern: string) => format(new UTCDate(timeMs), pattern);

export const fmtHHMM = (instant: IsoInstant | number): string =>
  f(typeof instant === "number" ? instant : Date.parse(instant), "HH:mm");

/** "14 Sep" */
export const fmtDate = (instant: IsoInstant | number | IsoDate): string => f(toMs(instant), "d MMM");

/** "Mon 14 Sep" */
export const fmtDow = (instant: IsoInstant | number | IsoDate): string => f(toMs(instant), "EEE d MMM");

/** "Mon 14 Sep 03:30Z" */
export const fmtDowTime = (instant: IsoInstant | number): string => f(toMs(instant), "EEE d MMM HH:mm") + "Z";

/** "14 Sep 2026" */
export const fmtFull = (instant: IsoInstant | number | IsoDate): string => f(toMs(instant), "d MMM yyyy");

function toMs(v: IsoInstant | number | IsoDate): number {
  if (typeof v === "number") return v;
  return v.length === 10 ? dateMs(v) : Date.parse(v);
}

/** Minutes as "HH:MM". */
export function fmtDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** "HH:MM" or "H:MM" to minutes since 00:00, null when it is not a valid time of day. */
export function parseHHMM(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export interface BuiltTimes {
  valid: boolean;
  error: string | null;
  warning: string | null;
  etdUtc: IsoInstant;
  etaUtc: IsoInstant;
  blockMinutes: number;
  dayPlus: 0 | 1;
}

/**
 * R6. The importer and the leg drawer take the ETA as a time of day.
 * blockMinutes = (eta - etd + 1440) mod 1440. The ETA date is the ETD date,
 * plus one day when the ETA time is not later than the ETD time.
 * A block of 0 is invalid; above 18 h it is valid with a warning.
 */
export function buildTimes(date: IsoDate, etdMin: number, etaMin: number): BuiltTimes {
  const block = (((etaMin - etdMin) % 1440) + 1440) % 1440;
  const etd = dateMs(date) + etdMin * MIN;
  const next = etaMin <= etdMin ? 1 : 0;
  const eta = dateMs(date) + next * DAY + etaMin * MIN;
  const valid = block > 0;
  return {
    valid,
    error: valid ? null : "ETA must differ from ETD",
    warning: valid && block > 1080 ? "Block time is longer than 18 h" : null,
    etdUtc: iso(etd),
    etaUtc: iso(eta),
    blockMinutes: block,
    dayPlus: valid ? (utcDate(eta) > utcDate(etd) ? 1 : 0) : 0,
  };
}

export function minutesOfDay(instant: IsoInstant): number {
  const t = Date.parse(instant);
  return Math.round((t - dateMs(utcDate(t))) / MIN);
}

export function snapToMinutes(timeMs: number, step: number): number {
  const s = step * MIN;
  return Math.round(timeMs / s) * s;
}
