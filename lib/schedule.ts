import type { Derived } from "./derived";
import { fullFlight, isActive } from "./legs";
import { SEASON_START } from "./seed/legs";
import { addDaysIso, dateMs, DAY, ms, utcDate, isoWeekday } from "./time";
import type { Leg, MaintenanceBlock } from "./types";
import type { ScheduleFilters } from "./ui-store";
import type { RangeSel } from "./store";
import { blockKindLabel, blockUntilText, effectiveBlocks, legHitsBlock } from "./validate";
import type { DomainState } from "./types";

/** UTC dates shown for a range selection. "all" covers the 3 season weeks, widened when legs lie outside them. */
export function daysForRange(range: RangeSel, legs: Leg[]): string[] {
  if (range !== "all") {
    const start = addDaysIso(SEASON_START, range * 7);
    return Array.from({ length: 7 }, (_, i) => addDaysIso(start, i));
  }
  let first = SEASON_START;
  let last = addDaysIso(SEASON_START, 20);
  for (const l of legs) {
    const d = utcDate(l.etdUtc);
    if (d < first) first = d;
    if (d > last) last = d;
  }
  const n = Math.round((dateMs(last) - dateMs(first)) / DAY) + 1;
  return Array.from({ length: n }, (_, i) => addDaysIso(first, i));
}

export function rangeLabel(range: RangeSel): string {
  return range === "all"
    ? "14 Sep to 4 Oct 2026"
    : ["Week 1, 14 to 20 Sep", "Week 2, 21 to 27 Sep", "Week 3, 28 Sep to 4 Oct"][range];
}

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
