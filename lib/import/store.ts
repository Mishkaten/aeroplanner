"use client";

import { create } from "zustand";
import { useDemo } from "../store";
import { acceptFix, buildRow, countReady, countReview, countSkipped, permitStatusOf, rowsToPayload, saveFromDrawer } from "./parse";
import { runImport } from "./run";
import type { FleetFound, ImportRow, MaintenanceDay, ParseCtx, SheetStructure } from "./types";
import { mergeMaintenance } from "./blocks";
import type { Leg } from "../types";
import type { DraftPermit } from "../permits";

type Phase = "idle" | "running" | "review";

interface ImportStore {
  phase: Phase;
  fileName: string;
  pct: number;
  parsed: number;
  stage: string;
  structure: SheetStructure | null;
  rows: ImportRow[];
  maintenance: MaintenanceDay[];
  fleet: FleetFound | null;
  error: string | null;

  start: (buffer: ArrayBuffer, fileName: string) => Promise<void>;
  accept: (rowId: string) => void;
  skip: (rowId: string, skipped: boolean) => void;
  addFleet: () => { aircraft: number; company: boolean };
  saveDrawer: (rowId: string, leg: Leg, permits: DraftPermit[]) => void;
  reset: () => void;
  error_: (m: string | null) => void;
}

export function parseCtx(): ParseCtx {
  const { data } = useDemo.getState();
  return { companyIcao: data.company.icao, baseIcao: data.company.baseIcao, dayTagMode: data.company.dayTagMode, airports: data.airports, permitRules: data.permitRules, aircraft: data.aircraft };
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
  maintenance: [],
  fleet: null,
  error: null,

  start: async (buffer, fileName) => {
    stopTimer();
    set({ phase: "running", fileName, pct: 0, parsed: 0, stage: "Opening the workbook", rows: [], structure: null, maintenance: [], fleet: null, error: null });
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
      set({ phase: "review", pct: 100, rows: result.rows, maintenance: result.maintenance, fleet: result.fleet, structure: result.structure, parsed: result.rows.length, stage: "Done" });
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

  skip: (rowId, skipped) => {
    set({ rows: get().rows.map((r) => (r.id === rowId ? { ...r, status: skipped ? "skipped" : r.override ? "fixed" : r.flag ? "flagged" : "ok" } : r)) });
  },

  addFleet: () => {
    const { fleet, rows } = get();
    const demo = useDemo.getState();
    let added = 0;
    for (const a of fleet?.aircraft ?? []) {
      if (demo.data.aircraft.some((x) => x.registration === a.registration)) continue;
      demo.addAircraftToStore({
        id: a.registration,
        registration: a.registration,
        type: a.type || "Unknown type",
        serialNo: a.serialNo,
        yearOfManufacture: a.yearOfManufacture,
        mtowKg: a.mtowKg,
        cargoPayloadKg: a.cargoPayloadKg,
        status: "active",
        defaultBackupId: null,
      });
      added++;
    }
    let company = false;
    const c = fleet?.company;
    if (c && (c.icao || c.iata || c.name)) {
      demo.patchCompany({
        ...(c.name && !demo.data.company.legalName ? { legalName: c.name } : {}),
        ...(c.icao ? { icao: c.icao } : {}),
        ...(c.iata ? { iata: c.iata } : {}),
      });
      company = true;
    }
    // Rows the user has not touched are read again with the new fleet and company designators.
    const ctx = parseCtx();
    set({ rows: rows.map((r) => (r.touched || r.override || r.status === "skipped" ? r : buildRow(r.ref, ctx))) });
    return { aircraft: added, company };
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
    set({ phase: "idle", fileName: "", pct: 0, parsed: 0, stage: "", structure: null, rows: [], maintenance: [], fleet: null, error: null });
  },
  error_: (error) => set({ error }),
}));

export const importCounts = (rows: ImportRow[]) => ({ parsed: rows.length, review: countReview(rows), ready: countReady(rows), skipped: countSkipped(rows) });

export function importPayload() {
  const { rows, maintenance } = useImport.getState();
  const ctx = parseCtx();
  const ids = new Map(ctx.aircraft.map((a) => [a.registration, a.id]));
  return { ...rowsToPayload(rows, ctx), blocks: mergeMaintenance(maintenance, (reg) => ids.get(reg) ?? null) };
}

export { buildRow };
