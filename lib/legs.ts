import { isPlaceholder, iataOf, type AirportIndex } from "./airports";
import { MIN, ms, utcDate, isoWeekday } from "./time";
import { airportOffset } from "./tz";
import type { IsoInstant, Leg } from "./types";

export const fullFlight = (l: Pick<Leg, "flightNumber" | "suffix">): string => l.flightNumber + l.suffix;

export const isActive = (l: Pick<Leg, "status">): boolean => l.status !== "cancelled";

/** "4L-PXA" -> "A" */
export const aircraftLetter = (aircraftId: string): string => aircraftId.slice(-1);

/** L-<yyyymmdd>-<full flight number>-<dep IATA>-<aircraft letter> */
export function makeLegId(
  l: Pick<Leg, "flightNumber" | "suffix" | "etdUtc" | "depIcao" | "aircraftId">,
  idx: AirportIndex,
): string {
  return `L-${utcDate(l.etdUtc).replace(/-/g, "")}-${fullFlight(l)}-${iataOf(l.depIcao, idx)}-${aircraftLetter(l.aircraftId)}`;
}

export interface LegDerived {
  blockMinutes: number;
  /** 1 when the ETA falls on the next UTC day, printed "(+1)". */
  dayPlus: 0 | 1;
  /** ISO weekday (1..7) of the local arrival date, only when it differs from the UTC arrival date. */
  dayTag: number | null;
  /** Valid when 0 < block < 1440. */
  valid: boolean;
}

export function blockMinutes(l: Pick<Leg, "etdUtc" | "etaUtc">): number {
  return (ms(l.etaUtc) - ms(l.etdUtc)) / MIN;
}

export function dayPlus(l: Pick<Leg, "etdUtc" | "etaUtc">): 0 | 1 {
  return utcDate(l.etaUtc) > utcDate(l.etdUtc) ? 1 : 0;
}

/** D4. Never printed for the placeholder airport. */
export function dayTag(l: Pick<Leg, "etaUtc" | "arrIcao">, idx: AirportIndex): number | null {
  if (isPlaceholder(l.arrIcao)) return null;
  const arr = idx.byIcao.get(l.arrIcao);
  if (!arr) return null;
  const localMs = ms(l.etaUtc) + airportOffset(arr, ms(l.etaUtc)) * MIN;
  const localDate = utcDate(localMs);
  return localDate !== utcDate(l.etaUtc) ? isoWeekday(localDate) : null;
}

/** Local arrival time as "Tue 01:30" style parts, for the arrival summary. */
export function localArrival(l: Pick<Leg, "etaUtc" | "arrIcao">, idx: AirportIndex): { ms: number; offsetMinutes: number } | null {
  const arr = idx.byIcao.get(l.arrIcao);
  if (!arr || isPlaceholder(l.arrIcao)) return null;
  const offsetMinutes = airportOffset(arr, ms(l.etaUtc));
  return { ms: ms(l.etaUtc) + offsetMinutes * MIN, offsetMinutes };
}

export function deriveLeg(l: Leg, idx: AirportIndex): LegDerived {
  const block = blockMinutes(l);
  return { blockMinutes: block, dayPlus: dayPlus(l), dayTag: dayTag(l, idx), valid: block > 0 && block < 1440 };
}

export function compareLegs(a: Leg, b: Leg): number {
  return ms(a.etdUtc) - ms(b.etdUtc) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Active legs of each aircraft, ordered by ETD. */
export function activeByAircraft(legs: Leg[]): Map<string, Leg[]> {
  const out = new Map<string, Leg[]>();
  for (const l of legs) {
    if (!isActive(l)) continue;
    const arr = out.get(l.aircraftId);
    if (arr) arr.push(l);
    else out.set(l.aircraftId, [l]);
  }
  for (const arr of out.values()) arr.sort(compareLegs);
  return out;
}

export interface ThroughGroups {
  /** leg id -> id of the first leg of its group */
  groupOf: Map<string, string>;
  groups: Map<string, string[]>;
}

/**
 * D6. Consecutive active legs on one aircraft, same full flight number and same
 * ETD date, where each departure equals the previous arrival and each ETD is not
 * earlier than the previous ETA. The group id is the id of its first leg.
 */
export function throughGroups(legs: Leg[]): ThroughGroups {
  const groupOf = new Map<string, string>();
  const groups = new Map<string, string[]>();
  for (const arr of activeByAircraft(legs).values()) {
    let cur: Leg[] = [];
    const flush = () => {
      if (cur.length > 1) {
        const id = cur[0].id;
        groups.set(id, cur.map((l) => l.id));
        for (const l of cur) groupOf.set(l.id, id);
      }
      cur = [];
    };
    for (const l of arr) {
      const prev = cur[cur.length - 1];
      if (
        prev &&
        fullFlight(prev) === fullFlight(l) &&
        utcDate(prev.etdUtc) === utcDate(l.etdUtc) &&
        prev.arrIcao === l.depIcao &&
        ms(l.etdUtc) >= ms(prev.etaUtc)
      ) {
        cur.push(l);
      } else {
        flush();
        cur = [l];
      }
    }
    flush();
  }
  return { groupOf, groups };
}

export function legLabel(l: Leg, idx: AirportIndex): string {
  return `${fullFlight(l)} ${iataOf(l.depIcao, idx)} to ${iataOf(l.arrIcao, idx)}`;
}

export function etdMs(l: Pick<Leg, "etdUtc">): number {
  return ms(l.etdUtc);
}
export function etaMs(l: Pick<Leg, "etaUtc">): number {
  return ms(l.etaUtc);
}
export function instantOf(timeMs: number): IsoInstant {
  return new Date(timeMs).toISOString().replace(".000Z", "Z");
}
