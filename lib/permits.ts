import { isPlaceholder, type AirportIndex, COUNTRY_NAMES } from "./airports";
import { addDaysIso, iso, utcDate, dateMs, MIN, DAY } from "./time";
import type { CountryCode, Leg, Permit, PermitRule, PermitStatus, PermitType, StatePatch } from "./types";

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
export function legacyRequiredPermits(depIcao: string, arrIcao: string, idx: AirportIndex, baseIcao = "UGTB"): RequiredPermit[] {
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

/**
 * Required permits for a route, from the permit rules the planner entered. A rule matches the station pair,
 * and when it is marked both ways, the reverse direction too. Legs touching the placeholder need none.
 */
export function requiredPermits(depIcao: string, arrIcao: string, rules: PermitRule[]): RequiredPermit[] {
  if (isPlaceholder(depIcao) || isPlaceholder(arrIcao) || depIcao === arrIcao) return [];
  const out: RequiredPermit[] = [];
  const seen = new Set<string>();
  for (const r of rules) {
    const hit = (r.aIcao === depIcao && r.bIcao === arrIcao) || (r.both && r.aIcao === arrIcao && r.bIcao === depIcao);
    if (!hit) continue;
    const k = `${r.countryCode}:${r.type}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ countryCode: r.countryCode, type: r.type });
  }
  return out;
}

/** The demo route table of PRD 9.4 as explicit rules, one per direction of every route in the seed. */
export function demoPermitRules(pairs: [string, string][], idx: AirportIndex): PermitRule[] {
  const rules: PermitRule[] = [];
  for (const [a, b] of pairs) {
    legacyRequiredPermits(a, b, idx).forEach((r) =>
      rules.push({ id: `R-${a}-${b}-${r.countryCode}-${r.type}`, aIcao: a, bIcao: b, both: false, countryCode: r.countryCode, type: r.type }),
    );
  }
  return rules;
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

/** A permit row as edited in the leg drawer. Permits are entered by hand: the route table only suggests. */
export interface DraftPermit {
  countryCode: CountryCode;
  type: PermitType;
  status: PermitStatus;
  /** Free text. Empty means "Not entered". */
  number: string;
}

/** Patch that makes the stored rows of a leg equal to the draft list (remove, update, insert). */
export function draftPermitPatch(leg: Pick<Leg, "id" | "etdUtc">, existing: Permit[], draft: DraftPermit[]): StatePatch {
  const have = new Map(existing.filter((p) => p.legId === leg.id).map((p) => [permitKey(p), p]));
  const keep = new Set(draft.map(permitKey));
  const patch: StatePatch = [];
  for (const [k, p] of have) if (!keep.has(k)) patch.push({ op: "remove", coll: "permits", id: p.id });
  for (const d of draft) {
    const number = d.status === "obtained" && d.number.trim() ? d.number.trim() : null;
    const row = have.get(permitKey(d));
    if (row) patch.push({ op: "set", coll: "permits", id: row.id, value: { status: d.status, number } });
    else patch.push({ op: "insert", coll: "permits", value: newPermit(leg, d, d.status, number) as never });
  }
  return patch;
}

export const permitKey =(p: { countryCode: CountryCode; type: PermitType }): string => `${p.countryCode}:${p.type}`;
