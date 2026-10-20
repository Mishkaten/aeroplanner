import { describe, expect, it } from "vitest";
import {
  adoptPatch,
  describePattern,
  detectPatterns,
  expandPattern,
  nextPatternId,
  occurrenceDates,
  patternStats,
  planDeletePattern,
  planPattern,
  sameLeg,
  validatePattern,
} from "./patterns";
import { applyPatch } from "./patch";
import { emptyScheduleState, fullDemoState } from "./seed";
import { addVersion, switchVersion } from "./versions";
import { fullFlight } from "./legs";
import { validateAll } from "./validate";
import type { DomainState, Pattern, StatePatch } from "./types";

const empty = () => emptyScheduleState();
const demo = () => fullDemoState();

const pat = (over: Partial<Pattern> = {}): Pattern => ({
  id: "PT-1",
  name: "TBS to BEG and back",
  aircraftId: "4L-PXA",
  backupAircraftId: null,
  basis: "utc",
  everyWeeks: 1,
  days: [1, 3],
  from: "2026-10-05",
  to: "2026-10-25",
  legs: [
    { flightNumber: "PHC501", suffix: "", legType: "landing", depIcao: "UGTB", arrIcao: "LYBE", dayOffset: 0, etdMin: 210, blockMin: 180, notes: "" },
    { flightNumber: "PHC502", suffix: "", legType: "landing", depIcao: "LYBE", arrIcao: "UGTB", dayOffset: 0, etdMin: 480, blockMin: 180, notes: "" },
  ],
  ...over,
});

const apply = (s: DomainState, patch: StatePatch) => applyPatch(s, patch).state;
const create = (s: DomainState, p: Pattern, permits = false) => apply(s, planPattern(s, p, null, { permits }).patch);

describe("occurrenceDates", () => {
  it("every week on Monday and Wednesday", () => {
    expect(occurrenceDates(pat())).toEqual(["2026-10-05", "2026-10-07", "2026-10-12", "2026-10-14", "2026-10-19", "2026-10-21"]);
  });
  it("every second week counts from the week of the first day", () => {
    expect(occurrenceDates(pat({ days: [1], everyWeeks: 2 }))).toEqual(["2026-10-05", "2026-10-19"]);
    expect(occurrenceDates(pat({ days: [3], from: "2026-10-07", everyWeeks: 3, to: "2026-11-30" }))).toEqual(["2026-10-07", "2026-10-28", "2026-11-18"]);
  });
  it("nothing for an empty or backwards range, or no weekdays", () => {
    expect(occurrenceDates(pat({ to: "2026-10-01" }))).toEqual([]);
    expect(occurrenceDates(pat({ days: [] }))).toEqual([]);
    expect(occurrenceDates(pat({ from: "nope" }))).toEqual([]);
  });
});

describe("expanding a pattern", () => {
  it("makes one leg per leg and day, with ids, times and the pattern as source", () => {
    const { legs } = expandPattern(empty(), pat());
    expect(legs).toHaveLength(12);
    expect(legs[0]).toMatchObject({ id: "L-20261005-PHC501-TBS-A", etdUtc: "2026-10-05T03:30:00Z", etaUtc: "2026-10-05T06:30:00Z", status: "planned", source: { kind: "pattern", patternId: "PT-1" } });
    expect(legs[1]).toMatchObject({ flightNumber: "PHC502", etdUtc: "2026-10-05T08:00:00Z" });
  });
  it("a day shift moves the following leg to the next day", () => {
    const p = pat({ legs: [pat().legs[0], { ...pat().legs[1], dayOffset: 1, etdMin: 60 }] });
    const { legs } = expandPattern(empty(), p);
    expect(legs[1].etdUtc).toBe("2026-10-06T01:00:00Z");
  });
  it("an unknown aircraft gives no legs and says why", () => {
    const r = expandPattern(empty(), pat({ aircraftId: "XX-XXX" }));
    expect(r.legs).toEqual([]);
    expect(r.warnings[0]).toMatch(/not in the fleet/);
  });
  it("local basis keeps the local time across the daylight saving change, so UTC moves by an hour", () => {
    const p = pat({
      basis: "local",
      days: [1],
      from: "2026-10-19",
      to: "2026-10-26",
      legs: [{ flightNumber: "PHC502", suffix: "", legType: "landing", depIcao: "LYBE", arrIcao: "UGTB", dayOffset: 0, etdMin: 600, blockMin: 180, notes: "" }],
    });
    const { legs } = expandPattern(empty(), p);
    expect(legs.map((l) => l.etdUtc)).toEqual(["2026-10-19T08:00:00Z", "2026-10-26T09:00:00Z"]);
    expect(legs.map((l) => (Date.parse(l.etaUtc) - Date.parse(l.etdUtc)) / 60000)).toEqual([180, 180]);
  });
  it("utc basis keeps the UTC time", () => {
    const p = pat({ days: [1], from: "2026-10-19", to: "2026-10-26", legs: [{ ...pat().legs[1] }] });
    expect(expandPattern(empty(), p).legs.map((l) => l.etdUtc.slice(11, 16))).toEqual(["08:00", "08:00"]);
  });
  it("a local time that does not exist is reported and moved after the gap", () => {
    const p = pat({
      basis: "local",
      days: [7],
      from: "2026-03-29",
      to: "2026-03-29",
      legs: [{ ...pat().legs[1], etdMin: 150 }],
    });
    const r = expandPattern(empty(), p);
    expect(r.warnings.join(" ")).toMatch(/does not exist/);
    expect(r.legs).toHaveLength(1);
  });
});

