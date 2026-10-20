// Bulk edits and aircraft swaps. Pure: each function returns a patch plus a preview, nothing is applied here.
import { FLIGHT_RE } from "./legform";
import { applyPatch } from "./patch";
import { fullFlight } from "./legs";
import { MIN, iso, ms } from "./time";
import { validateAll } from "./validate";
import { effectiveClock } from "./clock";
import type { DomainState, Leg, StatePatch } from "./types";

export type BulkOp =
  | { kind: "shift"; minutes: number }
  | { kind: "block"; mode: "set" | "add"; minutes: number }
  | { kind: "flight"; flight: string }
  | { kind: "aircraft"; aircraftId: string }
  | { kind: "route"; depIcao: string | null; arrIcao: string | null }
  | { kind: "status"; status: Leg["status"] }
  | { kind: "notes"; mode: "set" | "append"; text: string };

export interface BulkChange {
  legId: string;
  label: string;
  /** Short before and after text for the preview, for example "03:30Z to 04:30Z". */
  before: string;
  after: string;
}

export interface BulkPlan {
  patch: StatePatch;
  changes: BulkChange[];
  /** Legs the operation could not change, with the reason. */
  skipped: { legId: string; label: string; reason: string }[];
  /** Issues the edit would create, and issues it would clear. */
  newIssues: string[];
  clearedIssues: number;
  message: string;
}

const hm = (t: string) => `${t.slice(5, 10)} ${t.slice(11, 16)}Z`;
const label = (l: Leg) => `${fullFlight(l)} ${l.depIcao}-${l.arrIcao} ${l.etdUtc.slice(5, 10)}`;

/** Splits a typed flight number into number and D suffix: "phc 509 d" gives PHC509 and D. */
export function parseFlight(text: string): { flightNumber: string; suffix: "" | "D" } | null {
  const t = text.toUpperCase().replace(/\s+/g, "");
  const d = /^[A-Z]{3}\d{1,4}D$/.test(t);
  const fn = d ? t.slice(0, -1) : t;
  return FLIGHT_RE.test(fn) ? { flightNumber: fn, suffix: d ? "D" : "" } : null;
}

export function planBulk(state: DomainState, legs: Leg[], op: BulkOp): BulkPlan {
  const patch: StatePatch = [];
  const changes: BulkChange[] = [];
  const skipped: BulkPlan["skipped"] = [];
  const aircraft = new Map(state.aircraft.map((a) => [a.id, a]));

  for (const l of legs) {
    let value: Partial<Leg> | null = null;
    let before = "";
    let after = "";
    switch (op.kind) {
      case "shift": {
        if (op.minutes === 0) break;
        value = { etdUtc: iso(ms(l.etdUtc) + op.minutes * MIN), etaUtc: iso(ms(l.etaUtc) + op.minutes * MIN) };
        before = hm(l.etdUtc);
        after = hm(value.etdUtc!);
        break;
      }
      case "block": {
        const block = (ms(l.etaUtc) - ms(l.etdUtc)) / MIN;
        const next = op.mode === "set" ? op.minutes : block + op.minutes;
        if (!(next > 0 && next < 1440)) {
          skipped.push({ legId: l.id, label: label(l), reason: "block time would be outside 0 to 24 h" });
          break;
        }
        if (next === block) break;
        value = { etaUtc: iso(ms(l.etdUtc) + next * MIN) };
        before = `${Math.floor(block / 60)}:${String(block % 60).padStart(2, "0")} block`;
        after = `${Math.floor(next / 60)}:${String(next % 60).padStart(2, "0")} block`;
        break;
      }
      case "flight": {
        const f = parseFlight(op.flight);
        if (!f) {
          skipped.push({ legId: l.id, label: label(l), reason: "not a valid flight number" });
          break;
        }
        if (f.flightNumber === l.flightNumber && f.suffix === l.suffix) break;
        value = { flightNumber: f.flightNumber, suffix: f.suffix };
        before = fullFlight(l);
        after = f.flightNumber + f.suffix;
        break;
      }
      case "aircraft": {
        const to = aircraft.get(op.aircraftId);
        if (!to) {
          skipped.push({ legId: l.id, label: label(l), reason: "unknown aircraft" });
          break;
        }
        if (l.aircraftId === to.id) break;
        value = { aircraftId: to.id, backupAircraftId: to.defaultBackupId };
        before = aircraft.get(l.aircraftId)?.registration ?? l.aircraftId;
        after = to.registration;
        break;
      }
      case "route": {
        const dep = op.depIcao ?? l.depIcao;
        const arr = op.arrIcao ?? l.arrIcao;
        if (dep === arr) {
          skipped.push({ legId: l.id, label: label(l), reason: "departure and arrival would be the same" });
          break;
        }
        if (dep === l.depIcao && arr === l.arrIcao) break;
        value = { depIcao: dep, arrIcao: arr };
        before = `${l.depIcao}-${l.arrIcao}`;
        after = `${dep}-${arr}`;
        break;
      }
      case "status": {
        if (l.status === op.status) break;
        value = { status: op.status };
        before = l.status;
        after = op.status;
        break;
      }
      case "notes": {
        const next = op.mode === "set" ? op.text.trim() : [l.notes, op.text.trim()].filter(Boolean).join(" ");
        if (next === l.notes) break;
        value = { notes: next };
        before = l.notes || "(no note)";
        after = next || "(no note)";
        break;
      }
    }
    if (!value) continue;
    patch.push({ op: "set", coll: "legs", id: l.id, value: value as Record<string, unknown> });
    changes.push({ legId: l.id, label: label(l), before, after });
  }

  const { newIssues, cleared } = issueDelta(state, patch);
  return { patch, changes, skipped, newIssues, clearedIssues: cleared, message: `${changes.length} ${changes.length === 1 ? "leg" : "legs"} changed` };
}

