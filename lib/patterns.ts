// Recurring patterns: generate dated legs from a rotation, update them when the pattern changes, and find
// patterns in a schedule that was typed or imported leg by leg. Pure functions, nothing is applied here.
import { iataOf, indexAirports, isPlaceholder } from "./airports";
import { issueDelta } from "./bulk";
import { fullFlight, makeLegId } from "./legs";
import { newPermit, requiredPermits } from "./permits";
import { mondayOf } from "./schedule";
import { DAY, MIN, addDaysIso, dateMs, iso, isoWeekday, ms, utcDate } from "./time";
import { localToUtc } from "./tz";
import type { DomainState, IsoDate, Leg, Pattern, PatternLeg, StatePatch } from "./types";

/** A pattern may not create more legs than this at once. */
export const MAX_PATTERN_LEGS = 3000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (d: string) => DATE_RE.test(d) && !Number.isNaN(dateMs(d));

/** The days on which the rotation starts, in order. */
export function occurrenceDates(p: Pick<Pattern, "from" | "to" | "days" | "everyWeeks">): IsoDate[] {
  if (!validDate(p.from) || !validDate(p.to) || p.to < p.from || p.days.length === 0) return [];
  const startMonday = dateMs(mondayOf(p.from));
  const out: IsoDate[] = [];
  const total = Math.min(1100, Math.round((dateMs(p.to) - dateMs(p.from)) / DAY) + 1);
  for (let i = 0; i < total; i++) {
    const d = addDaysIso(p.from, i);
    if (!p.days.includes(isoWeekday(d))) continue;
    const weeks = Math.round((dateMs(mondayOf(d)) - startMonday) / (7 * DAY));
    if (weeks % p.everyWeeks === 0) out.push(d);
  }
  return out;
}

export interface Expansion {
  legs: Leg[];
  warnings: string[];
}

/** The legs a pattern stands for. Every leg remembers its pattern in `source`. */
export function expandPattern(state: DomainState, p: Pattern): Expansion {
  const idx = indexAirports(state.airports);
  const warnings = new Set<string>();
  if (!state.aircraft.some((a) => a.id === p.aircraftId)) return { legs: [], warnings: [`Aircraft ${p.aircraftId} is not in the fleet.`] };
  const legs: Leg[] = [];
  for (const date of occurrenceDates(p)) {
    for (const pl of p.legs) {
      const wall = dateMs(addDaysIso(date, pl.dayOffset)) + pl.etdMin * MIN;
      let etd = wall;
      const dep = idx.byIcao.get(pl.depIcao);
      if (p.basis === "local" && dep && !isPlaceholder(pl.depIcao)) {
        const r = localToUtc(dep, wall);
        etd = r.utcMs;
        if (r.nonexistent) warnings.add(`${pl.flightNumber} ${addDaysIso(date, pl.dayOffset)}: the local time does not exist at ${dep.iata} (clocks go forward), so it is moved to just after.`);
        if (r.ambiguous) warnings.add(`${pl.flightNumber} ${addDaysIso(date, pl.dayOffset)}: the local time happens twice at ${dep.iata} (clocks go back), the first one is used.`);
      }
      const draft = {
        flightNumber: pl.flightNumber,
        suffix: pl.suffix,
        aircraftId: p.aircraftId,
        backupAircraftId: p.backupAircraftId,
        legType: pl.legType,
        depIcao: pl.depIcao,
        arrIcao: pl.arrIcao,
        etdUtc: iso(etd),
        etaUtc: iso(etd + pl.blockMin * MIN),
      };
      legs.push({ id: makeLegId(draft, idx), ...draft, status: "planned", notes: pl.notes, source: { kind: "pattern", patternId: p.id } });
    }
  }
  return { legs, warnings: [...warnings] };
}

export interface PatternProblem {
  field: string;
  message: string;
}

