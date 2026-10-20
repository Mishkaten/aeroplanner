// IATA SSIM Chapter 7 writer (200-character fixed-width records). Field positions follow the layout read by the
// open-source ssimparser (record types 1, 2, 3 and 5). Times are written in UTC mode ("U" in the carrier record).
// Not yet checked against a file exported by Leon: see docs/export-formats.md.
import { addDaysIso, dateMs, isoWeekday } from "../time";
import type { ExportRow } from "./rows";

export interface SsimOptions {
  /** Two-character IATA airline designator, from the company profile. */
  carrier: string;
  title: string;
  /** Data set creation instant, ISO. Passed in so tests are deterministic. */
  createdAt: string;
}

export interface SsimResult {
  text: string;
  /** Number of flight leg records (type 3) written. */
  records: number;
  /** Legs left out, with the reason, so the dialog can say so. */
  skipped: { flight: string; date: string; reason: string }[];
}

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const ddmmmyy = (d: string): string => `${d.slice(8, 10)}${MON[Number(d.slice(5, 7)) - 1]}${d.slice(2, 4)}`;
const hhmm = (instant: string): string => `${instant.slice(11, 13)}${instant.slice(14, 16)}`;
const offset = (min: number): string =>
  `${min < 0 ? "-" : "+"}${String(Math.floor(Math.abs(min) / 60)).padStart(2, "0")}${String(Math.abs(min) % 60).padStart(2, "0")}`;

/** IATA aircraft type codes for common freighter fleet types. Anything else is written as its first three letters and digits. */
export function iataAircraftType(type: string): string {
  const t = type.toUpperCase().replace(/\s/g, "");
  const known: [string, string][] = [
    ["B737-800", "738"],
    ["B737-700", "73G"],
    ["B767-300", "763"],
    ["B767-200", "762"],
    ["B747-400", "744"],
    ["B777-200", "772"],
    ["A330-300", "333"],
    ["A330-200", "332"],
    ["A321", "321"],
    ["A320", "320"],
  ];
  for (const [prefix, code] of known) if (t.startsWith(prefix)) return code;
  return t.replace(/[^A-Z0-9]/g, "").slice(0, 3).padEnd(3);
}

/** IATA season code of a date: summer from the last Sunday of March, winter from the last Sunday of October. */
export function ssimSeason(date: string): string {
  const y = Number(date.slice(0, 4));
  const lastSunday = (year: number, month: number): string => {
    let d = `${year}-${String(month).padStart(2, "0")}-31`;
    while (isoWeekday(d) !== 7) d = addDaysIso(d, -1);
    return d;
  };
  const s = lastSunday(y, 3);
  const w = lastSunday(y, 10);
  if (date >= s && date < w) return `S${String(y).slice(2)}`;
  return `W${String(date >= w ? y : y - 1).slice(2)}`;
}

class Rec {
  private c: string[] = Array(200).fill(" ");
  put(pos: number, text: string): this {
    for (let i = 0; i < text.length; i++) this.c[pos - 1 + i] = text[i];
    return this;
  }
  serial(n: number): this {
    return this.put(195, String(n).padStart(6, "0"));
  }
  toString(): string {
    return this.c.join("");
  }
}

interface Pattern {
  row: ExportRow;
  from: string;
  to: string;
  days: Set<number>;
}

