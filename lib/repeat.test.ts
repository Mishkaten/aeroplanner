import { describe, expect, it } from "vitest";
import { planRepeatWeek, sourceWeekLegs, type RepeatOptions } from "./repeat";
import { planPattern } from "./patterns";
import { applyPatch } from "./patch";
import { emptyScheduleState, fullDemoState } from "./seed";
import { fullFlight } from "./legs";
import type { DomainState, Pattern, StatePatch } from "./types";

const apply = (s: DomainState, patch: StatePatch) => applyPatch(s, patch).state;
const opts = (o: Partial<RepeatOptions> = {}): RepeatOptions => ({ week: "2026-10-05", weeks: 1, basis: "utc", includeCancelled: false, permits: false, aircraftId: null, ...o });

const pat: Pattern = {
  id: "PT-1",
  name: "x",
  aircraftId: "4L-PXA",
  backupAircraftId: null,
  basis: "utc",
  everyWeeks: 1,
  days: [1, 3],
  from: "2026-10-05",
  to: "2026-10-11",
  legs: [
    { flightNumber: "PHC501", suffix: "", legType: "landing", depIcao: "UGTB", arrIcao: "LYBE", dayOffset: 0, etdMin: 210, blockMin: 180, notes: "n" },
    { flightNumber: "PHC502", suffix: "", legType: "landing", depIcao: "LYBE", arrIcao: "UGTB", dayOffset: 0, etdMin: 480, blockMin: 180, notes: "" },
  ],
};
const week1 = () => {
  const s = emptyScheduleState();
  return apply(s, planPattern(s, pat, null, { permits: false }).patch);
};

describe("source week", () => {
  it("takes the legs whose departure is in the Monday to Sunday week of any date given", () => {
    const s = week1();
    expect(sourceWeekLegs(s, opts({ week: "2026-10-09" }))).toHaveLength(4);
    expect(sourceWeekLegs(s, opts({ week: "2026-10-12" }))).toHaveLength(0);
  });
  it("leaves out cancelled legs unless asked, and can be limited to one aircraft", () => {
    const s = apply(week1(), [{ op: "set", coll: "legs", id: "L-20261007-PHC501-TBS-A", value: { status: "cancelled" } }]);
    expect(sourceWeekLegs(s, opts())).toHaveLength(3);
    expect(sourceWeekLegs(s, opts({ includeCancelled: true }))).toHaveLength(4);
    expect(sourceWeekLegs(s, opts({ aircraftId: "4L-PXB" }))).toHaveLength(0);
  });
});

describe("repeating", () => {
  it("copies each leg one week later, same UTC time, same block, as ordinary planned legs", () => {
    const s = week1();
    const plan = planRepeatWeek(s, opts({ weeks: 2 }));
    expect([plan.sourceLegs, plan.inserted, plan.existing]).toEqual([4, 8, 0]);
    const next = apply(s, plan.patch);
    const copy = next.legs.find((l) => l.id === "L-20261012-PHC501-TBS-A")!;
    expect(copy).toMatchObject({ etdUtc: "2026-10-12T03:30:00Z", etaUtc: "2026-10-12T06:30:00Z", status: "planned", notes: "n", source: { kind: "copy" } });
    expect(next.legs.find((l) => l.id === "L-20261021-PHC502-BEG-A")!.etdUtc).toBe("2026-10-21T08:00:00Z");
    expect([plan.firstDate, plan.lastDate]).toEqual(["2026-10-12", "2026-10-21"]);
  });
  it("running it twice adds nothing the second time", () => {
    const s = week1();
    const once = apply(s, planRepeatWeek(s, opts({ weeks: 2 })).patch);
    const again = planRepeatWeek(once, opts({ weeks: 2 }));
    expect([again.inserted, again.existing]).toEqual([0, 8]);
  });
  it("a copy of a cancelled leg comes back as planned", () => {
    const s = apply(week1(), [{ op: "set", coll: "legs", id: "L-20261007-PHC501-TBS-A", value: { status: "cancelled" } }]);
    const plan = planRepeatWeek(s, opts({ includeCancelled: true }));
    const next = apply(s, plan.patch);
    expect(next.legs.find((l) => l.id === "L-20261014-PHC501-TBS-A")!.status).toBe("planned");
  });
  it("local basis keeps the local time across the daylight saving change (25 Oct 2026)", () => {
    const s = emptyScheduleState();
    const p: Pattern = { ...pat, from: "2026-10-19", to: "2026-10-19", days: [1], legs: [pat.legs[1]] };
    const base = apply(s, planPattern(s, p, null, { permits: false }).patch);
    const local = apply(base, planRepeatWeek(base, opts({ week: "2026-10-19", basis: "local" })).patch);
    const utc = apply(base, planRepeatWeek(base, opts({ week: "2026-10-19", basis: "utc" })).patch);
    expect(local.legs.find((l) => l.etdUtc.startsWith("2026-10-26"))!.etdUtc).toBe("2026-10-26T09:00:00Z");
    expect(utc.legs.find((l) => l.etdUtc.startsWith("2026-10-26"))!.etdUtc).toBe("2026-10-26T08:00:00Z");
  });
  it("copies the permit rows as pending when asked", () => {
    const s = fullDemoState();
    const plan = planRepeatWeek(s, opts({ week: "2026-09-14", weeks: 4, permits: true }));
    const next = apply(s, plan.patch);
    const added = next.permits.filter((p) => !s.permits.some((x) => x.id === p.id));
    expect(plan.inserted).toBeGreaterThan(0);
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((p) => p.status === "pending" && next.legs.some((l) => l.id === p.legId))).toBe(true);
    expect(planRepeatWeek(s, opts({ week: "2026-09-14", weeks: 4, permits: false })).patch.some((o) => o.coll === "permits")).toBe(false);
  });
  it("reports the issues the copies create", () => {
    const s = fullDemoState();
    const plan = planRepeatWeek(s, opts({ week: "2026-09-14", weeks: 1 }));
    expect(plan.inserted + plan.existing).toBe(plan.sourceLegs);
    expect(Array.isArray(plan.newIssues)).toBe(true);
  });
  it("refuses a request that would create too many legs", () => {
    const s = fullDemoState();
    const plan = planRepeatWeek(s, opts({ week: "2026-09-14", weeks: 52 }));
    if (plan.sourceLegs * 52 > 3000) {
      expect(plan.inserted).toBe(0);
      expect(plan.warnings[0]).toMatch(/limit/);
    } else expect(plan.inserted + plan.existing).toBe(plan.sourceLegs * 52);
  });
  it("zero weeks or an empty week creates nothing", () => {
    expect(planRepeatWeek(week1(), opts({ weeks: 0 })).patch).toEqual([]);
    expect(planRepeatWeek(week1(), opts({ week: "2027-03-01" })).patch).toEqual([]);
  });
  it("the demo week keeps its flight numbers", () => {
    const s = fullDemoState();
    const plan = planRepeatWeek(s, opts({ week: "2026-09-14", weeks: 5 }));
    const next = apply(s, plan.patch);
    const added = next.legs.filter((l) => !s.legs.some((x) => x.id === l.id));
    expect(added.length).toBe(plan.inserted);
    expect(added.every((l) => fullFlight(l).startsWith("PHC"))).toBe(true);
  });
});
