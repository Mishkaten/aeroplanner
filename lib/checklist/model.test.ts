import { describe, expect, it } from "vitest";
import { buildChecklistModel, checklistFileBase, dateSpan, modelText } from "./model";
import { fullDemoState } from "../seed";
import { applyPatch } from "../patch";

const state = fullDemoState();
const ids = (...x: string[]) => x;
const X1 = ids("L-20260916-PHC611-TBS-C", "L-20260916-PHC611-URC-C", "L-20260917-PHC612-XIY-C");

describe("checklist model (PRD 8)", () => {
  it("X1 storyline C: three legs on 4L-PXC", () => {
    const m = buildChecklistModel(state, X1)!;
    expect(m.header.dateSpan).toBe("16 to 17 Sep 2026");
    expect(m.fileBase).toBe("PHC_Checklist_2026-09-16_to_2026-09-17_3legs");
    expect(m.aircraft.map((a) => `${a.role} ${a.registration}`)).toEqual(["Primary 4L-PXC", "Backup 4L-PXD"]);
    expect(m.aircraft[1].payload).toBe("Missing");
    expect(m.aircraft[0].mtow).toBe("186,880 kg");
    expect(m.legs).toHaveLength(3);
    expect(m.legs.map((l) => l.route)).toEqual(["TBS to URC", "URC to XIY", "XIY to URC"]);
    expect(m.legs[0]).toMatchObject({ date: "16 Sep", etd: "02:00", eta: "07:30", block: "05:30", type: "Landing" });
    expect(m.permits).toHaveLength(4);
    expect(m.permits.map((p) => `${p.country} ${p.permit} ${p.status}`).sort()).toEqual([
      "China Landing Obtained",
      "China Landing Obtained",
      "China Landing Obtained",
      "Kazakhstan Overflight Obtained",
    ]);
    expect(m.notes).toEqual(["PHC611: Confirm handling agent at URC"]);
    expect(m.route.points.map((p) => p.iata).sort()).toEqual(["TBS", "URC", "XIY"]);
    expect(m.route.segments).toHaveLength(3);
  });

  it("X2 one overnight leg: ETA reads 01:30 (+1), block 06:30, no record permits, primary PXD backup PXC", () => {
    const m = buildChecklistModel(state, ["L-20260918-PHC613-TBS-D"])!;
    expect(m.fileBase).toBe("PHC_Checklist_2026-09-18_1leg");
    expect(m.legs[0]).toMatchObject({ eta: "01:30", etaPlus: true, block: "06:30" });
    expect(m.permits.map((p) => `${p.country} ${p.permit} ${p.status}`)).toEqual(["India Landing No record", "UAE Overflight No record"]);
    expect(m.aircraft.map((a) => `${a.role} ${a.registration}`)).toEqual(["Primary 4L-PXD", "Backup 4L-PXC"]);
    expect(m.notes).toEqual(["PHC613: ETD 19.30Z TBC"]);
    expect(m.header.dateSpan).toBe("18 Sep 2026");
  });

  it("prints DAY n LT under the ETA where D4 applies", () => {
    const m = buildChecklistModel(state, ["L-20260914-PHC601-TBS-C"])!;
    expect(m.legs[0].dayTag).toBe("DAY 2 LT");
  });

  it("date span formats", () => {
    expect(dateSpan("2026-09-16", "2026-09-16")).toBe("16 Sep 2026");
    expect(dateSpan("2026-09-16", "2026-09-17")).toBe("16 to 17 Sep 2026");
    expect(dateSpan("2026-09-30", "2026-10-02")).toBe("30 Sep to 2 Oct 2026");
    expect(dateSpan("2026-12-30", "2027-01-02")).toBe("30 Dec 2026 to 2 Jan 2027");
  });

  it("file names follow B4", () => {
    expect(checklistFileBase("PHC", "2026-09-18", "2026-09-18", 1)).toBe("PHC_Checklist_2026-09-18_1leg");
    expect(checklistFileBase("PHC", "2026-09-16", "2026-09-17", 3)).toBe("PHC_Checklist_2026-09-16_to_2026-09-17_3legs");
  });

  it("X7 cancelled legs never reach the document", () => {
    const { state: s } = applyPatch(state, [{ op: "set", coll: "legs", id: X1[0], value: { status: "cancelled" } }]);
    expect(buildChecklistModel(s, X1)!.legs).toHaveLength(2);
    expect(buildChecklistModel(s, [X1[0]])).toBeNull();
  });

  it("reads the company profile (S9-1)", () => {
    const { company } = state;
    const s = { ...state, company: { ...company, legalName: "Test Air", checklistHeaderText: "Hello" } };
    const m = buildChecklistModel(s, X1)!;
    expect([m.header.legalName, m.header.text]).toEqual(["Test Air", "Hello"]);
    expect(m.header.idLine).toBe("ICAO PHC | IATA P7 | AOC DEMO-0001 | Base UGTB/TBS");
  });

  it("is deterministic and uses the demo clock for the timestamp", () => {
    const a = modelText(buildChecklistModel(state, X1)!);
    expect(a).toEqual(modelText(buildChecklistModel(state, X1)!));
    expect(a.some((t) => t === "Generated 13 Sep 2026 14:00Z")).toBe(true);
  });

  it("handles 40 legs", () => {
    const all = state.legs.filter((l) => l.status === "planned").slice(0, 40).map((l) => l.id);
    const m = buildChecklistModel(state, all)!;
    expect(m.legs).toHaveLength(40);
    expect(m.fileBase).toMatch(/_40legs$/);
  });
});
