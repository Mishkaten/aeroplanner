import { describe, expect, it } from "vitest";
import {
  activeVersion,
  addVersion,
  canonicalState,
  defaultVersions,
  diffLegs,
  isDraft,
  liveVersion,
  normalizeVersions,
  publishVersion,
  removeVersion,
  renameVersion,
  switchVersion,
  validateVersionName,
  versionContent,
  MAIN_VERSION_ID,
} from "./versions";
import { validateAll } from "./validate";
import { normalizeData } from "./workspace";
import { fullDemoState } from "./seed";
import { applyPatch } from "./patch";
import { useDemo } from "./store";
import type { DomainState } from "./types";

const NOW = "2026-10-20T10:00:00Z";
const base = () => fullDemoState();
const withDraft = (s: DomainState, from: "copy" | "blank" = "copy") => addVersion(s, { name: "Winter draft", note: "n", from, createdAt: NOW });

describe("defaults", () => {
  it("a state has one live version, active, with nothing parked", () => {
    const s = base();
    expect(s.versions).toHaveLength(1);
    expect(s.versions[0]).toMatchObject({ id: MAIN_VERSION_ID, live: true });
    expect(s.activeVersionId).toBe(MAIN_VERSION_ID);
    expect(s.parked).toEqual({});
    expect(isDraft(s)).toBe(false);
  });
});

describe("creating versions", () => {
  it("a copy has the same legs and permits but is independent of the original", () => {
    const s = base();
    const { state, id } = withDraft(s);
    expect(state.parked[id].legs).toEqual(s.legs);
    expect(state.parked[id].permits).toEqual(s.permits);
    expect(state.parked[id].legs).not.toBe(state.legs);
    expect(state.parked[id].legs[0]).not.toBe(state.legs[0]);
    expect(liveVersion(state).id).toBe(MAIN_VERSION_ID);
    expect(state.versions.find((v) => v.id === id)!.live).toBe(false);
  });
  it("a blank version has no legs", () => {
    const { state, id } = withDraft(base(), "blank");
    expect(state.parked[id]).toEqual({ legs: [], permits: [], patterns: [] });
  });
  it("names must be present, unique ignoring case, and at most 60 characters", () => {
    const { state } = withDraft(base());
    expect(validateVersionName("", state.versions)).toMatch(/Enter a name/);
    expect(validateVersionName("  winter DRAFT ", state.versions)).toMatch(/already/);
    expect(validateVersionName("x".repeat(61), state.versions)).toMatch(/60/);
    expect(validateVersionName("Winter draft", state.versions, state.versions[1].id)).toBeNull();
    expect(validateVersionName("Summer", state.versions)).toBeNull();
  });
});

describe("switching", () => {
  it("swaps what is in legs and parks the other version unchanged, and swaps back exactly", () => {
    const s = base();
    const { state, id } = withDraft(s, "blank");
    const draft = switchVersion(state, id);
    expect(draft.activeVersionId).toBe(id);
    expect(draft.legs).toEqual([]);
    expect(draft.parked[MAIN_VERSION_ID].legs).toEqual(s.legs);
    expect(isDraft(draft)).toBe(true);
    expect(activeVersion(draft).id).toBe(id);
    const back = switchVersion(draft, MAIN_VERSION_ID);
    expect(back.legs).toEqual(s.legs);
    expect(back.parked[id]).toEqual({ legs: [], permits: [], patterns: [] });
    expect(Object.keys(back.parked)).toEqual([id]);
  });
  it("an unknown id or the same id changes nothing", () => {
    const s = base();
    expect(switchVersion(s, "nope")).toBe(s);
    expect(switchVersion(s, s.activeVersionId)).toBe(s);
  });
  it("edits made while a draft is open stay in the draft", () => {
    const { state, id } = withDraft(base());
    const draft = switchVersion(state, id);
    const leg = draft.legs[0];
    const edited = applyPatch(draft, [{ op: "set", coll: "legs", id: leg.id, value: { notes: "draft only" } }]).state;
    const back = switchVersion(edited, MAIN_VERSION_ID);
    expect(back.legs.find((l) => l.id === leg.id)!.notes).not.toBe("draft only");
    expect(back.parked[id].legs.find((l) => l.id === leg.id)!.notes).toBe("draft only");
  });
  it("versionContent reads the active and the parked versions alike", () => {
    const { state, id } = withDraft(base(), "blank");
    expect(versionContent(state, MAIN_VERSION_ID).legs).toBe(state.legs);
    expect(versionContent(state, id).legs).toEqual([]);
    expect(versionContent(state, "ghost")).toEqual({ legs: [], permits: [], patterns: [] });
  });
});