/** Everything wrong with a pattern the user typed, so the form can say so before anything is generated. */
export function validatePattern(state: DomainState, p: Pattern, others: Pattern[]): PatternProblem[] {
  const out: PatternProblem[] = [];
  const idx = indexAirports(state.airports);
  if (!p.name.trim()) out.push({ field: "name", message: "Enter a name" });
  else if (others.some((o) => o.id !== p.id && o.name.trim().toLowerCase() === p.name.trim().toLowerCase())) out.push({ field: "name", message: "Another pattern has this name" });
  if (!state.aircraft.some((a) => a.id === p.aircraftId)) out.push({ field: "aircraft", message: "Choose an aircraft" });
  if (p.days.length === 0) out.push({ field: "days", message: "Choose at least one weekday" });
  if (!validDate(p.from)) out.push({ field: "from", message: "Enter the first day" });
  if (!validDate(p.to)) out.push({ field: "to", message: "Enter the last day" });
  else if (validDate(p.from) && p.to < p.from) out.push({ field: "to", message: "The last day is before the first day" });
  else if (validDate(p.from) && (dateMs(p.to) - dateMs(p.from)) / DAY > 800) out.push({ field: "to", message: "A pattern can cover at most about two years" });
  if (p.legs.length === 0) out.push({ field: "legs", message: "Add at least one leg" });
  p.legs.forEach((l, i) => {
    const row = `Leg ${i + 1}`;
    if (!/^[A-Z]{3}\d{1,4}$/.test(l.flightNumber)) out.push({ field: `leg${i}.flight`, message: `${row}: enter a flight number like PHC509` });
    if (!idx.byIcao.has(l.depIcao)) out.push({ field: `leg${i}.dep`, message: `${row}: unknown departure station` });
    if (!idx.byIcao.has(l.arrIcao)) out.push({ field: `leg${i}.arr`, message: `${row}: unknown arrival station` });
    else if (l.arrIcao === l.depIcao) out.push({ field: `leg${i}.arr`, message: `${row}: arrival must differ from departure` });
    if (!(l.blockMin > 0 && l.blockMin < 1440)) out.push({ field: `leg${i}.eta`, message: `${row}: ETA must differ from ETD` });
    if (!(l.etdMin >= 0 && l.etdMin < 1440)) out.push({ field: `leg${i}.etd`, message: `${row}: enter the departure time as HH:MM` });
    if (!(l.dayOffset >= 0 && l.dayOffset <= 6)) out.push({ field: `leg${i}.day`, message: `${row}: the day shift is 0 to 6` });
  });
  if (out.length === 0) {
    const n = occurrenceDates(p).length * p.legs.length;
    if (n === 0) out.push({ field: "days", message: "No day between the first and last day matches these weekdays" });
    else if (n > MAX_PATTERN_LEGS) out.push({ field: "to", message: `This would create ${n} legs. The limit is ${MAX_PATTERN_LEGS}.` });
  }
  return out;
}

const SAME_FIELDS: (keyof Leg)[] = ["flightNumber", "suffix", "aircraftId", "backupAircraftId", "depIcao", "arrIcao", "etdUtc", "etaUtc", "legType", "status", "notes"];
/** True when nobody has changed the leg since the pattern made it. */
export const sameLeg = (a: Leg, b: Leg): boolean => SAME_FIELDS.every((f) => a[f] === b[f]);

export interface PatternPlan {
  patch: StatePatch;
  inserted: number;
  updated: number;
  removed: number;
  /** Legs someone changed by hand: left exactly as they are. */
  kept: number;
  unchanged: number;
  /** Legs that could not be created because a leg with the same id already exists elsewhere. */
  clashes: { id: string; label: string }[];
  warnings: string[];
  newIssues: string[];
  clearedIssues: number;
}

const label = (l: Leg) => `${fullFlight(l)} ${l.depIcao}-${l.arrIcao} ${l.etdUtc.slice(0, 10)}`;
const permitsOf = (state: DomainState, legId: string) => state.permits.filter((p) => p.legId === legId);

/**
 * Brings the legs of a pattern in line with its definition. `prev` is the definition they were last made from
 * (null for a new pattern). Legs that still match `prev` are updated or removed, legs someone edited are kept.
 */
