// Pure validation for the Fleet registry and Company profile forms (PRD 6.7, 6.9).
import { resolveStation, type AirportIndex } from "./airports";
import type { Aircraft, AircraftStatus, Airport, Company, PermitRule } from "./types";

/** Suggestions only: the type field takes any text. */
export const AIRCRAFT_TYPES: string[] = ["B737-800SF", "B737-800BCF", "B767-300ER"];
export const REG_RE = /^[A-Z0-9]{2,3}-[A-Z]{3}$/;

export interface AircraftForm {
  registration: string;
  type: string;
  serialNo: string;
  year: string;
  mtow: string;
  payload: string;
  status: AircraftStatus;
  backup: string;
}

export const blankAircraftForm = (): AircraftForm => ({ registration: "", type: "B737-800SF", serialNo: "", year: "", mtow: "", payload: "", status: "active", backup: "" });

export function aircraftToForm(a: Aircraft): AircraftForm {
  return {
    registration: a.registration,
    type: a.type,
    serialNo: a.serialNo ?? "",
    year: a.yearOfManufacture === null ? "" : String(a.yearOfManufacture),
    mtow: a.mtowKg === null ? "" : String(a.mtowKg),
    payload: a.cargoPayloadKg === null ? "" : String(a.cargoPayloadKg),
    status: a.status,
    backup: a.defaultBackupId ?? "",
  };
}

const intOrNull = (t: string): number | null | "bad" => {
  const s = t.replace(/[,\s]/g, "");
  if (!s) return null;
  return /^\d+$/.test(s) ? Number(s) : "bad";
};

export interface AircraftResult {
  errors: Partial<Record<keyof AircraftForm, string>>;
  value: Aircraft | null;
}

/** Registration must be unique and match 2 to 3 letters or digits, a dash and 3 letters (for example 4L-PXE). */
export function validateAircraft(form: AircraftForm, fleet: Aircraft[], editingId: string | null): AircraftResult {
  const errors: AircraftResult["errors"] = {};
  const reg = form.registration.trim().toUpperCase();
  if (!REG_RE.test(reg)) errors.registration = "Use 2 to 3 letters or digits, a dash and 3 letters, for example 4L-PXE";
  else if (fleet.some((a) => a.id !== editingId && a.registration === reg)) errors.registration = `${reg} is already in the registry`;

  const year = intOrNull(form.year);
  const mtow = intOrNull(form.mtow);
  const payload = intOrNull(form.payload);
  if (year === "bad" || (typeof year === "number" && (year < 1950 || year > 2030))) errors.year = "Enter a year between 1950 and 2030";
  if (mtow === "bad") errors.mtow = "Enter whole kilograms";
  if (payload === "bad") errors.payload = "Enter whole kilograms";
  if (form.backup && form.backup === editingId) errors.backup = "An aircraft cannot back up itself";
  if (Object.keys(errors).length) return { errors, value: null };

  return {
    errors,
    value: {
      id: editingId ?? reg,
      registration: reg,
      type: form.type,
      serialNo: form.serialNo.trim() || null,
      yearOfManufacture: year as number | null,
      mtowKg: mtow as number | null,
      cargoPayloadKg: payload as number | null,
      status: form.status,
      defaultBackupId: form.backup || null,
    },
  };
}

/** A registry row is "Incomplete" when serialNo, yearOfManufacture, mtowKg or cargoPayloadKg is null. */
export function missingFields(a: Aircraft): string[] {
  const out: string[] = [];
  if (a.serialNo === null) out.push("serial number");
  if (a.yearOfManufacture === null) out.push("year of manufacture");
  if (a.mtowKg === null) out.push("MTOW");
  if (a.cargoPayloadKg === null) out.push("cargo payload");
  return out;
}

export interface CompanyForm {
  legalName: string;
  vatNumber: string;
  icao: string;
  iata: string;
  aocNumber: string;
  base: string;
  address: string;
  opsContact: string;
  checklistHeaderText: string;
  minGround: string;
  dayTagMode: Company["dayTagMode"];
}

export function companyToForm(c: Company, idx: AirportIndex): CompanyForm {
  const b = idx.byIcao.get(c.baseIcao);
  return {
    legalName: c.legalName,
    vatNumber: c.vatNumber,
    icao: c.icao,
    iata: c.iata,
    aocNumber: c.aocNumber,
    base: b ? `${b.icao}/${b.iata}` : c.baseIcao,
    address: c.address,
    opsContact: c.opsContact,
    checklistHeaderText: c.checklistHeaderText,
    minGround: String(c.minGroundMinutes),
    dayTagMode: c.dayTagMode ?? "arrival_local",
  };
}

export interface CompanyResult {
  errors: Partial<Record<keyof CompanyForm, string>>;
  value: Company | null;
}

export function validateCompany(form: CompanyForm, current: Company, idx: AirportIndex): CompanyResult {
  const errors: CompanyResult["errors"] = {};
  if (!form.legalName.trim()) errors.legalName = "Enter the legal name";
  if (!/^[A-Za-z]{3}$/.test(form.icao.trim())) errors.icao = "The ICAO designator is 3 letters";
  if (!/^[A-Za-z0-9]{2}$/.test(form.iata.trim())) errors.iata = "The IATA designator is 2 characters";
  const mg = Number(form.minGround);
  if (!Number.isInteger(mg) || mg < 0 || mg > 1440) errors.minGround = "Whole minutes, 0 to 1440";
  const base = resolveStation(form.base, idx);
  if (!base || base.provisional) errors.base = "The base must be an airport in the Airport directory";
  if (Object.keys(errors).length) return { errors, value: null };
  return {
    errors,
    value: {
      ...current,
      legalName: form.legalName.trim(),
      vatNumber: form.vatNumber.trim(),
      icao: form.icao.trim().toUpperCase(),
      iata: form.iata.trim().toUpperCase(),
      aocNumber: form.aocNumber.trim(),
      baseIcao: base!.icao,
      address: form.address.trim(),
      opsContact: form.opsContact.trim(),
      checklistHeaderText: form.checklistHeaderText.trim(),
      minGroundMinutes: mg,
      dayTagMode: form.dayTagMode,
    },
  };
}

