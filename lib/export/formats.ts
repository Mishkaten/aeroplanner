import { fmtDuration, addDaysIso, isoWeekday } from "../time";
import { mondayOf } from "../schedule";
import type { DomainState } from "../types";
import type { ExportRow } from "./rows";

export interface ExportInput {
  state: DomainState;
  rows: ExportRow[];
  /** Creation instant, ISO. Passed in so the output is deterministic in tests. */
  createdAt: string;
}

const HEADERS = [
  "Date (UTC)",
  "Flight",
  "Aircraft",
  "Type",
  "From (ICAO)",
  "From (IATA)",
  "To (ICAO)",
  "To (IATA)",
  "ETD (UTC)",
  "ETA (UTC)",
  "ETD (local)",
  "ETA (local)",
  "Block (h:mm)",
  "ETA day",
  "Leg type",
  "Status",
  "Backup aircraft",
  "Permits",
  "Notes",
] as const;

const cells = (r: ExportRow): (string | number)[] => [
  r.date,
  r.flight,
  r.aircraft,
  r.aircraftType,
  r.depIcao,
  r.depIata,
  r.arrIcao,
  r.arrIata,
  r.etdUtc.slice(11, 16),
  r.etaUtc.slice(11, 16),
  r.etdLocal,
  r.etaLocal,
  fmtDuration(r.blockMin),
  r.dayPlus ? "+1" : "",
  r.legType,
  r.status,
  r.backupAircraft,
  r.permits,
  r.notes,
];

/** Lets a spreadsheet read a value as text instead of running it as a formula (CSV injection). */
const safe = (v: string | number): string | number => (typeof v === "string" && /^[=+\-@\t\r]/.test(v) && !/^[+-]\d/.test(v) ? `'${v}` : v);

