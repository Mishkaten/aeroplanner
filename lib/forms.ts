// Pure validation for the Fleet registry and Company profile forms (PRD 6.7, 6.9).
import { resolveStation, type AirportIndex } from "./airports";
import type { Aircraft, AircraftStatus, AircraftType, Company } from "./types";

export const AIRCRAFT_TYPES: AircraftType[] = ["B737-800SF", "B737-800BCF", "B767-300ER"];
export const REG_RE = /^[A-Z0-9]{2,3}-[A-Z]{3}$/;

export interface AircraftForm {
  registration: string;
  type: AircraftType;
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
