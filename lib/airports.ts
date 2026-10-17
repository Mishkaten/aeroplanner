import type { Airport, CountryCode } from "./types";

export const PLACEHOLDER_ICAO = "XXXX";

export const COUNTRY_NAMES: Record<CountryCode, string> = {
  GE: "Georgia",
  CN: "China",
  KZ: "Kazakhstan",
  RS: "Serbia",
  GR: "Greece",
  HU: "Hungary",
  RO: "Romania",
  IT: "Italy",
  AE: "UAE",
  IN: "India",
  HK: "Hong Kong",
  XX: "Not set",
};

export type AirportIndex = {
  byIcao: Map<string, Airport>;
  byIata: Map<string, Airport>;
};

export function indexAirports(airports: Airport[]): AirportIndex {
  const byIcao = new Map<string, Airport>();
  const byIata = new Map<string, Airport>();
  for (const a of airports) {
    byIcao.set(a.icao, a);
    byIata.set(a.iata, a);
  }
  return { byIcao, byIata };
}

export const isPlaceholder = (icao: string): boolean => icao === PLACEHOLDER_ICAO;

/** "UGTB/TBS". Unknown stations print as the bare code. */
export function pairLabel(icao: string, idx: AirportIndex): string {
  const a = idx.byIcao.get(icao);
  return a ? `${a.icao}/${a.iata}` : icao;
}

export function iataOf(icao: string, idx: AirportIndex): string {
  return idx.byIcao.get(icao)?.iata ?? icao;
}

/** Accepts "UGTB/TBS", "UGTB", "TBS" (any case, any spacing). */
export function resolveStation(text: string, idx: AirportIndex): Airport | null {
  const t = text.replace(/\s+/g, "").toUpperCase();
  if (!t) return null;
  const [a, b] = t.split("/");
  if (b !== undefined) {
    const hit = idx.byIcao.get(a);
    return hit && hit.iata === b ? hit : null;
  }
  return idx.byIcao.get(a) ?? idx.byIata.get(a) ?? null;
}

export function searchAirports(airports: Airport[], query: string): Airport[] {
  const q = query.trim().toLowerCase();
  if (!q) return airports;
  return airports.filter(
    (a) =>
      a.iata.toLowerCase().includes(q) ||
      a.icao.toLowerCase().includes(q) ||
      a.name.toLowerCase().includes(q),
  );
}

export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
}
