import { describe, expect, it } from "vitest";
import { blankForm, blockText, evaluateForm, legFromForm, normaliseFlight } from "./legform";
import { emptyState, idx } from "./testing";
import { requiredPermits } from "./permits";

const state = emptyState();
const base = { ...blankForm(state, idx, undefined, "2026-09-18"), fn: "PHC700", dep: "UGTB/TBS", arr: "VECC/CCU", etd: "19:00", eta: "01:30" };

describe("leg drawer form (S3)", () => {
  it("S3-2 ETD 19:00 and ETA 01:30 gives block 06:30 with +1", () => {
    const r = evaluateForm(base, state, idx);
    expect(r.ok).toBe(true);
    expect(blockText(r.times)).toBe("06:30");
    expect(r.times!.dayPlus).toBe(1);
    expect(r.times!.etaUtc).toBe("2026-09-19T01:30:00Z");
  });

  it("S3-3 ETA equal to ETD blocks the save with a message under the ETA field", () => {
    const r = evaluateForm({ ...base, etd: "12:00", eta: "12:00" }, state, idx);
    expect(r.ok).toBe(false);
    expect(r.errors.eta).toBe("ETA must differ from ETD");
    expect(legFromForm({ ...base, etd: "12:00", eta: "12:00" }, r, state, idx, null)).toBeNull();
  });

  it("S3-7 a prefix other than PHC warns but still saves", () => {
    const f = { ...base, fn: "CMS572" };
    const r = evaluateForm(f, state, idx);
    expect(r.warnings.fn).toBe("Prefix differs from company designator PHC");
    expect(r.ok).toBe(true);
    expect(legFromForm(f, r, state, idx, null)?.flightNumber).toBe("CMS572");
  });

  it("moves a typed trailing D to the suffix toggle", () => {
    expect(normaliseFlight("phc509d", false)).toEqual({ fn: "PHC509", dSuffix: true });
    expect(normaliseFlight("PHC509", true)).toEqual({ fn: "PHC509", dSuffix: true });
  });

  it("rejects unknown stations and identical stations", () => {
    expect(evaluateForm({ ...base, arr: "ZZZZ" }, state, idx).errors.arr).toMatch(/Unknown station/);
    expect(evaluateForm({ ...base, arr: "UGTB/TBS" }, state, idx).errors.arr).toMatch(/differ/);
  });

  it("S3-1 permits follow the route: TBS to ALA is Kazakhstan landing, ATH to TBS needs none", () => {
    expect(requiredPermits("UGTB", "UAAA", idx).map((p) => `${p.countryCode} ${p.type}`)).toEqual(["KZ landing"]);
    expect(requiredPermits("UGTB", "LGAV", idx).map((p) => `${p.countryCode} ${p.type}`)).toEqual(["GR landing"]);
    expect(requiredPermits("LGAV", "UGTB", idx)).toEqual([]);
  });

  it("builds a stable id from date, full number, departure IATA and aircraft letter", () => {
    const f = { ...base, dSuffix: true, ac: "4L-PXB" };
    const leg = legFromForm(f, evaluateForm(f, state, idx), state, idx, null)!;
    expect(leg.id).toBe("L-20260918-PHC700D-TBS-B");
    expect(leg.suffix).toBe("D");
  });
});
