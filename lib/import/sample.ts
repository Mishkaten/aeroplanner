// The sample workbook Phasis_2026_Season.xlsx is built from the same seed data as the full demo (PRD 9),
// with messy cell text planted on purpose: 14 flagged cells (7.7), 18 cleaned silently, 4 free notes.
import { addDaysIso, isoWeekday, utcDate } from "../time";
import { SEASON_START } from "../seed/legs";
import type { DomainState, Leg } from "../types";
import { fullFlight } from "../legs";
import { requiredPermits } from "../permits";
import { indexAirports } from "../airports";
import { dayTag } from "../legs";

export const SAMPLE_FILE = "Phasis_2026_Season.xlsx";

/** Section 7.7: the 14 flagged cells, keyed by leg id, with the raw text exactly as typed. */
export const SAMPLE_FLAGGED: { n: number; legId: string; raw: string; code: string; suggestion: string | null }[] = [
  { n: 1, legId: "L-20260914-PHC502-BEG-A", raw: "PHC502 LYBE/BEG ETA/08.00Z UGTB/TBS ETA/11.00Z +", code: "ETA_FOR_ETD", suggestion: "ETD/08.00Z" },
  { n: 2, legId: "L-20260919-PHC515-TBS-B", raw: "PHC515 UGTB/TBS ETA/05.00Z LYBE/BEG ETA/08.00Z +", code: "ETA_FOR_ETD", suggestion: "ETD/05.00Z" },
  { n: 3, legId: "L-20260914-PHC601-TBS-C", raw: "PHC601 UGTB/TBS ETD/16.00Z UAAA/ALA ETA/20.30Z DAY 3 LT -", code: "DAYTAG_MISMATCH", suggestion: "DAY 2 LT" },
  { n: 4, legId: "L-20260917-PHC605-TBS-D", raw: "PHC605 UGTB/TBS ETD/18.00Z UAAA/ALA ETA/22.30Z (DAY 4 LT) +", code: "DAYTAG_MISMATCH", suggestion: "DAY 5 LT" },
  { n: 5, legId: "L-20260915-PHC504-BUD-B", raw: "PHC504 LHBP/BUD ETD/09.3Z UGTB/TBS ETA/12.30Z +", code: "TIME_MALFORMED", suggestion: null },
  { n: 6, legId: "L-20260917-PHC612-XIY-C", raw: "PHC612 ZLXY/XIY ETD/25.00Z ZWWW/URC ETA/05.00Z +", code: "TIME_OUT_OF_RANGE", suggestion: null },
  { n: 7, legId: "L-20260918-PHC510-OTP-A", raw: "PHC510 LROP/BUH ETD/09.00Z UGTB/TBS ETA/11.30Z +", code: "STATION_PAIR_MISMATCH", suggestion: "LROP/OTP" },
  { n: 8, legId: "L-20260919-PHC514-MXP-A", raw: "PHC514 LIMC/MIL ETD/08.30Z UGTB/TBS ETA/13.00Z +", code: "STATION_PAIR_MISMATCH", suggestion: "LIMC/MXP" },
  { n: 9, legId: "L-20260919-PHC516-BEG-B", raw: "CMS516 LYBE/BEG ETD/09.30Z UGTB/TBS ETA/12.30Z +", code: "PREFIX_MISMATCH", suggestion: "PHC516" },
  { n: 10, legId: "L-20260920-PHC518-ATH-B", raw: "CMS518 LGAV/ATH ETD/09.00Z UGTB/TBS ETA/12.00Z +", code: "PREFIX_MISMATCH", suggestion: "PHC518" },
  { n: 11, legId: "L-20260918-PHC606-ALA-D", raw: "PHC606 UAAA/ALA ETD/01.00Z UGTB/TBS ETA/01.00Z +", code: "BLOCK_ZERO", suggestion: null },
  { n: 12, legId: "L-20260915-PHC503-TBS-B", raw: "PHC503 UGTB/TBS ETD/04.00Z LHBP/BUD ETA/07.30Z + -", code: "MARKER_CONFLICT", suggestion: null },
  { n: 13, legId: "L-20260918-PHC613-TBS-D", raw: "PHC613 UGTB/TBS ETD/19.00Z VECC/CCU ETA/01.30Z ETD 19.30Z TBC", code: "NOTE_TIME_CONFLICT", suggestion: "Keep ETD/19.00Z, keep the text as a note" },
  { n: 14, legId: "L-20260915-PHC604-DWC-D", raw: "PHC604 OMDW/DWC ETD/08.00Z OMDW/DWC ETA/12.00Z +", code: "SAME_STATION", suggestion: null },
];