describe("creating legs from a pattern", () => {
  it("inserts every leg and stores the pattern", () => {
    const s = empty();
    const plan = planPattern(s, pat(), null, { permits: false });
    expect([plan.inserted, plan.updated, plan.removed, plan.kept, plan.clashes.length]).toEqual([12, 0, 0, 0, 0]);
    const next = apply(s, plan.patch);
    expect(next.legs).toHaveLength(12);
    expect(next.patterns.map((p) => p.id)).toEqual(["PT-1"]);
    expect(next.legs.every((l) => l.source.patternId === "PT-1")).toBe(true);
  });
  it("can add the permit rows the rules require, as pending", () => {
    const s = demo();
    const emptyLegs = { ...s, legs: [], permits: [] };
    const plan = planPattern(emptyLegs, pat(), null, { permits: true });
    const next = apply(emptyLegs, plan.patch);
    expect(next.permits.length).toBeGreaterThan(0);
    expect(next.permits.every((p) => p.status === "pending" && next.legs.some((l) => l.id === p.legId))).toBe(true);
  });
  it("does not overwrite an existing leg with the same id: it reports a clash", () => {
    const s = empty();
    const first = expandPattern(s, pat()).legs[0];
    const withManual = apply(s, [{ op: "insert", coll: "legs", value: { ...first, source: { kind: "manual" } } as never }]);
    const plan = planPattern(withManual, pat(), null, { permits: false });
    expect(plan.clashes.map((c) => c.id)).toEqual([first.id]);
    expect(plan.inserted).toBe(11);
  });
  it("reports the issues the new legs would create", () => {
    const s = empty();
    const twice = pat({ id: "PT-2", name: "again" });
    const once = create(s, pat());
    const plan = planPattern(once, { ...twice, legs: twice.legs.map((l) => ({ ...l, flightNumber: "PHC509" })) }, null, { permits: false });
    expect(plan.newIssues.length).toBeGreaterThan(0);
  });
  it("undo removes everything it added", () => {
    const s = empty();
    const { state, inverse } = applyPatch(s, planPattern(s, pat(), null, { permits: false }).patch);
    expect(state.legs).toHaveLength(12);
    const back = applyPatch(state, inverse).state;
    expect(back.legs).toHaveLength(0);
    expect(back.patterns).toHaveLength(0);
  });
});

