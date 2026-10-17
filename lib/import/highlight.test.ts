import { describe, expect, it } from "vitest";
import { flagRange } from "./highlight";
import { buildRow } from "./parse";
import { SAMPLE_FLAGGED } from "./sample";
import { fullDemoState } from "../seed";

const seed = fullDemoState();
const ctx = { companyIcao: "PHC", baseIcao: "UGTB", airports: seed.airports, aircraft: seed.aircraft };

describe("flag highlight", () => {
  it("marks the offending part of each of the 14 flagged cells", () => {
    for (const f of SAMPLE_FLAGGED) {
      const row = buildRow(
        { id: "x", sheet: "s", cell: "B3", text: f.raw, aircraftReg: "4L-PXA", dateIso: "2026-09-14", style: { fill: null, strike: false } },
        ctx,
      );
      const r = flagRange(row);
      expect(r, `cell ${f.n}`).not.toBeNull();
      const part = f.raw.slice(r![0], r![1]);
      expect(part.length).toBeGreaterThan(0);
      const expected: Record<string, RegExp> = {
        ETA_FOR_ETD: /^ETA\/0[58]\.00Z$/,
        DAYTAG_MISMATCH: /DAY/,
        TIME_MALFORMED: /09\.3Z/,
        TIME_OUT_OF_RANGE: /25\.00Z/,
        STATION_PAIR_MISMATCH: /BUH|MIL/,
        PREFIX_MISMATCH: /^CMS5/,
        BLOCK_ZERO: /ETA\/01\.00Z/,
        MARKER_CONFLICT: /\+ -/,
        NOTE_TIME_CONFLICT: /ETD 19\.30Z/,
        SAME_STATION: /OMDW\/DWC/,
      };
      expect(part, `cell ${f.n} ${f.code}`).toMatch(expected[f.code]);
    }
  });
});
