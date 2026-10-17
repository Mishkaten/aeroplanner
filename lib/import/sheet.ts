// Reads one season sheet. Two layouts are understood:
//   1. the demo layout: dates in column A, several legs in one cell separated by line breaks;
//   2. the Camex layout: a fleet table at the top, one header cell per aircraft such as "AIRPLANE 4L-CMX B737-8FE(SF)",
//      dates in a vertically merged column B, one leg per row in a merged pair of columns, and whole-day entries
//      AOG, C-CHECK and MAINTENANCE.
// Merged ranges are read once from their top-left cell.
import type { CellStyle, FleetFound, MaintenanceDay, RawLine, SheetStructure, WorkbookResult } from "./types";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const REG_ANY = /\b([A-Z0-9]{2,3}-[A-Z]{3})\b/;
const REG_ONLY = /^[A-Z0-9]{2,3}-[A-Z]{3}$/;
const MAINT = /^(AOG|C[- ]?CHECK|MAINTENANCE)$/i;

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

export function classifyFill(argb: string | undefined): CellStyle["fill"] {
  if (!argb || argb.length < 6) return null;
  const hex = argb.slice(-6);
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if (Number.isNaN(r + g + b)) return null;
  if (r > 200 && g > 140 && b < 170 && r - b > 60 && g - b > 40 && Math.abs(r - g) < 70) return "amber";
  if (g > r + 15 && g > b + 15) return "green";
  if (r > g + 25 && r > b + 25) return "red";
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
  return String(cell.text ?? "").replace(/\r\n?/g, "\n").replace(/�/g, "");
}

