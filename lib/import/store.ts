"use client";

import { create } from "zustand";
import { useDemo } from "../store";
import { acceptFix, buildRow, countReady, countReview, permitStatusOf, rowsToPayload, saveFromDrawer } from "./parse";
import { runImport } from "./run";
import type { ImportRow, ParseCtx, SheetStructure } from "./types";
import type { Leg, PermitStatus } from "../types";

type Phase = "idle" | "running" | "review";

interface ImportStore {
  phase: Phase;
  fileName: string;
  pct: number;
  parsed: number;
  stage: string;
  structure: SheetStructure | null;
  rows: ImportRow[];
  error: string | null;

  start: (buffer: ArrayBuffer, fileName: string) => Promise<void>;
  accept: (rowId: string) => void;
  saveDrawer: (rowId: string, leg: Leg, permits: Record<string, PermitStatus>) => void;
  reset: () => void;
  error_: (m: string | null) => void;
}

export function parseCtx(): ParseCtx {
  const { data } = useDemo.getState();
  return { companyIcao: data.company.icao, baseIcao: data.company.baseIcao, airports: data.airports, aircraft: data.aircraft };
}

let timer: ReturnType<typeof setInterval> | null = null;
const stopTimer = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

export const useImport = create<ImportStore>()((set, get) => ({
  phase: "idle",
  fileName: "",
  pct: 0,
  parsed: 0,
  stage: "",
  structure: null,
  rows: [],
  error: null,

  start: async (buffer, fileName) => {
    stopTimer();
    set({ phase: "running", fileName, pct: 0, parsed: 0, stage: "Opening the workbook", rows: [], structure: null, error: null });
    // The bar eases towards the real progress so a fast parse is still visible.
    let actual = 0;
    let shown = 0;
    timer = setInterval(() => {
      shown = Math.min(actual, shown + 3);
      set({ pct: shown });
    }, 30);
    try {
      const t0 = performance.now();
      const result = await runImport(buffer, fileName, parseCtx(), (p) => {
        actual = p.pct;
        set({ parsed: p.parsed, stage: p.stage });
      });
      actual = 100;
      while (shown < 100 && performance.now() - t0 < 2500) await new Promise((r) => setTimeout(r, 30));
      stopTimer();
      set({ phase: "review", pct: 100, rows: result.rows, structure: result.structure, parsed: result.rows.length, stage: "Done" });
    } catch (e) {
      stopTimer();
      set({ phase: "idle", error: e instanceof Error ? e.message : "The workbook could not be read." });
    }
  },

  accept: (rowId) => {
    const row = get().rows.find((r) => r.id === rowId);
    const s = row?.flag?.suggestion;
    if (!row || !s) return;
    if (s.patch.kind === "addAircraft") {
      const reg = s.patch.registration;
      const demo = useDemo.getState();
      if (!demo.data.aircraft.some((a) => a.registration === reg)) {
        demo.addAircraftToStore({
          id: reg,
          registration: reg,
          type: demo.data.aircraft[0]?.type ?? "B737-800SF",
          serialNo: null,
          yearOfManufacture: null,
          mtowKg: null,
          cargoPayloadKg: null,
          status: "active",
          defaultBackupId: null,
        });
      }
      const ctx = parseCtx();
      set({ rows: get().rows.map((r) => (r.flag?.suggestion?.patch.kind === "addAircraft" && r.ref.aircraftReg === reg ? acceptFix(r, ctx) : r)) });
      return;
    }
    const ctx = parseCtx();
    set({ rows: get().rows.map((r) => (r.id === rowId ? acceptFix(r, ctx) : r)) });
  },

  saveDrawer: (rowId, leg, permits) => {
    set({
      rows: get().rows.map((r) => {
        if (r.id !== rowId) return r;
        const cancelled = permitStatusOf(r) === "cancelled";
        return saveFromDrawer(r, cancelled ? { ...leg, status: "cancelled" } : leg, permits);
      }),
    });
  },

  reset: () => {
    stopTimer();
    set({ phase: "idle", fileName: "", pct: 0, parsed: 0, stage: "", structure: null, rows: [], error: null });
  },
  error_: (error) => set({ error }),
}));

export const importCounts = (rows: ImportRow[]) => ({ parsed: rows.length, review: countReview(rows), ready: countReady(rows) });

export function importPayload() {
  const { rows } = useImport.getState();
  return rowsToPayload(rows, parseCtx());
}

export { buildRow };
