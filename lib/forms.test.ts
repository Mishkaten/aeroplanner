import { describe, expect, it } from "vitest";
import { blankAircraftForm, logoProblem, missingFields, validateAircraft, validateCompany, companyToForm } from "./forms";
import { fullDemoState } from "./seed";
import { indexAirports } from "./airports";

const s = fullDemoState();
const idx = indexAirports(s.airports);

describe("fleet form (S7)", () => {
  it("S7-2 registration must match the pattern and be unique", () => {
    const f = { ...blankAircraftForm(), registration: "4l-pxe" };
    expect(validateAircraft(f, s.aircraft, null).value?.registration).toBe("4L-PXE");
    expect(validateAircraft({ ...f, registration: "4L-PXA" }, s.aircraft, null).errors.registration).toMatch(/already/);
    expect(validateAircraft({ ...f, registration: "PXE" }, s.aircraft, null).errors.registration).toMatch(/dash/);
    expect(validateAircraft({ ...f, registration: "ABCD-PXE" }, s.aircraft, null).errors.registration).toBeTruthy();
  });
  it("S7-5 empty fields are allowed and flagged as incomplete", () => {
    const v = validateAircraft({ ...blankAircraftForm(), registration: "4L-PXE" }, s.aircraft, null).value!;
    expect(missingFields(v)).toEqual(["serial number", "year of manufacture", "MTOW", "cargo payload"]);
    expect(missingFields(s.aircraft[3])).toEqual(["cargo payload"]);
    expect(missingFields(s.aircraft[0])).toEqual([]);
  });
  it("keeps the id when the registration is edited", () => {
    const a = s.aircraft[0];
    const v = validateAircraft({ ...blankAircraftForm(), registration: "4L-PXZ" }, s.aircraft, a.id).value!;
    expect([v.id, v.registration]).toEqual([a.id, "4L-PXZ"]);
  });
});

describe("company form (S9)", () => {
  const form = companyToForm(s.company, idx);
  it("S9-3 blocks an ICAO that is not 3 letters, an IATA that is not 2 characters and an unknown base", () => {
    expect(validateCompany({ ...form, icao: "PH" }, s.company, idx).errors.icao).toBeTruthy();
    expect(validateCompany({ ...form, iata: "P" }, s.company, idx).errors.iata).toBeTruthy();
    expect(validateCompany({ ...form, base: "ZZZZ" }, s.company, idx).errors.base).toBeTruthy();
    expect(validateCompany({ ...form, base: "XXXX/XXX" }, s.company, idx).errors.base).toBeTruthy();
    expect(validateCompany(form, s.company, idx).value).not.toBeNull();
  });
  it("accepts the base as IATA, ICAO or both", () => {
    expect(validateCompany({ ...form, base: "tbs" }, s.company, idx).value?.baseIcao).toBe("UGTB");
  });
  it("S9-2 only PNG or SVG up to 500 KB", () => {
    expect(logoProblem({ name: "a.png", type: "image/png", size: 1000 })).toBeNull();
    expect(logoProblem({ name: "a.svg", type: "image/svg+xml", size: 1000 })).toBeNull();
    expect(logoProblem({ name: "a.jpg", type: "image/jpeg", size: 1000 })).toMatch(/PNG or SVG/);
    expect(logoProblem({ name: "a.png", type: "image/png", size: 600 * 1024 })).toMatch(/500 KB/);
  });
});