const csvCell = (v: string | number): string => {
  const s = String(safe(v));
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** UTF-8 with a byte order mark so Excel opens it with the right characters. Comma separated, CRLF lines. */
export function buildCsv(rows: ExportRow[]): string {
  return "\uFEFF" + [HEADERS.map(csvCell).join(","), ...rows.map((r) => cells(r).map(csvCell).join(","))].join("\r\n") + "\r\n";
}

export function buildJson(inp: ExportInput): string {
  const { state, rows, createdAt } = inp;
  const c = state.company;
  return (
    JSON.stringify(
      {
        format: "aeroplanner.schedule.v1",
        createdAt,
        company: { legalName: c.legalName, icao: c.icao, iata: c.iata, base: c.baseIcao },
        legs: rows.map((r) => ({
          id: r.legId,
          flight: r.flight,
          aircraft: r.aircraft,
          aircraftType: r.aircraftType,
          legType: r.legType,
          status: r.status,
          from: { icao: r.depIcao, iata: r.depIata },
          to: { icao: r.arrIcao, iata: r.arrIata },
          etdUtc: r.etdUtc,
          etaUtc: r.etaUtc,
          blockMinutes: r.blockMin,
          backupAircraft: r.backupAircraft || null,
          permits: r.permits || null,
          notes: r.notes || null,
        })),
      },
      null,
      2,
    ) + "\n"
  );
}

// iCalendar (RFC 5545). Times are UTC, lines are folded at 75 octets, text is escaped.
const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsStamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d+/, "");
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (enc.encode(cur + ch).length > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function buildIcs(inp: ExportInput): string {
  const stamp = icsStamp(inp.createdAt);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AeroPlanner//Schedule//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const r of inp.rows) {
    const from = r.depIata || r.depIcao;
    const to = r.arrIata || r.arrIcao;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${r.legId}@aeroplanner`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsStamp(r.etdUtc)}`,
      `DTEND:${icsStamp(r.etaUtc)}`,
      `SUMMARY:${icsEscape(`${r.flight} ${from}-${to}${r.status === "cancelled" ? " (cancelled)" : ""}`)}`,
      `LOCATION:${icsEscape(`${r.depIcao} to ${r.arrIcao}`)}`,
      `DESCRIPTION:${icsEscape([`Aircraft ${r.aircraft} ${r.aircraftType}`, `Block ${fmtDuration(r.blockMin)}`, r.permits && `Permits: ${r.permits}`, r.notes].filter(Boolean).join("\n"))}`,
      `STATUS:${r.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

const HEAD_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF0EB" } } as const;

/** A flat list, one row per leg, with real dates and times so Excel can sort and filter. */
export async function buildXlsxList(inp: ExportInput): Promise<Blob> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "AeroPlanner";
  const ws = wb.addWorksheet("Schedule", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = HEADERS.map((h, i) => ({ header: h, width: [12, 10, 10, 13, 11, 11, 10, 10, 10, 10, 17, 17, 11, 8, 14, 10, 12, 40, 30][i] }));
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.eachCell((c) => (c.fill = HEAD_FILL));
  for (const r of inp.rows) {
    const row = ws.addRow(cells(r));
    row.getCell(1).value = new Date(`${r.date}T00:00:00Z`);
    row.getCell(1).numFmt = "yyyy-mm-dd";
    const time = (col: number, iso: string) => {
      row.getCell(col).value = new Date(`1899-12-30T${iso.slice(11, 16)}:00Z`);
      row.getCell(col).numFmt = "hh:mm";
    };
    time(9, r.etdUtc);
    time(10, r.etaUtc);
    for (const col of [18, 19]) row.getCell(col).alignment = { wrapText: true, vertical: "top" };
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: HEADERS.length } };
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

const hhmmDot = (iso: string) => `${iso.slice(11, 13)}.${iso.slice(14, 16)}`;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const FILL = { green: "FFC6EFCE", amber: "FFFFEB9C", red: "FFFFC7CE" } as const;

/** The text of one cell line, in the form the Excel importer reads back. */
export function gridLine(r: ExportRow, permitStatus: "obtained" | "pending" | null): string {
  let t = `${r.flight} ${r.depIcao}/${r.depIata || "XXX"} ETD/${hhmmDot(r.etdUtc)}Z ${r.arrIcao}/${r.arrIata || "XXX"} ETA/${hhmmDot(r.etaUtc)}Z`;
  if (r.dayTag !== null) t += ` DAY ${r.dayTag} LT`;
  if (r.status === "cancelled") t += " CNL";
  else if (permitStatus === "obtained") t += " +";
  else if (permitStatus === "pending") t += " -";
  if (r.legType === "ferry") t += " FERRY";
  if (r.notes) t += ` ${r.notes}`;
  return t;
}

/**
 * The planner's own layout: one column per aircraft, one row per day, one line per leg, weeks under a banner,
 * cell colour for the permit state. AeroPlanner's Excel import reads this file back unchanged.
 */
export async function buildXlsxGrid(inp: ExportInput): Promise<Blob> {
  const { state, rows } = inp;
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "AeroPlanner";
  const regs = state.aircraft.filter((a) => rows.some((r) => r.aircraft === a.registration)).map((a) => ({ reg: a.registration, type: a.type }));
  const ws = wb.addWorksheet("Schedule");
  const n = Math.max(1, regs.length);
  ws.columns = [{ width: 14 }, ...regs.map(() => ({ width: 58 }))];
  ws.mergeCells(1, 1, 1, n + 1);
  ws.getCell(1, 1).value = `${(state.company.legalName || "Schedule").toUpperCase()}  |  SCHEDULE`;
  ws.getCell(1, 1).font = { bold: true, size: 13 };
  ws.getCell(2, 1).value = "Date";
  regs.forEach((r, i) => {
    const c = ws.getCell(2, i + 2);
    c.value = `${r.reg}\n${r.type}`;
    c.alignment = { wrapText: true, vertical: "middle" };
    c.font = { bold: true };
  });
  ws.getRow(2).height = 32;

  const permitState = new Map<string, "obtained" | "pending" | null>();
  for (const r of rows) {
    const ps = state.permits.filter((p) => p.legId === r.legId && p.status !== "cancelled");
    permitState.set(r.legId, ps.length && ps.every((p) => p.status === "obtained") ? "obtained" : ps.length && ps.every((p) => p.status === "pending") ? "pending" : null);
  }

  if (rows.length) {
    const first = mondayOf(rows.reduce((m, r) => (r.date < m ? r.date : m), rows[0].date));
    const last = rows.reduce((m, r) => (r.date > m ? r.date : m), rows[0].date);
    let line = 3;
    for (let w = 0, start = first; start <= last; w++, start = addDaysIso(start, 7)) {
      const end = addDaysIso(start, 6);
      const mon = (d: string) => MONTHS[Number(d.slice(5, 7)) - 1];
      ws.mergeCells(line, 1, line, n + 1);
      const b = ws.getCell(line, 1);
      b.value = `WEEK ${w + 1}, ${Number(start.slice(8))}${start.slice(5, 7) !== end.slice(5, 7) ? " " + mon(start) : ""}-${Number(end.slice(8))} ${mon(end)} ${end.slice(0, 4)}`;
      b.font = { bold: true };
      b.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
      line++;
      for (let d = 0; d < 7; d++) {
        const date = addDaysIso(start, d);
        const a = ws.getCell(line, 1);
        a.value = new Date(`${date}T00:00:00Z`);
        a.numFmt = "ddd dd/mm/yyyy";
        let maxLines = 1;
        regs.forEach((reg, i) => {
          const here = rows.filter((r) => r.aircraft === reg.reg && r.date === date);
          if (!here.length) return;
          maxLines = Math.max(maxLines, here.length);
          const c = ws.getCell(line, i + 2);
          c.value = here.map((r) => gridLine(r, permitState.get(r.legId) ?? null)).join("\n");
          c.alignment = { wrapText: true, vertical: "top" };
          const states = new Set(here.map((r) => (r.status === "cancelled" ? "cancelled" : permitState.get(r.legId) ?? null)));
          if (states.size === 1) {
            const only = [...states][0];
            const fill = only === "obtained" ? FILL.green : only === "pending" ? FILL.amber : only === "cancelled" ? FILL.red : null;
            if (fill) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
          }
        });
        ws.getRow(line).height = Math.max(18, 16 * maxLines);
        line++;
      }
    }
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/** Pure: the pdfmake document for a printable schedule. A4 landscape. */
export function pdfDocDefinition(inp: ExportInput) {
  const { state, rows } = inp;
  const c = state.company;
  const span = rows.length ? `${rows[0].date} to ${rows.reduce((m, r) => (r.date > m ? r.date : m), rows[0].date)}` : "no legs";
  const th = (text: string) => ({ text, bold: true, fillColor: "#EEF0EB", fontSize: 8 });
  const body = [
    ["Date", "Flight", "Aircraft", "From", "To", "ETD", "ETA", "Block", "Status", "Notes"].map(th),
    ...rows.map((r) => [
      { text: r.date.slice(5) + ` ${["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][isoWeekday(r.date)]}`, fontSize: 8 },
      { text: r.flight, bold: true, fontSize: 8 },
      { text: r.aircraft, fontSize: 8 },
      { text: r.depIata || r.depIcao, fontSize: 8 },
      { text: r.arrIata || r.arrIcao, fontSize: 8 },
      { text: r.etdUtc.slice(11, 16), fontSize: 8 },
      { text: r.etaUtc.slice(11, 16) + (r.dayPlus ? " (+1)" : ""), fontSize: 8 },
      { text: fmtDuration(r.blockMin), fontSize: 8 },
      { text: r.status === "cancelled" ? "CNL" : r.legType === "ferry" ? "Ferry" : "", fontSize: 8, color: r.status === "cancelled" ? "#B3261E" : "#14202E" },
      { text: r.notes, fontSize: 7.5, color: "#46525F" },
    ]),
  ];
  return {
    pageSize: "A4" as const,
    pageOrientation: "landscape" as const,
    pageMargins: [28, 32, 28, 36] as [number, number, number, number],
    defaultStyle: { fontSize: 9, color: "#14202E" },
    footer: (page: number, pages: number) => ({ text: `${c.legalName || "AeroPlanner"}   Times in UTC   Page ${page} of ${pages}`, alignment: "center" as const, fontSize: 7.5, color: "#46525F", margin: [0, 10, 0, 0] as [number, number, number, number] }),
    content: [
      { text: `${c.legalName || "Flight schedule"}`, fontSize: 15, bold: true },
      { text: `Flight schedule ${span}. ${rows.length} legs. Created ${inp.createdAt.slice(0, 16).replace("T", " ")} UTC.`, fontSize: 8.5, color: "#46525F", margin: [0, 2, 0, 8] as [number, number, number, number] },
      {
        table: { headerRows: 1, dontBreakRows: true, widths: [52, 48, 54, 38, 38, 38, 56, 40, 40, "*"], body },
        layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => "#C9CFC6", vLineColor: () => "#C9CFC6", paddingTop: () => 2.5, paddingBottom: () => 2.5 },
      },
    ],
  };
}

export async function buildPdf(inp: ExportInput): Promise<Blob> {
  const [{ default: pdfMake }, vfsMod] = await Promise.all([import("pdfmake/build/pdfmake"), import("pdfmake/build/vfs_fonts")]);
  const vfs = (vfsMod as { default?: unknown }).default ?? vfsMod;
  (pdfMake as unknown as { addVirtualFileSystem: (v: unknown) => void }).addVirtualFileSystem(vfs);
  const doc = pdfMake.createPdf(pdfDocDefinition(inp) as never);
  return (await doc.getBlob()) as Blob;
}
