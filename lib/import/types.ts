import type { Aircraft, Airport, Company, Leg, PermitStatus } from "../types";

export type FlagCode =
  | "UNPARSEABLE_LINE"
  | "AIRCRAFT_UNKNOWN"
  | "DATE_UNREADABLE"
  | "TIME_MALFORMED"
  | "TIME_OUT_OF_RANGE"
  | "ETA_FOR_ETD"
  | "ETD_FOR_ETA"
  | "BLOCK_ZERO"
  | "STATION_UNKNOWN"
  | "STATION_PAIR_MISMATCH"
  | "SAME_STATION"
  | "PREFIX_MISMATCH"
  | "MARKER_CONFLICT"
  | "DAYTAG_MISMATCH"
  | "NOTE_TIME_CONFLICT";

export type TypeWord = "FERRY" | "OVERFLIGHT" | "TECHSTOP";

export interface TimeTok {
  tag: "ETD" | "ETA";
  /** The value as typed, without the Z: "03.30", "03:30", "0330", "09.3". */
  raw: string;
}

/** The parsed fields of one leg line. Accept fix changes these, never the raw text (RV3). */
export interface Fields {
  prefix: string;
  number: string;
  suffix: string;
  dep: { icao: string; iata: string };
  arr: { icao: string; iata: string };
  depTime: TimeTok;
  arrTime: TimeTok;
  dayTag: number | null;
  markers: ("+" | "-")[];
  cnl: boolean;
  typeWord: TypeWord | null;
  note: string;
  /** A third time token inside the note that contradicts a structured time. */
  noteTime: TimeTok | null;
}

export type SuggestionPatch =
  | { kind: "setTag"; which: "dep" | "arr"; tag: "ETD" | "ETA" }
  | { kind: "setPrefix"; prefix: string }
  | { kind: "setIata"; which: "dep" | "arr"; iata: string }
  | { kind: "setDayTag"; n: number }
  | { kind: "dropNoteTime" }
  | { kind: "addAircraft"; registration: string };

export interface ReviewSuggestion {
  label: string;
  patch: SuggestionPatch;
}

export interface ReviewFlag {
  code: FlagCode;
  message: string;
  suggestion: ReviewSuggestion | null;
}

export interface CellStyle {
  fill: "green" | "amber" | "red" | null;
  strike: boolean;
}

/** One non-empty cell line of a leg cell, with where it came from. */
export interface RawLine {
  id: string; // `${cell}#${line}`
  sheet: string;
  cell: string; // "B7", plus " line 2" for multi-line cells
  text: string;
  aircraftReg: string;
  /** UTC calendar date of the row, null when the date label could not be read. */
  dateIso: string | null;
  style: CellStyle;
}

export type RowStatus = "ok" | "flagged" | "fixed";

export interface ImportRow {
  id: string;
  ref: RawLine;
  fields: Fields | null;
  flag: ReviewFlag | null;
  status: RowStatus;
  /** Saved from the leg drawer: authoritative once set. */
  override: Leg | null;
  overridePermits: Record<string, PermitStatus> | null;
  /** True once the user fixed the row (accept fix or drawer). */
  touched: boolean;
}

export interface SheetStructure {
  sheet: string;
  aircraftHeaders: number;
  banners: number;
  dateLabels: number;
  legLines: number;
  /** Non-empty cell lines: leg lines plus structure lines. */
  rows: number;
}

export interface ParseCtx {
  companyIcao: string;
  baseIcao: string;
  airports: Airport[];
  aircraft: Pick<Aircraft, "id" | "registration" | "defaultBackupId">[];
}

export interface WorkbookResult {
  fileName: string;
  structure: SheetStructure;
  lines: RawLine[];
  /** Registrations found in the header row that are not in the Fleet registry. */
  unknownAircraft: string[];
}

export type { Company };
