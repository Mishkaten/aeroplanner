import { addDaysIso, iso, dateMs } from "../time";
import type { MaintenanceBlock } from "../types";
import type { MaintenanceDay } from "./types";

const LABEL = { aog: "AOG", c_check: "C-Check", maintenance: "Maintenance" } as const;

/**
 * Whole-day AOG, C-CHECK and MAINTENANCE entries become unavailable periods: consecutive days of one kind on one
 * aircraft merge into one block from 00:00 of the first day to 00:00 after the last. AOG with no known end is
 * imported with the days listed in the sheet. The planner can edit the periods afterwards.
 */
export function mergeMaintenance(days: MaintenanceDay[], aircraftIdOf: (registration: string) => string | null): MaintenanceBlock[] {
  const groups = new Map<string, MaintenanceDay[]>();
  for (const d of days) {
    const k = `${d.aircraftReg}|${d.kind}`;
    groups.set(k, [...(groups.get(k) ?? []), d]);
  }
  const out: MaintenanceBlock[] = [];
  for (const list of groups.values()) {
    const aircraftId = aircraftIdOf(list[0].aircraftReg);
    if (!aircraftId) continue;
    const dates = [...new Set(list.map((d) => d.date))].sort();
    let start = dates[0];
    let prev = dates[0];
    const flush = () => {
      out.push({
        id: `B-IMP-${aircraftId}-${list[0].kind}-${start}`,
        aircraftId,
        kind: list[0].kind,
        startUtc: iso(dateMs(start)),
        endUtc: iso(dateMs(addDaysIso(prev, 1))),
        note: `${LABEL[list[0].kind]} from the sheet (${start === prev ? start : `${start} to ${prev}`})`,
      });
    };
    for (const d of dates.slice(1)) {
      if (d === addDaysIso(prev, 1)) prev = d;
      else {
        flush();
        start = d;
        prev = d;
      }
    }
    flush();
  }
  return out.sort((a, b) => (a.startUtc < b.startUtc ? -1 : 1));
}
