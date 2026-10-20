import { describe, expect, it } from "vitest";
import { buildRows } from "./rows";
import { buildCsv, buildIcs, buildJson, buildXlsxList, pdfDocDefinition } from "./formats";
import { buildSsim, iataAircraftType, ssimSeason } from "./ssim";
import { buildScheduleExport, ExportBlocked } from "./index";
import { fullDemoState } from "../seed";
import { fullFlight } from "../legs";
import { parseWorkbook } from "../import/pipeline";
import { fieldsToLeg } from "../import/parse";
import type { ParseCtx } from "../import/types";
import type { Leg } from "../types";

const state = fullDemoState();
const NOW = "2026-09-13T14:00:00Z";
const rows = buildRows(state, state.legs);
const active = rows.filter((r) => r.status !== "cancelled");
const inp = { state, rows, createdAt: NOW };

const field = (line: string, from: number, to: number) => line.slice(from - 1, to);
const records = (text: string) => text.split("\r\n").filter(Boolean);

describe("rows", () => {
  it("one row per leg, sorted by departure, with local times at each station", () => {
    expect(rows).toHaveLength(state.legs.length);
    expect([...rows].map((r) => r.etdUtc)).toEqual([...rows].map((r) => r.etdUtc).sort());
    const tbsUrc = rows.find((r) => r.depIata === "TBS" && r.arrIata === "URC")!;
    expect(tbsUrc.depOffsetMin).toBe(240);
    expect(tbsUrc.arrOffsetMin).toBe(480);
    const shift = (s: string) => Date.parse(s.replace(" ", "T") + ":00Z") - Date.parse(tbsUrc.etdUtc);
    expect(shift(tbsUrc.etdLocal)).toBe(240 * 60_000);
  });
});

describe("CSV", () => {
  it("has a BOM, CRLF lines, a header and one line per leg", () => {
    const csv = buildCsv(rows);
    expect(csv.startsWith("﻿Date (UTC),Flight,")).toBe(true);
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(rows.length + 1);
  });
  it("quotes commas and quotes, and defuses formulas", () => {
    const r = { ...rows[0], notes: 'say "hi", ok', permits: "=HYPERLINK(1)" };
    const line = buildCsv([r]).split("\r\n")[1];
    expect(line).toContain('"say ""hi"", ok"');
    expect(line).toContain("'=HYPERLINK(1)");
  });
});

describe("JSON and calendar", () => {
  it("JSON lists every leg with ISO instants", () => {
    const j = JSON.parse(buildJson(inp));
    expect(j.format).toBe("aeroplanner.schedule.v1");
    expect(j.legs).toHaveLength(rows.length);
    expect(j.legs[0].etdUtc).toMatch(/Z$/);
  });
  it("ICS has one event per leg, UTC times, CRLF and folded lines under 76 octets", () => {
    const ics = buildIcs(inp);
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(rows.length);
    expect(ics).toMatch(/DTSTART:\d{8}T\d{6}Z/);
    for (const l of ics.split("\r\n")) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    expect(ics).toContain("STATUS:CANCELLED");
  });
});

describe("PDF", () => {
  it("is a landscape table with a header and one row per leg", () => {
    const def = pdfDocDefinition(inp);
    expect(def.pageOrientation).toBe("landscape");
    const table = def.content[2] as { table: { body: unknown[][] } };
    expect(table.table.body).toHaveLength(rows.length + 1);
  });
});

