// One layout model feeds the on-screen preview and the PDF, Excel and Word files (PRD section 8),
// so every block appears in the same order with the same strings in each of them.
import { COUNTRY_NAMES, iataOf, indexAirports, isPlaceholder, type AirportIndex } from "../airports";
import { blockMinutes, dayPlus, dayTag, fullFlight } from "../legs";
import { permitKey, requiredPermits } from "../permits";
import { effectiveClock } from "../clock";
import { fmtDate, fmtFull, fmtHHMM, fmtDuration, ms, utcDate } from "../time";
import type { Aircraft, DomainState, Leg, LegType, Permit, PermitType } from "../types";

export const MAX_LEGS = 40;
const MISSING = "Missing";

export interface ChecklistAircraftRow {
  role: "Primary" | "Backup";
  registration: string;
  type: string;
  serialNo: string;
  year: string;
  mtow: string;
  payload: string;
}

export interface ChecklistLegRow {
  legId: string;
  flight: string;
  aircraft: string;
  route: string; // "TBS to URC"
  date: string; // "16 Sep"
  etd: string; // "02:00"
  eta: string; // "07:30"
  etaPlus: boolean; // prints "(+1)"
  dayTag: string | null; // "DAY 2 LT", printed under the ETA
  block: string; // "05:30"
  type: string;
  // raw values for Excel
  etdMs: number;
  etaMs: number;
  dateIso: string;
  blockMinutes: number;
}

export interface ChecklistPermitRow {
  country: string;
  permit: string; // "Landing" | "Overflight"
  flight: string;
  number: string;
  status: string;
  valid: string;
}

export interface RoutePoint {
  iata: string;
  x: number; // 0..1
  y: number; // 0..1
}

export interface ChecklistModel {
  header: {
    legalName: string;
    logoDataUrl: string | null;
    idLine: string; // "ICAO PHC | IATA P7 | AOC DEMO-0001 | Base UGTB/TBS"
    text: string;
    title: string; // "FLIGHT CHECKLIST"
    dateSpan: string;
  };
  aircraft: ChecklistAircraftRow[];
  route: {
    points: RoutePoint[];
    segments: { from: string; to: string; n: number }[];
    legend: string[];
    note: string;
  };
  legs: ChecklistLegRow[];
  permits: ChecklistPermitRow[];
  notes: string[];
  signatures: [string, string];
  footer: { text: string; generated: string };
  fileBase: string;
}

const TYPE_LABEL: Record<LegType, string> = {
  landing: "Landing",
  overflight: "Overflight",
  technical_stop: "Technical stop",
  ferry: "Ferry",
};

/** "16 Sep 2026", "16 to 17 Sep 2026", "30 Sep to 2 Oct 2026", "30 Dec 2026 to 2 Jan 2027". */
export function dateSpan(first: string, last: string): string {
  if (first === last) return fmtFull(first);
  const [fy, fm] = [first.slice(0, 4), first.slice(5, 7)];
  const [ly, lm] = [last.slice(0, 4), last.slice(5, 7)];
  if (fy !== ly) return `${fmtFull(first)} to ${fmtFull(last)}`;
  if (fm !== lm) return `${fmtDate(first)} to ${fmtFull(last)}`;
  return `${Number(first.slice(8))} to ${fmtFull(last)}`;
}

/** PHC_Checklist_<first ETD date>[_to_<last ETD date>]_<n>leg(s) without the extension. */
export function checklistFileBase(prefix: string, first: string, last: string, n: number): string {
  const span = first === last ? first : `${first}_to_${last}`;
  return `${prefix}_Checklist_${span}_${n}${n === 1 ? "leg" : "legs"}`;
}

const kg = (v: number | null) => (v === null ? MISSING : `${v.toLocaleString("en-US")} kg`);