export const MAX_LOGO_BYTES = 500 * 1024;

export function logoProblem(file: { type: string; size: number; name: string }): string | null {
  const okType = file.type === "image/png" || file.type === "image/svg+xml" || /\.(png|svg)$/i.test(file.name);
  if (!okType) return "Use a PNG or SVG file.";
  if (file.size > MAX_LOGO_BYTES) return "The logo must be 500 KB or smaller.";
  return null;
}

// ---------------------------------------------------------------------------
// Airports
// ---------------------------------------------------------------------------
export interface AirportForm {
  icao: string;
  iata: string;
  name: string;
  countryCode: string;
  offset: string; // "+5:30", "-3", "4"
  lat: string;
  lon: string;
}

export const blankAirportForm = (): AirportForm => ({ icao: "", iata: "", name: "", countryCode: "", offset: "+0:00", lat: "", lon: "" });

export function airportToForm(a: Airport): AirportForm {
  const sign = a.utcOffsetMinutes < 0 ? "-" : "+";
  const m = Math.abs(a.utcOffsetMinutes);
  return {
    icao: a.icao,
    iata: a.iata,
    name: a.name,
    countryCode: a.countryCode,
    offset: `${sign}${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`,
    lat: a.lat === null ? "" : String(a.lat),
    lon: a.lon === null ? "" : String(a.lon),
  };
}

/** "+5:30", "-3", "4:00", "+0530" to minutes, or null. */
export function parseOffset(text: string): number | null {
  const m = /^([+-]?)(\d{1,2})(?::?(\d{2}))?$/.exec(text.trim());
  if (!m) return null;
  const mins = Number(m[2]) * 60 + Number(m[3] ?? 0);
  if (mins > 14 * 60 || Number(m[3] ?? 0) > 59) return null;
  return m[1] === "-" ? -mins : mins;
}

export interface AirportResult {
  errors: Partial<Record<keyof AirportForm, string>>;
  value: Airport | null;
}

export function validateAirport(form: AirportForm, all: Airport[], editingId: string | null): AirportResult {
  const errors: AirportResult["errors"] = {};
  const icao = form.icao.trim().toUpperCase();
  const iata = form.iata.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(icao)) errors.icao = "ICAO is 4 letters";
  else if (all.some((a) => a.id !== editingId && a.icao === icao)) errors.icao = `${icao} is already in the directory`;
  if (!/^[A-Z]{3}$/.test(iata)) errors.iata = "IATA is 3 letters";
  else if (all.some((a) => a.id !== editingId && a.iata === iata)) errors.iata = `${iata} is already in the directory`;
  if (!form.name.trim()) errors.name = "Enter the airport name";
  const cc = form.countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) errors.countryCode = "Country is a 2 letter code, for example GE";
  const off = parseOffset(form.offset);
  if (off === null) errors.offset = "Use hours from UTC, for example +4 or +5:30";
  const num = (t: string, lo: number, hi: number) => (t.trim() === "" ? null : Number(t) >= lo && Number(t) <= hi ? Number(t) : ("bad" as const));
  const lat = num(form.lat, -90, 90);
  const lon = num(form.lon, -180, 180);
  if (lat === "bad") errors.lat = "Latitude is -90 to 90";
  if (lon === "bad") errors.lon = "Longitude is -180 to 180";
  if (Object.keys(errors).length) return { errors, value: null };
  return {
    errors,
    value: { id: editingId ?? icao, icao, iata, name: form.name.trim(), countryCode: cc, utcOffsetMinutes: off as number, lat: lat as number | null, lon: lon as number | null, provisional: false },
  };
}

// ---------------------------------------------------------------------------
// Permit rules
// ---------------------------------------------------------------------------
export interface RuleForm {
  a: string;
  b: string;
  both: boolean;
  countryCode: string;
  type: "landing" | "overflight";
}

export function validateRule(form: RuleForm, airports: Airport[], rules: PermitRule[]): { error: string | null; value: PermitRule | null } {
  const a = resolveStation(form.a, indexAirportsLocal(airports));
  const b = resolveStation(form.b, indexAirportsLocal(airports));
  if (!a) return { error: "Departure station is not in the Airport directory", value: null };
  if (!b) return { error: "Arrival station is not in the Airport directory", value: null };
  if (a.icao === b.icao) return { error: "The two stations must differ", value: null };
  const cc = form.countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return { error: "Country is a 2 letter code, for example RS", value: null };
  const id = `R-${a.icao}-${b.icao}-${cc}-${form.type}`;
  if (rules.some((r) => r.id === id)) return { error: "That rule already exists", value: null };
  return { error: null, value: { id, aIcao: a.icao, bIcao: b.icao, both: form.both, countryCode: cc, type: form.type } };
}

import { indexAirports as indexAirportsLocal } from "./airports";
