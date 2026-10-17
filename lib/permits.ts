import { isPlaceholder, type AirportIndex, COUNTRY_NAMES } from "./airports";
import { addDaysIso, iso, utcDate, dateMs, MIN, DAY } from "./time";
import type { CountryCode, Leg, Permit, PermitStatus, PermitType, StatePatch } from "./types";

export interface RequiredPermit {
  countryCode: CountryCode;
  type: PermitType;
}

const L = (countryCode: CountryCode): RequiredPermit => ({ countryCode, type: "landing" });
const O = (countryCode: CountryCode): RequiredPermit => ({ countryCode, type: "overflight" });

// Section 9.4. Keyed by the foreign station, relative to the base (TBS).
const FROM_BASE: Record<string, RequiredPermit[]> = {
  BEG: [L("RS"), O("RO")],
  ATH: [L("GR")],
  BUD: [L("HU"), O("RO")],
  OTP: [L("RO")],
  MXP: [L("IT"), O("RS")],
  FRL: [L("IT"), O("RS")],
  URC: [L("CN"), O("KZ")],
  XIY: [L("CN"), O("KZ")],
  ALA: [L("KZ")],
  DWC: [L("AE")],
  CCU: [L("IN"), O("AE")],
  HKG: [L("HK"), O("KZ"), O("CN")],
};
const TO_BASE: Record<string, RequiredPermit[]> = {
  BEG: [O("RO")],
  ATH: [],
  BUD: [O("RO")],
  OTP: [],
  MXP: [O("RS")],
  FRL: [O("RS")],
  URC: [O("KZ")],
  XIY: [O("KZ")],
  ALA: [],
  DWC: [],
  CCU: [O("AE")],
  HKG: [O("CN"), O("KZ")],
};

/**
 * Required permits for a route. Leg endpoints are looked up through the
 * airport index. Any leg touching the placeholder XXXX/XXX needs none.
 */
export function requiredPermits(depIcao: string, arrIcao: string, idx: AirportIndex, baseIcao = "UGTB"): RequiredPermit[] {
  if (isPlaceholder(depIcao) || isPlaceholder(arrIcao)) return [];
  const dep = idx.byIcao.get(depIcao);
  const arr = idx.byIcao.get(arrIcao);
  if (!dep || !arr || depIcao === arrIcao) return [];
  if (depIcao === baseIcao) return FROM_BASE[arr.iata] ?? foreignLanding(arr.countryCode);
  if (arrIcao === baseIcao) return TO_BASE[dep.iata] ?? [];
  // URC and XIY in either direction need China landing only.
  const cn = new Set(["URC", "XIY"]);
  if (cn.has(dep.iata) && cn.has(arr.iata)) return [L("CN")];
  return foreignLanding(arr.countryCode);
}

function foreignLanding(code: CountryCode): RequiredPermit[] {
  return code === "GE" || code === "XX" ? [] : [L(code)];
}

export const permitId = (legId: string, code: CountryCode, type: PermitType): string => `P-${legId}-${code}-${type}`;

export const permitLabel = (p: { countryCode: CountryCode; type: PermitType }): string =>
  `${COUNTRY_NAMES[p.countryCode]} ${p.type}`;

/** Validity runs from 00:00Z on the ETD date to 23:59Z on the next day. */
export function validityFor(etdUtc: string): { validFromUtc: string; validToUtc: string } {
  const d = utcDate(etdUtc);
  return {
    validFromUtc: iso(dateMs(d)),
    validToUtc: iso(dateMs(addDaysIso(d, 1)) + DAY - MIN),
  };
}

export function newPermit(leg: Pick<Leg, "id" | "etdUtc">, req: RequiredPermit, status: PermitStatus, number: string | null = null): Permit {
  return {
    id: permitId(leg.id, req.countryCode, req.type),
    legId: leg.id,
    countryCode: req.countryCode,
    type: req.type,
    number,
    status,
    ...validityFor(leg.etdUtc),
  };
}

export const permitKey = (p: { countryCode: CountryCode; type: PermitType }): string => `${p.countryCode}:${p.type}`;

/**
 * Rows for a leg after its route changed: rows still required are kept,
 * newly required ones are added as pending, rows no longer required are removed.
 */
export function syncPermitPatch(
  leg: Pick<Leg, "id" | "etdUtc" | "depIcao" | "arrIcao">,
  existing: Permit[],
  idx: AirportIndex,
  baseIcao: string,
): StatePatch {
  const need = requiredPermits(leg.depIcao, leg.arrIcao, idx, baseIcao);
  const needKeys = new Set(need.map(permitKey));
  const have = existing.filter((p) => p.legId === leg.id);
  const haveKeys = new Set(have.map(permitKey));
  const patch: StatePatch = [];
  for (const p of have) if (!needKeys.has(permitKey(p))) patch.push({ op: "remove", coll: "permits", id: p.id });
  for (const r of need)
    if (!haveKeys.has(permitKey(r))) patch.push({ op: "insert", coll: "permits", value: newPermit(leg, r, "pending") as never });
  return patch;
}
