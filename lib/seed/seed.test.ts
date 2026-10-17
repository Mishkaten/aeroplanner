import { describe, expect, it } from "vitest";
import { fullDemoState, emptyScheduleState } from "./index";
import { validate } from "../validate";
import { boardRows, countsFor, fleetAvailability, permitCountsByCountry, urgentRows } from "../selectors";
import { indexAirports } from "../airports";
import { dayTag, dayPlus, blockMinutes, fullFlight, throughGroups } from "../legs";
import { applyPatch } from "../patch";

const state = fullDemoState();
const issues = validate(state);
const idx = indexAirports(state.airports);

describe("seed totals (PRD 9.8)", () => {
  it("has 90 legs, 88 active, 2 cancelled", () => {
    const c = countsFor(state, issues);
    expect([c.legs, c.active, c.cancelled]).toEqual([90, 88, 2]);
  });

  it("has 32, 30 and 28 legs per week", () => {
    const wk = (from: string, to: string) => state.legs.filter((l) => l.etdUtc >= from && l.etdUtc < to).length;
    expect(wk("2026-09-14", "2026-09-21")).toBe(32);
    expect(wk("2026-09-21", "2026-09-28")).toBe(30);
    expect(wk("2026-09-28", "2026-10-05")).toBe(28);
  });

  it("has the expected active legs per aircraft", () => {
    const n = (id: string) => state.legs.filter((l) => l.aircraftId === id && l.status === "planned").length;
    expect([n("4L-PXA"), n("4L-PXB"), n("4L-PXC"), n("4L-PXD")]).toEqual([24, 26, 18, 20]);
  });

  it("has 31 flights in the next 7 days from the demo clock", () => {
    expect(countsFor(state, issues).next7Days).toBe(31);
  });

  it("has 6 through-flight groups, 6 overnight legs, 6 DAY n LT tags", () => {
    expect(throughGroups(state.legs).groups.size).toBe(6);
    const active = state.legs.filter((l) => l.status === "planned");
    expect(active.filter((l) => dayPlus(l) === 1)).toHaveLength(6);
    const tags = active.map((l) => ({ l, t: dayTag(l, idx) })).filter((x) => x.t !== null);
    expect(tags).toHaveLength(6);
    for (const { l, t } of tags) {
      if (l.flightNumber === "PHC601") expect(t).toBe(2);
      if (l.flightNumber === "PHC605") expect(t).toBe(5);
    }
  });

  it("has 85 permit rows on the board: 53 obtained, 32 pending", () => {
    const rows = boardRows(state);
    expect(rows).toHaveLength(85);
    expect(rows.filter((r) => r.permit.status === "obtained")).toHaveLength(53);
    expect(rows.filter((r) => r.permit.status === "pending")).toHaveLength(32);
    const byCountry = Object.fromEntries(permitCountsByCountry(rows).map((c) => [c.name, c.count]));
    expect(byCountry).toEqual({ Romania: 22, Serbia: 18, Kazakhstan: 12, China: 9, UAE: 8, Italy: 6, Greece: 5, Hungary: 3, India: 2 });
  });

  it("has 3 urgent permit rows: PHC501 Serbia and Romania, PHC601 Kazakhstan", () => {
    const urgent = urgentRows(boardRows(state));
    expect(urgent.map((r) => `${fullFlight(r.leg)} ${r.permit.countryCode} ${r.permit.type}`)).toEqual([
      "PHC501 RS landing",
      "PHC501 RO overflight",
      "PHC601 KZ landing",
    ]);
  });

  it("has 9 open issues: R1 1, R2 1, R3 2, R4a 2, R4b 2, R5 1 (7 errors, 2 warnings)", () => {
    const by = (r: string) => issues.filter((i) => i.ruleId === r).length;
    expect([by("R1"), by("R2"), by("R3"), by("R4a"), by("R4b"), by("R5"), by("R6")]).toEqual([1, 1, 2, 2, 2, 1, 0]);
    expect(issues).toHaveLength(9);
    expect(issues.filter((i) => i.severity === "error")).toHaveLength(7);
    expect(issues.filter((i) => i.severity === "warning")).toHaveLength(2);
    // errors first, then by date
    expect(issues.slice(0, 7).every((i) => i.severity === "error")).toBe(true);
  });

  it("has 4 fleet rows, 1 incomplete, and 14 airports", () => {
    expect(state.aircraft).toHaveLength(4);
    expect(state.aircraft.filter((a) => [a.serialNo, a.yearOfManufacture, a.mtowKg, a.cargoPayloadKg].some((v) => v === null))).toHaveLength(1);
    expect(state.airports).toHaveLength(14);
  });

  it("reads PHC613 and PHC601 as the design says", () => {
    const l613 = state.legs.find((l) => l.id === "L-20260918-PHC613-TBS-D")!;
    expect(blockMinutes(l613)).toBe(390);
    expect(dayPlus(l613)).toBe(1);
    expect(dayTag(l613, idx)).toBeNull();
  });

  it("shows fleet availability: 4L-PXB AOG on 21 and 22 Sep, 4L-PXA maintenance on 26 Sep", () => {
    const rows = fleetAvailability(state);
    expect(rows).toHaveLength(4);
    const cell = (reg: string, date: string) => rows.find((r) => r.registration === reg)!.cells.find((c) => c.date === date)!.state;
    expect(cell("4L-PXB", "2026-09-21")).toBe("aog");
    expect(cell("4L-PXB", "2026-09-22")).toBe("aog");
    expect(cell("4L-PXA", "2026-09-26")).toBe("maintenance");
    const flat = rows.flatMap((r) => r.cells.filter((c) => c.state !== "available"));
    expect(flat).toHaveLength(3);
  });

  it("gives obtained permits sequential demo numbers in ETD order", () => {
    const obtained = state.permits.filter((p) => p.status === "obtained");
    expect(obtained.every((p) => /^DEMO-[A-Z]{2}-1\d{4}$/.test(p.number!))).toBe(true);
    expect(new Set(obtained.map((p) => p.number)).size).toBe(obtained.length);
    expect(state.permits.filter((p) => p.status === "pending").every((p) => p.number === null)).toBe(true);
  });

  it("is deterministic", () => {
    expect(JSON.stringify(fullDemoState())).toBe(JSON.stringify(fullDemoState()));
  });

  it("empty schedule keeps fleet, airports, company and blocks", () => {
    const e = emptyScheduleState();
    expect([e.legs.length, e.permits.length, e.aircraft.length, e.airports.length, e.blocks.length]).toEqual([0, 0, 4, 14, 2]);
  });
});

describe("storyline B: three fixes take 9 issues to 6", () => {
  it("applies R1, R2 and R3 (AOG) fixes without creating new issues", () => {
    let s = state;
    const fixOf = (rule: string, match?: (m: string) => boolean) => {
      const i = validate(s).find((x) => x.ruleId === rule && (!match || match(x.message)))!;
      return i.fixes[0];
    };
    const f1 = fixOf("R1");
    expect(f1.label).toBe("Make the 4L-PXB leg PHC509D");
    s = applyPatch(s, f1.patch).state;
    expect(validate(s)).toHaveLength(8);

    const f2 = fixOf("R2");
    expect(f2.label).toBe("Set departure to LIPK/FRL");
    s = applyPatch(s, f2.patch).state;
    expect(validate(s)).toHaveLength(7);

    const f3 = fixOf("R3", (m) => m.startsWith("4L-PXB"));
    expect(f3.label).toBe("Reassign 2 legs to 4L-PXA");
    expect(f3.enabled).toBe(true);
    s = applyPatch(s, f3.patch).state;
    const left = validate(s);
    expect(left).toHaveLength(6);
    expect(left.map((i) => i.ruleId).sort()).toEqual(["R3", "R4a", "R4a", "R4b", "R4b", "R5"]);
  });
});
