import type { Coll, DomainState, PatchOp, StatePatch } from "./types";

type Row = { id: string } & Record<string, unknown>;

/**
 * Applies a patch atomically and returns the new state plus the inverse patch
 * that undoes it. The input state is never mutated.
 */
export function applyPatch(state: DomainState, patch: StatePatch): { state: DomainState; inverse: StatePatch } {
  const lists: Partial<Record<Coll, Row[]>> = {};
  const get = (c: Coll): Row[] => (lists[c] ??= [...(state[c] as unknown as Row[])]);
  const inverse: StatePatch = [];

  for (const op of patch) {
    const list = get(op.coll);
    if (op.op === "insert") {
      list.push(op.value);
      inverse.push({ op: "remove", coll: op.coll, id: op.value.id });
    } else if (op.op === "remove") {
      const i = list.findIndex((r) => r.id === op.id);
      if (i < 0) continue;
      inverse.push({ op: "insert", coll: op.coll, value: list[i] });
      list.splice(i, 1);
    } else {
      const i = list.findIndex((r) => r.id === op.id);
      if (i < 0) continue;
      const prev: Record<string, unknown> = {};
      for (const k of Object.keys(op.value)) prev[k] = list[i][k];
      inverse.push({ op: "set", coll: op.coll, id: op.id, value: prev });
      list[i] = { ...list[i], ...op.value };
    }
  }

  const next = { ...state } as unknown as Record<string, unknown>;
  for (const c of Object.keys(lists) as Coll[]) next[c] = lists[c];
  return { state: next as unknown as DomainState, inverse: inverse.reverse() as PatchOp[] };
}
