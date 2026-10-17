import { describe, expect, it } from "vitest";
import { validate, validateAll } from "./validate";
import { applyPatch } from "./patch";
import { stateWith, mkLeg, permitsFor, emptyState, type LegSpec } from "./testing";
import { fullDemoState } from "./seed";
import { buildTimes, parseHHMM, fmtDuration } from "./time";
import { countsFor } from "./selectors";
import { blockMinutes, dayPlus } from "./legs";
import type { DomainState, MaintenanceBlock } from "./types";

const seed = fullDemoState();
const rule = (s: DomainState, r: string) => validate(s).filter((i) => i.ruleId === r);

const leg = (flight: string, ac: string, dep: string, arr: string, date: string, etd: string, eta: string, extra: Partial<LegSpec> = {}): LegSpec => ({
  flight, ac, dep, arr, date, etd, eta, ...extra,
});

describe("R1 flight number conflict", () => {
  it("T-R1-1 same number on two aircraft the same date is an error naming both legs", () => {
    const s = stateWith([leg("PHC509", "A", "TBS", "OTP", "2026-09-18", "05:00", "07:30"), leg("PHC509", "B", "TBS", "OTP", "2026-09-18", "06:00", "08:30")]);
    const r1 = rule(s, "R1");
    expect(r1).toHaveLength(1);
    expect(r1[0].legIds).toHaveLength(2);
    expect(r1[0].fixes[0].label).toBe("Make the 4L-PXB leg PHC509D");
  });
  it("T-R1-2 PHC507 and PHC507D never share a group", () => {
    const s = stateWith([leg("PHC507", "A", "TBS", "ATH", "2026-09-16", "04:00", "07:00"), leg("PHC507D", "B", "TBS", "ATH", "2026-09-16", "04:00", "07:00")]);
    expect(rule(s, "R1")).toHaveLength(0);
  });
  it("T-R1-3 legs of one aircraft never conflict", () => {
    const s = stateWith([leg("PHC611", "C", "TBS", "URC", "2026-09-16", "02:00", "07:30"), leg("PHC611", "C", "URC", "XIY", "2026-09-16", "09:30", "12:30")]);
    expect(rule(s, "R1")).toHaveLength(0);
  });
  it("T-R1-4 chain with an aircraft change is exempt", () => {
    const s = stateWith([leg("PHC611", "C", "TBS", "URC", "2026-09-16", "02:00", "07:30"), leg("PHC611", "D", "URC", "XIY", "2026-09-16", "09:30", "12:30")]);
    expect(rule(s, "R1")).toHaveLength(0);
    expect(validateAll(s).exemptions.some((e) => e.kind === "chain")).toBe(true);
  });
  it("T-R1-5 not a chain is an error", () => {
    const s = stateWith([leg("PHC611", "C", "TBS", "URC", "2026-09-16", "02:00", "07:30"), leg("PHC611", "D", "TBS", "XIY", "2026-09-16", "09:30", "12:30")]);
    expect(rule(s, "R1")).toHaveLength(1);
  });
  it("T-R1-6 PHC509D on both aircraft is an error and the D fix is disabled with a reason", () => {
    const s = stateWith([leg("PHC509D", "A", "TBS", "OTP", "2026-09-18", "05:00", "07:30"), leg("PHC509D", "B", "TBS", "OTP", "2026-09-18", "06:00", "08:30")]);
    const r1 = rule(s, "R1");
    expect(r1).toHaveLength(1);
    expect(r1[0].fixes[0].enabled).toBe(false);
    expect(r1[0].fixes[0].disabledReason).toMatch(/already/);
  });
  it("T-R1-7 different dates do not conflict", () => {
    const s = stateWith([leg("PHC509", "A", "TBS", "OTP", "2026-09-18", "05:00", "07:30"), leg("PHC509", "B", "TBS", "OTP", "2026-09-19", "06:00", "08:30")]);
    expect(rule(s, "R1")).toHaveLength(0);
  });
  it("T-R1-8 a cancelled duplicate is ignored", () => {
    const s = stateWith([leg("PHC509", "A", "TBS", "OTP", "2026-09-18", "05:00", "07:30"), leg("PHC509", "B", "TBS", "OTP", "2026-09-18", "06:00", "08:30", { cnl: true })]);
    expect(rule(s, "R1")).toHaveLength(0);
  });
  it("T-R1-9 the fix on the seed removes the issue and leg reads PHC509D", () => {
    const fix = rule(seed, "R1")[0].fixes[0];
    const { state, inverse } = applyPatch(seed, fix.patch);
    expect(rule(state, "R1")).toHaveLength(0);
    expect(state.legs.find((l) => l.id === "L-20260918-PHC509-TBS-B")!.suffix).toBe("D");
    expect(validate(state)).toHaveLength(8);
    // undo
    expect(validate(applyPatch(state, inverse).state)).toHaveLength(9);
  });
  it("reports through flights and parallel flights as exemptions on the seed", () => {
    const kinds = validateAll(seed).exemptions.map((e) => `${e.kind}:${e.flight}:${e.dateUtc}`);
    expect(kinds).toContain("through:PHC611:2026-09-16");
    expect(kinds).toContain("parallel:PHC507:2026-09-16");
  });
});

