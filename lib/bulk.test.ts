import { describe, expect, it } from "vitest";
import { issueDelta, parseFlight, planBulk, planSwap } from "./bulk";
import { applyPatch } from "./patch";
import { fullDemoState } from "./seed";
import { fullFlight } from "./legs";
import { ms, MIN } from "./time";

const state = fullDemoState();
const legsOf = (flight: string) => state.legs.filter((l) => fullFlight(l) === flight);

describe("parseFlight", () => {
  it("normalises case and spaces and splits a trailing D", () => {
    expect(parseFlight("phc 509 d")).toEqual({ flightNumber: "PHC509", suffix: "D" });
    expect(parseFlight("PHC1")).toEqual({ flightNumber: "PHC1", suffix: "" });
    expect(parseFlight("509")).toBeNull();
    expect(parseFlight("PHC12345")).toBeNull();
  });
});

describe("shift", () => {
  it("moves ETD and ETA together by the same minutes and keeps the block", () => {
    const legs = legsOf("PHC501");
    const plan = planBulk(state, legs, { kind: "shift", minutes: 90 });
    expect(plan.changes).toHaveLength(legs.length);
    const next = applyPatch(state, plan.patch).state;
    for (const l of legs) {
      const n = next.legs.find((x) => x.id === l.id)!;
      expect(ms(n.etdUtc) - ms(l.etdUtc)).toBe(90 * MIN);
      expect(ms(n.etaUtc) - ms(n.etdUtc)).toBe(ms(l.etaUtc) - ms(l.etdUtc));
    }
  });
  it("a shift of zero changes nothing", () => {
    expect(planBulk(state, legsOf("PHC501"), { kind: "shift", minutes: 0 }).patch).toEqual([]);
  });
});

describe("block time", () => {
  it("set: the ETA follows the ETD", () => {
    const plan = planBulk(state, legsOf("PHC501"), { kind: "block", mode: "set", minutes: 200 });
    const next = applyPatch(state, plan.patch).state;
    for (const c of plan.changes) {
      const n = next.legs.find((x) => x.id === c.legId)!;
      expect((ms(n.etaUtc) - ms(n.etdUtc)) / MIN).toBe(200);
    }
  });
  it("add: refuses a block outside 0 to 24 h per leg and says why", () => {
    const plan = planBulk(state, legsOf("PHC501"), { kind: "block", mode: "add", minutes: -10_000 });
    expect(plan.patch).toEqual([]);
    expect(plan.skipped.length).toBeGreaterThan(0);
    expect(plan.skipped[0].reason).toMatch(/block time/);
  });
});

describe("flight number and conflicts", () => {
  it("renaming one of the two PHC509 legs to PHC509D clears the R1 issue and creates none", () => {
    const [a, b] = legsOf("PHC509");
    expect([a.aircraftId, b.aircraftId].sort()).toEqual(["4L-PXA", "4L-PXB"]);
    const second = a.aircraftId === "4L-PXB" ? a : b;
    const plan = planBulk(state, [second], { kind: "flight", flight: "PHC509D" });
    expect(plan.newIssues).toEqual([]);
    expect(plan.clearedIssues).toBeGreaterThanOrEqual(1);
    const next = applyPatch(state, plan.patch).state.legs.find((l) => l.id === second.id)!;
    expect([next.flightNumber, next.suffix]).toEqual(["PHC509", "D"]);
  });
  it("an invalid flight number is skipped, not written", () => {
    const plan = planBulk(state, legsOf("PHC509"), { kind: "flight", flight: "oops" });
    expect(plan.patch).toEqual([]);
    expect(plan.skipped).toHaveLength(legsOf("PHC509").length);
  });
});

describe("aircraft and swap", () => {
  it("moving legs into the AOG window of 4L-PXB reports the new R3 issue", () => {
    const aog = state.blocks.find((b) => b.kind === "aog")!;
    const inside = state.legs.filter((l) => l.aircraftId !== aog.aircraftId && ms(l.etdUtc) >= ms(aog.startUtc) && ms(l.etaUtc) <= ms(aog.endUtc!));
    expect(inside.length).toBeGreaterThan(0);
    const plan = planBulk(state, inside, { kind: "aircraft", aircraftId: aog.aircraftId });
    expect(plan.newIssues.some((m) => m.startsWith("R3"))).toBe(true);
  });
  it("a swap exchanges the legs of two tails and leaves other tails alone", () => {
    const week = state.legs.filter((l) => l.etdUtc < "2026-09-21");
    const plan = planSwap(state, week, "4L-PXA", "4L-PXC");
    const next = applyPatch(state, plan.patch).state;
    for (const l of week) {
      const n = next.legs.find((x) => x.id === l.id)!;
      expect(n.aircraftId).toBe(l.aircraftId === "4L-PXA" ? "4L-PXC" : l.aircraftId === "4L-PXC" ? "4L-PXA" : l.aircraftId);
    }
    expect(plan.changes.length).toBe(week.filter((l) => ["4L-PXA", "4L-PXC"].includes(l.aircraftId)).length);
  });
  it("warns when the two aircraft are different types", () => {
    const a = state.aircraft.find((x) => x.type !== state.aircraft[0].type);
    if (!a) return;
    expect(planSwap(state, state.legs, state.aircraft[0].id, a.id).warning).toMatch(/is a/);
  });
});

describe("status and notes", () => {
  it("cancel then restore round-trips through the inverse patch", () => {
    const legs = legsOf("PHC501");
    const plan = planBulk(state, legs, { kind: "status", status: "cancelled" });
    const { state: next, inverse } = applyPatch(state, plan.patch);
    expect(next.legs.filter((l) => legs.some((x) => x.id === l.id)).every((l) => l.status === "cancelled")).toBe(true);
    expect(applyPatch(next, inverse).state.legs.filter((l) => legs.some((x) => x.id === l.id)).every((l) => l.status === "planned")).toBe(true);
  });
  it("append keeps the old note", () => {
    const l = state.legs.find((x) => x.notes)!;
    const plan = planBulk(state, [l], { kind: "notes", mode: "append", text: "check dock" });
    expect((plan.patch[0] as unknown as { value: { notes: string } }).value.notes).toBe(`${l.notes} check dock`);
  });
});

describe("issueDelta", () => {
  it("an empty patch costs nothing", () => {
    expect(issueDelta(state, [])).toEqual({ newIssues: [], cleared: 0 });
  });
});
