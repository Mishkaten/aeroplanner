import type { Workbook } from "exceljs";
import type { DomainState } from "../types";
import { sampleSheetSpec } from "./sample";

const FILL = { green: "FFC6EFCE", amber: "FFFFEB9C", red: "FFFFC7CE" } as const;

/** Writes the sample season workbook from the seed. Used by scripts/build-sample.ts and by tests. */
export async function buildSampleWorkbook(state: DomainState): Promise<Workbook> {
  const { default: ExcelJS } = await import("exceljs");
  const spec = sampleSheetSpec(state);
  const wb = new ExcelJS.Workbook();
  wb.creator = "AeroPlanner demo";
  const ws = wb.addWorksheet(spec.name);
  const n = spec.registrations.length;
  ws.columns = [{ width: 14 }, ...spec.registrations.map(() => ({ width: 58 }))];

  // title line above the grid, ignored by the parser
  ws.mergeCells(1, 1, 1, n + 1);
  ws.getCell(1, 1).value = spec.title;
  ws.getCell(1, 1).font = { bold: true, size: 13 };

  // aircraft header row: registration, then the type on a second line
  ws.getCell(2, 1).value = "Date";
  spec.registrations.forEach((r, i) => {
    const c = ws.getCell(2, i + 2);
    c.value = `${r.reg}\n${r.type}`;
    c.alignment = { wrapText: true, vertical: "middle" };
    c.font = { bold: true };
  });
  ws.getRow(2).height = 32;

  let row = 3;
  for (const week of spec.weeks) {
    ws.mergeCells(row, 1, row, n + 1);
    const b = ws.getCell(row, 1);
    b.value = week.banner;
    b.font = { bold: true };
    b.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
    row++;
    for (const day of week.days) {
      const a = ws.getCell(row, 1);
      if (typeof day.label === "string") a.value = day.label;
      else {
        a.value = new Date(`${day.label.date}T00:00:00Z`);
        a.numFmt = "ddd dd/mm/yyyy";
      }
      spec.registrations.forEach((r, i) => {
        const cell = day.cells[r.reg];
        if (!cell) return;
        const c = ws.getCell(row, i + 2);
        c.value = cell.lines.join("\n");
        c.alignment = { wrapText: true, vertical: "top" };
        if (cell.fill) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL[cell.fill] } };
      });
      ws.getRow(row).height = Math.max(18, 16 * Math.max(1, ...Object.values(day.cells).map((c) => c.lines.length)));
      row++;
    }
  }
  return wb;
}
