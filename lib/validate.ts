import { COUNTRY_NAMES, indexAirports, isPlaceholder, pairLabel, type AirportIndex } from "./airports";
import { activeByAircraft, blockMinutes, compareLegs, fullFlight, isActive, throughGroups } from "./legs";
import { newPermit, permitKey, permitLabel, requiredPermits, validityFor, type RequiredPermit } from "./permits";
import { DEMO_CLOCK, DAY, HOUR, MIN, fmtDow, fmtDowTime, fmtHHMM, fmtDuration, iso, ms, utcDate } from "./time";
import type {
  DomainState,
  Exemption,
  Fix,
  Leg,
  MaintenanceBlock,
  Permit,
  RuleId,
  StatePatch,
  ValidationIssue,
  ValidationResult,
} from "./types";

const RULE_ORDER: Record<RuleId, number> = { R1: 1, R2: 2, R3: 3, R4a: 4, R4b: 5, R5: 6, R6: 7 };

/** Registry status AOG or Maintenance creates an open-ended block that starts at the demo clock. */
export function effectiveBlocks(state: DomainState, clock: string = DEMO_CLOCK): MaintenanceBlock[] {
  const out = [...state.blocks];
  for (const a of state.aircraft) {
    if (a.status === "active") continue;
    out.push({
      id: `B-REG-${a.id}`,
      aircraftId: a.id,
      kind: a.status === "aog" ? "aog" : "maintenance",
      startUtc: clock,
      endUtc: null,
      note: "Set in the Fleet registry",
    });
  }
  return out;
}

export const blockKindLabel = (k: MaintenanceBlock["kind"]): string =>
  k === "aog" ? "AOG" : k === "c_check" ? "in C-Check" : "in Maintenance";

const blockEnd = (b: MaintenanceBlock): number => (b.endUtc ? ms(b.endUtc) : Number.POSITIVE_INFINITY);

/** [ETD, ETA) intersects [start, end). Touching boundaries do not overlap. */
export function legHitsBlock(l: Pick<Leg, "etdUtc" | "etaUtc">, b: MaintenanceBlock): boolean {
  return ms(l.etdUtc) < blockEnd(b) && ms(b.startUtc) < ms(l.etaUtc);
}

