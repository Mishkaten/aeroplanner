"use client";

import { useDemo } from "./store";
import { useUi } from "./ui-store";

/**
 * Global search: a tail number selects that aircraft tab, an airport code filters by station,
 * anything else filters by flight number text. Returns true when the Schedule should open.
 */
export function submitGlobalSearch(raw: string): boolean {
  const q = raw.trim();
  if (!q) return false;
  const { data } = useDemo.getState();
  const { setFilters, clearFilters } = useUi.getState();
  const up = q.toUpperCase().replace(/\s+/g, "");
  clearFilters();
  const ac = data.aircraft.find((a) => a.registration === up || a.registration.endsWith(up) && up.length >= 3);
  if (ac) {
    setFilters({ tab: ac.id });
    return true;
  }
  const ap = data.airports.find((a) => a.icao === up || a.iata === up);
  if (ap) {
    setFilters({ station: ap.icao });
    return true;
  }
  setFilters({ flight: q });
  return true;
}
