import { DEMO_CLOCK } from "../time";
import { defaultVersions } from "../versions";
import type { DomainState } from "../types";
import { SEED_AIRPORTS, starterAirports } from "./airports";
import { SEED_COMPANY, SEED_FLEET } from "./fleet";
import { SEED_BLOCKS, seedLegs, seedPermitRules, seedPermits, type SeedOptions } from "./legs";

/** The full demo: 4 aircraft, 90 legs over 3 weeks, 85 permit rows, 2 maintenance blocks, clock pinned to 13 Sep 2026. */
export function fullDemoState(opts: SeedOptions = {}): DomainState {
  const aircraft = structuredClone(SEED_FLEET);
  const legs = seedLegs(aircraft, opts);
  const permitRules = seedPermitRules(legs);
  return {
    clock: DEMO_CLOCK,
    permitRules,
    ...defaultVersions(),
    company: structuredClone(SEED_COMPANY),
    aircraft,
    airports: structuredClone(SEED_AIRPORTS),
    legs,
    permits: seedPermits(legs, permitRules),
    blocks: opts.stressLegs ? [] : structuredClone(SEED_BLOCKS),
  };
}

/** Reset to empty schedule: keeps company, fleet, airports, permit rules and maintenance blocks; removes legs and permits. */
export function emptyScheduleState(): DomainState {
  return { ...fullDemoState(), legs: [], permits: [] };
}

/**
 * A new, empty workspace for real data: no aircraft, legs, permits or rules, the real clock, a starter airport
 * directory and a company profile to fill in.
 */
export function blankWorkspaceState(): DomainState {
  return {
    clock: null,
    permitRules: [],
    ...defaultVersions(),
    company: {
      id: "company",
      legalName: "",
      vatNumber: "",
      icao: "",
      iata: "",
      aocNumber: "",
      baseIcao: "UGTB",
      address: "",
      opsContact: "",
      checklistHeaderText: "Flight packet for crew and handling agents",
      logoDataUrl: null,
      minGroundMinutes: 60,
      dayTagMode: "ignore",
    },
    aircraft: [],
    airports: starterAirports(),
    legs: [],
    permits: [],
    blocks: [],
  };
}
