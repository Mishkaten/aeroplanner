// Pure logic behind the leg drawer: form values, parsing and validation (PRD 6.3, R6).
import { resolveStation, type AirportIndex } from "./airports";
import { makeLegId } from "./legs";
import { buildTimes, parseHHMM, minutesOfDay, utcDate, fmtDuration, type BuiltTimes } from "./time";
import type { DomainState, Leg, LegType } from "./types";

export interface LegForm {
  fn: string; // prefix + number, e.g. "PHC509"
  dSuffix: boolean;
  type: LegType;
  ac: string;
  backup: string; // "" = none
  dep: string;
  arr: string;
  date: string; // YYYY-MM-DD
  etd: string; // HH:MM
  eta: string; // HH:MM
  notes: string;
}

export const LEG_TYPES: { value: LegType; label: string }[] = [
  { value: "landing", label: "Landing" },
  { value: "overflight", label: "Overflight" },
  { value: "technical_stop", label: "Technical stop" },
  { value: "ferry", label: "Ferry" },
];

const hhmm = (instant: string) => {
  const m = minutesOfDay(instant);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

export function formFromLeg(leg: Leg, idx: AirportIndex): LegForm {
  const st = (icao: string) => {
    const a = idx.byIcao.get(icao);
    return a ? `${a.icao}/${a.iata}` : icao;
  };
  return {
    fn: leg.flightNumber,
    dSuffix: leg.suffix === "D",
    type: leg.legType,
    ac: leg.aircraftId,
    backup: leg.backupAircraftId ?? "",
    dep: st(leg.depIcao),
    arr: st(leg.arrIcao),
    date: utcDate(leg.etdUtc),
    etd: hhmm(leg.etdUtc),
    eta: hhmm(leg.etaUtc),
    notes: leg.notes,
  };
}

export function blankForm(state: DomainState, idx: AirportIndex, draft: Partial<Leg> | undefined, defaultDate: string): LegForm {
  const base: LegForm = {
    fn: state.company.icao,
    dSuffix: false,
    type: "landing",
    ac: state.aircraft[0]?.id ?? "",
    backup: state.aircraft[0]?.defaultBackupId ?? "",
    dep: "",
    arr: "",
    date: defaultDate,
    etd: "",
    eta: "",
    notes: "",
  };
  if (!draft) return base;
  const filled = formFromLeg(
    {
      id: "",
      flightNumber: draft.flightNumber ?? state.company.icao,
      suffix: draft.suffix ?? "",
      aircraftId: draft.aircraftId ?? base.ac,
      backupAircraftId: draft.backupAircraftId ?? state.aircraft.find((a) => a.id === (draft.aircraftId ?? base.ac))?.defaultBackupId ?? null,
      legType: draft.legType ?? "landing",
      depIcao: draft.depIcao ?? "",
      arrIcao: draft.arrIcao ?? "",
      etdUtc: draft.etdUtc ?? `${defaultDate}T00:00:00Z`,
      etaUtc: draft.etaUtc ?? `${defaultDate}T00:00:00Z`,
      status: "planned",
      notes: draft.notes ?? "",
      source: { kind: "manual" },
    },
    idx,
  );
  if (!draft.etdUtc) {
    filled.etd = "";
    filled.eta = "";
  }
  return filled;
}

export interface FormErrors {
  fn?: string;
  dep?: string;
  arr?: string;
  date?: string;
  etd?: string;
  eta?: string;
  ac?: string;
}

export interface FormResult {
  errors: FormErrors;
  /** Not blocking: shown under the field. */
  warnings: { fn?: string; eta?: string };
  times: BuiltTimes | null;
  depIcao: string | null;
  arrIcao: string | null;
  ok: boolean;
}

export const FLIGHT_RE = /^[A-Z]{3}\d{1,4}$/;

/** Normalises a typed flight number: upper case, spaces removed, a trailing D moved to the suffix toggle. */
export function normaliseFlight(text: string, dSuffix: boolean): { fn: string; dSuffix: boolean } {
  const t = text.toUpperCase().replace(/\s+/g, "");
  if (/^[A-Z]{3}\d{1,4}D$/.test(t)) return { fn: t.slice(0, -1), dSuffix: true };
  return { fn: t, dSuffix };
}

export function evaluateForm(form: LegForm, state: DomainState, idx: AirportIndex): FormResult {
  const errors: FormErrors = {};
  const warnings: FormResult["warnings"] = {};

  const fn = form.fn.toUpperCase().replace(/\s+/g, "");
  if (!FLIGHT_RE.test(fn)) errors.fn = "Enter a flight number like PHC509";
  else if (!fn.startsWith(state.company.icao)) warnings.fn = `Prefix differs from company designator ${state.company.icao}`;

  const dep = resolveStation(form.dep, idx);
  const arr = resolveStation(form.arr, idx);
  if (!form.dep.trim()) errors.dep = "Choose a departure station";
  else if (!dep) errors.dep = "Unknown station. Use ICAO/IATA from the Airport directory.";
  if (!form.arr.trim()) errors.arr = "Choose an arrival station";
  else if (!arr) errors.arr = "Unknown station. Use ICAO/IATA from the Airport directory.";
  else if (dep && dep.icao === arr.icao) errors.arr = "Arrival must differ from departure";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date) || Number.isNaN(Date.parse(`${form.date}T00:00:00Z`))) errors.date = "Enter a departure date";
  if (!state.aircraft.some((a) => a.id === form.ac)) errors.ac = "Choose an aircraft";

  const etdMin = parseHHMM(form.etd);
  const etaMin = parseHHMM(form.eta);
  if (etdMin === null) errors.etd = "Enter ETD as HH:MM (UTC)";
  if (etaMin === null) errors.eta = "Enter ETA as HH:MM (UTC)";

  let times: BuiltTimes | null = null;
  if (!errors.date && etdMin !== null && etaMin !== null) {
    times = buildTimes(form.date, etdMin, etaMin);
    if (!times.valid) errors.eta = "ETA must differ from ETD";
    else if (times.warning) warnings.eta = "Block time is longer than 18 h";
  }

  return {
    errors,
    warnings,
    times,
    depIcao: dep?.icao ?? null,
    arrIcao: arr?.icao ?? null,
    ok: Object.keys(errors).length === 0,
  };
}

