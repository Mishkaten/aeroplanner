"use client";

// Shared test workspace on Supabase: sign in, load the one shared workspace, save every change (last save wins),
// pick up changes made by others, and keep backups. When the Supabase settings are absent the app runs as the
// browser-only demo.
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { create } from "zustand";
import { blankWorkspaceState } from "./seed";
import { WORKSPACE_MODE } from "./mode";
import { useDemo } from "./store";
import type { DomainState } from "./types";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export { WORKSPACE_MODE };

const WORKSPACE_ID = "main";
const SAVE_DELAY_MS = 900;
const POLL_MS = 20_000;

let clientPromise: Promise<SupabaseClient> | null = null;
/** The Supabase client, loaded on first use so the demo build never downloads it. */
function sb(): Promise<SupabaseClient> {
  clientPromise ??= import("@supabase/supabase-js").then((m) => m.createClient(URL_!, KEY!, { auth: { persistSession: true, autoRefreshToken: true } }));
  return clientPromise;
}

export type WsStatus = "off" | "loading" | "signedout" | "ready" | "error";
export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export interface Snapshot {
  id: number;
  saved_at: string;
  saved_by: string | null;
}

interface Ws {
  status: WsStatus;
  email: string | null;
  error: string | null;
  signingIn: boolean;
  save: SaveState;
  savedAt: string | null;
  remoteAt: string | null;
  boot: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  reload: (silent?: boolean) => Promise<void>;
  saveNow: () => Promise<void>;
  listSnapshots: () => Promise<Snapshot[]>;
  restoreSnapshot: (id: number) => Promise<void>;
  replaceAll: (data: DomainState, reason: string) => Promise<void>;
}

/** Fills fields that older saved workspaces do not have, so the app never meets a missing list. */
export function normalizeData(raw: Partial<DomainState> | null | undefined): DomainState {
  const base = blankWorkspaceState();
  const d = (raw ?? {}) as Partial<DomainState>;
  return {
    clock: d.clock ?? null,
    permitRules: d.permitRules ?? [],
    company: { ...base.company, ...(d.company ?? {}) },
    aircraft: d.aircraft ?? [],
    airports: d.airports?.length ? d.airports.map((a) => ({ ...a, id: a.id ?? a.icao })) : base.airports,
    legs: d.legs ?? [],
    permits: d.permits ?? [],
    blocks: d.blocks ?? [],
  };
}

let applyingRemote = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let unsubscribe: (() => void) | null = null;
let booted = false;

function applyRemote(data: DomainState) {
  applyingRemote = true;
  const demo = useDemo.getState();
  useDemo.setState({ data, selection: demo.selection.filter((id) => data.legs.some((l) => l.id === id)) });
  applyingRemote = false;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "Something went wrong");

