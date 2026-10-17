import { fullFlight } from "../legs";
import type { DomainState, Leg, MaintenanceBlock, Permit, StatePatch } from "../types";

/** RV6 natural key: full flight number, ETD instant, departure ICAO and aircraft. */
export const naturalKey = (l: Pick<Leg, "flightNumber" | "suffix" | "etdUtc" | "depIcao" | "aircraftId">): string =>
  `${fullFlight(l)}|${l.etdUtc}|${l.depIcao}|${l.aircraftId}`;

/**
 * Idempotent import: a leg whose key exists is updated, otherwise inserted. Nothing is deleted.
 * Importing the sample twice leaves 90 legs.
 */
export function importPatch(data: DomainState, legs: Leg[], permits: Permit[], blocks: MaintenanceBlock[] = []): { patch: StatePatch; inserted: number; updated: number } {
  const existing = new Map(data.legs.map((l) => [naturalKey(l), l]));
  const havePermit = new Set(data.permits.map((p) => p.id));
  const patch: StatePatch = [];
  const idMap = new Map<string, string>();
  let inserted = 0;
  let updated = 0;

  for (const l of legs) {
    const hit = existing.get(naturalKey(l));
    if (hit) {
      const { id: _id, ...rest } = l;
      void _id;
      patch.push({ op: "set", coll: "legs", id: hit.id, value: rest });
      idMap.set(l.id, hit.id);
      updated++;
    } else {
      patch.push({ op: "insert", coll: "legs", value: l as never });
      existing.set(naturalKey(l), l);
      idMap.set(l.id, l.id);
      inserted++;
    }
  }
  for (const p of permits) {
    const legId = idMap.get(p.legId) ?? p.legId;
    const id = p.id.replace(p.legId, legId);
    if (havePermit.has(id)) patch.push({ op: "set", coll: "permits", id, value: { status: p.status } });
    else {
      patch.push({ op: "insert", coll: "permits", value: { ...p, legId, id } as never });
      havePermit.add(id);
    }
  }
  const haveBlock = new Set(data.blocks.map((b) => b.id));
  for (const b of blocks) {
    if (haveBlock.has(b.id)) patch.push({ op: "set", coll: "blocks", id: b.id, value: { endUtc: b.endUtc, startUtc: b.startUtc, kind: b.kind } });
    else patch.push({ op: "insert", coll: "blocks", value: b as never });
  }
  return { patch, inserted, updated };
}