export function planPattern(state: DomainState, next: Pattern, prev: Pattern | null, opts: { permits: boolean }): PatternPlan {
  const patch: StatePatch = [];
  const exp = expandPattern(state, next);
  const wanted = new Map(exp.legs.map((l) => [l.id, l]));
  const was = prev ? new Map(expandPattern(state, prev).legs.map((l) => [l.id, l])) : new Map<string, Leg>();
  const mine = state.legs.filter((l) => l.source.patternId === next.id);
  const mineIds = new Set(mine.map((l) => l.id));
  const allIds = new Set(state.legs.map((l) => l.id));
  const plan: PatternPlan = { patch, inserted: 0, updated: 0, removed: 0, kept: 0, unchanged: 0, clashes: [], warnings: exp.warnings, newIssues: [], clearedIssues: 0 };

  patch.push(prev ? { op: "set", coll: "patterns", id: next.id, value: { ...next } as unknown as Record<string, unknown> } : { op: "insert", coll: "patterns", value: next as never });

  for (const l of mine) {
    const old = was.get(l.id);
    const untouched = !!old && sameLeg(old, l);
    const nw = wanted.get(l.id);
    if (nw) {
      if (!untouched) plan.kept++;
      else if (sameLeg(nw, l)) plan.unchanged++;
      else {
        const { id: _id, ...rest } = nw;
        void _id;
        patch.push({ op: "set", coll: "legs", id: l.id, value: rest as unknown as Record<string, unknown> });
        plan.updated++;
      }
    } else if (untouched) {
      patch.push({ op: "remove", coll: "legs", id: l.id });
      for (const p of permitsOf(state, l.id)) patch.push({ op: "remove", coll: "permits", id: p.id });
      plan.removed++;
    } else {
      // The pattern no longer produces this leg but someone changed it: keep it as an ordinary leg.
      patch.push({ op: "set", coll: "legs", id: l.id, value: { source: { kind: "manual" } } });
      plan.kept++;
    }
  }

  const haveLegPermit = new Set(state.permits.map((p) => p.id));
  for (const [id, leg] of wanted) {
    if (mineIds.has(id)) continue;
    if (allIds.has(id)) {
      plan.clashes.push({ id, label: label(leg) });
      continue;
    }
    patch.push({ op: "insert", coll: "legs", value: leg as never });
    plan.inserted++;
    if (opts.permits) {
      for (const req of requiredPermits(leg.depIcao, leg.arrIcao, state.permitRules)) {
        const permit = newPermit(leg, req, "pending");
        if (!haveLegPermit.has(permit.id)) patch.push({ op: "insert", coll: "permits", value: permit as never });
      }
    }
  }

  const d = issueDelta(state, patch);
  plan.newIssues = d.newIssues;
  plan.clearedIssues = d.cleared;
  return plan;
}

/** Deletes a pattern. With removeLegs the legs nobody edited go too, the rest become ordinary legs. */
export function planDeletePattern(state: DomainState, p: Pattern, removeLegs: boolean): { patch: StatePatch; removed: number; kept: number } {
  const patch: StatePatch = [{ op: "remove", coll: "patterns", id: p.id }];
  const was = new Map(expandPattern(state, p).legs.map((l) => [l.id, l]));
  let removed = 0;
  let kept = 0;
  for (const l of state.legs.filter((x) => x.source.patternId === p.id)) {
    const old = was.get(l.id);
    if (removeLegs && old && sameLeg(old, l)) {
      patch.push({ op: "remove", coll: "legs", id: l.id });
      for (const pm of permitsOf(state, l.id)) patch.push({ op: "remove", coll: "permits", id: pm.id });
      removed++;
    } else {
      patch.push({ op: "set", coll: "legs", id: l.id, value: { source: { kind: "manual" } } });
      kept++;
    }
  }
  return { patch, removed, kept };
}

export function nextPatternId(patterns: Pattern[], offset = 0): string {
  const used = patterns.map((p) => /^PT-(\d+)$/.exec(p.id)).filter((m): m is RegExpExecArray => !!m).map((m) => Number(m[1]));
  return `PT-${Math.max(0, ...used) + 1 + offset}`;
}

export const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function describePattern(p: Pattern, state: DomainState): string {
  const idx = indexAirports(state.airports);
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const days = [...p.days].sort().map((d) => DAY_NAMES[d]).join(" ");
  const every = p.everyWeeks === 1 ? "every week" : `every ${p.everyWeeks} weeks`;
  const legs = p.legs.map((l) => `${l.flightNumber}${l.suffix} ${iataOf(l.depIcao, idx)}-${iataOf(l.arrIcao, idx)} ${hhmm(l.etdMin)}${p.basis === "local" ? " LT" : "Z"}`).join(", ");
  return `${days} ${every}, ${p.from} to ${p.to}: ${legs}`;
}