export const useWorkspace = create<Ws>()((set, get) => ({
  status: WORKSPACE_MODE ? "loading" : "off",
  email: null,
  error: null,
  signingIn: false,
  save: "idle",
  savedAt: null,
  remoteAt: null,

  boot: async () => {
    if (!WORKSPACE_MODE || booted) return;
    booted = true;
    const c = await sb();
    c.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        stopSync();
        set({ status: "signedout", email: null });
      }
    });
    const { data } = await c.auth.getSession();
    if (data.session) {
      set({ email: data.session.user.email ?? null });
      await get().reload(true);
    } else set({ status: "signedout" });
  },

  signIn: async (email, password) => {
    set({ signingIn: true, error: null });
    const { data, error } = await (await sb()).auth.signInWithPassword({ email: email.trim(), password });
    if (error || !data.session) {
      set({ signingIn: false, error: error ? (/invalid/i.test(error.message) ? "Wrong email or password." : error.message) : "Could not sign in." });
      return;
    }
    set({ email: data.session.user.email ?? email, signingIn: false, status: "loading" });
    await get().reload(true);
  },

  signOut: async () => {
    if (get().save === "dirty" || get().save === "saving") await get().saveNow();
    stopSync();
    await (await sb()).auth.signOut();
    set({ status: "signedout", email: null, save: "idle" });
  },

  reload: async (silent = false) => {
    try {
      const { data, error } = await (await sb()).from("workspace").select("data, updated_at, updated_by").eq("id", WORKSPACE_ID).maybeSingle();
      if (error) throw error;
      if (!data) {
        // the first person to sign in creates the empty workspace
        const blank = blankWorkspaceState();
        const ins = await (await sb()).from("workspace").insert({ id: WORKSPACE_ID, data: blank, updated_by: get().email }).select("updated_at").single();
        if (ins.error) throw ins.error;
        applyRemote(blank);
        useDemo.setState({ range: null, bannerDismissed: false });
        set({ status: "ready", savedAt: ins.data.updated_at, remoteAt: ins.data.updated_at, save: "saved", error: null });
      } else {
        if (!silent) toast(`Workspace reloaded${data.updated_by ? `, last saved by ${data.updated_by}` : ""}`);
        applyRemote(normalizeData(data.data as Partial<DomainState>));
        set({ status: "ready", savedAt: data.updated_at, remoteAt: data.updated_at, save: "saved", error: null });
      }
      startSync();
    } catch (e) {
      set({ status: "error", error: msg(e) });
    }
  },

  saveNow: async () => {
    if (get().status !== "ready") return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    set({ save: "saving" });
    const { data, error } = await (await sb())
      .from("workspace")
      .upsert({ id: WORKSPACE_ID, data: useDemo.getState().data, updated_by: get().email })
      .select("updated_at")
      .single();
    if (error) {
      set({ save: "error", error: msg(error) });
      return;
    }
    set({ save: saveTimer ? "dirty" : "saved", savedAt: data.updated_at, remoteAt: data.updated_at, error: null });
  },

  listSnapshots: async () => {
    const { data, error } = await (await sb()).from("workspace_history").select("id, saved_at, saved_by").order("id", { ascending: false }).limit(60);
    if (error) throw error;
    return (data ?? []) as Snapshot[];
  },

  restoreSnapshot: async (id) => {
    const { data, error } = await (await sb()).from("workspace_history").select("data").eq("id", id).single();
    if (error) throw error;
    await get().replaceAll(normalizeData(data.data as Partial<DomainState>), "Backup restored");
  },

  replaceAll: async (data, reason) => {
    // keep a backup of what is being replaced
    await (await sb()).from("workspace_history").insert({ saved_by: get().email, data: useDemo.getState().data });
    applyRemote(data);
    useDemo.setState({ range: null, selection: [] });
    await get().saveNow();
    toast.success(reason);
  },
}));

function startSync() {
  stopSync();
  unsubscribe = useDemo.subscribe((s, prev) => {
    if (s.data === prev.data || applyingRemote || useWorkspace.getState().status !== "ready") return;
    useWorkspace.setState({ save: "dirty" });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void useWorkspace.getState().saveNow(), SAVE_DELAY_MS);
  });
  pollTimer = setInterval(() => void checkRemote(), POLL_MS);
  window.addEventListener("focus", onFocus);
  window.addEventListener("beforeunload", onUnload);
}

function stopSync() {
  unsubscribe?.();
  unsubscribe = null;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  if (typeof window !== "undefined") {
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("beforeunload", onUnload);
  }
}

const onFocus = () => void checkRemote();
const onUnload = (e: BeforeUnloadEvent) => {
  const s = useWorkspace.getState().save;
  if (s === "dirty" || s === "saving") {
    e.preventDefault();
    e.returnValue = "";
  }
};

/** Last save wins, but a change made by someone else is picked up when you have nothing waiting to save. */
async function checkRemote() {
  const ws = useWorkspace.getState();
  if (ws.status !== "ready" || ws.save === "dirty" || ws.save === "saving") return;
  const { data } = await (await sb()).from("workspace").select("updated_at, updated_by").eq("id", WORKSPACE_ID).maybeSingle();
  if (data && ws.remoteAt && data.updated_at > ws.remoteAt) {
    await ws.reload(true);
    toast(`Updated: ${data.updated_by ?? "someone"} changed the workspace`);
  }
}
