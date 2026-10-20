// Repeat a week: copy the legs of one week onto the following weeks as ordinary dated legs.
import { indexAirports, isPlaceholder } from "./airports";
import { issueDelta } from "./bulk";
import { fullFlight, makeLegId } from "./legs";
import { naturalKey } from "./import/upsert";
import { newPermit } from "./permits";
import { mondayOf } from "./schedule";
import { DAY, MIN, addDaysIso, iso, ms, utcDate } from "./time";
import { airportOffset, localToUtc } from "./tz";
import type { DomainState, IsoDate, Leg, StatePatch } from "./types";

export const MAX_REPEAT_WEEKS = 52;
export const MAX_REPEAT_LEGS = 3000;

export interface RepeatOptions {
  /** Any date in the week to copy. The Monday of that week is used. */
  week: IsoDate;
  /** How many following weeks to fill. */
  weeks: number;
  /** "utc": same UTC time each week. "local": same local time at each departure station, so UTC moves with daylight saving. */
  basis: "utc" | "local";
  includeCancelled: boolean;
  /** Add the permit rows of the source legs to the copies, as pending. */
  permits: boolean;
  /** Only this aircraft, or every aircraft when null. */
  aircraftId: string | null;
}

export interface RepeatPlan {
  patch: StatePatch;
  sourceLegs: number;
  inserted: number;
  /** Copies not made because the same leg already exists on that day. */
  existing: number;
  warnings: string[];
  newIssues: string[];
  clearedIssues: number;
  firstDate: IsoDate | null;
  lastDate: IsoDate | null;
}

export function sourceWeekLegs(state: DomainState, o: Pick<RepeatOptions, "week" | "includeCancelled" | "aircraftId">): Leg[] {
  const monday = mondayOf(o.week);
  const end = addDaysIso(monday, 6);
  return state.legs.filter((l) => {
    const d = utcDate(l.etdUtc);
    return d >= monday && d <= end && (o.includeCancelled || l.status !== "cancelled") && (!o.aircraftId || l.aircraftId === o.aircraftId);
  });
}

export function planRepeatWeek(state: DomainState, o: RepeatOptions): RepeatPlan {
  const source = sourceWeekLegs(state, o);
  const idx = indexAirports(state.airports);
  const patch: StatePatch = [];
  const warnings = new Set<string>();
  const have = new Set(state.legs.map((l) => naturalKey(l)));
  const haveIds = new Set(state.legs.map((l) => l.id));
  const havePermits = new Set(state.permits.map((p) => p.id));
  const plan: RepeatPlan = { patch, sourceLegs: source.length, inserted: 0, existing: 0, warnings: [], newIssues: [], clearedIssues: 0, firstDate: null, lastDate: null };
  const weeks = Math.max(0, Math.min(MAX_REPEAT_WEEKS, Math.floor(o.weeks)));
  if (source.length * weeks > MAX_REPEAT_LEGS) {
    plan.warnings = [`This would create ${source.length * weeks} legs. The limit is ${MAX_REPEAT_LEGS}: use fewer weeks.`];
    return plan;
  }

  for (let w = 1; w <= weeks; w++) {
    for (const l of source) {
      const block = ms(l.etaUtc) - ms(l.etdUtc);
      let etd = ms(l.etdUtc) + w * 7 * DAY;
      const dep = idx.byIcao.get(l.depIcao);
      if (o.basis === "local" && dep && !isPlaceholder(l.depIcao)) {
        const r = localToUtc(dep, ms(l.etdUtc) + airportOffset(dep, ms(l.etdUtc)) * MIN + w * 7 * DAY);
        etd = r.utcMs;
        if (r.nonexistent) warnings.add(`${fullFlight(l)} on ${utcDate(etd)}: the local time does not exist at ${dep.iata} (clocks go forward), so it is moved to just after.`);
      }
      const draft = { flightNumber: l.flightNumber, suffix: l.suffix, aircraftId: l.aircraftId, backupAircraftId: l.backupAircraftId, legType: l.legType, depIcao: l.depIcao, arrIcao: l.arrIcao, etdUtc: iso(etd), etaUtc: iso(etd + block) };
      const copy: Leg = { id: makeLegId(draft, idx), ...draft, status: "planned", notes: l.notes, source: { kind: "copy" } };
      if (have.has(naturalKey(copy)) || haveIds.has(copy.id)) {
        plan.existing++;
        continue;
      }
      have.add(naturalKey(copy));
      haveIds.add(copy.id);
      patch.push({ op: "insert", coll: "legs", value: copy as never });
      plan.inserted++;
      const d = utcDate(copy.etdUtc);
      if (!plan.firstDate || d < plan.firstDate) plan.firstDate = d;
      if (!plan.lastDate || d > plan.lastDate) plan.lastDate = d;
      if (o.permits) {
        for (const p of state.permits.filter((x) => x.legId === l.id && x.status !== "cancelled")) {
          const row = newPermit(copy, { countryCode: p.countryCode, type: p.type }, "pending");
          if (!havePermits.has(row.id)) {
            havePermits.add(row.id);
            patch.push({ op: "insert", coll: "permits", value: row as never });
          }
        }
      }
    }
  }
  plan.warnings = [...warnings];
  const delta = issueDelta(state, patch);
  plan.newIssues = delta.newIssues;
  plan.clearedIssues = delta.cleared;
  return plan;
}