function aircraftRows(legs: Leg[], aircraft: Aircraft[]): ChecklistAircraftRow[] {
  const byId = new Map(aircraft.map((a) => [a.id, a]));
  const row = (a: Aircraft, role: "Primary" | "Backup"): ChecklistAircraftRow => ({
    role,
    registration: a.registration,
    type: a.type,
    serialNo: a.serialNo ?? MISSING,
    year: a.yearOfManufacture === null ? MISSING : String(a.yearOfManufacture),
    mtow: kg(a.mtowKg),
    payload: kg(a.cargoPayloadKg),
  });
  const primary = [...new Set(legs.map((l) => l.aircraftId))].sort();
  const backups = [...new Set(legs.map((l) => l.backupAircraftId).filter((b): b is string => !!b))].filter((b) => !primary.includes(b)).sort();
  return [
    ...primary.map((id) => byId.get(id)).filter((a): a is Aircraft => !!a).map((a) => row(a, "Primary")),
    ...backups.map((id) => byId.get(id)).filter((a): a is Aircraft => !!a).map((a) => row(a, "Backup")),
  ];
}

function validRange(p: Permit): string {
  if (!p.validFromUtc || !p.validToUtc) return "-";
  const a = utcDate(p.validFromUtc);
  const b = utcDate(p.validToUtc);
  return a === b ? fmtDate(a) : `${fmtDate(a)} to ${fmtDate(b)}`;
}

function routeBlock(legs: Leg[], idx: AirportIndex): ChecklistModel["route"] {
  const used: string[] = [];
  const segments: ChecklistModel["route"]["segments"] = [];
  const legend: string[] = [];
  legs.forEach((l, i) => {
    const from = iataOf(l.depIcao, idx);
    const to = iataOf(l.arrIcao, idx);
    legend.push(`${i + 1}  ${fullFlight(l)} ${from} to ${to}`);
    if (isPlaceholder(l.depIcao) || isPlaceholder(l.arrIcao)) return;
    for (const s of [l.depIcao, l.arrIcao]) if (!used.includes(s)) used.push(s);
    segments.push({ from, to, n: i + 1 });
  });
  const coords = used.map((icao) => idx.byIcao.get(icao)).filter((a) => a && a.lat !== null && a.lon !== null);
  const lats = coords.map((a) => a!.lat as number);
  const lons = coords.map((a) => a!.lon as number);
  const [minLat, maxLat, minLon, maxLon] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
  const spanLat = maxLat - minLat || 1;
  const spanLon = maxLon - minLon || 1;
  const pad = 0.08;
  const points = coords.map((a) => ({
    iata: a!.iata,
    x: pad + (1 - 2 * pad) * (((a!.lon as number) - minLon) / spanLon),
    y: pad + (1 - 2 * pad) * (1 - ((a!.lat as number) - minLat) / spanLat),
  }));
  return { points, segments, legend, note: "Schematic, not to scale" };
}

