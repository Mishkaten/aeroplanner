// Schedule versions (drafts, seasons, client requests). Pure functions on DomainState.
//
// Shape: `legs` and `permits` always hold the version being edited (activeVersionId). Every other version is
// parked in `parked`. All the screens, the validation and the exports therefore keep reading `legs` as before.
// The saved copy of a workspace always has the live version in `legs` (see canonicalState), so two people who
// look at different versions never change what the other loads.
import { structuredCloneSafe } from "./clone";
import { fullFlight } from "./legs";
import type { DomainState, Leg, ParkedVersion, ScheduleVersion } from "./types";

export const MAIN_VERSION_ID = "v-main";
export const MAX_VERSIONS = 12;

/** Used by the seed and by workspaces saved before versions existed. */
export function defaultVersions(): Pick<DomainState, "versions" | "activeVersionId" | "parked"> {
  return {
    versions: [{ id: MAIN_VERSION_ID, name: "Live schedule", note: "", live: true, createdAt: "" }],
    activeVersionId: MAIN_VERSION_ID,
    parked: {},
  };
}

export const liveVersion = (s: Pick<DomainState, "versions">): ScheduleVersion => s.versions.find((v) => v.live) ?? s.versions[0];
export const activeVersion = (s: Pick<DomainState, "versions" | "activeVersionId">): ScheduleVersion =>
  s.versions.find((v) => v.id === s.activeVersionId) ?? liveVersion(s);
export const isDraft = (s: Pick<DomainState, "versions" | "activeVersionId">): boolean => !activeVersion(s).live;

/** Legs and permits of any version, whether it is the active one or parked. */
export function versionContent(s: DomainState, id: string): ParkedVersion {
  return id === s.activeVersionId ? { legs: s.legs, permits: s.permits, patterns: s.patterns } : (s.parked[id] ?? { legs: [], permits: [], patterns: [] });
}

/** Makes another version the one being edited. The previous one is parked as it is. */
export function switchVersion(s: DomainState, id: string): DomainState {
  if (id === s.activeVersionId || !s.versions.some((v) => v.id === id)) return s;
  const parked = { ...s.parked, [s.activeVersionId]: { legs: s.legs, permits: s.permits, patterns: s.patterns } };
  const next = parked[id] ?? { legs: [], permits: [], patterns: [] };
  delete parked[id];
  return { ...s, activeVersionId: id, legs: next.legs, permits: next.permits, patterns: next.patterns, parked };
}

/** What is written to the server: the live version in `legs`, drafts parked. */
export const canonicalState = (s: DomainState): DomainState => switchVersion(s, liveVersion(s).id);

/** Fills in versions for a workspace saved without them, and drops parked content of versions that no longer exist. */
export function normalizeVersions(raw: Partial<DomainState>): Pick<DomainState, "versions" | "activeVersionId" | "parked"> {
  const d = defaultVersions();
  const versions = raw.versions?.length ? raw.versions : d.versions;
  const live = versions.find((v) => v.live)?.id ?? versions[0].id;
  const fixed = versions.map((v) => ({ ...v, live: v.id === live }));
  const active = fixed.some((v) => v.id === raw.activeVersionId) ? (raw.activeVersionId as string) : live;
  const parked: Record<string, ParkedVersion> = {};
  for (const v of fixed) if (v.id !== active && raw.parked?.[v.id]) parked[v.id] = { legs: raw.parked[v.id].legs ?? [], permits: raw.parked[v.id].permits ?? [], patterns: raw.parked[v.id].patterns ?? [] };
  return { versions: fixed, activeVersionId: active, parked };
}

/** v-2, v-3 ... the next number after the highest one in use. Deterministic, as the app logic must be. */
const newId = (versions: ScheduleVersion[]): string => {
  const used = versions.map((v) => /^v-(\d+)$/.exec(v.id)).filter((m): m is RegExpExecArray => !!m).map((m) => Number(m[1]));
  return `v-${Math.max(1, ...used) + 1}`;
};