// ---------------------------------------------------------------------------
// Finding patterns in a schedule
// ---------------------------------------------------------------------------
export interface DetectedPattern {
  pattern: Pattern;
  legIds: string[];
}

interface Cand {
  aircraftId: string;
  everyWeeks: 1 | 2 | 3 | 4;
  days: number[];
  from: IsoDate;
  to: IsoDate;
  dates: IsoDate[];
  leg: PatternLeg;
  legIds: string[];
}

const STEPS = [7, 14, 21, 28];

/**
 * Looks for legs that repeat on the same weekday at the same time, every 1 to 4 weeks, at least three times,
 * and chains legs that follow each other on the same aircraft into one rotation. Only legs that belong to no
 * pattern yet are considered. A proposal is kept only when it would regenerate exactly the legs it covers.
 */
export function detectPatterns(state: DomainState): DetectedPattern[] {
  const free = state.legs.filter((l) => !l.source.patternId);
  const groups = new Map<string, Leg[]>();
  for (const l of free) {
    const block = (ms(l.etaUtc) - ms(l.etdUtc)) / MIN;
    const tod = Math.round((ms(l.etdUtc) - dateMs(utcDate(l.etdUtc))) / MIN);
    const k = [l.aircraftId, l.flightNumber, l.suffix, l.depIcao, l.arrIcao, tod, block, l.legType].join("|");
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }

  const cands: Cand[] = [];
  for (const legs of groups.values()) {
    const byDate = new Map<IsoDate, Leg>();
    for (const l of legs) if (!byDate.has(utcDate(l.etdUtc))) byDate.set(utcDate(l.etdUtc), l);
    const sample = legs[0];
    const byDow = new Map<number, IsoDate[]>();
    for (const d of [...byDate.keys()].sort()) byDow.set(isoWeekday(d), [...(byDow.get(isoWeekday(d)) ?? []), d]);
    const runs: { dates: IsoDate[]; step: number }[] = [];
    for (const list of byDow.values()) {
      let i = 0;
      while (i < list.length - 1) {
        const diff = Math.round((dateMs(list[i + 1]) - dateMs(list[i])) / DAY);
        if (!STEPS.includes(diff)) {
          i++;
          continue;
        }
        let j = i + 1;
        while (j + 1 < list.length && Math.round((dateMs(list[j + 1]) - dateMs(list[j])) / DAY) === diff) j++;
        if (j - i + 1 >= 3) runs.push({ dates: list.slice(i, j + 1), step: diff });
        i = j + 1;
      }
    }
    // Runs that start and end in the same weeks and repeat at the same step are one pattern on several weekdays.
    const merged = new Map<string, { dates: IsoDate[]; step: number }[]>();
    for (const r of runs) {
      const k = `${mondayOf(r.dates[0])}|${mondayOf(r.dates[r.dates.length - 1])}|${r.step}`;
      merged.set(k, [...(merged.get(k) ?? []), r]);
    }
    for (const rs of merged.values()) {
      const dates = rs.flatMap((r) => r.dates).sort();
      const tod = Math.round((ms(sample.etdUtc) - dateMs(utcDate(sample.etdUtc))) / MIN);
      cands.push({
        aircraftId: sample.aircraftId,
        everyWeeks: (rs[0].step / 7) as 1 | 2 | 3 | 4,
        days: [...new Set(rs.map((r) => isoWeekday(r.dates[0])))].sort((a, b) => a - b),
        from: dates[0],
        to: dates[dates.length - 1],
        dates,
        leg: {
          flightNumber: sample.flightNumber,
          suffix: sample.suffix,
          legType: sample.legType,
          depIcao: sample.depIcao,
          arrIcao: sample.arrIcao,
          dayOffset: 0,
          etdMin: tod,
          blockMin: (ms(sample.etaUtc) - ms(sample.etdUtc)) / MIN,
          notes: "",
        },
        legIds: dates.map((d) => byDate.get(d)!.id),
      });
    }
  }

  const absStart = (c: Cand) => dateMs(c.dates[0]) + c.leg.etdMin * MIN;
  cands.sort((a, b) => absStart(a) - absStart(b));
  const used = new Set<Cand>();
  const out: DetectedPattern[] = [];
  const verify = (p: Pattern, legIds: string[]): boolean => {
    const ids = expandPattern(state, p).legs.map((l) => l.id);
    return ids.length === legIds.length && new Set(ids).size === ids.length && legIds.every((id) => ids.includes(id));
  };
  const single = (c: Cand): Pattern => buildPattern([c], [0]);
  const buildPattern = (chain: Cand[], shifts: number[]): Pattern => {
    const head = chain[0];
    const name = [...new Set(chain.map((c) => c.leg.flightNumber + c.leg.suffix))].join(" / ");
    return {
      id: "PT-detected",
      name,
      aircraftId: head.aircraftId,
      backupAircraftId: state.aircraft.find((a) => a.id === head.aircraftId)?.defaultBackupId ?? null,
      basis: "utc",
      everyWeeks: head.everyWeeks,
      days: head.days,
      from: head.from,
      to: head.to,
      legs: chain.map((c, i) => ({ ...c.leg, dayOffset: shifts[i] })),
    };
  };

  for (const head of cands) {
    if (used.has(head)) continue;
    used.add(head);
    const chain = [head];
    const shifts = [0];
    for (let guard = 0; guard < 8; guard++) {
      const last = chain[chain.length - 1];
      const lastEnd = dateMs(last.dates[0]) + (shifts[shifts.length - 1] * DAY) + last.leg.etdMin * MIN + last.leg.blockMin * MIN;
      const next = cands.find((y) => {
        if (used.has(y) || y.aircraftId !== head.aircraftId || y.everyWeeks !== head.everyWeeks || y.leg.depIcao !== last.leg.arrIcao) return false;
        const k = Math.round((dateMs(y.dates[0]) - dateMs(head.dates[0])) / DAY);
        if (k < 0 || k > 4 || y.dates.length !== head.dates.length) return false;
        if (!head.dates.every((d, i) => y.dates[i] === addDaysIso(d, k))) return false;
        const start = dateMs(head.dates[0]) + k * DAY + y.leg.etdMin * MIN;
        return start >= lastEnd && start - lastEnd <= 36 * 3600_000;
      });
      if (!next) break;
      used.add(next);
      chain.push(next);
      shifts.push(Math.round((dateMs(next.dates[0]) - dateMs(head.dates[0])) / DAY));
    }
    const pattern = buildPattern(chain, shifts);
    const ids = chain.flatMap((c) => c.legIds);
    if (verify(pattern, ids)) {
      out.push({ pattern, legIds: ids });
      continue;
    }
    // A chain that does not reproduce its legs is split back into single legs, each checked on its own.
    for (const c of chain) {
      const p = single(c);
      if (verify(p, c.legIds)) out.push({ pattern: p, legIds: c.legIds });
    }
  }
  return out.sort((a, b) => (a.pattern.from < b.pattern.from ? -1 : a.pattern.from > b.pattern.from ? 1 : a.pattern.name < b.pattern.name ? -1 : 1));
}