describe("R2 station continuity", () => {
  it("T-R2-1 seed: PHC512 departs MXP after PHC511 arrived FRL", () => {
    const r2 = rule(seed, "R2");
    expect(r2).toHaveLength(1);
    expect(r2[0].fixes[0].label).toBe("Set departure to LIPK/FRL");
    expect(r2[0].fixes[1].label).toBe("Insert ferry leg");
    expect(r2[0].fixes[1].secondary).toBe(true);
  });
  it("T-R2-2 placeholder skips continuity", () => {
    const s = stateWith([leg("PHC901", "D", "TBS", "XXX", "2026-09-23", "08:00", "12:00", { type: "ferry" }), leg("PHC605", "D", "TBS", "ALA", "2026-09-23", "18:00", "22:30")]);
    expect(rule(s, "R2")).toHaveLength(0);
  });
  it("T-R2-3 a proper return is fine", () => {
    const s = stateWith([leg("PHC501", "A", "TBS", "BEG", "2026-09-21", "03:30", "06:30"), leg("PHC502", "A", "BEG", "TBS", "2026-09-21", "08:00", "11:00")]);
    expect(rule(s, "R2")).toHaveLength(0);
  });
  it("T-R2-5 a cancelled predecessor is skipped", () => {
    const s = stateWith([
      leg("PHC501", "A", "TBS", "BEG", "2026-09-21", "03:30", "06:30"),
      leg("PHC502", "A", "BEG", "TBS", "2026-09-21", "08:00", "11:00"),
      leg("PHC507", "A", "ATH", "TBS", "2026-09-22", "08:00", "11:00", { cnl: true }),
      leg("PHC509", "A", "TBS", "OTP", "2026-09-23", "05:00", "07:30"),
    ]);
    expect(rule(s, "R2")).toHaveLength(0);
  });
  it("T-R2-6 cancelling PHC511 re-points R2 at TBS", () => {
    const patch = [{ op: "set" as const, coll: "legs" as const, id: "L-20260917-PHC511-TBS-B", value: { status: "cancelled" } }];
    const r2 = rule(applyPatch(seed, patch).state, "R2");
    expect(r2).toHaveLength(1);
    expect(r2[0].fixes[0].label).toBe("Set departure to UGTB/TBS");
  });
  it("T-R2-7 applying the fix clears the issue, leaves hand-entered permit rows alone and adds no new issue", () => {
    const { state } = applyPatch(seed, rule(seed, "R2")[0].fixes[0].patch);
    expect(rule(state, "R2")).toHaveLength(0);
    expect(validate(state)).toHaveLength(8);
    const rows = state.permits.filter((p) => p.legId === "L-20260917-PHC512-MXP-B");
    expect(rows.map((p) => `${p.countryCode}:${p.type}`)).toEqual(["RS:overflight"]);
  });
});