describe("changing a pattern", () => {
  const shifted = (p: Pattern, minutes: number): Pattern => ({ ...p, legs: p.legs.map((l) => ({ ...l, etdMin: l.etdMin + minutes })) });

  it("updates every untouched leg, keeping its id and permits", () => {
    const s0 = demo();
    const s = create({ ...s0, legs: [], permits: [] }, pat(), true);
    const permitsBefore = s.permits.length;
    expect(permitsBefore).toBeGreaterThan(0);
    const plan = planPattern(s, shifted(pat(), 60), pat(), { permits: false });
    expect([plan.updated, plan.inserted, plan.removed, plan.kept]).toEqual([12, 0, 0, 0]);
    const next = apply(s, plan.patch);
    expect(next.legs.find((l) => l.id === "L-20261005-PHC501-TBS-A")!.etdUtc).toBe("2026-10-05T04:30:00Z");
    expect(next.permits).toHaveLength(permitsBefore);
  });
  it("leaves a leg alone that someone edited, and one that someone cancelled", () => {
    const s = create(empty(), pat());
    const edited = apply(s, [
      { op: "set", coll: "legs", id: "L-20261005-PHC501-TBS-A", value: { notes: "hand note" } },
      { op: "set", coll: "legs", id: "L-20261007-PHC501-TBS-A", value: { status: "cancelled" } },
    ]);
    const plan = planPattern(edited, shifted(pat(), 30), pat(), { permits: false });
    expect(plan.kept).toBe(2);
    expect(plan.updated).toBe(10);
    const next = apply(edited, plan.patch);
    const a = next.legs.find((l) => l.id === "L-20261005-PHC501-TBS-A")!;
    expect([a.notes, a.etdUtc]).toEqual(["hand note", "2026-10-05T03:30:00Z"]);
    expect(next.legs.find((l) => l.id === "L-20261007-PHC501-TBS-A")!.status).toBe("cancelled");
  });
  it("a shorter period removes the untouched legs and their permits and keeps hand-edited ones as ordinary legs", () => {
    const s0 = demo();
    const s = create({ ...s0, legs: [], permits: [] }, pat(), true);
    const edited = apply(s, [{ op: "set", coll: "legs", id: "L-20261021-PHC501-TBS-A", value: { notes: "keep me" } }]);
    const shorter = pat({ to: "2026-10-14" });
    const plan = planPattern(edited, shorter, pat(), { permits: false });
    expect(plan.removed).toBe(3);
    expect(plan.kept).toBe(1);
    const next = apply(edited, plan.patch);
    expect(next.legs.map((l) => l.id)).not.toContain("L-20261019-PHC501-TBS-A");
    const keep = next.legs.find((l) => l.id === "L-20261021-PHC501-TBS-A")!;
    expect(keep.source.kind).toBe("manual");
    expect(next.permits.every((p) => next.legs.some((l) => l.id === p.legId))).toBe(true);
  });
  it("a longer period adds legs", () => {
    const s = create(empty(), pat());
    const plan = planPattern(s, pat({ to: "2026-11-01" }), pat(), { permits: false });
    expect(plan.inserted).toBe(4);
    expect(plan.unchanged).toBe(12);
  });
  it("changing the aircraft replaces the legs (their ids contain the aircraft)", () => {
    const s = create(empty(), pat());
    const plan = planPattern(s, pat({ aircraftId: "4L-PXC" }), pat(), { permits: false });
    expect([plan.inserted, plan.removed]).toEqual([12, 12]);
    expect(apply(s, plan.patch).legs.every((l) => l.aircraftId === "4L-PXC")).toBe(true);
  });
  it("saving a pattern without changes changes nothing", () => {
    const s = create(empty(), pat());
    const plan = planPattern(s, pat(), pat(), { permits: false });
    expect([plan.inserted, plan.updated, plan.removed, plan.kept, plan.unchanged]).toEqual([0, 0, 0, 0, 12]);
  });
});

describe("deleting a pattern", () => {
  it("with its legs: untouched legs go, hand-edited ones stay as ordinary legs", () => {
    const s = create(empty(), pat());
    const edited = apply(s, [{ op: "set", coll: "legs", id: "L-20261005-PHC501-TBS-A", value: { notes: "x" } }]);
    const r = planDeletePattern(edited, pat(), true);
    expect([r.removed, r.kept]).toEqual([11, 1]);
    const next = apply(edited, r.patch);
    expect(next.patterns).toHaveLength(0);
    expect(next.legs).toHaveLength(1);
    expect(next.legs[0].source.kind).toBe("manual");
  });
  it("keeping the legs turns them all into ordinary legs", () => {
    const s = create(empty(), pat());
    const r = planDeletePattern(s, pat(), false);
    expect([r.removed, r.kept]).toEqual([0, 12]);
    const next = apply(s, r.patch);
    expect(next.legs).toHaveLength(12);
    expect(next.legs.every((l) => l.source.kind === "manual" && !l.source.patternId)).toBe(true);
  });
});