describe("Excel", () => {
  it("list: real dates and times, header frozen, one row per leg", async () => {
    const buf = await (await buildXlsxList(inp)).arrayBuffer();
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet("Schedule")!;
    expect(ws.rowCount).toBe(rows.length + 1);
    expect(ws.getRow(2).getCell(1).value instanceof Date).toBe(true);
    expect(ws.getRow(2).getCell(9).numFmt).toBe("hh:mm");
  });

  it("grid: AeroPlanner reads its own export back to the same legs", async () => {
    const live = state.legs.filter((l) => l.status !== "cancelled");
    const exported = await buildScheduleExport(state, { format: "xlsx-grid", legs: live, includeCancelled: false, createdAt: NOW });
    const ctx: ParseCtx = { companyIcao: "PHC", baseIcao: "UGTB", airports: state.airports, permitRules: state.permitRules, aircraft: state.aircraft };
    const result = await parseWorkbook(await exported.blob.arrayBuffer(), exported.filename, ctx, () => {});
    // The only flag allowed is a note that contradicts its own leg time, which is true of one seed leg and stays a real conflict.
    const flagged = result.rows.filter((r) => r.flag);
    expect(flagged.map((r) => r.flag?.code)).toEqual(["NOTE_TIME_CONFLICT"]);
    const back = result.rows.filter((r) => !r.flag).map((r) => fieldsToLeg(r, ctx)).filter((l): l is Leg => !!l);
    const key = (l: Leg) => `${fullFlight(l)}|${l.aircraftId}|${l.depIcao}|${l.arrIcao}|${l.etdUtc}|${l.etaUtc}`;
    const conflicted = live.filter((l) => /\d\d[.:]\d\d/.test(l.notes)).map(key);
    expect(back.map(key).sort()).toEqual(live.map(key).filter((k) => !conflicted.includes(k)).sort());
  });
});

