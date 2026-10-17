import { describe, expect, it } from "vitest";
import { parseWorkbook } from "./pipeline";
import { mergeMaintenance } from "./blocks";
import { acceptFix, buildRow, fieldsToLeg, rowsToPayload } from "./parse";
import { starterAirports } from "../seed/airports";
import type { ParseCtx } from "./types";

/** A small workbook in the layout of a real airline sheet: fleet table on top, "AIRPLANE <reg>" headers, merged date column, one leg per merged row. */
async function layoutWorkbook(): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.getCell("A1").value = "2026 AIRCRAFT PLANNING FORECAST";
  ws.getCell("A2").value = "ALL TIMINGS UTC";
  ["AIR COMPANY", "", "ICAO Designator", "IATA Designator", "A/C Type", "Aircraft ID", "AIRCRAFT SN", "AIRCRAFT YOM", "MTOW", "Capacity "].forEach((t, i) => (ws.getCell(3, i + 1).value = t || null));
  ws.getCell("A4").value = "�Test Air� LLC";
  ws.getCell("C4").value = "TST";
  ws.getCell("D4").value = "T7";
  ws.getCell("E4").value = "B737-8FE (SF)";
  ws.getCell("F4").value = "4L-TSA";
  ws.getCell("G4").value = 33800;
  ws.getCell("H4").value = 2004;
  ws.getCell("I4").value = "79015kg";
  ws.getCell("J4").value = "23223kg ";
  ws.getCell("E5").value = "B767-300(ER)";
  ws.getCell("F5").value = "4L-TSB";
  ws.getCell("G5").value = 25451;

  ws.getCell("A8").value = "DAY";
  ws.getCell("B8").value = "DATE";
  ws.getCell("C8").value = "AIRPLANE 4L-TSA B737-8FE(SF)";
  ws.mergeCells("C8:D8");
  ws.getCell("E8").value = "AIRPLANE 4L-TSB B767-300(ER)";
  ws.mergeCells("E8:F8");

  // 2026-09-14 is a Monday: three rows share the date cell
  ws.getCell("A9").value = { formula: 'TEXT(B9,"dddd")', result: "Monday" };
  ws.getCell("B9").value = new Date("2026-09-14T00:00:00Z");
  ws.mergeCells("B9:B11");
  const leg = (cell: string, text: string, fill?: string) => {
    const c = ws.getCell(cell);
    c.value = text;
    ws.mergeCells(`${cell}:${cell.replace("C", "D").replace("E", "F")}`);
    if (fill) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
  };
  leg("C9", "TST572D UGTB/TBS ETD/03.30Z LYBE/BEG ETA/06.30Z", "FF92D050");
  leg("C10", "TST571D LYBE/BEG ETD/ 08.00Z UGTB/TBS ETA/11.00Z  DAY 1");
  leg("E9", "TST562D UGTB/TBS ETD/22.45Z LIMC/MXP ETA/03.00(+1)");
  leg("E10", "AOG");
  leg("C11", "urc-tbs tbilisis tvirti");
  ws.getCell("A12").value = { formula: 'TEXT(B12,"dddd")', result: "Tuesday" };
  ws.getCell("B12").value = new Date("2026-09-15T00:00:00Z");
  ws.mergeCells("B12:B13");
  leg("E12", "AOG");
  leg("C12", "TST572D UGTB/TBS ETD/03.30Z LYBE/BEG ETA/06.30Z", "FFFFFF00");
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

const fleetCtx = (icao: string): ParseCtx => ({
  companyIcao: icao,
  baseIcao: "UGTB",
  dayTagMode: "ignore",
  airports: starterAirports(),
  permitRules: [],
  aircraft: [
    { id: "4L-TSA", registration: "4L-TSA", defaultBackupId: null },
    { id: "4L-TSB", registration: "4L-TSB", defaultBackupId: null },
  ],
});