/** Makes the chosen detections real: stores the patterns and tags their legs. The legs themselves do not change. */
export function adoptPatch(state: DomainState, chosen: DetectedPattern[]): StatePatch {
  const patch: StatePatch = [];
  const byId = new Map(state.legs.map((l) => [l.id, l]));
  const taken: Pattern[] = [...state.patterns];
  chosen.forEach((d) => {
    const id = nextPatternId(taken, 0);
    const pattern: Pattern = { ...d.pattern, id };
    taken.push(pattern);
    patch.push({ op: "insert", coll: "patterns", value: pattern as never });
    for (const legId of d.legIds) {
      const l = byId.get(legId);
      if (l) patch.push({ op: "set", coll: "legs", id: legId, value: { source: { kind: "pattern", patternId: id, ...(l.source.sheetRef ? { sheetRef: l.source.sheetRef } : {}) } } });
    }
  });
  return patch;
}

/** How many of a pattern's legs exist now and how many were changed by hand. */
export function patternStats(state: DomainState, p: Pattern): { legs: number; changed: number; missing: number } {
  const want = new Map(expandPattern(state, p).legs.map((l) => [l.id, l]));
  const mine = state.legs.filter((l) => l.source.patternId === p.id);
  const changed = mine.filter((l) => !(want.get(l.id) && sameLeg(want.get(l.id)!, l))).length;
  const have = new Set(mine.map((l) => l.id));
  return { legs: mine.length, changed, missing: [...want.keys()].filter((id) => !have.has(id)).length };
}
