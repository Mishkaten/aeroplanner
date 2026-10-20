import { COUNTRY_NAMES, iataOf, indexAirports, isPlaceholder } from "../airports";
import { blockMinutes, dayPlus, dayTag, fullFlight } from "../legs";
import { MIN, iso, ms, utcDate } from "../time";
import type { DomainState, Leg, LegType } from "../types";

/** One flat line per leg. Every export format is written from these rows, so they all agree. */
export interface ExportRow {
  legId: string;
  /** UTC date of departure, yyyy-mm-dd */
  date: string;
  flight: string;
  /** Flight number without prefix and suffix, "507" */
  number: string;
  suffix: string;
  aircraft: string;
  aircraftType: string;
  legType: LegType;
  depIcao: string;
  depIata: string;
  arrIcao: string;
  arrIata: string;
  etdUtc: string;
  etaUtc: string;
  /** "yyyy-mm-dd hh:mm" at the departure and arrival station */
  etdLocal: string;
  etaLocal: string;
  depOffsetMin: number;
  arrOffsetMin: number;
  blockMin: number;
  dayPlus: 0 | 1;
  /** ISO weekday of the local arrival date when it differs from the UTC date */
  dayTag: number | null;
  status: "planned" | "cancelled";
  backupAircraft: string;
  permits: string;
  notes: string;
  /** The airport is the XXXX placeholder, so it has no real code or offset. */
  placeholder: boolean;
}

const local = (instant: string, offsetMin: number) => iso(ms(instant) + offsetMin * MIN).slice(0, 16).replace("T", " ");

export function buildRows(state: DomainState, legs: Leg[]): ExportRow[] {
  const idx = indexAirports(state.airports);
  const type = new Map(state.aircraft.map((a) => [a.id, a.type]));
  const reg = new Map(state.aircraft.map((a) => [a.id, a.registration]));
  const permits = new Map<string, string[]>();
  for (const p of state.permits) {
    const text = `${COUNTRY_NAMES[p.countryCode] ?? p.countryCode} ${p.type} ${p.status}${p.number ? ` (${p.number})` : ""}`;
    permits.set(p.legId, [...(permits.get(p.legId) ?? []), text]);
  }
  return [...legs]
    .sort((a, b) => ms(a.etdUtc) - ms(b.etdUtc) || (fullFlight(a) < fullFlight(b) ? -1 : 1))
    .map((l) => {
      const dep = idx.byIcao.get(l.depIcao);
      const arr = idx.byIcao.get(l.arrIcao);
      const depOff = dep && !isPlaceholder(l.depIcao) ? dep.utcOffsetMinutes : 0;
      const arrOff = arr && !isPlaceholder(l.arrIcao) ? arr.utcOffsetMinutes : 0;
      return {
        legId: l.id,
        date: utcDate(l.etdUtc),
        flight: fullFlight(l),
        number: l.flightNumber.replace(/^[A-Za-z]+/, ""),
        suffix: l.suffix,
        aircraft: reg.get(l.aircraftId) ?? l.aircraftId,
        aircraftType: type.get(l.aircraftId) ?? "",
        legType: l.legType,
        depIcao: l.depIcao,
        depIata: isPlaceholder(l.depIcao) ? "" : iataOf(l.depIcao, idx),
        arrIcao: l.arrIcao,
        arrIata: isPlaceholder(l.arrIcao) ? "" : iataOf(l.arrIcao, idx),
        etdUtc: l.etdUtc,
        etaUtc: l.etaUtc,
        etdLocal: local(l.etdUtc, depOff),
        etaLocal: local(l.etaUtc, arrOff),
        depOffsetMin: depOff,
        arrOffsetMin: arrOff,
        blockMin: blockMinutes(l),
        dayPlus: dayPlus(l),
        dayTag: dayTag(l, idx),
        status: l.status,
        backupAircraft: l.backupAircraftId ? (reg.get(l.backupAircraftId) ?? l.backupAircraftId) : "",
        permits: (permits.get(l.id) ?? []).join("; "),
        notes: l.notes,
        placeholder: isPlaceholder(l.depIcao) || isPlaceholder(l.arrIcao),
      };
    });
}
