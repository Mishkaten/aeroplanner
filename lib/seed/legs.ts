import { indexAirports } from "../airports";
import { makeLegId } from "../legs";
import { demoPermitRules, newPermit, requiredPermits } from "../permits";
import { addDaysIso, buildTimes, parseHHMM, ms } from "../time";
import type { Aircraft, Leg, LegType, MaintenanceBlock, Permit, PermitRule } from "../types";
import { SEED_AIRPORTS } from "./airports";

export const SEASON_START = "2026-09-14"; // Mon, day 1 of week 1
export const WEEKS = 3;

type Tail = "A" | "B" | "C" | "D";
const REG = (t: Tail) => `4L-PX${t}`;

interface PatternLeg {
  day: number; // 0 = Monday
  ac: Tail;
  flight: string;
  dep: string;
  arr: string;
  etd: string;
  eta: string;
}

const P = (day: number, ac: Tail, flight: string, dep: string, arr: string, etd: string, eta: string): PatternLeg => ({
  day,
  ac,
  flight,
  dep,
  arr,
  etd,
  eta,
});

// Section 9.5. Weekly pattern, 28 legs, repeated in weeks 1, 2 and 3. Every leg is type landing.
export const WEEKLY_PATTERN: PatternLeg[] = [
  P(0, "A", "PHC501", "UGTB", "LYBE", "03:30", "06:30"),
  P(0, "A", "PHC502", "LYBE", "UGTB", "08:00", "11:00"),
  P(0, "C", "PHC601", "UGTB", "UAAA", "16:00", "20:30"),
  P(1, "C", "PHC602", "UAAA", "UGTB", "02:00", "06:30"),
  P(1, "D", "PHC603", "UGTB", "OMDW", "02:00", "06:00"),
  P(1, "B", "PHC503", "UGTB", "LHBP", "04:00", "07:30"),
  P(1, "D", "PHC604", "OMDW", "UGTB", "08:00", "12:00"),
  P(1, "B", "PHC504", "LHBP", "UGTB", "09:00", "12:30"),
  P(2, "C", "PHC611", "UGTB", "ZWWW", "02:00", "07:30"),
  P(2, "A", "PHC507", "UGTB", "LGAV", "04:00", "07:00"),
  P(2, "A", "PHC508", "LGAV", "UGTB", "08:30", "11:30"),
  P(2, "C", "PHC611", "ZWWW", "ZLXY", "09:30", "12:30"),
  P(3, "C", "PHC612", "ZLXY", "ZWWW", "02:00", "05:00"),
  P(3, "B", "PHC511", "UGTB", "LIPK", "03:00", "07:00"),
  P(3, "C", "PHC612", "ZWWW", "UGTB", "07:00", "12:30"),
  P(3, "B", "PHC512", "LIPK", "UGTB", "09:00", "13:00"),
  P(3, "D", "PHC605", "UGTB", "UAAA", "18:00", "22:30"),
  P(4, "D", "PHC606", "UAAA", "UGTB", "01:00", "05:30"),
  P(4, "A", "PHC509", "UGTB", "LROP", "05:00", "07:30"),
  P(4, "A", "PHC510", "LROP", "UGTB", "09:00", "11:30"),
  P(4, "D", "PHC613", "UGTB", "VECC", "19:00", "01:30"),
  P(5, "A", "PHC513", "UGTB", "LIMC", "02:00", "06:30"),
  P(5, "B", "PHC515", "UGTB", "LYBE", "05:00", "08:00"),
  P(5, "A", "PHC514", "LIMC", "UGTB", "08:30", "13:00"),
  P(5, "B", "PHC516", "LYBE", "UGTB", "09:30", "12:30"),
  P(6, "B", "PHC517", "UGTB", "LGAV", "04:30", "07:30"),
  P(6, "B", "PHC518", "LGAV", "UGTB", "09:00", "12:00"),
  P(6, "D", "PHC614", "VECC", "UGTB", "20:30", "03:00"),
];