describe("R3 aircraft unavailable", () => {
  it("T-R3-1 seed: AOG on 4L-PXB lists both legs", () => {
    const r3 = rule(seed, "R3").filter((i) => i.aircraftId === "4L-PXB");
    expect(r3).toHaveLength(1);
    expect(r3[0].legIds).toHaveLength(2);
  });
  it("T-R3-2 Fix A is enabled and clears R2/R3/R5 for those legs", () => {
    const issue = rule(seed, "R3").find((i) => i.aircraftId === "4L-PXB")!;
    expect(issue.fixes[0].label).toBe("Reassign 2 legs to 4L-PXA");
    expect(issue.fixes[0].enabled).toBe(true);
    const next = validate(applyPatch(seed, issue.fixes[0].patch).state);
    expect(next.filter((i) => ["R2", "R3", "R5"].includes(i.ruleId) && i.legIds.some((id) => id.includes("20260922")))).toHaveLength(0);
  });
  it("T-R3-3 C-Check on 4L-PXA: Fix A disabled with the first blocker, Fix B enabled", () => {
    const issue = rule(seed, "R3").find((i) => i.aircraftId === "4L-PXA")!;
    expect(issue.fixes[0].enabled).toBe(false);
    expect(issue.fixes[0].disabledReason).toBe("4L-PXB flies PHC515 05:00 to 08:00 on Sat 26 Sep");
    expect(issue.fixes[1].enabled).toBe(true);
    expect(issue.fixes[1].label).toBe("Cancel 2 legs (CNL)");
  });
  const aog = (end: string | null, start = "2026-09-21T20:00:00Z"): MaintenanceBlock => ({ id: "B", aircraftId: "4L-PXB", kind: "aog", startUtc: start, endUtc: end, note: "" });
  it("T-R3-4 a leg whose ETA equals the block start is fine", () => {
    const s = stateWith([leg("PHC503", "B", "TBS", "BUD", "2026-09-21", "16:30", "20:00")], { blocks: [aog("2026-09-22T10:00:00Z")] });
    expect(rule(s, "R3")).toHaveLength(0);
  });
  it("T-R3-5 overlapping the block by one minute is an issue", () => {
    const s = stateWith([leg("PHC503", "B", "TBS", "BUD", "2026-09-21", "16:30", "20:01")], { blocks: [aog("2026-09-22T10:00:00Z")] });
    expect(rule(s, "R3")).toHaveLength(1);
  });
  it("T-R3-6 cancelling the legs one by one shrinks and then removes the issue", () => {
    const issue = rule(seed, "R3").find((i) => i.aircraftId === "4L-PXB")!;
    const c = (s: DomainState, id: string) => applyPatch(s, [{ op: "set", coll: "legs", id, value: { status: "cancelled" } }]).state;
    const one = c(seed, issue.legIds[0]);
    expect(rule(one, "R3").find((i) => i.aircraftId === "4L-PXB")!.legIds).toHaveLength(1);
    expect(rule(c(one, issue.legIds[1]), "R3").find((i) => i.aircraftId === "4L-PXB")).toBeUndefined();
  });
  it("T-R3-7 setting 4L-PXC to AOG at the demo clock lists all 18 active legs", () => {
    const { state } = applyPatch(seed, [{ op: "set", coll: "aircraft", id: "4L-PXC", value: { status: "aog" } }]);
    const issue = rule(state, "R3").find((i) => i.aircraftId === "4L-PXC")!;
    expect(issue.legIds).toHaveLength(18);
  });
});

describe("R4 permit risk", () => {
  it("T-R4-1/2 seed: PHC501 and PHC601 are R4a errors", () => {
    const r4a = rule(seed, "R4a");
    expect(r4a).toHaveLength(2);
    expect(r4a[0].message).toContain("13.5 h");
    expect(r4a[1].message).toContain("26 h");
  });
  it("T-R4-3 obtained permits at 60 h raise nothing; T-R4-4 pending beyond 48 h raises nothing", () => {
    const s = stateWith([leg("PHC611", "C", "TBS", "URC", "2026-09-16", "02:00", "07:30")], { permits: "pending" });
    expect(rule(s, "R4a")).toHaveLength(0);
    expect(rule(s, "R4b")).toHaveLength(0);
  });
  it("T-R4-5 PHC613 India landing and UAE overflight with no rows is one R4b listing both", () => {
    const r = rule(seed, "R4b").find((i) => i.message.startsWith("PHC613"))!;
    expect(r.message).toContain("India landing");
    expect(r.message).toContain("UAE overflight");
    expect(r.severity).toBe("warning");
  });
  it("T-R4-6 PHC517 on Sun 20 Sep has one R4b", () => {
    expect(rule(seed, "R4b").filter((i) => i.message.startsWith("PHC517"))).toHaveLength(1);
  });
  it("T-R4-7 the window is inclusive: ETD exactly Tue 15 Sep 14:00Z is R4a", () => {
    const s = stateWith([leg("PHC501", "A", "TBS", "BEG", "2026-09-15", "14:00", "17:00")], { permits: "pending" });
    expect(rule(s, "R4a")).toHaveLength(1);
    const later = stateWith([leg("PHC501", "A", "TBS", "BEG", "2026-09-15", "14:01", "17:00")], { permits: "pending" });
    expect(rule(later, "R4a")).toHaveLength(0);
  });
  it("T-R4-8/9 ATH to TBS and ferry to the placeholder need nothing", () => {
    const s = stateWith([leg("PHC508", "A", "ATH", "TBS", "2026-09-14", "08:30", "11:30"), leg("PHC901", "D", "TBS", "XXX", "2026-09-14", "08:00", "12:00", { type: "ferry" })], { permits: "none" });
    expect(validate(s).filter((i) => i.ruleId.startsWith("R4"))).toHaveLength(0);
  });
  it("T-R4-10 a cancelled leg with a pending permit inside 48 h is ignored", () => {
    const s = stateWith([leg("PHC501", "A", "TBS", "BEG", "2026-09-14", "03:30", "06:30", { cnl: true })], { permits: "pending" });
    expect(rule(s, "R4a")).toHaveLength(0);
  });
  it("T-R4-11 the fix marks permits obtained with number empty", () => {
    const issue = rule(seed, "R4a")[0];
    expect(issue.fixes[0].label).toBe("Mark 2 permits obtained");
    const { state } = applyPatch(seed, issue.fixes[0].patch);
    expect(rule(state, "R4a")).toHaveLength(1);
    const rows = state.permits.filter((p) => p.legId === issue.legIds[0]);
    expect(rows.every((p) => p.status === "obtained" && p.number === null)).toBe(true);
  });
  it("R4b fix adds pending rows and clears the warning", () => {
    const issue = rule(seed, "R4b")[0];
    expect(issue.fixes[0].label).toMatch(/^Add \d+ pending permit rows?$/);
    expect(rule(applyPatch(seed, issue.fixes[0].patch).state, "R4b")).toHaveLength(1);
  });
});