type Variant = "stray" | "colon" | "lower" | "dayNoSpace" | "dayParen";
type Pick = { flight: string; dep: string; week: number };

// The 18 cells cleaned silently and never flagged (counts asserted by test).
export const SAMPLE_SILENT: { variant: Variant; picks: Pick[] }[] = [
  {
    variant: "stray",
    picks: [
      { flight: "PHC507", dep: "TBS", week: 0 },
      { flight: "PHC508", dep: "ATH", week: 0 },
      { flight: "PHC603", dep: "TBS", week: 1 },
      { flight: "PHC604", dep: "DWC", week: 1 },
      { flight: "PHC511", dep: "TBS", week: 2 },
      { flight: "PHC512", dep: "FRL", week: 2 },
    ],
  },
  {
    variant: "colon",
    picks: [
      { flight: "PHC603", dep: "TBS", week: 0 },
      { flight: "PHC602", dep: "ALA", week: 1 },
      { flight: "PHC501", dep: "TBS", week: 2 },
      { flight: "PHC502", dep: "BEG", week: 2 },
    ],
  },
  {
    variant: "lower",
    picks: [
      { flight: "PHC602", dep: "ALA", week: 0 },
      { flight: "PHC514", dep: "MXP", week: 1 },
      { flight: "PHC603", dep: "TBS", week: 2 },
    ],
  },
  {
    variant: "dayNoSpace",
    picks: [
      { flight: "PHC601", dep: "TBS", week: 1 },
      { flight: "PHC605", dep: "TBS", week: 1 },
      { flight: "PHC611", dep: "URC", week: 1 },
    ],
  },
  {
    variant: "dayParen",
    picks: [
      { flight: "PHC601", dep: "TBS", week: 2 },
      { flight: "PHC605", dep: "TBS", week: 2 },
    ],
  },
];

/** The four free notes kept without a flag (PHC611 and PHC507D in week 1, PHC601 and PHC901 in week 2). */
export const SAMPLE_NOTE_LEGS = ["L-20260916-PHC611-TBS-C", "L-20260916-PHC507D-TBS-B", "L-20260921-PHC601-TBS-C", "L-20260923-PHC901-TBS-D"];

export const SAMPLE_COUNTS = { legs: 90, rows: 118, structure: 28, flagged: 14, withSuggestion: 9, withoutSuggestion: 5, silent: 18 };

const hhmm = (instant: string) => `${instant.slice(11, 13)}.${instant.slice(14, 16)}`;

function legWeek(l: Leg): number {
  return Math.floor((Date.parse(l.etdUtc) - Date.parse(`${SEASON_START}T00:00:00Z`)) / (7 * 86_400_000));
}

export interface SheetSpec {
  name: string;
  title: string;
  registrations: { reg: string; type: string }[];
  weeks: {
    banner: string;
    days: { label: string | { date: string }; date: string; cells: Record<string, { lines: string[]; fill: "green" | "amber" | "red" | null }> }[];
  }[];
}

