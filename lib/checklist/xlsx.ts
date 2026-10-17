import type { Workbook } from "exceljs";
import type { ChecklistModel } from "./model";

const HEAD_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF0EB" } } as const;
const THIN = { style: "thin", color: { argb: "FFC9CFC6" } } as const;
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };

/** Pure workbook builder. Times are real Excel times (hh:mm), dates are real dates. */
export async function buildWorkbook(m: ChecklistModel): Promise<Workbook> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "Phasis Air Cargo (demo)";
  wb.title = `${m.header.title} ${m.header.dateSpan}`;

  const ws = wb.addWorksheet("Checklist", {
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [{ width: 14 }, { width: 14 }, { width: 18 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 10 }, { width: 12 }, { width: 10 }, { width: 18 }];
  const merge = (row: number, text: string, opts: { bold?: boolean; size?: number } = {}) => {
    ws.mergeCells(row, 1, row, 10);
    const c = ws.getCell(row, 1);
    c.value = text;
    c.font = { bold: opts.bold, size: opts.size ?? 11 };
  };

  merge(1, m.header.legalName, { bold: true, size: 14 });
  merge(2, m.header.idLine);
  merge(3, m.header.text);
  merge(4, `${m.header.title}   ${m.header.dateSpan}`, { bold: true, size: 12 });
  const headerRows = 4;

  const label = (row: number, text: string) => {
    ws.mergeCells(row, 1, row, 10);
    ws.getCell(row, 1).value = text.toUpperCase();
    ws.getCell(row, 1).font = { bold: true, size: 9, color: { argb: "FF46525F" } };
  };
  const headRow = (row: number, titles: string[]) => {
    titles.forEach((t, i) => {
      const c = ws.getCell(row, i + 1);
      c.value = t;
      c.font = { bold: true };
      c.fill = HEAD_FILL;
      c.border = BORDER;
    });
  };

  let r = headerRows + 2;
  label(r++, "Aircraft");
  headRow(r++, ["Role", "Registration", "Type", "Serial no.", "Year", "MTOW", "Payload"]);
  for (const a of m.aircraft) {
    [a.role, a.registration, a.type, a.serialNo, a.year, a.mtow, a.payload].forEach((v, i) => {
      const c = ws.getCell(r, i + 1);
      c.value = v;
      c.border = BORDER;
    });
    r++;
  }

  r++;
  label(r++, "Legs");
  headRow(r++, ["Flight", "Aircraft", "Route", "Date", "ETD (UTC)", "ETA (UTC)", "ETA day", "Local day", "Block", "Type"]);
  const day = 86_400_000;
  for (const l of m.legs) {
    const cells: (string | number | Date)[] = [
      l.flight,
      l.aircraft,
      l.route,
      new Date(`${l.dateIso}T00:00:00Z`),
      (l.etdMs - Date.parse(`${l.dateIso}T00:00:00Z`)) / day,
      (((l.etaMs % day) + day) % day) / day,
      l.etaPlus ? "+1" : "",
      l.dayTag ?? "",
      l.blockMinutes / 1440,
      l.type,
    ];
    cells.forEach((v, i) => {
      const c = ws.getCell(r, i + 1);
      c.value = v;
      c.border = BORDER;
    });
    ws.getCell(r, 4).numFmt = "dd mmm yyyy";
    ws.getCell(r, 5).numFmt = "hh:mm";
    ws.getCell(r, 6).numFmt = "hh:mm";
    ws.getCell(r, 9).numFmt = "hh:mm";
    r++;
  }

  r++;
  label(r++, "Special notes");
  for (const n of m.notes) {
    ws.mergeCells(r, 1, r, 10);
    ws.getCell(r, 1).value = n;
    r++;
  }
  r++;
  ws.getCell(r, 1).value = m.footer.text;
  ws.getCell(r + 1, 1).value = m.footer.generated;
  ws.getCell(r, 1).font = ws.getCell(r + 1, 1).font = { size: 9, color: { argb: "FF46525F" } };
  ws.views = [{ state: "frozen", ySplit: headerRows }];

  const wp = wb.addWorksheet("Permits", {
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: "frozen", ySplit: 1 }],
  });
  wp.columns = [{ width: 16 }, { width: 14 }, { width: 12 }, { width: 18 }, { width: 14 }, { width: 18 }];
  ["Country", "Permit", "Flight", "Number", "Status", "Valid"].forEach((t, i) => {
    const c = wp.getCell(1, i + 1);
    c.value = t;
    c.font = { bold: true };
    c.fill = HEAD_FILL;
    c.border = BORDER;
  });
  m.permits.forEach((p, i) => {
    [p.country, p.permit, p.flight, p.number, p.status, p.valid].forEach((v, j) => {
      const c = wp.getCell(i + 2, j + 1);
      c.value = v;
      c.border = BORDER;
    });
  });
  return wb;
}

export async function buildXlsx(m: ChecklistModel, onProgress: (pct: number) => void): Promise<Blob> {
  onProgress(15);
  const wb = await buildWorkbook(m);
  onProgress(70);
  const buf = await wb.xlsx.writeBuffer();
  onProgress(100);
  return new Blob([buf as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