export function validateVersionName(name: string, versions: ScheduleVersion[], exceptId: string | null = null): string | null {
  const n = name.trim();
  if (!n) return "Enter a name";
  if (n.length > 60) return "Use 60 characters or fewer";
  if (versions.some((v) => v.id !== exceptId && v.name.trim().toLowerCase() === n.toLowerCase())) return `There is already a version called "${n}"`;
  return null;
}

export interface NewVersion {
  name: string;
  note: string;
  /** "copy": start from the version being edited. "blank": start empty. */
  from: "copy" | "blank";
  createdAt: string;
}

/** Adds a version (not live, not active) and returns its id. */
export function addVersion(s: DomainState, o: NewVersion): { state: DomainState; id: string } {
  const id = newId(s.versions);
  const content: ParkedVersion = o.from === "copy" ? { legs: structuredCloneSafe(s.legs), permits: structuredCloneSafe(s.permits), patterns: structuredCloneSafe(s.patterns) } : { legs: [], permits: [], patterns: [] };
  const v: ScheduleVersion = { id, name: o.name.trim(), note: o.note.trim(), live: false, createdAt: o.createdAt };
  return { state: { ...s, versions: [...s.versions, v], parked: { ...s.parked, [id]: content } }, id };
}

export function renameVersion(s: DomainState, id: string, name: string, note: string): DomainState {
  return { ...s, versions: s.versions.map((v) => (v.id === id ? { ...v, name: name.trim(), note: note.trim() } : v)) };
}

/** Makes a version the live one. The old live version stays as a draft. */
export function publishVersion(s: DomainState, id: string): DomainState {
  if (!s.versions.some((v) => v.id === id)) return s;
  return { ...s, versions: s.versions.map((v) => ({ ...v, live: v.id === id })) };
}

/** The live version cannot be deleted. Deleting the one being edited switches to the live version first. */
export function removeVersion(s: DomainState, id: string): DomainState {
  const v = s.versions.find((x) => x.id === id);
  if (!v || v.live) return s;
  const base = id === s.activeVersionId ? switchVersion(s, liveVersion(s).id) : s;
  const parked = { ...base.parked };
  delete parked[id];
  return { ...base, versions: base.versions.filter((x) => x.id !== id), parked };
}

export interface LegDiff {
  added: Leg[];
  removed: Leg[];
  changed: { before: Leg; after: Leg; fields: string[] }[];
  same: number;
}

const FIELDS: (keyof Leg)[] = ["flightNumber", "suffix", "aircraftId", "depIcao", "arrIcao", "etdUtc", "etaUtc", "status", "legType", "notes"];

/** Compares two versions leg by leg. Legs are matched by id, which names the flight, day, departure and aircraft. */
export function diffLegs(base: Leg[], other: Leg[]): LegDiff {
  const a = new Map(base.map((l) => [l.id, l]));
  const b = new Map(other.map((l) => [l.id, l]));
  const diff: LegDiff = { added: [], removed: [], changed: [], same: 0 };
  for (const [id, l] of b) {
    const prev = a.get(id);
    if (!prev) diff.added.push(l);
    else {
      const fields = FIELDS.filter((f) => prev[f] !== l[f]).map(String);
      if (fields.length) diff.changed.push({ before: prev, after: l, fields });
      else diff.same++;
    }
  }
  for (const [id, l] of a) if (!b.has(id)) diff.removed.push(l);
  const order = (x: Leg, y: Leg) => (x.etdUtc < y.etdUtc ? -1 : x.etdUtc > y.etdUtc ? 1 : fullFlight(x) < fullFlight(y) ? -1 : 1);
  diff.added.sort(order);
  diff.removed.sort(order);
  diff.changed.sort((x, y) => order(x.after, y.after));
  return diff;
}