describe("R5 overlapping legs", () => {
  it("T-R5-1 seed: PHC510 departs 07:00, before PHC509 arrives 07:30; fix moves it to 08:30", () => {
    const r5 = rule(seed, "R5");
    expect(r5).toHaveLength(1);
    expect(r5[0].fixes[0].label).toBe("Move PHC510 to depart 08:30");
    const { state } = applyPatch(seed, r5[0].fixes[0].patch);
    const l = state.legs.find((x) => x.id === "L-20260925-PHC510-OTP-A")!;
    expect([l.etdUtc, l.etaUtc]).toEqual(["2026-09-25T08:30:00Z", "2026-09-25T11:00:00Z"]);
    expect(validate(state)).toHaveLength(8);
  });
  it("T-R5-2/3 touching is allowed, one minute earlier is an error", () => {
    const touching = stateWith([leg("PHC509", "A", "TBS", "OTP", "2026-09-25", "05:00", "07:30"), leg("PHC510", "A", "OTP", "TBS", "2026-09-25", "07:30", "10:00")]);
    expect(rule(touching, "R5")).toHaveLength(0);
    const early = stateWith([leg("PHC509", "A", "TBS", "OTP", "2026-09-25", "05:00", "07:30"), leg("PHC510", "A", "OTP", "TBS", "2026-09-25", "07:29", "10:00")]);
    expect(rule(early, "R5")).toHaveLength(1);
  });
  it("T-R5-4 two aircraft with identical times do not overlap", () => {
    const s = stateWith([leg("PHC509", "A", "TBS", "OTP", "2026-09-25", "05:00", "07:30"), leg("PHC520", "B", "TBS", "OTP", "2026-09-25", "05:00", "07:30")]);
    expect(rule(s, "R5")).toHaveLength(0);
  });
  it("T-R5-6 a cancelled overlapping leg is ignored", () => {
    const s = stateWith([leg("PHC509", "A", "TBS", "OTP", "2026-09-25", "05:00", "07:30"), leg("PHC510", "A", "OTP", "TBS", "2026-09-25", "07:00", "09:30", { cnl: true })]);
    expect(rule(s, "R5")).toHaveLength(0);
  });
  it("T-R5-7 overnight leg against a leg on the next date", () => {
    const s = stateWith([leg("PHC613", "D", "TBS", "CCU", "2026-09-25", "23:00", "01:00"), leg("PHC614", "D", "CCU", "TBS", "2026-09-26", "00:30", "03:00")]);
    expect(rule(s, "R5")).toHaveLength(1);
  });
});

