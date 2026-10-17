// Parser for one season-sheet leg line against the grammar in PRD 7.3, with the review flags of 7.4.
import { indexAirports, isPlaceholder, PLACEHOLDER_ICAO, type AirportIndex } from "../airports";
import { makeLegId } from "../legs";
import { newPermit, requiredPermits, type DraftPermit } from "../permits";
import { buildTimes, isoWeekday, ms, MIN, utcDate } from "../time";
import type { Leg, LegType, Permit, PermitRule, PermitStatus } from "../types";
import { cleanWhitespace } from "./normalise";
import type {
  Fields,
  FlagCode,
  ImportRow,
  ParseCtx,
  RawLine,
  ReviewFlag,
  ReviewSuggestion,
  SuggestionPatch,
  TimeTok,
  TypeWord,
} from "./types";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------
export interface ParseIndex {
  idx: AirportIndex;
  companyIcao: string;
  baseIcao: string;
  dayTagMode: "arrival_local" | "departure_day" | "ignore";
  rules: PermitRule[];
  byReg: Map<string, { id: string; registration: string; defaultBackupId: string | null }>;
}

const cache = new WeakMap<ParseCtx, ParseIndex>();
export function indexCtx(ctx: ParseCtx): ParseIndex {
  const hit = cache.get(ctx);
  if (hit) return hit;
  const out: ParseIndex = {
    idx: indexAirports(ctx.airports),
    companyIcao: ctx.companyIcao,
    baseIcao: ctx.baseIcao,
    dayTagMode: ctx.dayTagMode ?? "arrival_local",
    rules: ctx.permitRules,
    byReg: new Map(ctx.aircraft.map((a) => [a.registration, a])),
  };
  cache.set(ctx, out);
  return out;
}

// ---------------------------------------------------------------------------
// Scanning (grammar)
// ---------------------------------------------------------------------------
const FLIGHT = /^([A-Za-z]{3})\s?(\d{1,4})(?:\s?([Dd]))?(?=\s|$)/;
const STATION = /^\s*([A-Za-z]{4})\s*\/\s*([A-Za-z]{3})(?![A-Za-z])/;
const TIME = /^\s*(ETD|ETA|STD)\s*[/: ]?\s*(\d[\d.:]*)\s*[Zz]?/i;
const DAYTAG = /^\s*\(?\s*DAY\s*([1-7])\s*(?:LT)?\s*\)?(?=\s|$|[+-])/i;
const NEXTDAY = /^\s*\(\s*\+\s*1\s*\)/;
const MARKER = /^\s*([+-])(?=\s|$|[+-])/;
const CNL = /^\s*CNL(?=\s|$)/i;
const TYPEWORD = /^\s*(FERRY|OVERFLIGHT|TECHSTOP)(?=\s|$)/i;
const NOTE_TIME = /\b(ETD|ETA|STD)\s*[/: ]?\s*(\d{1,2})[.:]?(\d{2})\s*Z?(?![\dA-Za-z])/i;

const tag = (t: string): "ETD" | "ETA" => (t.toUpperCase() === "ETA" ? "ETA" : "ETD");