describe("validatePattern", () => {
  const s = empty();
  it("a good pattern has no problems", () => {
    expect(validatePattern(s, pat(), [])).toEqual([]);
  });
  it("lists every problem", () => {
    const bad = pat({
      name: " ",
      aircraftId: "nope",
      days: [],
      to: "2026-01-01",
      legs: [{ flightNumber: "x", suffix: "", legType: "landing", depIcao: "ZZZZ", arrIcao: "ZZZZ", dayOffset: 9, etdMin: 2000, blockMin: 0, notes: "" }],
    });
    const fields = validatePattern(s, bad, []).map((p) => p.field);
    expect(fields).toEqual(expect.arrayContaining(["name", "aircraft", "days", "to", "leg0.flight", "leg0.dep", "leg0.eta", "leg0.etd", "leg0.day"]));
  });
  it("names must be unique, legs must exist, and the size is limited", () => {
    expect(validatePattern(s, pat({ id: "PT-9" }), [pat()]).map((p) => p.field)).toContain("name");
    expect(validatePattern(s, pat({ legs: [] }), []).map((p) => p.field)).toContain("legs");
    expect(validatePattern(s, pat({ days: [1, 2, 3, 4, 5, 6, 7], from: "2026-01-01", to: "2027-12-31", legs: Array(10).fill(pat().legs[0]) }), []).map((p) => p.message).join(" ")).toMatch(/limit|two years/);
    expect(validatePattern(s, pat({ days: [2], from: "2026-10-05", to: "2026-10-05" }), []).map((p) => p.field)).toContain("days");
  });
});

describe("naming and describing", () => {
  it("next ids follow the highest one", () => {
    expect(nextPatternId([])).toBe("PT-1");
    expect(nextPatternId([pat({ id: "PT-4" }), pat({ id: "PT-2" })])).toBe("PT-5");
  });
  it("describes a pattern in one line", () => {
    expect(describePattern(pat(), empty())).toBe("Mon Wed every week, 2026-10-05 to 2026-10-25: PHC501 TBS-BEG 03:30Z, PHC502 BEG-TBS 08:00Z");
    expect(describePattern(pat({ basis: "local", everyWeeks: 2 }), empty())).toMatch(/every 2 weeks.*03:30 LT/);
  });
  it("stats count legs, hand changes and missing legs", () => {
    const s = create(empty(), pat());
    expect(patternStats(s, pat())).toEqual({ legs: 12, changed: 0, missing: 0 });
    const edited = apply(s, [
      { op: "set", coll: "legs", id: "L-20261005-PHC501-TBS-A", value: { notes: "x" } },
      { op: "remove", coll: "legs", id: "L-20261007-PHC501-TBS-A" },
    ]);
    expect(patternStats(edited, pat())).toEqual({ legs: 11, changed: 1, missing: 1 });
  });
});