describe("airline sheet layout", async () => {
  const buf = await layoutWorkbook();
  const result = await parseWorkbook(buf, "t.xlsx", fleetCtx("TST"), () => {});

  it("reads the fleet table and company designators", () => {
    expect(result.fleet?.company).toEqual({ name: "Test Air LLC", icao: "TST", iata: "T7" });
    expect(result.fleet?.aircraft).toEqual([
      { registration: "4L-TSA", type: "B737-8FE (SF)", serialNo: "33800", yearOfManufacture: 2004, mtowKg: 79015, cargoPayloadKg: 23223 },
      { registration: "4L-TSB", type: "B767-300(ER)", serialNo: "25451", yearOfManufacture: null, mtowKg: null, cargoPayloadKg: null },
    ]);
  });

  it("finds AIRPLANE headers and a vertically merged date column", () => {
    expect(result.structure.aircraftHeaders).toBe(2);
    expect(result.structure.dateLabels).toBe(2);
    const dates = result.rows.map((r) => `${r.ref.cell}:${r.ref.dateIso}`);
    expect(dates).toContain("C9:2026-09-14");
    expect(dates).toContain("C10:2026-09-14");
    expect(dates).toContain("E9:2026-09-14");
    expect(dates).toContain("C11:2026-09-14"); // third row of the merged date
    expect(dates).toContain("C12:2026-09-15");
  });

  it("reads a leg per merged row, with a bare DAY tag, (+1) and stray spaces", () => {
    const by = (cell: string) => result.rows.find((r) => r.ref.cell === cell)!;
    expect(by("C9").flag).toBeNull();
    expect(by("C10").flag).toBeNull(); // "DAY 1" without LT, tags are not checked in this mode
    const night = by("E9");
    expect(night.flag).toBeNull();
    const leg = fieldsToLeg(night, fleetCtx("TST"))!;
    expect([leg.etdUtc, leg.etaUtc]).toEqual(["2026-09-14T22:45:00Z", "2026-09-15T03:00:00Z"]);
  });

  it("flags the free-text line and turns AOG days into an unavailable period", () => {
    expect(result.rows.find((r) => r.ref.cell === "C11")?.flag?.code).toBe("UNPARSEABLE_LINE");
    expect(result.maintenance.map((m) => `${m.aircraftReg} ${m.kind} ${m.date}`)).toEqual(["4L-TSB aog 2026-09-14", "4L-TSB aog 2026-09-15"]);
    const blocks = mergeMaintenance(result.maintenance, (r) => r);
    expect(blocks).toHaveLength(1);
    expect([blocks[0].startUtc, blocks[0].endUtc]).toEqual(["2026-09-14T00:00:00Z", "2026-09-16T00:00:00Z"]);
  });

  it("reads colours: green and yellow cells set the permit state", () => {
    const rules = [{ id: "r1", aIcao: "UGTB", bIcao: "LYBE", both: false, countryCode: "RS", type: "landing" as const }];
    const ctx = { ...fleetCtx("TST"), permitRules: rules };
    const rows = result.rows.map((r) => buildRow(r.ref, ctx));
    const { permits } = rowsToPayload(rows, ctx);
    const byLeg = Object.fromEntries(permits.map((p) => [p.legId, p.status]));
    expect(Object.values(byLeg).sort()).toEqual(["obtained", "pending"]);
  });

  it("a wrong company prefix is flagged with a suggestion, and unknown aircraft are flagged until added", () => {
    const wrong = buildRow(result.rows[0].ref, fleetCtx("ABC"));
    expect(wrong.flag?.code).toBe("PREFIX_MISMATCH");
    expect(acceptFix(wrong, fleetCtx("ABC")).fields?.prefix).toBe("ABC");
    const noFleet = buildRow(result.rows[0].ref, { ...fleetCtx("TST"), aircraft: [] });
    expect(noFleet.flag?.code).toBe("AIRCRAFT_UNKNOWN");
  });
});