describe("what is saved", () => {
  it("always has the live version in legs, even while a draft is open", () => {
    const s = base();
    const { state, id } = withDraft(s, "blank");
    const open = switchVersion(state, id);
    const saved = canonicalState(open);
    expect(saved.activeVersionId).toBe(MAIN_VERSION_ID);
    expect(saved.legs).toEqual(s.legs);
    expect(saved.parked[id].legs).toEqual([]);
  });
  it("is stable: saving the saved copy changes nothing, and loading it gives the same state", () => {
    const { state, id } = withDraft(base());
    const saved = canonicalState(switchVersion(state, id));
    expect(canonicalState(saved)).toEqual(saved);
    expect(normalizeData(JSON.parse(JSON.stringify(saved))).parked).toEqual(saved.parked);
    expect(normalizeData(JSON.parse(JSON.stringify(saved))).versions).toEqual(saved.versions);
  });
  it("after publishing, the newly live version is the one in the saved legs", () => {
    const { state, id } = withDraft(base(), "blank");
    const published = publishVersion(switchVersion(state, id), id);
    const saved = canonicalState(published);
    expect(saved.legs).toEqual([]);
    expect(saved.parked[MAIN_VERSION_ID].legs.length).toBe(base().legs.length);
    expect(saved.versions.filter((v) => v.live).map((v) => v.id)).toEqual([id]);
  });
});

describe("publish, rename, delete", () => {
  it("publish keeps exactly one live version and keeps the old one as a draft", () => {
    const { state, id } = withDraft(base());
    const p = publishVersion(state, id);
    expect(p.versions.filter((v) => v.live)).toHaveLength(1);
    expect(liveVersion(p).id).toBe(id);
    expect(p.versions.find((v) => v.id === MAIN_VERSION_ID)!.live).toBe(false);
  });
  it("rename changes name and note only", () => {
    const { state, id } = withDraft(base());
    const r = renameVersion(state, id, " Spring ", " for client A ");
    expect(r.versions.find((v) => v.id === id)).toMatchObject({ name: "Spring", note: "for client A", live: false });
  });
  it("the live version cannot be deleted", () => {
    const s = base();
    expect(removeVersion(s, MAIN_VERSION_ID)).toBe(s);
  });
  it("deleting a draft removes its legs, and deleting the open draft returns to the live version", () => {
    const { state, id } = withDraft(base());
    const gone = removeVersion(state, id);
    expect(gone.versions.map((v) => v.id)).toEqual([MAIN_VERSION_ID]);
    expect(gone.parked[id]).toBeUndefined();
    const open = switchVersion(state, id);
    const goneOpen = removeVersion(open, id);
    expect(goneOpen.activeVersionId).toBe(MAIN_VERSION_ID);
    expect(goneOpen.legs.length).toBe(base().legs.length);
    expect(goneOpen.parked).toEqual({});
  });
});

describe("loading a workspace saved without versions or with damaged ones", () => {
  it("no versions: one live version and the old legs stay in front", () => {
    const n = normalizeData({ legs: base().legs });
    expect(n.versions).toHaveLength(1);
    expect(n.activeVersionId).toBe(MAIN_VERSION_ID);
    expect(n.legs).toHaveLength(base().legs.length);
  });
  it("two live versions become one; an unknown active version becomes the live one; parked content of unknown versions is dropped", () => {
    const d = defaultVersions();
    const fixed = normalizeVersions({
      versions: [
        { ...d.versions[0], live: true },
        { id: "v-b", name: "B", note: "", live: true, createdAt: "" },
      ],
      activeVersionId: "gone",
      parked: { "v-b": { legs: [], permits: [], patterns: [] }, ghost: { legs: [], permits: [], patterns: [] } },
    });
    expect(fixed.versions.filter((v) => v.live)).toHaveLength(1);
    expect(fixed.activeVersionId).toBe(MAIN_VERSION_ID);
    expect(Object.keys(fixed.parked)).toEqual(["v-b"]);
  });
});

