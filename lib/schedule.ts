import type { Derived } from "./derived";
import { fullFlight, isActive } from "./legs";
import { addDaysIso, dateMs, DAY, ms, utcDate, isoWeekday } from "./time";
import type { Leg, MaintenanceBlock } from "./types";
import type { ScheduleFilters } from "./ui-store";
import { blockKindLabel, blockUntilText, effectiveBlocks, legHitsBlock } from "./validate";
import type { DomainState } from "./types";

export interface DateRange {
  from: string; // UTC date, inclusive
  to: string; // UTC date, inclusive
}

const MAX_DAYS = 120;

/** Monday (UTC) of the week holding a date. */
export function mondayOf(date: string): string {
  return addDaysIso(date, -(isoWeekday(date) - 1));
}

/**
 * The range shown when the user has not chosen one: three weeks starting at the Monday of today, or, when
 * the schedule has no legs near today, three weeks starting at the first leg.
 */
export function autoRange(legs: Leg[], today: string): DateRange {
  const near = legs.some((l) => {
    const d = utcDate(l.etdUtc);
    return d >= addDaysIso(today, -30) && d <= addDaysIso(today, 90);
  });
  let start = mondayOf(today);
  if (!near && legs.length) {
    let first = utcDate(legs[0].etdUtc);
    for (const l of legs) if (utcDate(l.etdUtc) < first) first = utcDate(l.etdUtc);
    start = mondayOf(first);
  }
  return { from: start, to: addDaysIso(start, 20) };
}

export function resolveRange(range: DateRange | null, legs: Leg[], today: string): DateRange {
  return range ?? autoRange(legs, today);
}

/** Every UTC date in a range, capped so a mistyped year cannot freeze the page. */
export function daysBetween(r: DateRange): string[] {
  const n = Math.min(MAX_DAYS, Math.max(1, Math.round((dateMs(r.to) - dateMs(r.from)) / DAY) + 1));
  return Array.from({ length: n }, (_, i) => addDaysIso(r.from, i));
}

export function rangeLabel(r: DateRange): string {
  return `${fmtDateLong(r.from)} to ${fmtDateLong(r.to)}`;
}

const fmtDateLong = (d: string) => new Date(dateMs(d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function legMatches(leg: Leg, f: ScheduleFilters, d: Derived, typeOf: (aircraftId: string) => string | undefined): boolean {
  if (f.tab !== "all" && leg.aircraftId !== f.tab) return false;
  if (f.type !== "all" && typeOf(leg.aircraftId) !== f.type) return false;
  if (f.station !== "all" && leg.depIcao !== f.station && leg.arrIcao !== f.station) return false;
  const text = f.flight.trim().toLowerCase();
  if (text && !fullFlight(leg).toLowerCase().includes(text)) return false;
  switch (f.status) {
    case "issue":
      return isActive(leg) && d.issuesByLeg.has(leg.id);
    case "pending": {
      const s = d.permitState.get(leg.id);
      return s === "pending" || s === "missing";
    }
    case "obtained":
      return d.permitState.get(leg.id) === "obtained";
    case "cnl":
      return !isActive(leg);
    default:
      return true;
  }
}

export const filtersActive = (f: ScheduleFilters): boolean =>
  f.tab !== "all" || f.type !== "all" || f.station !== "all" || f.flight.trim() !== "" || f.status !== "all";

/** Legs grouped by `${date}|${aircraftId}` using the day of ETD, each list ordered by ETD. */
export function groupByDayAircraft(legs: Leg[]): Map<string, Leg[]> {
  const m = new Map<string, Leg[]>();
  for (const l of legs) {
    const k = `${utcDate(l.etdUtc)}|${l.aircraftId}`;
    const a = m.get(k);
    if (a) a.push(l);
    else m.set(k, [l]);
  }
  for (const a of m.values()) a.sort((x, y) => ms(x.etdUtc) - ms(y.etdUtc) || (x.id < y.id ? -1 : 1));
  return m;
}

/**
 * Moves a leg to another aircraft and/or another UTC date, keeping its time of day and block time.
 * Refused when the target aircraft is AOG, in maintenance or in C-Check at that time.
 */
export function planMove(
  state: DomainState,
  leg: Leg,
  aircraftId: string,
  date: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  const delta = dateMs(date) - dateMs(utcDate(leg.etdUtc));
  const etd = ms(leg.etdUtc) + delta;
  const eta = ms(leg.etaUtc) + delta;
  const iso = (t: number) => new Date(t).toISOString().replace(".000Z", "Z");
  const clash = effectiveBlocks(state).find((b) => b.aircraftId === aircraftId && legHitsBlock({ etdUtc: iso(etd), etaUtc: iso(eta) }, b));
  if (clash) {
    const reg = state.aircraft.find((a) => a.id === aircraftId)?.registration ?? aircraftId;
    return { ok: false, message: `${reg} is ${blockKindLabel(clash.kind)} ${blockUntilText(clash)}` };
  }
  const value: Record<string, unknown> = { etdUtc: iso(etd), etaUtc: iso(eta) };
  if (aircraftId !== leg.aircraftId) {
    value.aircraftId = aircraftId;
    value.backupAircraftId = state.aircraft.find((a) => a.id === aircraftId)?.defaultBackupId ?? null;
  }
  return { ok: true, value };
}

export function blocksOnDay(state: DomainState, aircraftId: string, date: string): MaintenanceBlock[] {
  const start = dateMs(date);
  const end = start + DAY;
  return effectiveBlocks(state).filter(
    (b) => b.aircraftId === aircraftId && ms(b.startUtc) < end && start < (b.endUtc ? ms(b.endUtc) : Number.POSITIVE_INFINITY),
  );
}

/** Header for a day row: "14 Sep" in Dates mode, "Mon 14 Sep" plus the ISO weekday number otherwise. */
export function dayHeader(date: string, mode: "dates" | "weekday", fmtDate: (d: string) => string, fmtDow: (d: string) => string): { label: string; sub: string } {
  return mode === "dates" ? { label: fmtDate(date), sub: "" } : { label: `${fmtDow(date)}, ${isoWeekday(date)}`, sub: "" };
}
