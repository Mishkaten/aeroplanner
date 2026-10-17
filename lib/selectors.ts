import { effectiveBlocks } from "./validate";
import { isActive, throughGroups } from "./legs";
import { COUNTRY_NAMES } from "./airports";
import { DAY, DEMO_CLOCK, DEMO_CLOCK_MS, HOUR, ms, utcDate, iso, dateMs, addDaysIso } from "./time";
import type { CountryCode, DomainState, Leg, Permit, ValidationIssue } from "./types";

export interface Counts {
  legs: number;
  active: number;
  cancelled: number;
  next7Days: number;
  openIssues: number;
  errors: number;
  warnings: number;
  urgentPermits: number;
  throughGroups: number;
  overnight: number;
}

/** D7: every count excludes cancelled legs. */
export function activeLegs(legs: Leg[]): Leg[] {
  return legs.filter(isActive);
}

export function legsInNext7Days(legs: Leg[], clock: string = DEMO_CLOCK): number {
  const from = ms(clock);
  return legs.filter((l) => isActive(l) && ms(l.etdUtc) >= from && ms(l.etdUtc) < from + 7 * DAY).length;
}

export interface PermitRow {
  permit: Permit;
  leg: Leg;
}

/** Rows shown on the Permits board. Cancelled legs contribute no rows. */
export function boardRows(state: DomainState): PermitRow[] {
  const legs = new Map(state.legs.map((l) => [l.id, l]));
  const out: PermitRow[] = [];
  for (const p of state.permits) {
    const leg = legs.get(p.legId);
    if (!leg || !isActive(leg)) continue;
    out.push({ permit: p, leg });
  }
  return out.sort((a, b) => ms(a.leg.etdUtc) - ms(b.leg.etdUtc));
}

/** Urgent: ETD from the demo clock up to and including clock + 48 h, permit not obtained. */
export function urgentRows(rows: PermitRow[], clock: string = DEMO_CLOCK): PermitRow[] {
  const from = ms(clock);
  const to = from + 48 * HOUR;
  return rows.filter((r) => r.permit.status !== "obtained" && ms(r.leg.etdUtc) >= from && ms(r.leg.etdUtc) <= to);
}

export function countsFor(state: DomainState, issues: ValidationIssue[], clock: string = DEMO_CLOCK): Counts {
  const active = activeLegs(state.legs);
  const tg = throughGroups(state.legs);
  return {
    legs: state.legs.length,
    active: active.length,
    cancelled: state.legs.length - active.length,
    next7Days: legsInNext7Days(state.legs, clock),
    openIssues: issues.length,
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
    urgentPermits: urgentRows(boardRows(state), clock).length,
    throughGroups: tg.groups.size,
    overnight: active.filter((l) => utcDate(l.etaUtc) > utcDate(l.etdUtc)).length,
  };
}

export type Availability = "available" | "maintenance" | "aog";

export interface AvailabilityRow {
  aircraftId: string;
  registration: string;
  cells: { date: string; state: Availability; title: string }[];
}

/** Fleet availability for 14 days from the demo clock's date. A day takes the worst state of any block touching it. */
export function fleetAvailability(state: DomainState, days = 14, clock: string = DEMO_CLOCK): AvailabilityRow[] {
  const blocks = effectiveBlocks(state, clock);
  const start = utcDate(clock);
  return state.aircraft.map((a) => ({
    aircraftId: a.id,
    registration: a.registration,
    cells: Array.from({ length: days }, (_, i) => {
      const date = addDaysIso(start, i);
      const dayStart = dateMs(date);
      const dayEnd = dayStart + DAY;
      let worst: Availability = "available";
      for (const b of blocks) {
        if (b.aircraftId !== a.id) continue;
        const end = b.endUtc ? ms(b.endUtc) : Number.POSITIVE_INFINITY;
        if (ms(b.startUtc) < dayEnd && dayStart < end) {
          if (b.kind === "aog") worst = "aog";
          else if (worst !== "aog") worst = "maintenance";
        }
      }
      const label = worst === "aog" ? "AOG" : worst === "maintenance" ? "Maintenance" : "Available";
      return { date, state: worst, title: `${a.registration} ${date}: ${label}` };
    }),
  }));
}

export function permitCountsByCountry(rows: PermitRow[]): { code: CountryCode; name: string; count: number }[] {
  const m = new Map<CountryCode, number>();
  for (const r of rows) m.set(r.permit.countryCode, (m.get(r.permit.countryCode) ?? 0) + 1);
  return [...m.entries()]
    .map(([code, count]) => ({ code, name: COUNTRY_NAMES[code], count }))
    .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1));
}

export { iso, DEMO_CLOCK_MS };
