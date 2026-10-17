// Reads one season sheet (PRD 7.1): aircraft header row, week banners, date labels in column A and grid cells
// holding one leg line per line break. Merged ranges are read once from their top-left cell.
import type { CellStyle, RawLine, SheetStructure, WorkbookResult } from "./types";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const REG = /^[A-Z0-9]{2,3}-[A-Z]{3}$/;

export function colLetter(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

const iso = (y: number, m: number, d: number): string | null => {
  const t = Date.UTC(y, m - 1, d);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
};

/** "Mon 14.09", "14/09/2026", "14 Sep" or a real Excel date. The year comes from the banner or the sheet name. */
export function parseDateLabel(value: unknown, year: number | null): { date: string | null; looksLikeDate: boolean } {
  if (value instanceof Date) return { date: value.toISOString().slice(0, 10), looksLikeDate: true };
  const t = String(value ?? "")
    .replace(/ /g, " ")
    .trim();
  if (!t) return { date: null, looksLikeDate: false };
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return { date: iso(+m[1], +m[2], +m[3]), looksLikeDate: true };
  m = /(\d{1,2})\s*[/.]\s*(\d{1,2})\s*[/.]\s*(\d{4})/.exec(t);
  if (m) return { date: iso(+m[3], +m[2], +m[1]), looksLikeDate: true };
  m = /(\d{1,2})\s*[/.]\s*(\d{1,2})(?!\d)/.exec(t);
  if (m) return { date: year ? iso(year, +m[2], +m[1]) : null, looksLikeDate: true };
  m = /(\d{1,2})\s*([A-Za-z]{3,})/.exec(t);
  if (m) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (mi >= 0) return { date: year ? iso(year, mi + 1, +m[1]) : null, looksLikeDate: true };
  }
  return { date: null, looksLikeDate: false };
}

interface ARGB {
  r: number;
  g: number;
  b: number;
}

export function classifyFill(argb: string | undefined): CellStyle["fill"] {
  if (!argb || argb.length < 6) return null;
  const hex = argb.slice(-6);
  const c: ARGB = { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
  if (Number.isNaN(c.r + c.g + c.b)) return null;
  if (c.r > 200 && c.g > 140 && c.b < 170 && c.r - c.b > 60 && c.g - c.b > 40 && Math.abs(c.r - c.g) < 70) return "amber";
  if (c.g > c.r + 15 && c.g > c.b + 15) return "green";
  if (c.r > c.g + 25 && c.r > c.b + 25) return "red";
  return null;
}

type AnyCell = {
  address: string;
  row: number;
  col: number;
  value: unknown;
  text: string;
  isMerged: boolean;
  master: AnyCell;
  fill?: { type?: string; pattern?: string; fgColor?: { argb?: string } };
  font?: { strike?: boolean };
};

function styleOf(cell: AnyCell): CellStyle {
  const f = cell.fill;
  const fill = f && f.type === "pattern" && f.pattern === "solid" ? classifyFill(f.fgColor?.argb) : null;
  let strike = !!cell.font?.strike;
  const v = cell.value as { richText?: { font?: { strike?: boolean }; text: string }[] } | null;
  if (v && typeof v === "object" && Array.isArray(v.richText) && v.richText.length) strike = v.richText.every((s) => s.font?.strike);
  return { fill, strike };
}

function cellText(cell: AnyCell): string {
  const v = cell.value;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(cell.text ?? "").replace(/\r\n?/g, "\n");
}

export interface ReadOptions {
  knownRegistrations: Set<string>;
  onRow?: (rowsSeen: number) => void;
}

export async function readWorkbook(data: ArrayBuffer | Uint8Array, fileName: string, opts: ReadOptions): Promise<WorkbookResult> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as ArrayBuffer);
  const ws = wb.worksheets.find((s) => s.rowCount > 0) ?? wb.worksheets[0];
  if (!ws) throw new Error("The workbook has no sheet");
  const sheet = ws.name;
  const sheetYear = /(20\d{2})/.exec(sheet) ? Number(/(20\d{2})/.exec(sheet)![1]) : null;
  const get = (r: number, c: number) => ws.getCell(r, c) as unknown as AnyCell;

  // 1. aircraft header row: the first row holding at least one registration
  let headerRow = 0;
  const headers: { col: number; span: number; reg: string }[] = [];
  const maxCol = Math.max(ws.columnCount, 1);
  for (let r = 1; r <= ws.rowCount && !headerRow; r++) {
    for (let c = 1; c <= maxCol; c++) {
      const cell = get(r, c);
      if (cell.isMerged && cell.master.address !== cell.address) continue;
      const first = cellText(cell).split("\n")[0].trim().toUpperCase();
      if (REG.test(first)) {
        let span = 1;
        while (c + span <= maxCol) {
          const next = get(r, c + span);
          if (next.isMerged && next.master.address === cell.address) span++;
          else break;
        }
        headers.push({ col: c, span, reg: first });
        headerRow = r;
      }
    }
  }
  if (!headerRow) throw new Error("No aircraft header row found. Expected registrations such as 4L-PXA.");
  const colReg = new Map<number, string>();
  for (const h of headers) for (let k = 0; k < h.span; k++) colReg.set(h.col + k, h.reg);

  // 2. rows below the header
  const lines: RawLine[] = [];
  let banners = 0;
  let dateLabels = 0;
  let year = sheetYear;
  let rowsSeen = headers.length;
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const a = get(r, 1);
    const aText = cellText(a).trim();
    const banner = /^WEEK\s*\d/i.test(aText) || (a.isMerged && a.master.address === a.address && aText !== "" && !parseDateLabel(a.value, year).looksLikeDate);
    if (banner && aText) {
      banners++;
      rowsSeen++;
      const y = /(20\d{2})/.exec(aText);
      if (y) year = Number(y[1]);
      opts.onRow?.(rowsSeen);
      continue;
    }
    const { date, looksLikeDate } = parseDateLabel(a.value instanceof Date ? a.value : aText, year);
    if (looksLikeDate) {
      dateLabels++;
      rowsSeen++;
    }
    let cellsInRow = 0;
    for (let c = 2; c <= maxCol; c++) {
      const reg = colReg.get(c);
      if (!reg) continue;
      const cell = get(r, c);
      let src = cell;
      if (cell.isMerged && cell.master.address !== cell.address) {
        // a merged range is read once, from its top-left cell, for the leftmost aircraft only; a range
        // that spans rows applies to every date row it covers
        if (cell.master.col !== c) continue;
        src = cell.master;
      }
      const text = cellText(src);
      const parts = text.split("\n").map((s) => s.trim()).filter(Boolean);
      const style = styleOf(src);
      parts.forEach((p, i) => {
        const address = `${colLetter(c)}${r}`;
        lines.push({
          id: `${address}#${i + 1}`,
          sheet,
          cell: parts.length > 1 ? `${address} line ${i + 1}` : address,
          text: p,
          aircraftReg: reg,
          dateIso: date,
          style,
        });
        cellsInRow++;
        rowsSeen++;
      });
    }
    if (cellsInRow) opts.onRow?.(rowsSeen);
  }

  const structure: SheetStructure = {
    sheet,
    aircraftHeaders: headers.length,
    banners,
    dateLabels,
    legLines: lines.length,
    rows: headers.length + banners + dateLabels + lines.length,
  };
  return {
    fileName,
    structure,
    lines,
    unknownAircraft: headers.map((h) => h.reg).filter((reg) => !opts.knownRegistrations.has(reg)),
  };
}