export function blockText(times: BuiltTimes | null): string {
  return times && times.valid ? fmtDuration(times.blockMinutes) : "--:--";
}

/** Builds the stored leg from a valid form. Returns null when the form has errors. */
export function legFromForm(
  form: LegForm,
  result: FormResult,
  state: DomainState,
  idx: AirportIndex,
  existing: Leg | null,
): Leg | null {
  if (!result.ok || !result.times || !result.depIcao || !result.arrIcao) return null;
  const { fn, dSuffix } = normaliseFlight(form.fn, form.dSuffix);
  const draft = {
    flightNumber: fn,
    suffix: (dSuffix ? "D" : "") as "" | "D",
    etdUtc: result.times.etdUtc,
    depIcao: result.depIcao,
    aircraftId: form.ac,
  };
  const reg = state.aircraft.find((a) => a.id === form.ac);
  void reg;
  return {
    id: existing?.id ?? makeLegId(draft, idx),
    flightNumber: draft.flightNumber,
    suffix: draft.suffix,
    aircraftId: form.ac,
    backupAircraftId: form.backup || null,
    legType: form.type,
    depIcao: result.depIcao,
    arrIcao: result.arrIcao,
    etdUtc: result.times.etdUtc,
    etaUtc: result.times.etaUtc,
    status: existing?.status ?? "planned",
    notes: form.notes.trim(),
    source: existing?.source ?? { kind: "manual" },
  };
}