export function buildChecklistModel(state: DomainState, legIds: string[], clock: string = effectiveClock(state)): ChecklistModel | null {
  const idx = indexAirports(state.airports);
  const wanted = new Set(legIds);
  const legs = state.legs
    .filter((l) => wanted.has(l.id) && l.status !== "cancelled")
    .sort((a, b) => ms(a.etdUtc) - ms(b.etdUtc) || (a.id < b.id ? -1 : 1));
  if (!legs.length) return null;

  const first = utcDate(legs[0].etdUtc);
  const last = utcDate(legs[legs.length - 1].etdUtc);
  const c = state.company;
  const regOf = new Map(state.aircraft.map((a) => [a.id, a.registration]));

  const legRows: ChecklistLegRow[] = legs.map((l) => {
    const tag = dayTag(l, idx);
    return {
      legId: l.id,
      flight: fullFlight(l),
      aircraft: regOf.get(l.aircraftId) ?? l.aircraftId,
      route: `${iataOf(l.depIcao, idx)} to ${iataOf(l.arrIcao, idx)}`,
      date: fmtDate(l.etdUtc),
      etd: fmtHHMM(l.etdUtc),
      eta: fmtHHMM(l.etaUtc),
      etaPlus: dayPlus(l) === 1,
      dayTag: tag === null ? null : `DAY ${tag} LT`,
      block: fmtDuration(blockMinutes(l)),
      type: TYPE_LABEL[l.legType],
      etdMs: ms(l.etdUtc),
      etaMs: ms(l.etaUtc),
      dateIso: utcDate(l.etdUtc),
      blockMinutes: blockMinutes(l),
    };
  });

  // Permits: one row per Permit per selected leg, plus "No record" for required permits with no row.
  const permitRows: { sortCountry: string; etd: number; row: ChecklistPermitRow }[] = [];
  for (const l of legs) {
    const have = new Map(state.permits.filter((p) => p.legId === l.id).map((p) => [permitKey(p), p]));
    const need = requiredPermits(l.depIcao, l.arrIcao, state.permitRules);
    const typeLabel = (t: PermitType) => (t === "landing" ? "Landing" : "Overflight");
    for (const p of have.values())
      permitRows.push({
        sortCountry: COUNTRY_NAMES[p.countryCode],
        etd: ms(l.etdUtc),
        row: {
          country: COUNTRY_NAMES[p.countryCode],
          permit: typeLabel(p.type),
          flight: fullFlight(l),
          number: p.number ?? "Not entered",
          status: p.status === "obtained" ? "Obtained" : p.status === "pending" ? "Pending" : "Cancelled",
          valid: validRange(p),
        },
      });
    for (const r of need)
      if (!have.has(permitKey(r)))
        permitRows.push({
          sortCountry: COUNTRY_NAMES[r.countryCode],
          etd: ms(l.etdUtc),
          row: { country: COUNTRY_NAMES[r.countryCode], permit: typeLabel(r.type), flight: fullFlight(l), number: "-", status: "No record", valid: "-" },
        });
  }
  permitRows.sort((a, b) => (a.sortCountry < b.sortCountry ? -1 : a.sortCountry > b.sortCountry ? 1 : a.etd - b.etd));

  const notes = legs.filter((l) => l.notes.trim()).map((l) => `${fullFlight(l)}: ${l.notes.trim()}`);

  return {
    header: {
      legalName: c.legalName,
      logoDataUrl: c.logoDataUrl,
      idLine: `ICAO ${c.icao} | IATA ${c.iata} | AOC ${c.aocNumber} | Base ${c.baseIcao}/${iataOf(c.baseIcao, idx)}`,
      text: c.checklistHeaderText,
      title: "FLIGHT CHECKLIST",
      dateSpan: dateSpan(first, last),
    },
    aircraft: aircraftRows(legs, state.aircraft),
    route: routeBlock(legs, idx),
    legs: legRows,
    permits: permitRows.map((p) => p.row),
    notes: notes.length ? notes : ["None"],
    signatures: ["Prepared by, Flight Operations", "Commander signature and date"],
    footer: {
      text: "All times UTC unless marked LT. Demo document, fictional operator.",
      // The timestamp uses the demo clock so repeated runs match.
      generated: `Generated ${fmtFull(clock)} ${fmtHHMM(clock)}Z`,
    },
    fileBase: checklistFileBase(c.icao, first, last, legs.length),
  };
}

/** Every string the document prints, in order. Used to check that preview and files agree (X9). */
export function modelText(m: ChecklistModel): string[] {
  return [
    m.header.legalName,
    m.header.idLine,
    m.header.text,
    m.header.title,
    m.header.dateSpan,
    ...m.aircraft.flatMap((a) => [a.role, a.registration, a.type, a.serialNo, a.year, a.mtow, a.payload]),
    ...m.route.legend,
    m.route.note,
    ...m.legs.flatMap((l) => [l.flight, l.aircraft, l.route, l.date, l.etd, l.eta + (l.etaPlus ? " (+1)" : ""), ...(l.dayTag ? [l.dayTag] : []), l.block, l.type]),
    ...m.permits.flatMap((p) => [p.country, p.permit, p.flight, p.number, p.status, p.valid]),
    ...m.notes,
    ...m.signatures,
    m.footer.text,
    m.footer.generated,
  ];
}