/**
 * Swaps the aircraft of two tails inside the given legs: every leg of A moves to B and every leg of B to A.
 * Leon requires the same aircraft type, so a different type is reported as a warning, not refused.
 */
export function planSwap(state: DomainState, legs: Leg[], aId: string, bId: string): BulkPlan & { warning: string | null } {
  const a = state.aircraft.find((x) => x.id === aId);
  const b = state.aircraft.find((x) => x.id === bId);
  const patch: StatePatch = [];
  const changes: BulkChange[] = [];
  if (a && b && a.id !== b.id) {
    for (const l of legs) {
      const to = l.aircraftId === a.id ? b : l.aircraftId === b.id ? a : null;
      if (!to) continue;
      patch.push({ op: "set", coll: "legs", id: l.id, value: { aircraftId: to.id, backupAircraftId: to.defaultBackupId } });
      changes.push({ legId: l.id, label: label(l), before: l.aircraftId === a.id ? a.registration : b.registration, after: to.registration });
    }
  }
  const { newIssues, cleared } = issueDelta(state, patch);
  return {
    patch,
    changes,
    skipped: [],
    newIssues,
    clearedIssues: cleared,
    message: `${a?.registration ?? "?"} and ${b?.registration ?? "?"} swapped on ${changes.length} legs`,
    warning: a && b && a.type !== b.type ? `${a.registration} is a ${a.type} and ${b.registration} is a ${b.type}.` : null,
  };
}

/** Issue ids that appear only after the patch, and how many existing issues it clears. */
export function issueDelta(state: DomainState, patch: StatePatch): { newIssues: string[]; cleared: number } {
  if (!patch.length) return { newIssues: [], cleared: 0 };
  const clock = effectiveClock(state);
  const before = new Map(validateAll(state, clock).issues.map((i) => [i.id, i]));
  const after = validateAll(applyPatch(state, patch).state, clock).issues;
  const afterIds = new Set(after.map((i) => i.id));
  return {
    newIssues: after.filter((i) => !before.has(i.id)).map((i) => `${i.ruleId} ${i.message}`),
    cleared: [...before.keys()].filter((id) => !afterIds.has(id)).length,
  };
}