export function blockUntilText(b: MaintenanceBlock): string {
  return b.endUtc ? `until ${fmtDowTime(b.endUtc)}` : "with no end set";
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function listFlights(legs: Leg[]): string {
  const names = legs.map(fullFlight);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const sortIds = (ids: string[]) => [...ids].sort();
const issueId = (rule: RuleId, legIds: string[], blockId: string | null) => `${rule}:${sortIds(legIds).join(",")}:${blockId ?? ""}`;

interface Ctx {
  state: DomainState;
  idx: AirportIndex;
  clockMs: number;
  byAircraft: Map<string, Leg[]>;
  permitsByLeg: Map<string, Permit[]>;
  blocksByAircraft: Map<string, MaintenanceBlock[]>;
  reg: (aircraftId: string) => string;
}

function makeCtx(state: DomainState, clock: string): Ctx {
  const permitsByLeg = new Map<string, Permit[]>();
  for (const p of state.permits) {
    const arr = permitsByLeg.get(p.legId);
    if (arr) arr.push(p);
    else permitsByLeg.set(p.legId, [p]);
  }
  const blocksByAircraft = new Map<string, MaintenanceBlock[]>();
  for (const b of effectiveBlocks(state, clock)) {
    const arr = blocksByAircraft.get(b.aircraftId);
    if (arr) arr.push(b);
    else blocksByAircraft.set(b.aircraftId, [b]);
  }
  const regs = new Map(state.aircraft.map((a) => [a.id, a.registration]));
  return {
    state,
    idx: indexAirports(state.airports),
    clockMs: ms(clock),
    byAircraft: activeByAircraft(state.legs),
    permitsByLeg,
    blocksByAircraft,
    reg: (id) => regs.get(id) ?? id,
  };
}

function mk(
  rule: RuleId,
  severity: "error" | "warning",
  legs: Leg[],
  aircraftId: string | null,
  blockId: string | null,
  message: string,
  fixes: Fix[],
): ValidationIssue {
  const whenMs = Math.min(...legs.map((l) => ms(l.etdUtc)));
  return {
    id: issueId(rule, legs.map((l) => l.id), blockId),
    ruleId: rule,
    severity,
    legIds: sortIds(legs.map((l) => l.id)),
    aircraftId,
    blockId,
    whenUtc: iso(whenMs),
    message,
    fixes,
  };
}

/** validate(state, demoClock) is a pure function (E1). Issues are sorted errors first, then whenUtc, ruleId, id. */
export function validate(state: DomainState, clock: string = DEMO_CLOCK): ValidationIssue[] {
  return validateAll(state, clock).issues;
}

export function validateAll(state: DomainState, clock: string = DEMO_CLOCK): ValidationResult {
  const ctx = makeCtx(state, clock);
  const exemptions: Exemption[] = [];
  const issues: ValidationIssue[] = [
    ...r1(ctx, exemptions),
    ...r2(ctx),
    ...r3(ctx),
    ...r4(ctx),
    ...r5(ctx),
    ...r6(ctx),
  ];
  issues.sort(
    (a, b) =>
      (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1) ||
      ms(a.whenUtc) - ms(b.whenUtc) ||
      RULE_ORDER[a.ruleId] - RULE_ORDER[b.ruleId] ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  exemptions.sort((a, b) => (a.dateUtc < b.dateUtc ? -1 : a.dateUtc > b.dateUtc ? 1 : a.flight < b.flight ? -1 : 1));
  return { issues, exemptions };
}

// ---------------------------------------------------------------------------
// R1 Flight number conflict
// ---------------------------------------------------------------------------
function r1(ctx: Ctx, exemptions: Exemption[]): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const groups = new Map<string, Leg[]>();
  const taken = new Set<string>();
  for (const l of ctx.state.legs) {
    if (!isActive(l)) continue;
    const key = `${fullFlight(l)}|${utcDate(l.etdUtc)}`;
    taken.add(key);
    const g = groups.get(key);
    if (g) g.push(l);
    else groups.set(key, [l]);
  }

  for (const [key, legs] of groups) {
    if (legs.length < 2) continue;
    legs.sort(compareLegs);
    const aircraft = new Set(legs.map((l) => l.aircraftId));
    if (aircraft.size < 2) continue; // legs of one aircraft never conflict
    const chain = legs.every((l, i) => i === 0 || (legs[i - 1].arrIcao === l.depIcao && ms(l.etdUtc) >= ms(legs[i - 1].etaUtc)));
    if (chain) {
      exemptions.push({
        id: `chain:${key}`,
        kind: "chain",
        flight: fullFlight(legs[0]),
        dateUtc: utcDate(legs[0].etdUtc),
        legIds: legs.map((l) => l.id),
        aircraftIds: [...aircraft],
        text: `${fullFlight(legs[0])} runs as one through flight with an aircraft change.`,
      });
      continue;
    }
    const later = legs[legs.length - 1];
    const date = fmtDow(later.etdUtc);
    const regs = [...aircraft].map(ctx.reg);
    const dName = `${later.flightNumber}D`;
    let enabled = true;
    let reason: string | null = null;
    if (later.suffix === "D") {
      enabled = false;
      reason = `${fullFlight(later)} already carries suffix D. Renumber by hand in the leg drawer.`;
    } else if (taken.has(`${dName}|${utcDate(later.etdUtc)}`)) {
      enabled = false;
      reason = `${dName} already exists on ${date}. Renumber by hand in the leg drawer.`;
    }
    const patch: StatePatch = [{ op: "set", coll: "legs", id: later.id, value: { suffix: "D" } }];
    out.push(
      mk(
        "R1",
        "error",
        legs,
        later.aircraftId,
        null,
        `${fullFlight(legs[0])} is planned on ${regs.slice(0, -1).join(", ")}${regs.length > 1 ? " and " : ""}${regs[regs.length - 1]} on ${date}. One flight number cannot fly on two aircraft.`,
        [
          {
            id: `fix:R1:${later.id}`,
            label: `Make the ${ctx.reg(later.aircraftId)} leg ${dName}`,
            enabled,
            disabledReason: reason,
            patch,
            result: `${fullFlight(later)} on ${ctx.reg(later.aircraftId)} is now ${dName}`,
          },
        ],
      ),
    );
  }

  // Exemption hits: through flights (one aircraft) and parallel flights (D suffix).
  const tg = throughGroups(ctx.state.legs);
  const byId = new Map(ctx.state.legs.map((l) => [l.id, l]));
  for (const [gid, ids] of tg.groups) {
    const legs = ids.map((id) => byId.get(id)!);
    const stops = [legs[0].depIcao, ...legs.map((l) => l.arrIcao)].map((c) => pairLabel(c, ctx.idx).split("/")[1] ?? c);
    exemptions.push({
      id: `through:${gid}`,
      kind: "through",
      flight: fullFlight(legs[0]),
      dateUtc: utcDate(legs[0].etdUtc),
      legIds: ids,
      aircraftIds: [legs[0].aircraftId],
      text: `${stops.join(", ")} under one number on ${ctx.reg(legs[0].aircraftId)}.`,
    });
  }
  const seenParallel = new Set<string>();
  for (const l of ctx.state.legs) {
    if (!isActive(l) || l.suffix !== "D") continue;
    const date = utcDate(l.etdUtc);
    const mates = ctx.state.legs.filter(
      (m) => isActive(m) && m.suffix === "" && m.flightNumber === l.flightNumber && utcDate(m.etdUtc) === date && m.aircraftId !== l.aircraftId,
    );
    if (!mates.length) continue;
    const key = `${l.flightNumber}|${date}`;
    if (seenParallel.has(key)) continue;
    seenParallel.add(key);
    const all = [...mates, l];
    exemptions.push({
      id: `parallel:${key}`,
      kind: "parallel",
      flight: l.flightNumber,
      dateUtc: date,
      legIds: all.map((x) => x.id),
      aircraftIds: [...new Set(all.map((x) => x.aircraftId))],
      text: `${l.flightNumber} and ${l.flightNumber}D on two aircraft the same day is the agreed way to run parallel flights.`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// R2 Station continuity
// ---------------------------------------------------------------------------
function r2(ctx: Ctx): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const minGround = ctx.state.company.minGroundMinutes;
  for (const [aircraftId, legs] of ctx.byAircraft) {
    for (let i = 1; i < legs.length; i++) {
      const prev = legs[i - 1];
      const next = legs[i];
      if (isPlaceholder(prev.arrIcao) || isPlaceholder(next.depIcao)) continue;
      if (prev.arrIcao === next.depIcao) continue;
      const to = pairLabel(prev.arrIcao, ctx.idx);
      // Permit rows are entered by hand, so the fix only changes the departure.
      const patch: StatePatch = [{ op: "set", coll: "legs", id: next.id, value: { depIcao: prev.arrIcao } }];
      const ferryStart = ms(prev.etaUtc) + minGround * MIN;
      out.push(
        mk(
          "R2",
          "error",
          [prev, next],
          aircraftId,
          null,
          `${ctx.reg(aircraftId)} flew ${fullFlight(prev)} into ${to}, but ${fullFlight(next)} on ${fmtDow(next.etdUtc)} departs ${pairLabel(next.depIcao, ctx.idx)}.`,
          [
            {
              id: `fix:R2:${next.id}`,
              label: `Set departure to ${to}`,
              enabled: true,
              disabledReason: null,
              patch,
              result: `${fullFlight(next)} now departs ${to}`,
            },
            {
              id: `fix:R2ferry:${next.id}`,
              label: "Insert ferry leg",
              enabled: true,
              disabledReason: null,
              patch: [],
              secondary: true,
              draft: {
                aircraftId,
                legType: "ferry",
                depIcao: prev.arrIcao,
                arrIcao: next.depIcao,
                etdUtc: iso(ferryStart),
                etaUtc: iso(Math.min(ferryStart + 2 * HOUR, ms(next.etdUtc))),
              },
              result: "Ferry leg drawer opened",
            },
          ],
        ),
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// R3 Aircraft unavailable
// ---------------------------------------------------------------------------
function r3(ctx: Ctx): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const [aircraftId, legs] of ctx.byAircraft) {
    const blocks = ctx.blocksByAircraft.get(aircraftId);
    if (!blocks) continue;
    for (const b of blocks) {
      const hit = legs.filter((l) => legHitsBlock(l, b));
      if (!hit.length) continue;
      const reg = ctx.reg(aircraftId);
      const kind = blockKindLabel(b.kind);
      const window = b.endUtc ? `from ${fmtDowTime(b.startUtc)} to ${fmtDowTime(b.endUtc)}` : `from ${fmtDowTime(b.startUtc)}, open-ended`;
      const message = `${reg} is ${kind} ${window}. ${listFlights(hit)} ${hit.length === 1 ? "falls" : "fall"} inside it.`;
      out.push(mk("R3", "error", hit, aircraftId, b.id, message, r3Fixes(ctx, hit, aircraftId, b.id)));
    }
  }
  return out;
}

function r3Fixes(ctx: Ctx, legs: Leg[], aircraftId: string, blockId: string): Fix[] {
  // Fix A: every leg goes to its own backup aircraft.
  let reason: string | null = null;
  const targets = new Set<string>();
  const moved: Leg[] = [];
  for (const l of legs) {
    const backup = l.backupAircraftId;
    if (!backup || backup === aircraftId || !ctx.state.aircraft.some((a) => a.id === backup)) {
      reason = `${fullFlight(l)} has no backup aircraft`;
      break;
    }
    const blk = (ctx.blocksByAircraft.get(backup) ?? []).find((b) => legHitsBlock(l, b));
    if (blk) {
      reason = `${ctx.reg(backup)} is ${blockKindLabel(blk.kind)} ${blockUntilText(blk)}`;
      break;
    }
    const clash = (ctx.byAircraft.get(backup) ?? []).find((o) => ms(o.etdUtc) < ms(l.etaUtc) && ms(l.etdUtc) < ms(o.etaUtc));
    if (clash) {
      reason = `${ctx.reg(backup)} flies ${fullFlight(clash)} ${fmtHHMM(clash.etdUtc)} to ${fmtHHMM(clash.etaUtc)} on ${fmtDow(clash.etdUtc)}`;
      break;
    }
    const earlier = moved.find((m) => m.backupAircraftId === backup && ms(m.etdUtc) < ms(l.etaUtc) && ms(l.etdUtc) < ms(m.etaUtc));
    if (earlier) {
      reason = `${fullFlight(earlier)} and ${fullFlight(l)} would overlap on ${ctx.reg(backup)}`;
      break;
    }
    targets.add(backup);
    moved.push(l);
  }
  const backups = new Set(legs.map((l) => l.backupAircraftId).filter((b): b is string => !!b));
  const backupName = backups.size === 1 ? ctx.reg([...backups][0]) : "backups";
  const fixA: Fix = {
    id: `fix:R3reassign:${blockId}`,
    label: `Reassign ${plural(legs.length, "leg", "legs")} to ${backupName}`,
    enabled: reason === null,
    disabledReason: reason,
    patch: legs.map((l) => ({
      op: "set" as const,
      coll: "legs" as const,
      id: l.id,
      value: {
        aircraftId: l.backupAircraftId,
        backupAircraftId: ctx.state.aircraft.find((a) => a.id === l.backupAircraftId)?.defaultBackupId ?? null,
      },
    })),
    result: `${plural(legs.length, "leg", "legs")} reassigned from ${ctx.reg(aircraftId)} to ${[...targets].map(ctx.reg).join(", ") || "backups"}`,
  };
  const fixB: Fix = {
    id: `fix:R3cancel:${blockId}`,
    label: `Cancel ${plural(legs.length, "leg", "legs")} (CNL)`,
    enabled: true,
    disabledReason: null,
    patch: legs.map((l) => ({ op: "set" as const, coll: "legs" as const, id: l.id, value: { status: "cancelled" } })),
    result: `${plural(legs.length, "leg", "legs")} cancelled`,
  };
  return [fixA, fixB];
}

// ---------------------------------------------------------------------------
// R4 Permit risk
// ---------------------------------------------------------------------------
function r4(ctx: Ctx): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const windowEnd = ctx.clockMs + 48 * HOUR;
  const base = ctx.state.company.baseIcao;
  for (const l of ctx.state.legs) {
    if (!isActive(l)) continue;
    const etd = ms(l.etdUtc);
    if (etd < ctx.clockMs) continue;
    const required = requiredPermits(l.depIcao, l.arrIcao, ctx.idx, base);
    if (!required.length) continue;
    const rows = ctx.permitsByLeg.get(l.id) ?? [];
    const rowOf = new Map(rows.map((p) => [permitKey(p), p]));
    const urgent = etd <= windowEnd;
    if (urgent) {
      const unmet = required.filter((r) => rowOf.get(permitKey(r))?.status !== "obtained");
      if (!unmet.length) continue;
      const hours = Math.round(((etd - ctx.clockMs) / HOUR) * 10) / 10;
      const names = unmet.map((r) => `${permitLabel(r)} (${rowOf.get(permitKey(r))?.status ?? "no record"})`);
      const patch: StatePatch = [];
      for (const r of unmet) {
        const row = rowOf.get(permitKey(r));
        if (row) patch.push({ op: "set", coll: "permits", id: row.id, value: { status: "obtained", number: null, ...validityFor(l.etdUtc) } });
        else patch.push({ op: "insert", coll: "permits", value: newPermit(l, r, "obtained") as never });
      }
      out.push(
        mk(
          "R4a",
          "error",
          [l],
          l.aircraftId,
          null,
          `${fullFlight(l)} departs in ${hours} h and ${plural(unmet.length, "required permit is", "required permits are")} not obtained: ${names.join(", ")}.`,
          [
            {
              id: `fix:R4a:${l.id}`,
              label: `Mark ${plural(unmet.length, "permit", "permits")} obtained`,
              enabled: true,
              disabledReason: null,
              patch,
              result: `${plural(unmet.length, "permit", "permits")} marked obtained for ${fullFlight(l)}`,
            },
          ],
        ),
      );
    } else {
      const missing = required.filter((r) => !rowOf.has(permitKey(r)));
      if (!missing.length) continue;
      out.push(
        mk(
          "R4b",
          "warning",
          [l],
          l.aircraftId,
          null,
          `${fullFlight(l)} has no permit record for ${missing.map(permitLabel).join(" and ")}.`,
          [
            {
              id: `fix:R4b:${l.id}`,
              label: `Add ${plural(missing.length, "pending permit row", "pending permit rows")}`,
              enabled: true,
              disabledReason: null,
              patch: missing.map((r) => ({ op: "insert" as const, coll: "permits" as const, value: newPermit(l, r, "pending") as never })),
              result: `${plural(missing.length, "pending permit row", "pending permit rows")} added for ${fullFlight(l)}`,
            },
          ],
        ),
      );
    }
  }
  return out;
}

export function missingCountries(required: RequiredPermit[]): string {
  return required.map((r) => COUNTRY_NAMES[r.countryCode]).join(", ");
}

// ---------------------------------------------------------------------------
// R5 Overlapping legs
// ---------------------------------------------------------------------------
function r5(ctx: Ctx): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const minGround = ctx.state.company.minGroundMinutes;
  for (const [aircraftId, legs] of ctx.byAircraft) {
    for (let i = 1; i < legs.length; i++) {
      const prev = legs[i - 1];
      const next = legs[i];
      if (ms(next.etdUtc) >= ms(prev.etaUtc)) continue; // equal values touch and are allowed
      const newEtd = ms(prev.etaUtc) + minGround * MIN;
      const delta = newEtd - ms(next.etdUtc);
      const newEta = ms(next.etaUtc) + delta;
      let reason: string | null = null;
      const clash = legs.find((o) => o.id !== next.id && ms(o.etdUtc) < newEta && newEtd < ms(o.etaUtc));
      if (clash) reason = `Moving ${fullFlight(next)} would overlap ${fullFlight(clash)} (${fmtHHMM(clash.etdUtc)} to ${fmtHHMM(clash.etaUtc)} on ${fmtDow(clash.etdUtc)})`;
      const blk = (ctx.blocksByAircraft.get(aircraftId) ?? []).find((b) => legHitsBlock({ etdUtc: iso(newEtd), etaUtc: iso(newEta) }, b));
      if (!reason && blk) reason = `${ctx.reg(aircraftId)} is ${blockKindLabel(blk.kind)} ${blockUntilText(blk)}`;
      out.push(
        mk(
          "R5",
          "error",
          [prev, next],
          aircraftId,
          null,
          `${fullFlight(prev)} and ${fullFlight(next)} overlap on ${ctx.reg(aircraftId)}: ${fullFlight(next)} departs ${fmtHHMM(next.etdUtc)}, before ${fullFlight(prev)} arrives ${fmtHHMM(prev.etaUtc)} (${fmtDow(prev.etaUtc)}).`,
          [
            {
              id: `fix:R5:${next.id}`,
              label: `Move ${fullFlight(next)} to depart ${fmtHHMM(newEtd)}`,
              enabled: reason === null,
              disabledReason: reason,
              patch: [{ op: "set", coll: "legs", id: next.id, value: { etdUtc: iso(newEtd), etaUtc: iso(newEta) } }],
              result: `${fullFlight(next)} now departs ${fmtHHMM(newEtd)}`,
            },
          ],
        ),
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// R6 Block time across midnight
// ---------------------------------------------------------------------------
function r6(ctx: Ctx): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const l of ctx.state.legs) {
    if (!isActive(l)) continue;
    const block = blockMinutes(l);
    if (block <= 0 || block >= 1440) {
      out.push(mk("R6", "error", [l], l.aircraftId, null, `${fullFlight(l)} has an invalid block time. ETA must be after ETD and less than 24 h later.`, []));
    } else if (block > 1080) {
      out.push(mk("R6", "warning", [l], l.aircraftId, null, `${fullFlight(l)} block time ${fmtDuration(block)} is longer than 18 h.`, []));
    }
  }
  return out;
}

export { DAY };
