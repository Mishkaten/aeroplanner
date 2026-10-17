// Test helpers. Not imported by application code.
import { indexAirports } from "./airports";
import { makeLegId } from "./legs";
import { buildTimes, parseHHMM } from "./time";
import type { DomainState, Leg, Permit, MaintenanceBlock } from "./types";
import { fullDemoState } from "./seed";
import { newPermit, requiredPermits } from "./permits";

const base = fullDemoState();
export const idx = indexAirports(base.airports);

export function emptyState(): DomainState {
  return { ...base, legs: [], permits: [], blocks: [], aircraft: base.aircraft.map((a) => ({ ...a })) };
}

export interface LegSpec {
  flight: string; // PHC509 or PHC509D
  ac: string; // "A".."D"
  dep: string; // IATA, e.g. "TBS"
  arr: string;
  date: string; // YYYY-MM-DD
  etd: string; // HH:MM
  eta: string; // HH:MM
  cnl?: boolean;
  type?: Leg["legType"];
  notes?: string;
}

const icaoOf = (iata: string) => base.airports.find((a) => a.iata === iata)!.icao;

export function mkLeg(s: LegSpec): Leg {
  const t = buildTimes(s.date, parseHHMM(s.etd)!, parseHHMM(s.eta)!);
  const suffix = s.flight.endsWith("D") ? "D" : "";
  const flightNumber = suffix ? s.flight.slice(0, -1) : s.flight;
  const aircraftId = `4L-PX${s.ac}`;
  const draft = { flightNumber, suffix: suffix as "" | "D", etdUtc: t.etdUtc, depIcao: icaoOf(s.dep), aircraftId };
  return {
    id: makeLegId(draft, idx),
    flightNumber,
    suffix: suffix as "" | "D",
    aircraftId,
    backupAircraftId: base.aircraft.find((a) => a.id === aircraftId)!.defaultBackupId,
    legType: s.type ?? "landing",
    depIcao: icaoOf(s.dep),
    arrIcao: icaoOf(s.arr),
    etdUtc: t.etdUtc,
    etaUtc: t.etaUtc,
    status: s.cnl ? "cancelled" : "planned",
    notes: s.notes ?? "",
    source: { kind: "manual" },
  };
}

export function permitsFor(leg: Leg, status: Permit["status"] = "obtained"): Permit[] {
  return requiredPermits(leg.depIcao, leg.arrIcao, idx).map((r) => newPermit(leg, r, status));
}

export function stateWith(specs: LegSpec[], opts: { permits?: "obtained" | "pending" | "none"; blocks?: MaintenanceBlock[] } = {}): DomainState {
  const s = emptyState();
  s.legs = specs.map(mkLeg);
  const mode = opts.permits ?? "obtained";
  s.permits = mode === "none" ? [] : s.legs.flatMap((l) => permitsFor(l, mode));
  s.blocks = opts.blocks ?? [];
  return s;
}
