import { DEMO_CLOCK } from "./time";
import type { DomainState, IsoInstant } from "./types";

/**
 * The only place that reads the real clock. A workspace uses it for the 48 h permit rule and the
 * overview; the demo seed pins `state.clock` to the demo clock instead (PRD NF-R7).
 */
// eslint-disable-next-line no-restricted-properties
export const realNow = (): IsoInstant => new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString().replace(".000Z", "Z");

/** The clock a state runs on: its pinned clock, or the real time. */
export const effectiveClock = (state: Pick<DomainState, "clock">): IsoInstant => state.clock ?? realNow();

export const isDemoClock = (state: Pick<DomainState, "clock">): boolean => state.clock === DEMO_CLOCK;
