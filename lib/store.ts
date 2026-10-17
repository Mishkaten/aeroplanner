"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { toast } from "sonner";
import { applyPatch } from "./patch";
import { fullDemoState, emptyScheduleState } from "./seed";
import { derive } from "./derived";
import { fullFlight, isActive } from "./legs";
import { permitId, syncPermitPatch } from "./permits";
import { ms } from "./time";
import type { Aircraft, Company, CountryCode, DomainState, Leg, Permit, PermitType, StatePatch } from "./types";

export const STORE_KEY = "aeroplanner.demo.v1";
export const STORE_VERSION = 1;
export const MAX_CHECKLIST_LEGS = 40;

export type RangeSel = "all" | 0 | 1 | 2;
export type Layout = "table" | "gantt";
export type CalendarMode = "dates" | "weekday";
export type ResetKind = "full" | "empty";

interface DemoStore {
  data: DomainState;
  bannerDismissed: boolean;
  /** Leg ids ticked for the checklist. Persists across screens for the session, cleared by Reset. */
  selection: string[];
  range: RangeSel;
  layout: Layout;
  calendar: CalendarMode;

  commit: (patch: StatePatch, message: string, opts?: { silent?: boolean }) => void;
  saveLeg: (leg: Leg, isNew: boolean, permitStatus?: Record<string, Permit["status"]>) => void;
  setLegStatus: (legId: string, status: Leg["status"]) => void;
  setPermitStatus: (permitId: string, status: Permit["status"]) => void;
  saveAircraft: (a: Aircraft, isNew: boolean) => void;
  saveCompany: (c: Company) => void;
  importLegs: (legs: Leg[], permits: Permit[]) => { inserted: number; updated: number };
  addAircraftToStore: (a: Aircraft) => void;

  toggleSelect: (legId: string) => void;
  setSelection: (ids: string[]) => void;
  clearSelection: () => void;

  setRange: (r: RangeSel) => void;
  setLayout: (l: Layout) => void;
  setCalendar: (c: CalendarMode) => void;
  dismissBanner: () => void;
  reset: (kind: ResetKind, stressLegs?: number) => void;
}

const initial = () => ({
  data: fullDemoState(),
  bannerDismissed: false,
  selection: [] as string[],
  range: "all" as RangeSel,
  layout: "table" as Layout,
  calendar: "dates" as CalendarMode,
});

function undoToast(message: string, inverse: StatePatch, apply: (p: StatePatch) => void) {
  toast(message, {
    duration: 9000,
    action: {
      label: "Undo",
      onClick: () => {
        apply(inverse);
        toast("Undone");
      },
    },
  });
}

const safeSession = {
  getItem: (k: string) => {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k: string, v: string) => {
    try {
      sessionStorage.setItem(k, v);
    } catch {
      // storage can be blocked; edits then live in memory only
    }
  },
  removeItem: (k: string) => {
    try {
      sessionStorage.removeItem(k);
    } catch {
      // ignore
    }
  },
};