describe("SSIM", () => {
  const opts = { carrier: "PX", title: "Phasis Air Cargo", createdAt: NOW };
  const r = buildSsim(rows, opts);
  const lines = records(r.text);

  it("every record is exactly 200 characters, in the SSIM order 1, 0 x4, 2, 3..., 5", () => {
    expect(lines.every((l) => l.length === 200)).toBe(true);
    expect(lines[0].startsWith("1AIRLINE STANDARD SCHEDULE DATA SET")).toBe(true);
    expect(lines.slice(1, 5).every((l) => l === "0".repeat(200))).toBe(true);
    expect(lines[5][0]).toBe("2");
    expect(lines.at(-1)![0]).toBe("5");
    expect(lines.slice(6, -1).every((l) => l[0] === "3")).toBe(true);
  });

  it("record serial numbers run 1, 2, 3 ... and the trailer points at the last flight record", () => {
    const real = [lines[0], ...lines.slice(5)];
    expect(real.map((l) => Number(field(l, 195, 200)))).toEqual(real.map((_, i) => i + 1));
    expect(field(lines.at(-1)!, 188, 193)).toBe(String(real.length - 1).padStart(6, "0"));
  });

  it("carrier record: UTC mode, designator, season and the data set period", () => {
    const c = lines[5];
    expect(field(c, 2, 2)).toBe("U");
    expect(field(c, 3, 4)).toBe("PX");
    expect(field(c, 11, 13)).toBe("S26");
    expect(field(c, 15, 21)).toMatch(/^\d\d[A-Z]{3}26$/);
    expect(field(c, 191, 194)).toBe("1400");
  });

  it("expands to exactly the active legs: same flights, same dates, no more, no fewer", () => {
    const out = new Set<string>();
    const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const usable = active.filter((x) => !x.placeholder);
    for (const l of lines.slice(6, -1)) {
      const parse = (s: string) => `20${s.slice(5, 7)}-${String(MON.indexOf(s.slice(2, 5)) + 1).padStart(2, "0")}-${s.slice(0, 2)}`;
      const from = Date.parse(parse(field(l, 15, 21)));
      const to = Date.parse(parse(field(l, 22, 28)));
      const days = field(l, 29, 35);
      for (let t = from; t <= to; t += 86_400_000) {
        const wd = ((new Date(t).getUTCDay() + 6) % 7) + 1;
        if (days[wd - 1] === String(wd)) out.add([field(l, 6, 9).replace(/^0+/, ""), field(l, 37, 39), field(l, 55, 57), new Date(t).toISOString().slice(0, 10), field(l, 44, 47), field(l, 58, 61)].join("|"));
      }
    }
    const want = new Set(usable.map((x) => [x.number, x.depIata, x.arrIata, x.date, x.etdUtc.slice(11, 13) + x.etdUtc.slice(14, 16), x.etaUtc.slice(11, 13) + x.etaUtc.slice(14, 16)].join("|")));
    expect(out).toEqual(want);
    expect(lines.length - 7).toBeLessThan(usable.length); // recurring patterns collapse repeated dates
  });

  it("flight leg fields sit at their positions", () => {
    const one = buildSsim([rows.find((x) => x.depIata === "TBS" && x.arrIata === "URC" && x.status === "planned")!], opts).text.split("\r\n")[6];
    expect(field(one, 1, 1)).toBe("3");
    expect(field(one, 3, 5).trim()).toBe("PX");
    expect(field(one, 6, 9)).toMatch(/^\d{4}$/);
    expect(field(one, 10, 13)).toBe("0101");
    expect(field(one, 14, 14)).toBe("F");
    expect(field(one, 37, 39)).toBe("TBS");
    expect(field(one, 48, 52)).toBe("+0400");
    expect(field(one, 55, 57)).toBe("URC");
    expect(field(one, 66, 70)).toBe("+0800");
    expect(field(one, 73, 75)).toMatch(/^\w{3}$/);
  });

  it("leaves out cancelled legs and legs to the placeholder station, and says so", () => {
    expect(r.skipped.length).toBeGreaterThan(0);
    expect(r.skipped.every((s) => /placeholder|number/.test(s.reason))).toBe(true);
    expect(r.text).not.toMatch(/XXX/);
  });

  it("overnight arrival writes date variation 1 and a day-of-week pattern that matches", () => {
    const night = rows.find((x) => x.dayPlus === 1 && !x.placeholder && x.status === "planned")!;
    const rec = buildSsim([night], opts).text.split("\r\n")[6];
    expect(field(rec, 193, 193)).toBe("1");
    const wd = ((new Date(`${night.date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
    expect(field(rec, 29, 35)).toBe(" ".repeat(wd - 1) + wd + " ".repeat(7 - wd));
  });

  it("a gap in a weekly run splits the pattern instead of inventing a flight", () => {
    const base = rows.find((x) => !x.placeholder && x.status === "planned")!;
    const shift = (d: number) => {
      const t = Date.parse(base.date + "T00:00:00Z") + d * 86_400_000;
      return { ...base, date: new Date(t).toISOString().slice(0, 10) };
    };
    const text = buildSsim([shift(0), shift(7), shift(21)], opts).text;
    expect(records(text).filter((l) => l[0] === "3")).toHaveLength(2);
  });

  it("season codes follow the last Sunday of March and October", () => {
    expect(ssimSeason("2026-03-28")).toBe("W25");
    expect(ssimSeason("2026-03-29")).toBe("S26");
    expect(ssimSeason("2026-10-24")).toBe("S26");
    expect(ssimSeason("2026-10-25")).toBe("W26");
    expect(ssimSeason("2027-01-15")).toBe("W26");
  });

  it("maps freighter fleet types to IATA codes", () => {
    expect(iataAircraftType("B737-800SF")).toBe("738");
    expect(iataAircraftType("B767-300ER")).toBe("763");
  });
});

describe("export entry point", () => {
  it("SSIM is blocked with a clear message while the company has no IATA designator", async () => {
    const noCode = { ...state, company: { ...state.company, iata: "" } };
    await expect(buildScheduleExport(noCode, { format: "ssim", legs: state.legs, includeCancelled: false, createdAt: NOW })).rejects.toBeInstanceOf(ExportBlocked);
  });

  it("every format produces a non-empty file named after the company and the date span", async () => {
    const withCode = { ...state, company: { ...state.company, iata: "PX", icao: "PHC" } };
    for (const format of ["csv", "json", "ics", "ssim", "xlsx-list", "xlsx-grid"] as const) {
      const out = await buildScheduleExport(withCode, { format, legs: state.legs, includeCancelled: false, createdAt: NOW });
      expect(out.blob.size).toBeGreaterThan(200);
      expect(out.filename).toMatch(/^phc-schedule-2026-\d\d-\d\d_2026-\d\d-\d\d\.\w+$/);
    }
  });

  it("cancelled legs are left out unless asked for", async () => {
    const cancelled = state.legs.filter((l) => l.status === "cancelled").length;
    expect(cancelled).toBeGreaterThan(0);
    const a = await buildScheduleExport(state, { format: "csv", legs: state.legs, includeCancelled: false, createdAt: NOW });
    const b = await buildScheduleExport(state, { format: "csv", legs: state.legs, includeCancelled: true, createdAt: NOW });
    expect(b.legCount - a.legCount).toBe(cancelled);
  });
});