describe("R6 block time across midnight", () => {
  const t = (etd: string, eta: string) => buildTimes("2026-09-16", parseHHMM(etd)!, parseHHMM(eta)!);
  it("T-R6-1..4", () => {
    expect([t("03:30", "06:30").blockMinutes, fmtDuration(t("03:30", "06:30").blockMinutes), t("03:30", "06:30").dayPlus]).toEqual([180, "03:00", 0]);
    expect([t("19:00", "01:30").blockMinutes, fmtDuration(t("19:00", "01:30").blockMinutes), t("19:00", "01:30").dayPlus]).toEqual([390, "06:30", 1]);
    expect([t("23:30", "00:45").blockMinutes, t("23:30", "00:45").dayPlus]).toEqual([75, 1]);
    expect([t("23:59", "00:00").blockMinutes, fmtDuration(t("23:59", "00:00").blockMinutes)]).toEqual([1, "00:01"]);
  });
  it("T-R6-5 ETA equals ETD is invalid", () => {
    const r = t("12:00", "12:00");
    expect(r.valid).toBe(false);
    expect(r.error).toBe("ETA must differ from ETD");
  });
  it("T-R6-6 00:00 to 23:59 is valid with an 18 h warning", () => {
    const r = t("00:00", "23:59");
    expect([r.blockMinutes, r.valid, r.warning]).toEqual([1439, true, "Block time is longer than 18 h"]);
    const s = stateWith([leg("PHC999", "A", "TBS", "BEG", "2026-09-30", "00:00", "23:59")]);
    expect(rule(s, "R6")[0].severity).toBe("warning");
  });
  it("T-R6-7 moving the ETD date by a day moves the ETA with it", () => {
    const a = buildTimes("2026-09-16", 19 * 60, 90);
    const b = buildTimes("2026-09-17", 19 * 60, 90);
    expect(Date.parse(b.etaUtc) - Date.parse(a.etaUtc)).toBe(86_400_000);
    expect(b.blockMinutes).toBe(a.blockMinutes);
  });
  it("T-R6-8 ETD 10:00 with ETA edited to 09:00 reads as next day: 1380 min, (+1), warning", () => {
    const r = t("10:00", "09:00");
    expect([r.blockMinutes, r.dayPlus, r.warning]).toEqual([1380, 1, "Block time is longer than 18 h"]);
  });
  it("derives block and (+1) from stored instants", () => {
    const l = mkLeg(leg("PHC613", "D", "TBS", "CCU", "2026-09-18", "19:00", "01:30"));
    expect([blockMinutes(l), dayPlus(l)]).toEqual([390, 1]);
  });
});

describe("R7 soft cancellation", () => {
  it("T-R7-1 seed counts and the 27 Sep day reads one flight", () => {
    const c = countsFor(seed, validate(seed));
    expect(c.active).toBe(88);
    const sun = seed.legs.filter((l) => l.etdUtc.startsWith("2026-09-27") && l.status === "planned");
    expect(sun.map((l) => l.flightNumber)).toEqual(["PHC614"]);
  });
  it("T-R7-2/4 cancelling PHC503 shortens the R3 issue and restoring brings it back", () => {
    const set = (status: string) => applyPatch(seed, [{ op: "set", coll: "legs", id: "L-20260922-PHC503-TBS-B", value: { status } }]).state;
    const cancelled = set("cancelled");
    expect(rule(cancelled, "R3").find((i) => i.aircraftId === "4L-PXB")!.legIds).toHaveLength(1);
    expect(countsFor(cancelled, validate(cancelled)).active).toBe(87);
    expect(validate(set("planned"))).toHaveLength(9);
  });
  it("cancelled legs add no urgent permits", () => {
    const { state } = applyPatch(seed, [{ op: "set", coll: "legs", id: "L-20260914-PHC501-TBS-A", value: { status: "cancelled" } }]);
    expect(countsFor(state, validate(state)).urgentPermits).toBe(1);
  });
});

describe("engine", () => {
  it("runs 1,000 legs in well under 100 ms", () => {
    const s = fullDemoState({ stressLegs: 1000 });
    expect(s.legs).toHaveLength(1000);
    validate(s); // warm up
    const t0 = performance.now();
    validate(s);
    expect(performance.now() - t0).toBeLessThan(100);
  });
  it("keeps issue ids stable across recomputation", () => {
    expect(validate(seed).map((i) => i.id)).toEqual(validate(structuredClone(seed)).map((i) => i.id));
    expect(validate(seed)[0].id).toMatch(/^R\d[ab]?:/);
  });
  it("an empty state has no issues", () => {
    expect(validate(emptyState())).toEqual([]);
  });
  it("permitsFor is consistent with the route table", () => {
    const l = mkLeg(leg("PHC613", "D", "TBS", "CCU", "2026-09-18", "19:00", "01:30"));
    expect(permitsFor(l).map((p) => `${p.countryCode}:${p.type}`)).toEqual(["IN:landing", "AE:overflight"]);
  });
});
