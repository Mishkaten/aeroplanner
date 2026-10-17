import { readTime } from "./parse";
import type { ImportRow } from "./types";

const TIME = /(?:ETD|ETA|STD)\s*[/: ]?\s*\d[\d.:]*\s*[Zz]?/gi;
const STATION = /[A-Za-z]{4}\s*\/\s*[A-Za-z]{3}/g;

function nth(text: string, re: RegExp, n: number): [number, number] | null {
  const m = [...text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))][n];
  return m && m.index !== undefined ? [m.index, m.index + m[0].length] : null;
}

/** The part of the raw cell text that caused the flag, as [start, end), or null. Used to highlight the messy text. */
export function flagRange(row: ImportRow): [number, number] | null {
  const code = row.flag?.code;
  const t = row.ref.text;
  const f = row.fields;
  if (!code || !f) return null;
  switch (code) {
    case "TIME_MALFORMED":
    case "TIME_OUT_OF_RANGE":
      return nth(t, TIME, readTime(f.depTime.raw).ok ? 1 : 0);
    case "ETA_FOR_ETD":
      return nth(t, TIME, 0);
    case "ETD_FOR_ETA":
    case "BLOCK_ZERO":
      return nth(t, TIME, 1);
    case "STATION_UNKNOWN":
    case "STATION_PAIR_MISMATCH": {
      const typed = row.flag?.message.match(/[A-Z]{4}\/[A-Z]{3}/)?.[0] ?? "";
      const i = [f.dep, f.arr].findIndex((s) => `${s.icao}/${s.iata}` === typed);
      return nth(t, STATION, Math.max(0, i));
    }
    case "SAME_STATION":
      return nth(t, STATION, 1);
    case "PREFIX_MISMATCH":
      return nth(t, /^[A-Za-z]{3}\s?\d{1,4}\s?[Dd]?/, 0);
    case "MARKER_CONFLICT":
      return nth(t, /[+-]\s*[+-]/, 0);
    case "DAYTAG_MISMATCH":
      return nth(t, /\(?\s*DAY\s*\d\s*LT\s*\)?/i, 0);
    case "NOTE_TIME_CONFLICT":
      return nth(t, TIME, 2);
    default:
      return null;
  }
}