/** Collapses dated legs into recurring patterns that expand to exactly the same dates, no more and no fewer. */
function patternsFor(dates: string[], row: ExportRow): Pattern[] {
  const byDow = new Map<number, string[]>();
  for (const d of [...new Set(dates)].sort()) byDow.set(isoWeekday(d), [...(byDow.get(isoWeekday(d)) ?? []), d]);
  const runs: { from: string; to: string; dow: number }[] = [];
  for (const [dow, list] of byDow) {
    let start = list[0];
    let prev = list[0];
    for (const d of list.slice(1)) {
      if (dateMs(d) - dateMs(prev) !== 7 * 86_400_000) {
        runs.push({ from: start, to: prev, dow });
        start = d;
      }
      prev = d;
    }
    runs.push({ from: start, to: prev, dow });
  }
  const merged = new Map<string, Pattern>();
  for (const r of runs) {
    const k = `${r.from}|${r.to}`;
    const p = merged.get(k) ?? { row, from: r.from, to: r.to, days: new Set<number>() };
    p.days.add(r.dow);
    merged.set(k, p);
  }
  return [...merged.values()];
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function buildSsim(rows: ExportRow[], o: SsimOptions): SsimResult {
  const skipped: SsimResult["skipped"] = [];
  const usable: ExportRow[] = [];
  for (const r of rows) {
    if (r.status === "cancelled") continue;
    if (r.placeholder) skipped.push({ flight: r.flight, date: r.date, reason: "no real airport code (placeholder station)" });
    else if (!/^\d{1,4}$/.test(r.number)) skipped.push({ flight: r.flight, date: r.date, reason: "the flight number has no 1 to 4 digit number" });
    else usable.push(r);
  }

  // One group per flight with identical times and route: the same recurring pattern.
  const groups = new Map<string, { row: ExportRow; dates: string[] }>();
  for (const r of usable) {
    const k = [r.number, r.suffix, r.depIata, r.arrIata, r.etdUtc.slice(11, 16), r.etaUtc.slice(11, 16), r.dayPlus, r.depOffsetMin, r.arrOffsetMin, iataAircraftType(r.aircraftType), r.legType].join("|");
    const g = groups.get(k) ?? { row: r, dates: [] };
    g.dates.push(r.date);
    groups.set(k, g);
  }
  const patterns = [...groups.values()].flatMap((g) => patternsFor(g.dates, g.row));
  patterns.sort((a, b) => cmp(a.row.number + a.row.suffix, b.row.number + b.row.suffix) || cmp(a.from, b.from) || cmp(a.to, b.to));

  const createdD = o.createdAt.slice(0, 10);
  const first = patterns.reduce((m, p) => (p.from < m ? p.from : m), patterns[0]?.from ?? createdD);
  const last = patterns.reduce((m, p) => (p.to > m ? p.to : m), patterns[0]?.to ?? createdD);
  const carrier = o.carrier.toUpperCase().slice(0, 2);

  const lines: string[] = [];
  let serial = 1;
  lines.push(new Rec().put(1, "1AIRLINE STANDARD SCHEDULE DATA SET").put(41, "1").serial(serial++).toString());
  for (let i = 0; i < 4; i++) lines.push("0".repeat(200));
  lines.push(
    new Rec()
      .put(1, "2U")
      .put(3, carrier)
      .put(11, ssimSeason(first))
      .put(15, ddmmmyy(first))
      .put(22, ddmmmyy(last))
      .put(29, ddmmmyy(createdD))
      .put(36, o.title.toUpperCase().slice(0, 29))
      .put(65, ddmmmyy(createdD))
      .put(72, "C")
      .put(73, "AEROPLANNER")
      .put(191, hhmm(o.createdAt))
      .serial(serial++)
      .toString(),
  );

  const variation = new Map<string, number>();
  for (const p of patterns) {
    const r = p.row;
    const key = r.number + r.suffix;
    const v = (variation.get(key) ?? 0) + 1;
    variation.set(key, v);
    const days = [1, 2, 3, 4, 5, 6, 7].map((d) => (p.days.has(d) ? String(d) : " ")).join("");
    lines.push(
      new Rec()
        .put(1, "3")
        .put(2, r.suffix || " ")
        .put(3, carrier)
        .put(6, r.number.padStart(4, "0"))
        .put(10, String(Math.min(v, 99)).padStart(2, "0"))
        .put(12, "01")
        .put(14, r.legType === "ferry" ? "P" : "F")
        .put(15, ddmmmyy(p.from))
        .put(22, ddmmmyy(p.to))
        .put(29, days)
        .put(37, r.depIata)
        .put(40, hhmm(r.etdUtc))
        .put(44, hhmm(r.etdUtc))
        .put(48, offset(r.depOffsetMin))
        .put(55, r.arrIata)
        .put(58, hhmm(r.etaUtc))
        .put(62, hhmm(r.etaUtc))
        .put(66, offset(r.arrOffsetMin))
        .put(73, iataAircraftType(r.aircraftType))
        .put(193, String(r.dayPlus))
        .put(194, "0")
        .serial(serial++)
        .toString(),
    );
  }
  lines.push(new Rec().put(1, "5").put(3, carrier).put(6, ddmmmyy(createdD)).put(188, String(serial - 1).padStart(6, "0")).put(194, "E").serial(serial++).toString());
  return { text: lines.join("\r\n") + "\r\n", records: patterns.length, skipped };
}