interface ExtraLeg extends PatternLeg {
  date: string;
  type?: LegType;
}

// Section 9.6. Six extra legs (84 pattern legs plus 6 gives 90).
const X = (date: string, ac: Tail, flight: string, dep: string, arr: string, etd: string, eta: string, type: LegType = "landing"): ExtraLeg => ({
  ...P(0, ac, flight, dep, arr, etd, eta),
  date,
  type,
});

export const PLANTED_EXTRAS: ExtraLeg[] = [
  X("2026-09-16", "B", "PHC507D", "UGTB", "LGAV", "04:00", "07:00"),
  X("2026-09-16", "B", "PHC508D", "LGAV", "UGTB", "08:30", "11:30"),
  X("2026-09-18", "B", "PHC509", "UGTB", "LROP", "06:00", "08:30"),
  X("2026-09-18", "B", "PHC520", "LROP", "UGTB", "10:00", "12:30"),
  X("2026-09-23", "D", "PHC901", "UGTB", "XXXX", "08:00", "12:00", "ferry"),
  X("2026-09-24", "D", "PHC902", "XXXX", "UGTB", "08:00", "12:00", "ferry"),
];

// Leg notes in the seed (section 9.7), keyed by leg id.
const SEED_NOTES: Record<string, string> = {
  "L-20260916-PHC611-TBS-C": "Confirm handling agent at URC",
  "L-20260916-PHC507D-TBS-B": "Deliver to dock 4",
  "L-20260918-PHC613-TBS-D": "ETD 19.30Z TBC",
  "L-20260921-PHC601-TBS-C": "Cargo: perishables",
  "L-20260923-PHC901-TBS-D": "Destination to be decided",
};

const idx = indexAirports(SEED_AIRPORTS);

function splitFlight(full: string): { flightNumber: string; suffix: "" | "D" } {
  return full.endsWith("D") ? { flightNumber: full.slice(0, -1), suffix: "D" } : { flightNumber: full, suffix: "" };
}

function makeLeg(date: string, p: PatternLeg, type: LegType, aircraft: Aircraft[]): Leg {
  const t = buildTimes(date, parseHHMM(p.etd)!, parseHHMM(p.eta)!);
  const { flightNumber, suffix } = splitFlight(p.flight);
  const aircraftId = REG(p.ac);
  const draft = { flightNumber, suffix, etdUtc: t.etdUtc, depIcao: p.dep, aircraftId };
  const id = makeLegId(draft, idx);
  return {
    id,
    flightNumber,
    suffix,
    aircraftId,
    backupAircraftId: aircraft.find((a) => a.id === aircraftId)?.defaultBackupId ?? null,
    legType: type,
    depIcao: p.dep,
    arrIcao: p.arr,
    etdUtc: t.etdUtc,
    etaUtc: t.etaUtc,
    status: "planned",
    notes: SEED_NOTES[id] ?? "",
    source: { kind: "seed" },
  };
}

export interface SeedOptions {
  /** Stress mode: repeat the 28-leg weekly pattern for 36 weeks, cut at this many legs, no planted exceptions. */
  stressLegs?: number;
}