describe("finding patterns in the demo schedule", () => {
  const s = demo();
  const found = detectPatterns(s);

  it("finds weekly rotations and covers most of the legs", () => {
    expect(found.length).toBeGreaterThanOrEqual(10);
    const covered = new Set(found.flatMap((d) => d.legIds));
    expect(covered.size).toBeGreaterThan(60);
    expect(covered.size).toBeLessThan(s.legs.length);
  });
  it("no leg is in two proposals", () => {
    const all = found.flatMap((d) => d.legIds);
    expect(new Set(all).size).toBe(all.length);
  });
  it("chains legs that follow each other on one aircraft, such as the PHC611 through flight", () => {
    const chain = found.find((d) => d.pattern.legs.some((l) => l.flightNumber === "PHC611" && l.arrIcao === "ZLXY"))!;
    expect(chain.pattern.legs.length).toBeGreaterThanOrEqual(2);
    expect(chain.pattern.legs[0].depIcao).toBe("UGTB");
  });
  it("every proposal regenerates exactly the legs it covers", () => {
    for (const d of found) {
      const ids = expandPattern(s, { ...d.pattern, id: "PT-x" }).legs.map((l) => l.id).sort();
      expect(ids).toEqual([...d.legIds].sort());
    }
  });
  it("adopting changes no leg times and leaves the schedule identical except for the pattern tag", () => {
    const adopted = apply(s, adoptPatch(s, found));
    expect(adopted.patterns).toHaveLength(found.length);
    expect(adopted.legs).toHaveLength(s.legs.length);
    for (const l of adopted.legs) {
      const before = s.legs.find((x) => x.id === l.id)!;
      expect(sameLeg(before, l)).toBe(true);
    }
    expect(adopted.legs.filter((l) => l.source.patternId).length).toBe(new Set(found.flatMap((d) => d.legIds)).size);
    expect(validateAll(adopted).issues.map((i) => i.id)).toEqual(validateAll(s).issues.map((i) => i.id));
  });
  it("after adopting, re-saving each pattern unchanged is a no-op, and a hand-cancelled leg counts as kept", () => {
    const adopted = apply(s, adoptPatch(s, found));
    for (const p of adopted.patterns) {
      const plan = planPattern(adopted, p, p, { permits: false });
      expect([plan.inserted, plan.updated, plan.removed, plan.clashes.length]).toEqual([0, 0, 0, 0]);
    }
    const cancelled = adopted.legs.find((l) => l.status === "cancelled" && l.source.patternId)!;
    const p = adopted.patterns.find((x) => x.id === cancelled.source.patternId)!;
    expect(planPattern(adopted, p, p, { permits: false }).kept).toBeGreaterThanOrEqual(1);
  });
  it("after adopting, changing a pattern's block time updates its legs and leaves the others", () => {
    const adopted = apply(s, adoptPatch(s, found));
    const p = adopted.patterns.find((x) => x.legs.length === 2)!;
    const longer: Pattern = { ...p, legs: p.legs.map((l) => ({ ...l, blockMin: l.blockMin + 15 })) };
    const plan = planPattern(adopted, longer, p, { permits: false });
    const active = adopted.legs.filter((l) => l.source.patternId === p.id && l.status === "planned").length;
    expect(plan.updated).toBe(active);
    const next = apply(adopted, plan.patch);
    const one = next.legs.find((l) => l.source.patternId === p.id && l.status === "planned")!;
    expect((Date.parse(one.etaUtc) - Date.parse(one.etdUtc)) / 60000).toBe(p.legs[0].blockMin + 15);
    expect(next.legs.filter((l) => l.source.patternId && l.source.patternId !== p.id).every((l) => sameLeg(l, adopted.legs.find((x) => x.id === l.id)!))).toBe(true);
  });
  it("legs already in a pattern are not proposed again", () => {
    const adopted = apply(s, adoptPatch(s, found));
    expect(detectPatterns(adopted)).toEqual([]);
  });
  it("two occurrences are not a pattern", () => {
    const two = { ...empty(), legs: expandPattern(empty(), pat({ days: [1], to: "2026-10-12" })).legs.map((l) => ({ ...l, source: { kind: "manual" as const } })) };
    expect(two.legs.length).toBe(4);
    expect(detectPatterns(two)).toEqual([]);
  });
  it("three weekly occurrences are", () => {
    const three = { ...empty(), legs: expandPattern(empty(), pat({ days: [1], to: "2026-10-19" })).legs.map((l) => ({ ...l, source: { kind: "manual" as const } })) };
    const d = detectPatterns(three);
    expect(d).toHaveLength(1);
    expect(d[0].pattern.legs.map((l) => l.flightNumber)).toEqual(["PHC501", "PHC502"]);
    expect(d[0].legIds).toHaveLength(6);
  });
  it("every other week is found with its step", () => {
    const biweekly = { ...empty(), legs: expandPattern(empty(), pat({ days: [2], everyWeeks: 2, from: "2026-10-06", to: "2026-11-17" })).legs.map((l) => ({ ...l, source: { kind: "manual" as const } })) };
    const d = detectPatterns(biweekly);
    expect(d).toHaveLength(1);
    expect(d[0].pattern.everyWeeks).toBe(2);
    expect(d[0].legIds).toHaveLength(8);
  });
});

describe("patterns and versions", () => {
  it("a copied version has its own copy of the patterns, edited independently", () => {
    const s = create(empty(), pat());
    const { state, id } = addVersion(s, { name: "Draft", note: "", from: "copy", createdAt: "2026-10-20T10:00:00Z" });
    const draft = switchVersion(state, id);
    expect(draft.patterns).toHaveLength(1);
    const longer = pat({ to: "2026-11-15" });
    const plan = planPattern(draft, longer, draft.patterns[0], { permits: false });
    const changed = apply(draft, plan.patch);
    expect(changed.legs.length).toBeGreaterThan(12);
    const live = switchVersion(changed, state.activeVersionId);
    expect(live.legs).toHaveLength(12);
    expect(live.patterns[0].to).toBe("2026-10-25");
  });
});

describe("flight numbers", () => {
  it("a pattern leg keeps its flight number and D suffix on the generated leg", () => {
    const p = pat({ legs: [{ ...pat().legs[0], suffix: "D" }] });
    expect(expandPattern(empty(), p).legs.every((l) => fullFlight(l) === "PHC501D")).toBe(true);
  });
});