export const useDemo = create<DemoStore>()(
  persist(
    (set, get) => {
      const raw = (patch: StatePatch): StatePatch => {
        const { state, inverse } = applyPatch(get().data, patch);
        set({ data: state });
        return inverse;
      };

      return {
        ...initial(),

        commit: (patch, message, opts) => {
          const inverse = raw(patch);
          if (!opts?.silent) undoToast(message, inverse, raw);
        },

        saveLeg: (leg, isNew, permitStatus) => {
          const { data } = get();
          const idx = derive(data).idx;
          let patch: StatePatch;
          if (isNew) {
            patch = [{ op: "insert", coll: "legs", value: leg as never }, ...syncPermitPatch(leg, [], idx, data.company.baseIcao)];
          } else {
            const { id, ...rest } = leg;
            patch = [{ op: "set", coll: "legs", id, value: rest }, ...syncPermitPatch(leg, data.permits, idx, data.company.baseIcao)];
          }
          // Statuses chosen in the drawer's permit table apply to rows the route needs.
          for (const [key, status] of Object.entries(permitStatus ?? {})) {
            const [cc, type] = key.split(":");
            const pid = permitId(leg.id, cc as CountryCode, type as PermitType);
            const ins = patch.find((o) => o.op === "insert" && o.coll === "permits" && o.value.id === pid);
            if (ins && ins.op === "insert") ins.value.status = status;
            else if (data.permits.some((p) => p.id === pid)) patch.push({ op: "set", coll: "permits", id: pid, value: { status } });
          }
          const inverse = raw(patch);
          undoToast(`Leg ${fullFlight(leg)} ${isNew ? "added" : "saved"}`, inverse, raw);
        },

        setLegStatus: (legId, status) => {
          const leg = get().data.legs.find((l) => l.id === legId);
          if (!leg) return;
          const inverse = raw([{ op: "set", coll: "legs", id: legId, value: { status } }]);
          undoToast(status === "cancelled" ? `${fullFlight(leg)} cancelled (CNL)` : `${fullFlight(leg)} restored`, inverse, raw);
        },

        setPermitStatus: (permitId, status) => {
          const inverse = raw([{ op: "set", coll: "permits", id: permitId, value: { status } }]);
          undoToast(`Permit marked ${status}`, inverse, raw);
        },

        saveAircraft: (a, isNew) => {
          const patch: StatePatch = isNew
            ? [{ op: "insert", coll: "aircraft", value: a as never }]
            : [{ op: "set", coll: "aircraft", id: a.id, value: { ...a } }];
          const inverse = raw(patch);
          undoToast(`Aircraft ${a.registration} ${isNew ? "added" : "saved"}`, inverse, raw);
        },

        addAircraftToStore: (a) => {
          raw([{ op: "insert", coll: "aircraft", value: a as never }]);
        },

        saveCompany: (c) => {
          set((s) => ({ data: { ...s.data, company: c } }));
          toast.success("Company profile saved");
        },

        importLegs: (legs, permits) => {
          const { data } = get();
          const keyOf = (l: Leg) => `${fullFlight(l)}|${l.etdUtc}|${l.depIcao}|${l.aircraftId}`;
          const existing = new Map(data.legs.map((l) => [keyOf(l), l]));
          const havePermit = new Map(data.permits.map((p) => [p.id, p]));
          const patch: StatePatch = [];
          let inserted = 0;
          let updated = 0;
          const idMap = new Map<string, string>();
          for (const l of legs) {
            const hit = existing.get(keyOf(l));
            if (hit) {
              const { id: _ignored, ...rest } = l;
              void _ignored;
              patch.push({ op: "set", coll: "legs", id: hit.id, value: rest });
              idMap.set(l.id, hit.id);
              updated++;
            } else {
              patch.push({ op: "insert", coll: "legs", value: l as never });
              existing.set(keyOf(l), l);
              idMap.set(l.id, l.id);
              inserted++;
            }
          }
          for (const p of permits) {
            const legId = idMap.get(p.legId) ?? p.legId;
            const row = { ...p, legId, id: p.id.replace(p.legId, legId) };
            if (havePermit.has(row.id)) patch.push({ op: "set", coll: "permits", id: row.id, value: { status: row.status } });
            else patch.push({ op: "insert", coll: "permits", value: row as never });
          }
          raw(patch);
          return { inserted, updated };
        },

        toggleSelect: (legId) => {
          const { selection, data } = get();
          if (selection.includes(legId)) {
            set({ selection: selection.filter((id) => id !== legId) });
            return;
          }
          const leg = data.legs.find((l) => l.id === legId);
          if (!leg || !isActive(leg)) {
            toast.error("Cancelled legs cannot be added to a checklist");
            return;
          }
          const live = selection.filter((id) => data.legs.some((l) => l.id === id && isActive(l)));
          if (live.length >= MAX_CHECKLIST_LEGS) {
            toast.error(`A checklist holds up to ${MAX_CHECKLIST_LEGS} legs`);
            return;
          }
          set({ selection: [...live, legId] });
        },
        setSelection: (ids) => set({ selection: ids.slice(0, MAX_CHECKLIST_LEGS) }),
        clearSelection: () => set({ selection: [] }),

        setRange: (range) => set({ range }),
        setLayout: (layout) => set({ layout }),
        setCalendar: (calendar) => set({ calendar }),
        dismissBanner: () => set({ bannerDismissed: true }),

        reset: (kind, stressLegs) => {
          const data = stressLegs ? fullDemoState({ stressLegs }) : kind === "full" ? fullDemoState() : emptyScheduleState();
          set({ ...initial(), data });
        },
      };
    },
    {
      name: STORE_KEY,
      version: STORE_VERSION,
      storage: createJSONStorage(() => safeSession),
      skipHydration: true,
      // A stored version that does not match the app version is discarded silently.
      migrate: () => initial() as never,
      partialize: (s) => ({
        data: s.data,
        bannerDismissed: s.bannerDismissed,
        selection: s.selection,
        range: s.range,
        layout: s.layout,
        calendar: s.calendar,
      }),
    },
  ),
);

/** Ticked legs that still exist and are active. */
export function liveSelection(selection: string[], data: DomainState): string[] {
  const ok = new Set(data.legs.filter(isActive).map((l) => l.id));
  return selection.filter((id) => ok.has(id));
}

export function weekIndexOf(etdUtc: string): 0 | 1 | 2 | null {
  const t = ms(etdUtc);
  const start = ms("2026-09-14T00:00:00Z");
  const w = Math.floor((t - start) / (7 * 86_400_000));
  return w >= 0 && w <= 2 ? (w as 0 | 1 | 2) : null;
}