export function seedLegs(aircraft: Aircraft[], opts: SeedOptions = {}): Leg[] {
  if (opts.stressLegs) {
    const out: Leg[] = [];
    for (let w = 0; out.length < opts.stressLegs && w < 36; w++) {
      for (const p of WEEKLY_PATTERN) {
        if (out.length >= opts.stressLegs) break;
        out.push(makeLeg(addDaysIso(SEASON_START, w * 7 + p.day), p, "landing", aircraft));
      }
    }
    return out.sort((a, b) => ms(a.etdUtc) - ms(b.etdUtc) || (a.id < b.id ? -1 : 1));
  }

  const legs: Leg[] = [];
  for (let w = 0; w < WEEKS; w++) {
    for (const p of WEEKLY_PATTERN) {
      let pattern = p;
      const date = addDaysIso(SEASON_START, w * 7 + p.day);
      // Changes to pattern legs (section 9.6)
      if (w === 0 && p.flight === "PHC512") pattern = { ...p, dep: "LIMC" }; // R2: departs MXP instead of FRL
      if (w === 1 && p.flight === "PHC510") pattern = { ...p, etd: "07:00", eta: "09:30" }; // R5 against PHC509
      const leg = makeLeg(date, pattern, "landing", aircraft);
      if (w === 1 && p.day === 6 && (p.flight === "PHC517" || p.flight === "PHC518")) leg.status = "cancelled"; // R7
      legs.push(leg);
    }
  }
  for (const x of PLANTED_EXTRAS) legs.push(makeLeg(x.date, x, x.type ?? "landing", aircraft));
  return legs.sort((a, b) => ms(a.etdUtc) - ms(b.etdUtc) || (a.id < b.id ? -1 : 1));
}

/**
 * Permit rows (section 9.6). Weeks 1 and 2 are obtained, except PHC501 and PHC601 on
 * Mon 14 Sep (pending). All week 3 legs are pending. PHC613 and PHC517 in week 1 have
 * no rows at all (R4b). Obtained rows get DEMO-<country>-<10000 + n>, n counting
 * obtained rows in ETD order. The cancelled PHC517 on Sun 27 Sep keeps its row, cancelled.
 */
export function seedPermits(legs: Leg[], rules: PermitRule[]): Permit[] {
  const week3Start = ms(`${addDaysIso(SEASON_START, 14)}T00:00:00Z`);
  const noRows = new Set(["L-20260918-PHC613-TBS-D", "L-20260920-PHC517-TBS-B"]);
  const allPending = new Set(["L-20260914-PHC501-TBS-A", "L-20260914-PHC601-TBS-C"]);
  const rows: Permit[] = [];
  let n = 0;
  const ordered = [...legs].sort((a, b) => ms(a.etdUtc) - ms(b.etdUtc) || (a.id < b.id ? -1 : 1));
  for (const leg of ordered) {
    if (noRows.has(leg.id)) continue;
    for (const req of requiredPermits(leg.depIcao, leg.arrIcao, rules)) {
      let status: Permit["status"] = "obtained";
      if (leg.status === "cancelled") status = "cancelled";
      else if (allPending.has(leg.id) || ms(leg.etdUtc) >= week3Start) status = "pending";
      let number: string | null = null;
      if (status === "obtained") {
        n += 1;
        number = `DEMO-${req.countryCode}-${10000 + n}`;
      }
      rows.push(newPermit(leg, req, status, number));
    }
  }
  return rows;
}

export const SEED_BLOCKS: MaintenanceBlock[] = [
  {
    id: "B-4L-PXB-AOG",
    aircraftId: "4L-PXB",
    kind: "aog",
    startUtc: "2026-09-21T20:00:00Z",
    endUtc: "2026-09-22T10:00:00Z",
    note: "Hydraulic pump replacement, part on order (fictional)",
  },
  {
    id: "B-4L-PXA-CCHECK",
    aircraftId: "4L-PXA",
    kind: "c_check",
    startUtc: "2026-09-26T00:00:00Z",
    endUtc: "2026-09-27T23:59:00Z",
    note: "Scheduled C-Check (fictional)",
  },
];

/** The demo permit rules: the route table of PRD 9.4 for every route that flies in the seed. */
export function seedPermitRules(legs: Leg[]): PermitRule[] {
  const pairs = new Map<string, [string, string]>();
  for (const l of legs) pairs.set(`${l.depIcao}>${l.arrIcao}`, [l.depIcao, l.arrIcao]);
  return demoPermitRules([...pairs.values()].sort(), idx);
}
