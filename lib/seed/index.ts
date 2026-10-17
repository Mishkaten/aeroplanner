import type { DomainState } from "../types";
import { SEED_AIRPORTS } from "./airports";
import { SEED_COMPANY, SEED_FLEET } from "./fleet";
import { SEED_BLOCKS, seedLegs, seedPermits, type SeedOptions } from "./legs";

/** The full demo: 4 aircraft, 90 legs over 3 weeks, 85 permit rows, 2 maintenance blocks. */
export function fullDemoState(opts: SeedOptions = {}): DomainState {
  const aircraft = structuredClone(SEED_FLEET);
  const legs = seedLegs(aircraft, opts);
  return {
    company: structuredClone(SEED_COMPANY),
    aircraft,
    airports: structuredClone(SEED_AIRPORTS),
    legs,
    permits: seedPermits(legs),
    blocks: opts.stressLegs ? [] : structuredClone(SEED_BLOCKS),
  };
}

/** Reset to empty schedule: keeps company, fleet, airports and maintenance blocks; removes legs and permits. */
export function emptyScheduleState(): DomainState {
  return { ...fullDemoState(), legs: [], permits: [] };
}