export function sampleSheetSpec(state: DomainState): SheetSpec {
  const idx = indexAirports(state.airports);
  const iata = (icao: string) => idx.byIcao.get(icao)!.iata;
  const permitsByLeg = new Map<string, string[]>();
  for (const p of state.permits) permitsByLeg.set(p.legId, [...(permitsByLeg.get(p.legId) ?? []), p.status]);

  const variantOf = new Map<string, Variant>();
  for (const v of SAMPLE_SILENT)
    for (const p of v.picks) {
      const hit = state.legs.find((l) => fullFlight(l) === p.flight && iata(l.depIcao) === p.dep && legWeek(l) === p.week);
      if (!hit) throw new Error(`Sample fixture: no leg for ${p.flight} ${p.dep} week ${p.week}`);
      variantOf.set(hit.id, v.variant);
    }
  const flagged = new Map(SAMPLE_FLAGGED.map((f) => [f.legId, f.raw]));

  const canonical = (l: Leg): { text: string; status: "obtained" | "pending" | "cancelled" | null } => {
    const rows = permitsByLeg.get(l.id) ?? [];
    const status = l.status === "cancelled" ? "cancelled" : rows.length && rows.every((s) => s === "obtained") ? "obtained" : rows.length && rows.every((s) => s === "pending") ? "pending" : null;
    const req = requiredPermits(l.depIcao, l.arrIcao, state.permitRules).length;
    let t = `${fullFlight(l)} ${l.depIcao}/${iata(l.depIcao)} ETD/${hhmm(l.etdUtc)}Z ${l.arrIcao}/${iata(l.arrIcao)} ETA/${hhmm(l.etaUtc)}Z`;
    const v = variantOf.get(l.id);
    // A typed day tag is the ISO weekday of the local arrival date. Legs whose local date equals the UTC date
    // carry none, except the planted consistent cells (for example PHC611 URC to XIY in week 2).
    const local = Date.parse(l.etaUtc) + idx.byIcao.get(l.arrIcao)!.utcOffsetMinutes * 60_000;
    const tag = dayTag(l, idx) ?? (v === "dayNoSpace" || v === "dayParen" ? isoWeekday(utcDate(local)) : null);
    if (tag !== null) t += v === "dayNoSpace" ? ` DAY${tag} LT` : v === "dayParen" ? ` (DAY ${tag} LT)` : ` DAY ${tag} LT`;
    if (status === "cancelled") t += " CNL";
    else if (req > 0 && status === "obtained") t += " +";
    else if (req > 0 && status === "pending") t += " -";
    if (l.legType === "ferry") t += " FERRY";
    if (l.notes && SAMPLE_NOTE_LEGS.includes(l.id)) t += ` ${l.notes}`;
    return { text: t, status };
  };

  const dirty = (id: string, text: string): string => {
    switch (variantOf.get(id)) {
      case "stray":
        return text.replace(/\//g, " / ").replace(/ETD \/ /, "ETD/ ").replace(/ETA \/ /, "ETA / ");
      case "colon":
        return text.replace(/ETD\/(\d\d)\.(\d\d)Z/, "ETD/$1:$2").replace(/ETA\/(\d\d)\.(\d\d)Z/, "ETA $1$2Z");
      case "lower":
        return text.toLowerCase();
      default:
        return text;
    }
  };

  const regs = state.aircraft.map((a) => ({ reg: a.registration, type: a.type }));
  const legs = [...state.legs].sort((a, b) => Date.parse(a.etdUtc) - Date.parse(b.etdUtc) || (a.id < b.id ? -1 : 1));
  const labelFor = (week: number, d: number, date: string): string | { date: string } => {
    if (week === 0) {
      const dow = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d];
      return `${dow} ${date.slice(8)}.${date.slice(5, 7)}`;
    }
    if (week === 1) return `${date.slice(8)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
    if (d < 4) return `${Number(date.slice(8))} ${["Sep", "Oct"][date.slice(5, 7) === "10" ? 1 : 0]}`;
    return { date };
  };

  const weeks: SheetSpec["weeks"] = [];
  for (let w = 0; w < 3; w++) {
    const start = addDaysIso(SEASON_START, w * 7);
    const end = addDaysIso(start, 6);
    const mon = (d: string) => ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][Number(d.slice(5, 7)) - 1];
    const banner = `WEEK ${w + 1}, ${Number(start.slice(8))}${start.slice(5, 7) !== end.slice(5, 7) ? " " + mon(start) : ""}-${Number(end.slice(8))} ${mon(end)} ${end.slice(0, 4)}`;
    const days: SheetSpec["weeks"][number]["days"] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDaysIso(start, d);
      const cells: Record<string, { lines: string[]; fill: "green" | "amber" | "red" | null }> = {};
      for (const r of regs) {
        const here = legs.filter((l) => l.aircraftId === r.reg && l.etdUtc.slice(0, 10) === date);
        if (!here.length) continue;
        const parts = here.map((l) => ({ id: l.id, c: canonical(l) }));
        const lines = parts.map((p) => flagged.get(p.id) ?? dirty(p.id, p.c.text));
        const statuses = new Set(parts.map((p) => p.c.status));
        const fill = statuses.size === 1 ? ([...statuses][0] === "obtained" ? "green" : [...statuses][0] === "pending" ? "amber" : [...statuses][0] === "cancelled" ? "red" : null) : null;
        cells[r.reg] = { lines, fill };
      }
      days.push({ label: labelFor(w, d, date), date, cells });
    }
    weeks.push({ banner, days });
  }
  return { name: "Season 2026", title: "PHASIS AIR CARGO  |  SEASON 2026 SCHEDULE  |  Fictional demo data", registrations: regs, weeks };
}