const kgOf = (t: string): number | null => {
  const m = /(\d[\d.,\s]*)\s*kg/i.exec(t) ?? /^(\d[\d,\s]*)$/.exec(t.trim());
  if (!m) return null;
  const n = Number(m[1].replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

export interface ReadOptions {
  knownRegistrations: Set<string>;
  onRow?: (rowsSeen: number) => void;
}

/** The fleet table and company designators at the top of the sheet ("Aircraft ID", "ICAO Designator" ...), if there is one. */
function readFleet(ws: { rowCount: number; columnCount: number }, get: (r: number, c: number) => AnyCell, limitRow: number): FleetFound | null {
  const maxCol = Math.max(ws.columnCount, 1);
  let idRow = 0;
  for (let r = 1; r <= Math.min(limitRow, 40) && !idRow; r++)
    for (let c = 1; c <= maxCol; c++) if (/^aircraft\s*id$/i.test(cellText(get(r, c)).trim())) idRow = r;
  if (!idRow) return null;
  const col = (re: RegExp): number => {
    for (let c = 1; c <= maxCol; c++) if (re.test(cellText(get(idRow, c)).trim())) return c;
    return 0;
  };
  const cType = col(/^a\/c\s*type|^type/i);
  const cId = col(/^aircraft\s*id/i);
  const cSn = col(/\bsn\b|serial/i);
  const cYom = col(/yom|year/i);
  const cMtow = col(/mtow/i);
  const cCap = col(/capacity|payload/i);
  const cIcao = col(/icao/i);
  const cIata = col(/iata/i);
  const text = (r: number, c: number) => (c ? cellText(get(r, c)).trim() : "");

  const aircraft: FleetFound["aircraft"] = [];
  for (let r = idRow + 1; r <= Math.min(idRow + 40, limitRow); r++) {
    const reg = text(r, cId).toUpperCase();
    if (!REG_ONLY.test(reg)) break;
    const year = Number(text(r, cYom));
    aircraft.push({
      registration: reg,
      type: text(r, cType).replace(/\s+/g, " "),
      serialNo: text(r, cSn) || null,
      yearOfManufacture: Number.isInteger(year) && year > 1950 ? year : null,
      mtowKg: kgOf(text(r, cMtow)),
      cargoPayloadKg: kgOf(text(r, cCap)),
    });
  }
  if (!aircraft.length) return null;

  const first = idRow + 1;
  let name = "";
  for (let c = 1; c <= 2 && !name; c++) name = text(first, c).replace(/[“”„"«»]/g, "").replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9.)]+$/g, "").replace(/\s+/g, " ");
  return { company: { name, icao: text(first, cIcao).toUpperCase(), iata: text(first, cIata).toUpperCase() }, aircraft };
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
  const maxCol = Math.max(ws.columnCount, 1);

  // 1. aircraft header row: the first row with two or more registrations (or one, if no row has two)
  const headerCandidates: { row: number; cells: { col: number; span: number; reg: string }[] }[] = [];
  for (let r = 1; r <= Math.min(ws.rowCount, 60); r++) {
    const cells: { col: number; span: number; reg: string }[] = [];
    for (let c = 1; c <= maxCol; c++) {
      const cell = get(r, c);
      if (cell.isMerged && cell.master.address !== cell.address) continue;
      const first = cellText(cell).split("\n")[0].trim().toUpperCase();
      const m = REG_ONLY.test(first) ? [first, first] : REG_ANY.exec(first);
      if (!m) continue;
      let span = 1;
      while (c + span <= maxCol) {
        const next = get(r, c + span);
        if (next.isMerged && next.master.address === cell.address) span++;
        else break;
      }
      cells.push({ col: c, span, reg: m[1] });
    }
    if (cells.length) headerCandidates.push({ row: r, cells });
  }
  const header = headerCandidates.find((h) => h.cells.length >= 2) ?? headerCandidates[0];
  if (!header) throw new Error("No aircraft header row found. Expected registrations such as 4L-PXA or AIRPLANE 4L-CMX.");
  const headerRow = header.row;
  const headers = header.cells;
  const colReg = new Map<number, string>();
  for (const h of headers) for (let k = 0; k < h.span; k++) colReg.set(h.col + k, h.reg);
  const firstAircraftCol = Math.min(...headers.map((h) => h.col));

  const fleet = readFleet(ws, get, headerRow - 1);

  // 2. rows below the header
  const lines: RawLine[] = [];
  const maintenance: MaintenanceDay[] = [];
  let banners = 0;
  let dateLabels = 0;
  let year = sheetYear;
  let rowsSeen = headers.length;
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    // the date of the row: a real date or a label in any column left of the first aircraft
    let date: string | null = null;
    let dateHere = false;
    let bannerText = "";
    for (let c = 1; c < firstAircraftCol && !date && !bannerText; c++) {
      const cell = get(r, c);
      const src = cell.isMerged ? cell.master : cell;
      const own = !cell.isMerged || cell.master.address === cell.address;
      const t = cellText(src).trim();
      if (!t) continue;
      if (/^WEEK\s*\d/i.test(t)) {
        if (own) bannerText = t;
        continue;
      }
      const p = parseDateLabel(src.value instanceof Date ? src.value : t, year);
      if (p.looksLikeDate) {
        date = p.date;
        dateHere = own;
        if (!p.date) dateHere = own;
      }
    }
    if (bannerText) {
      banners++;
      rowsSeen++;
      const y = /(20\d{2})/.exec(bannerText);
      if (y) year = Number(y[1]);
      opts.onRow?.(rowsSeen);
      continue;
    }
    if (dateHere) {
      dateLabels++;
      rowsSeen++;
    }
    let cellsInRow = 0;
    for (let c = firstAircraftCol; c <= maxCol; c++) {
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
        const mm = MAINT.exec(p);
        if (mm && date) {
          const k = mm[1].toUpperCase();
          maintenance.push({ aircraftReg: reg, date, kind: k === "AOG" ? "aog" : k.startsWith("C") ? "c_check" : "maintenance", cell: address });
          cellsInRow++;
          rowsSeen++;
          return;
        }
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
    rows: headers.length + banners + dateLabels + lines.length + maintenance.length,
  };
  const known = opts.knownRegistrations;
  return {
    fileName,
    structure,
    lines,
    maintenance,
    fleet,
    unknownAircraft: headers.map((h) => h.reg).filter((reg) => !known.has(reg)),
  };
}
