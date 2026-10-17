"use client";

import { create } from "zustand";
import type { Leg } from "./types";

export type ListState = "normal" | "loading" | "error" | "empty";

export interface ScheduleFilters {
  tab: string; // "all" or an aircraft id
  type: string; // "all" or an aircraft type
  station: string; // "all" or an ICAO
  flight: string;
  status: "all" | "issue" | "pending" | "obtained" | "cnl";
}

export const NO_FILTERS: ScheduleFilters = { tab: "all", type: "all", station: "all", flight: "", status: "all" };

export type Drawer =
  | { kind: "none" }
  | { kind: "leg"; legId: string }
  | { kind: "new"; draft?: Partial<Leg> }
  | { kind: "import"; rowId: string };

interface UiStore {
  hydrated: boolean;
  theme: "light" | "dark";
  setTheme: (t: "light" | "dark") => void;
  presenter: boolean;
  listState: ListState;
  filters: ScheduleFilters;
  drawer: Drawer;
  /** Leg to scroll to and highlight for 2 s on the Schedule. */
  focusLegId: string | null;
  focusNonce: number;
  helpOpen: boolean;
  resetOpen: boolean;
  announce: string;

  setHydrated: () => void;
  setPresenter: (v: boolean) => void;
  setListState: (s: ListState) => void;
  setFilters: (f: Partial<ScheduleFilters>) => void;
  clearFilters: () => void;
  openLeg: (legId: string) => void;
  openNew: (draft?: Partial<Leg>) => void;
  openImportRow: (rowId: string) => void;
  closeDrawer: () => void;
  focusLeg: (legId: string) => void;
  setHelp: (v: boolean) => void;
  setResetOpen: (v: boolean) => void;
  say: (text: string) => void;
}

export const useUi = create<UiStore>()((set, get) => ({
  hydrated: false,
  theme: "light",
  setTheme: (theme) => set({ theme }),
  presenter: false,
  listState: "normal",
  filters: NO_FILTERS,
  drawer: { kind: "none" },
  focusLegId: null,
  focusNonce: 0,
  helpOpen: false,
  resetOpen: false,
  announce: "",

  setHydrated: () => set({ hydrated: true }),
  setPresenter: (presenter) => set({ presenter }),
  setListState: (listState) => set({ listState }),
  setFilters: (f) => set({ filters: { ...get().filters, ...f } }),
  clearFilters: () => set({ filters: NO_FILTERS }),
  openLeg: (legId) => set({ drawer: { kind: "leg", legId } }),
  openNew: (draft) => set({ drawer: { kind: "new", draft } }),
  openImportRow: (rowId) => set({ drawer: { kind: "import", rowId } }),
  closeDrawer: () => set({ drawer: { kind: "none" } }),
  focusLeg: (legId) => set({ focusLegId: legId, focusNonce: get().focusNonce + 1 }),
  setHelp: (helpOpen) => set({ helpOpen }),
  setResetOpen: (resetOpen) => set({ resetOpen }),
  say: (announce) => set({ announce }),
}));
