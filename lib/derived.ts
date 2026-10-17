import { indexAirports, type AirportIndex } from "./airports";
import { isActive, throughGroups, type ThroughGroups } from "./legs";
import { permitKey, requiredPermits } from "./permits";
import { boardRows, countsFor, urgentRows, type Counts, type PermitRow } from "./selectors";
import { validateAll } from "./validate";
import type { Aircraft, DomainState, Exemption, Leg, Permit, ValidationIssue } from "./types";

export type PermitState = "none" | "obtained" | "pending" | "missing" | "cancelled";

export interface Derived {
  idx: AirportIndex;
  issues: ValidationIssue[];
  exemptions: Exemption[];
  counts: Counts;
  legById: Map<string, Leg>;
  aircraftById: Map<string, Aircraft>;
  issuesByLeg: Map<string, ValidationIssue[]>;
  through: ThroughGroups;
  permitsByLeg: Map<string, Permit[]>;
  permitState: Map<string, PermitState>;
  board: PermitRow[];
  urgent: PermitRow[];
}

const cache = new WeakMap<DomainState, Derived>();

/** Everything derived from the stored state. Cached per state object, so every screen shares one validation run. */
export function derive(state: DomainState): Derived {
  const hit = cache.get(state);
  if (hit) return hit;

  const idx = indexAirports(state.airports);
  const { issues, exemptions } = validateAll(state);
  const legById = new Map(state.legs.map((l) => [l.id, l]));
  const aircraftById = new Map(state.aircraft.map((a) => [a.id, a]));

  const issuesByLeg = new Map<string, ValidationIssue[]>();
  for (const i of issues)
    for (const id of i.legIds) {
      const arr = issuesByLeg.get(id);
      if (arr) arr.push(i);
      else issuesByLeg.set(id, [i]);
    }

  const permitsByLeg = new Map<string, Permit[]>();
  for (const p of state.permits) {
    const arr = permitsByLeg.get(p.legId);
    if (arr) arr.push(p);
    else permitsByLeg.set(p.legId, [p]);
  }

  const permitState = new Map<string, PermitState>();
  for (const l of state.legs) {
    if (!isActive(l)) {
      permitState.set(l.id, "cancelled");
      continue;
    }
    const need = requiredPermits(l.depIcao, l.arrIcao, idx, state.company.baseIcao);
    if (!need.length) {
      permitState.set(l.id, "none");
      continue;
    }
    const rows = new Map((permitsByLeg.get(l.id) ?? []).map((p) => [permitKey(p), p]));
    let st: PermitState = "obtained";
    for (const r of need) {
      const row = rows.get(permitKey(r));
      if (!row) {
        st = "missing";
        break;
      }
      if (row.status !== "obtained") st = "pending";
    }
    permitState.set(l.id, st);
  }

  const board = boardRows(state);
  const d: Derived = {
    idx,
    issues,
    exemptions,
    counts: countsFor(state, issues),
    legById,
    aircraftById,
    issuesByLeg,
    through: throughGroups(state.legs),
    permitsByLeg,
    permitState,
    board,
    urgent: urgentRows(board),
  };
  cache.set(state, d);
  return d;
}