/** Parses a leg line into fields, or returns null when it does not match the grammar (UNPARSEABLE_LINE). */
export function scanLine(raw: string): Fields | null {
  const s = cleanWhitespace(raw);
  const fm = FLIGHT.exec(s);
  if (!fm) return null;
  let rest = s.slice(fm[0].length);

  const st1 = STATION.exec(rest);
  if (!st1) return null;
  rest = rest.slice(st1[0].length);
  const t1 = TIME.exec(rest);
  if (!t1) return null;
  rest = rest.slice(t1[0].length);
  const st2 = STATION.exec(rest);
  if (!st2) return null;
  rest = rest.slice(st2[0].length);
  const t2 = TIME.exec(rest);
  if (!t2) return null;
  rest = rest.slice(t2[0].length);

  // tail items in any order, the note starts at the first token that is not one of them
  let dayTag: number | null = null;
  const markers: ("+" | "-")[] = [];
  let cnl = false;
  let typeWord: TypeWord | null = null;
  let last: "time" | "daytag" | "marker" | "other" = "time";
  for (;;) {
    let m: RegExpExecArray | null;
    if ((m = NEXTDAY.exec(rest))) {
      // "(+1)" next-day annotation: derived from the times, ignored
    } else if ((m = DAYTAG.exec(rest))) {
      dayTag = Number(m[1]);
      last = "daytag";
    } else if (last !== "other" && (m = MARKER.exec(rest))) {
      markers.push(m[1] as "+" | "-");
      last = "marker";
    } else if ((m = CNL.exec(rest))) {
      cnl = true;
      last = "other";
    } else if ((m = TYPEWORD.exec(rest))) {
      typeWord = m[1].toUpperCase() as TypeWord;
      last = "other";
    } else break;
    rest = rest.slice(m[0].length);
  }
  const note = rest.trim();

  let noteTime: TimeTok | null = null;
  const nt = NOTE_TIME.exec(note);
  if (nt) noteTime = { tag: tag(nt[1]), raw: `${nt[2].padStart(2, "0")}.${nt[3]}` };

  return {
    prefix: fm[1].toUpperCase(),
    number: fm[2],
    suffix: (fm[3] ?? "").toUpperCase(),
    dep: { icao: st1[1].toUpperCase(), iata: st1[2].toUpperCase() },
    arr: { icao: st2[1].toUpperCase(), iata: st2[2].toUpperCase() },
    depTime: { tag: tag(t1[1]), raw: t1[2] },
    arrTime: { tag: tag(t2[1]), raw: t2[2] },
    dayTag,
    markers,
    cnl,
    typeWord,
    note,
    noteTime,
  };
}

// ---------------------------------------------------------------------------
// Times
// ---------------------------------------------------------------------------
export type ReadTime = { ok: true; minutes: number } | { ok: false; error: "malformed" | "range" };

/** HH.MM, HH:MM or HHMM. */
export function readTime(raw: string): ReadTime {
  const m = /^(\d{1,2})[.:](\d{2})$/.exec(raw) ?? /^(\d{2})(\d{2})$/.exec(raw);
  if (!m) return { ok: false, error: "malformed" };
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return { ok: false, error: "range" };
  return { ok: true, minutes: h * 60 + min };
}

const dotTime = (raw: string): string => {
  const r = readTime(raw);
  if (!r.ok) return raw;
  return `${String(Math.floor(r.minutes / 60)).padStart(2, "0")}.${String(r.minutes % 60).padStart(2, "0")}`;
};
const tokLabel = (t: TimeTok) => `${t.tag}/${dotTime(t.raw)}Z`;

// ---------------------------------------------------------------------------
// Flags. Several flags on one line: only the first is shown, precedence
// structure, time, station, prefix, marker, day tag, note.
// ---------------------------------------------------------------------------
const flag = (code: FlagCode, message: string, suggestion: ReviewSuggestion | null = null): ReviewFlag => ({ code, message, suggestion });

