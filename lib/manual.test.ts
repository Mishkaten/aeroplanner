import { describe, expect, it } from "vitest";
import { draftPermitPatch } from "./permits";
import { planMove } from "./schedule";
import { applyPatch } from "./patch";
import { fullDemoState } from "./seed";
import { validate } from "./validate";

const seed = fullDemoState();

describe("permits are entered by hand", () => {
  it("lists exactly the rows the drawer holds and stores the number only for obtained permits", () => {
    const leg = seed.legs.find((l) => l.id === "L-20260914-PHC501-TBS-A")!;
    const patch = draftPermitPatch(leg, seed.permits, [
      { countryCode: "RS", type: "landing", status: "obtained", number: " RS-77 " },
      { countryCode: "HU", type: "overflight", status: "pending", number: "ignored" },
    ]);
    const rows = applyPatch(seed, patch).state.permits.filter((p) => p.legId === leg.id);
    expect(rows.map((p) => [p.countryCode, p.type, p.status, p.number])).toEqual([
      ["RS", "landing", "obtained", "RS-77"],
      ["HU", "overflight", "pending", null],
    ]);
  });
  it("a leg with no hand-entered permits is flagged by R4, not given rows silently", () => {
    const leg = seed.legs.find((l) => l.id === "L-20260918-PHC509-TBS-A")!;
    const s = applyPatch(seed, draftPermitPatch(leg, seed.permits, [])).state;
    expect(s.permits.filter((p) => p.legId === leg.id)).toHaveLength(0);
    expect(validate(s).some((i) => i.ruleId === "R4b" && i.legIds.includes(leg.id))).toBe(true);
  });
});

describe("drag a leg to another aircraft", () => {
  const leg = seed.legs.find((l) => l.id === "L-20260914-PHC502-BEG-A")!;
  it("keeps time of day and block time and takes the new aircraft's default backup", () => {
    const r = planMove(seed, leg, "4L-PXC", "2026-09-14");
    expect(r).toMatchObject({ ok: true, value: { aircraftId: "4L-PXC", backupAircraftId: "4L-PXD", etdUtc: leg.etdUtc, etaUtc: leg.etaUtc } });
  });
  it("moves to another day with the same time of day", () => {
    const r = planMove(seed, leg, "4L-PXA", "2026-09-15");
    expect(r).toMatchObject({ ok: true, value: { etdUtc: "2026-09-15T08:00:00Z", etaUtc: "2026-09-15T11:00:00Z" } });
  });
  it("is refused on an aircraft that is AOG", () => {
    const r = planMove(seed, leg, "4L-PXB", "2026-09-22");
    expect(r).toEqual({ ok: false, message: "4L-PXB is AOG until Tue 22 Sep 10:00Z" });
  });
});