describe("validation is per version", () => {
  it("the same legs in two versions do not create flight number conflicts: only the open version is checked", () => {
    const s = base();
    const before = validateAll(s).issues.length;
    const { state } = withDraft(s);
    expect(validateAll(state).issues.length).toBe(before);
    const draft = switchVersion(state, state.versions[1].id);
    expect(validateAll(draft).issues.length).toBe(before);
  });
  it("fixing a conflict in a draft does not touch the live schedule", () => {
    const { state, id } = withDraft(base());
    const draft = switchVersion(state, id);
    const r1 = validateAll(draft).issues.find((i) => i.ruleId === "R1")!;
    const fix = r1.fixes.find((f) => f.enabled)!;
    const fixed = applyPatch(draft, fix.patch).state;
    expect(validateAll(fixed).issues.length).toBeLessThan(validateAll(draft).issues.length);
    expect(validateAll(switchVersion(fixed, MAIN_VERSION_ID)).issues.length).toBe(validateAll(base()).issues.length);
  });
});

describe("comparing", () => {
  it("lists added, removed and changed legs and counts the rest", () => {
    const s = base();
    const other = s.legs.slice(2).map((l) => ({ ...l }));
    other[0] = { ...other[0], aircraftId: "4L-PXD", notes: "moved" };
    const extra = { ...s.legs[0], id: "L-extra", flightNumber: "PHC999" };
    const d = diffLegs(s.legs, [...other, extra]);
    expect(d.removed.map((l) => l.id).sort()).toEqual([s.legs[0].id, s.legs[1].id].sort());
    expect(d.added.map((l) => l.id)).toEqual(["L-extra"]);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0].fields).toEqual(expect.arrayContaining(["aircraftId", "notes"]));
    expect(d.same).toBe(s.legs.length - 2 - 1);
  });
  it("identical versions have no differences", () => {
    const s = base();
    const d = diffLegs(s.legs, s.legs.map((l) => ({ ...l })));
    expect([d.added.length, d.removed.length, d.changed.length, d.same]).toEqual([0, 0, 0, s.legs.length]);
  });
});

describe("the store", () => {
  const reset = () => useDemo.getState().reset("full");
  it("creates, edits, publishes and deletes versions through the actions", () => {
    reset();
    const st = useDemo.getState();
    expect(st.createVersion("", "", "copy")).toMatch(/Enter a name/);
    expect(st.createVersion("Winter", "n", "copy")).toBeNull();
    let s = useDemo.getState();
    expect(activeVersion(s.data).name).toBe("Winter");
    expect(s.data.legs.length).toBe(90);
    s.commit([{ op: "remove", coll: "legs", id: s.data.legs[0].id }], "removed", { silent: true });
    s = useDemo.getState();
    expect(s.data.legs.length).toBe(89);
    expect(s.data.parked[MAIN_VERSION_ID].legs.length).toBe(90);
    s.switchVersion(MAIN_VERSION_ID);
    expect(useDemo.getState().data.legs.length).toBe(90);
    const winter = useDemo.getState().data.versions.find((v) => v.name === "Winter")!;
    expect(useDemo.getState().renameVersion(winter.id, "Winter 26", "")).toBeNull();
    expect(useDemo.getState().createVersion("winter 26", "", "blank")).toMatch(/already/);
    useDemo.getState().publishVersion(winter.id);
    expect(liveVersion(useDemo.getState().data).id).toBe(winter.id);
    useDemo.getState().deleteVersion(winter.id);
    expect(useDemo.getState().data.versions.some((v) => v.id === winter.id)).toBe(true); // live: refused
    useDemo.getState().publishVersion(MAIN_VERSION_ID);
    useDemo.getState().deleteVersion(winter.id);
    expect(useDemo.getState().data.versions).toHaveLength(1);
    reset();
  });
  it("stops at 12 versions", () => {
    reset();
    for (let i = 0; i < 11; i++) expect(useDemo.getState().createVersion(`v${i}`, "", "blank")).toBeNull();
    expect(useDemo.getState().data.versions).toHaveLength(12);
    expect(useDemo.getState().createVersion("one too many", "", "blank")).toMatch(/up to 12/);
    reset();
  });
  it("switching clears the checklist selection", () => {
    reset();
    const st = useDemo.getState();
    st.setSelection([st.data.legs[0].id]);
    st.createVersion("Draft", "", "copy");
    expect(useDemo.getState().selection).toEqual([]);
    reset();
  });
});