export function checkFields(f: Fields, ref: RawLine, pi: ParseIndex): ReviewFlag | null {
  // structure
  if (!pi.byReg.has(ref.aircraftReg))
    return flag("AIRCRAFT_UNKNOWN", `Aircraft ${ref.aircraftReg} is not in the Fleet registry.`, {
      label: `Add ${ref.aircraftReg} to the Fleet registry as incomplete`,
      patch: { kind: "addAircraft", registration: ref.aircraftReg },
    });
  if (!ref.dateIso) return flag("DATE_UNREADABLE", "No date or year could be read for this row.");

  // time
  const dep = readTime(f.depTime.raw);
  const arr = readTime(f.arrTime.raw);
  for (const [t, r] of [
    [f.depTime, dep],
    [f.arrTime, arr],
  ] as const) {
    if (!r.ok) {
      const typed = `${t.tag}/${t.raw}Z`;
      return r.error === "range"
        ? flag("TIME_OUT_OF_RANGE", `${typed} is not a time of day.`)
        : flag("TIME_MALFORMED", `${typed} is not a valid time. Use HH.MM, HH:MM or HHMM.`);
    }
  }
  if (f.depTime.tag === "ETA")
    return flag("ETA_FOR_ETD", `The first time is tagged ETA but is read as the departure.`, {
      label: `ETD/${dotTime(f.depTime.raw)}Z`,
      patch: { kind: "setTag", which: "dep", tag: "ETD" },
    });
  if (f.arrTime.tag === "ETD")
    return flag("ETD_FOR_ETA", `The second time is tagged ETD but is read as the arrival.`, {
      label: `ETA/${dotTime(f.arrTime.raw)}Z`,
      patch: { kind: "setTag", which: "arr", tag: "ETA" },
    });
  const depMin = (dep as { minutes: number }).minutes;
  const arrMin = (arr as { minutes: number }).minutes;
  if (depMin === arrMin) return flag("BLOCK_ZERO", "ETA equals ETD, so the block time is 00:00.");

  // station
  for (const [which, st] of [
    ["dep", f.dep],
    ["arr", f.arr],
  ] as const) {
    const known = pi.idx.byIcao.get(st.icao);
    if (!known) return flag("STATION_UNKNOWN", `Station ${st.icao}/${st.iata} is not in the Airport directory.`);
    if (known.iata !== st.iata)
      return flag("STATION_PAIR_MISMATCH", `${st.icao}/${st.iata} does not match the directory, where ${st.icao} is ${known.iata}.`, {
        label: `${known.icao}/${known.iata}`,
        patch: { kind: "setIata", which, iata: known.iata },
      });
  }
  if (f.dep.icao === f.arr.icao) return flag("SAME_STATION", `Departure and arrival are both ${f.dep.icao}/${f.dep.iata}.`);

  // prefix
  if (f.prefix !== pi.companyIcao)
    return flag("PREFIX_MISMATCH", `Flight prefix ${f.prefix} differs from the company designator ${pi.companyIcao}.`, {
      label: `${pi.companyIcao}${f.number}${f.suffix}`,
      patch: { kind: "setPrefix", prefix: pi.companyIcao },
    });

  // marker (CNL overrides it)
  if (f.markers.length > 1 && !f.cnl)
    return flag("MARKER_CONFLICT", `${f.markers.join(" ")} follow the arrival time. Both permit markers cannot apply.`);

  // day tag: n must equal the ISO weekday of the local arrival date
  if (f.dayTag !== null && pi.dayTagMode !== "ignore" && !isPlaceholder(f.arr.icao)) {
    const built = buildTimes(ref.dateIso, depMin, arrMin);
    const airport = pi.idx.byIcao.get(f.arr.icao)!;
    const derived = pi.dayTagMode === "departure_day" ? isoWeekday(ref.dateIso) : isoWeekday(utcDate(ms(built.etaUtc) + airport.utcOffsetMinutes * MIN));
    if (derived !== f.dayTag)
      return flag("DAYTAG_MISMATCH", `DAY ${f.dayTag} LT does not match the local arrival date, which is DAY ${derived} LT.`, {
        label: `DAY ${derived} LT`,
        patch: { kind: "setDayTag", n: derived },
      });
  }

  // note
  if (f.noteTime) {
    const structured = f.noteTime.tag === "ETA" ? arrMin : depMin;
    const nt = readTime(f.noteTime.raw);
    if (nt.ok && nt.minutes !== structured)
      return flag("NOTE_TIME_CONFLICT", `The note "${f.note}" contradicts ${tokLabel(f.noteTime.tag === "ETA" ? f.arrTime : f.depTime)}.`, {
        label: `Keep ${tokLabel(f.depTime)}, keep the text as a note`,
        patch: { kind: "dropNoteTime" },
      });
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------
export function buildRow(ref: RawLine, ctx: ParseCtx): ImportRow {
  const pi = indexCtx(ctx);
  const fields = scanLine(ref.text);
  let fl: ReviewFlag | null;
  if (!fields) {
    fl = pi.byReg.has(ref.aircraftReg)
      ? flag("UNPARSEABLE_LINE", "This line does not match a flight number followed by two station and time pairs.")
      : flag("AIRCRAFT_UNKNOWN", `Aircraft ${ref.aircraftReg} is not in the Fleet registry.`, {
          label: `Add ${ref.aircraftReg} to the Fleet registry as incomplete`,
          patch: { kind: "addAircraft", registration: ref.aircraftReg },
        });
  } else fl = checkFields(fields, ref, pi);
  return { id: ref.id, ref, fields, flag: fl, status: fl ? "flagged" : "ok", override: null, overridePermits: null, touched: false };
}

export function applySuggestion(f: Fields, p: SuggestionPatch): Fields {
  switch (p.kind) {
    case "setTag":
      return p.which === "dep" ? { ...f, depTime: { ...f.depTime, tag: p.tag } } : { ...f, arrTime: { ...f.arrTime, tag: p.tag } };
    case "setPrefix":
      return { ...f, prefix: p.prefix };
    case "setIata":
      return p.which === "dep" ? { ...f, dep: { ...f.dep, iata: p.iata } } : { ...f, arr: { ...f.arr, iata: p.iata } };
    case "setDayTag":
      return { ...f, dayTag: p.n };
    case "dropNoteTime":
      return { ...f, noteTime: null };
    case "addAircraft":
      return f;
  }
}

/** RV3: Accept fix changes the parsed fields, never the raw text, then reruns parsing and R6. */
export function acceptFix(row: ImportRow, ctx: ParseCtx): ImportRow {
  const s = row.flag?.suggestion;
  if (!s) return row;
  const pi = indexCtx(ctx);
  if (s.patch.kind === "addAircraft") {
    // the caller adds the aircraft to the registry first and passes a ctx that contains it
    return rebuild(row, row.fields, pi);
  }
  if (!row.fields) return row;
  return rebuild(row, applySuggestion(row.fields, s.patch), pi);
}

export type FieldEdit = Partial<{
  depRaw: string;
  arrRaw: string;
  depIcao: string;
  arrIcao: string;
  markers: ("+" | "-")[];
  dayTag: number | null;
}>;

/** Direct field edits (used by tests and by the corrected values of PRD 7.7). */
export function editFields(row: ImportRow, edit: FieldEdit, ctx: ParseCtx): ImportRow {
  if (!row.fields) return row;
  const pi = indexCtx(ctx);
  let f = row.fields;
  if (edit.depRaw !== undefined) f = { ...f, depTime: { tag: "ETD", raw: edit.depRaw } };
  if (edit.arrRaw !== undefined) f = { ...f, arrTime: { tag: "ETA", raw: edit.arrRaw } };
  if (edit.depIcao) {
    const a = pi.idx.byIcao.get(edit.depIcao);
    if (a) f = { ...f, dep: { icao: a.icao, iata: a.iata } };
  }
  if (edit.arrIcao) {
    const a = pi.idx.byIcao.get(edit.arrIcao);
    if (a) f = { ...f, arr: { icao: a.icao, iata: a.iata } };
  }
  if (edit.markers) f = { ...f, markers: edit.markers };
  if (edit.dayTag !== undefined) f = { ...f, dayTag: edit.dayTag };
  return rebuild(row, f, pi);
}

function rebuild(row: ImportRow, fields: Fields | null, pi: ParseIndex): ImportRow {
  const fl = fields ? checkFields(fields, row.ref, pi) : row.flag;
  return { ...row, fields, flag: fl, status: fl ? "flagged" : "fixed", touched: true };
}

/** The drawer saved a corrected leg: the row is Fixed and the saved leg is authoritative. */
export function saveFromDrawer(row: ImportRow, leg: Leg, permits: DraftPermit[]): ImportRow {
  return { ...row, override: leg, overridePermits: permits, flag: null, status: "fixed", touched: true };
}

export const countReview = (rows: ImportRow[]) => rows.filter((r) => r.status === "flagged").length;
export const countReady = (rows: ImportRow[]) => rows.filter((r) => r.status === "ok" || r.status === "fixed").length;
export const countSkipped = (rows: ImportRow[]) => rows.filter((r) => r.status === "skipped").length;

// ---------------------------------------------------------------------------
// Rows to legs and permits
// ---------------------------------------------------------------------------
export function permitStatusOf(row: ImportRow): PermitStatus | null {
  const f = row.fields;
  const st = row.ref.style;
  // precedence: CNL, strikethrough or red fill (cancelled), then marker, then green or amber fill
  if (f?.cnl || st.strike || st.fill === "red") return "cancelled";
  if (f && f.markers.length === 1) return f.markers[0] === "+" ? "obtained" : "pending";
  if (st.fill === "green") return "obtained";
  if (st.fill === "amber") return "pending";
  return null;
}

export function fieldsToLeg(row: ImportRow, ctx: ParseCtx): Leg | null {
  const f = row.fields;
  const pi = indexCtx(ctx);
  const ac = pi.byReg.get(row.ref.aircraftReg);
  if (!f || !ac || !row.ref.dateIso) return null;
  const dep = readTime(f.depTime.raw);
  const arr = readTime(f.arrTime.raw);
  if (!dep.ok || !arr.ok) return null;
  const times = buildTimes(row.ref.dateIso, dep.minutes, arr.minutes);
  if (!times.valid) return null;
  const depAirport = pi.idx.byIcao.get(f.dep.icao);
  const arrAirport = pi.idx.byIcao.get(f.arr.icao);
  if (!depAirport || !arrAirport) return null;

  let legType: LegType = "landing";
  if (f.typeWord === "FERRY" || f.dep.icao === PLACEHOLDER_ICAO || f.arr.icao === PLACEHOLDER_ICAO) legType = "ferry";
  else if (f.typeWord === "OVERFLIGHT") legType = "overflight";
  else if (f.typeWord === "TECHSTOP") legType = "technical_stop";

  const draft = { flightNumber: `${f.prefix}${f.number}`, suffix: (f.suffix === "D" ? "D" : "") as "" | "D", etdUtc: times.etdUtc, depIcao: depAirport.icao, aircraftId: ac.id };
  return {
    id: makeLegId(draft, pi.idx),
    ...draft,
    backupAircraftId: ac.defaultBackupId,
    legType,
    arrIcao: arrAirport.icao,
    etaUtc: times.etaUtc,
    status: permitStatusOf(row) === "cancelled" ? "cancelled" : "planned",
    notes: f.note,
    source: { kind: "import", sheetRef: { sheet: row.ref.sheet, cell: row.ref.cell, rawText: row.ref.text } },
  };
}

export interface ImportPayload {
  legs: Leg[];
  permits: Permit[];
}

/** Legs and permit rows for every importable row (unflagged and fixed). Permit rows carry no numbers. */
export function rowsToPayload(rows: ImportRow[], ctx: ParseCtx): ImportPayload {
  const pi = indexCtx(ctx);
  const legs: Leg[] = [];
  const permits: Permit[] = [];
  for (const row of rows) {
    if (row.status === "flagged" || row.status === "skipped") continue;
    const leg = row.override ? { ...row.override, source: { kind: "import" as const, sheetRef: { sheet: row.ref.sheet, cell: row.ref.cell, rawText: row.ref.text } } } : fieldsToLeg(row, ctx);
    if (!leg) continue;
    legs.push(leg);
    if (row.overridePermits) {
      // corrected in the drawer: exactly the rows the planner listed
      for (const d of row.overridePermits) permits.push(newPermit(leg, d, d.status, d.status === "obtained" && d.number.trim() ? d.number.trim() : null));
      continue;
    }
    const required = requiredPermits(leg.depIcao, leg.arrIcao, pi.rules);
    const status = permitStatusOf(row);
    for (const r of required) {
      const chosen = leg.status === "cancelled" ? "cancelled" : status;
      if (chosen) permits.push(newPermit(leg, r, chosen));
    }
  }
  return { legs, permits };
}

export { type ParseCtx };
