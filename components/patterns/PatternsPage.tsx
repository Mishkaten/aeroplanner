"use client";

import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { indexAirports, pairLabel, resolveStation } from "@/lib/airports";
import {
  DAY_NAMES,
  adoptPatch,
  describePattern,
  detectPatterns,
  nextPatternId,
  occurrenceDates,
  patternStats,
  planDeletePattern,
  planPattern,
  validatePattern,
  type DetectedPattern,
} from "@/lib/patterns";
import { useDemo } from "@/lib/store";
import { parseHHMM } from "@/lib/time";
import type { DomainState, Pattern, PatternLeg } from "@/lib/types";
import { ListGate } from "@/components/common/ListGate";

type Dlg = { kind: "edit"; pattern: Pattern | null } | { kind: "delete"; pattern: Pattern } | { kind: "detect" } | null;

export function PatternsPage() {
  const data = useDemo((s) => s.data);
  const [dlg, setDlg] = useState<Dlg>(null);
  const reg = (id: string) => data.aircraft.find((a) => a.id === id)?.registration ?? id;

  const regenerate = (p: Pattern) => {
    const plan = planPattern(data, p, p, { permits: true });
    if (plan.patch.length <= 1) return;
    useDemo.getState().commit(plan.patch, `${p.name}: ${plan.inserted} missing legs added`);
  };

  return (
    <>
      <div className="head">
        <div>
          <h1>Patterns</h1>
          <p>
            A pattern is a rotation that repeats on set weekdays, every 1 to 4 weeks, between two dates. It makes the dated legs for you. Change the pattern and its legs follow, but a leg someone edited or cancelled by hand is
            left alone.
          </p>
        </div>
        <span className="grow" />
        <button className="btn" onClick={() => setDlg({ kind: "detect" })} disabled={data.legs.length === 0}>
          Find patterns in the schedule
        </button>
        <button className="btn pri" onClick={() => setDlg({ kind: "edit", pattern: null })}>
          + New pattern
        </button>
      </div>

      <ListGate>
        <section className="card scroll" aria-label="Patterns">
          {data.patterns.length === 0 ? (
            <div className="empty">
              <b>No patterns yet</b>
              <span>Create one, or let AeroPlanner look for rotations that already repeat in your schedule.</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn pri" onClick={() => setDlg({ kind: "edit", pattern: null })}>
                  + New pattern
                </button>
                <button className="btn" onClick={() => setDlg({ kind: "detect" })} disabled={data.legs.length === 0}>
                  Find patterns in the schedule
                </button>
              </div>
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  {["Pattern", "Aircraft", "When", "Legs made", ""].map((h, i) => (
                    <th key={i} scope="col">
                      {h || <span className="sr-only">Actions</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.patterns.map((p) => {
                  const st = patternStats(data, p);
                  return (
                    <tr key={p.id}>
                      <th scope="row" style={{ textTransform: "none", letterSpacing: 0, fontSize: 14, color: "var(--ink)", background: "none" }}>
                        {p.name}
                        <br />
                        <small className="hint">{describePattern(p, data)}</small>
                      </th>
                      <td className="mono">{reg(p.aircraftId)}</td>
                      <td style={{ fontSize: 13 }}>
                        {[...p.days].sort().map((d) => DAY_NAMES[d]).join(" ")}
                        <br />
                        <small className="hint">
                          {p.everyWeeks === 1 ? "every week" : `every ${p.everyWeeks} weeks`}, {p.basis === "local" ? "local time" : "UTC"}
                        </small>
                      </td>
                      <td className="mono">
                        {st.legs}
                        {st.changed > 0 && <small className="hint"> {st.changed} changed by hand</small>}
                        {st.missing > 0 && <span className="b b-wa"> {st.missing} missing</span>}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {st.missing > 0 && (
                          <>
                            <button className="btn sm" onClick={() => regenerate(p)}>
                              Add missing legs
                            </button>{" "}
                          </>
                        )}
                        <button className="btn sm" onClick={() => setDlg({ kind: "edit", pattern: p })} aria-label={`Edit ${p.name}`}>
                          Edit
                        </button>{" "}
                        <button className="btn sm" onClick={() => setDlg({ kind: "delete", pattern: p })} aria-label={`Delete ${p.name}`}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
        <p className="hint">
          Times are UTC, or local at each departure station when the pattern says so (the local time then stays the same across daylight saving and UTC moves). Patterns belong to the version you are editing.
        </p>
      </ListGate>

      {dlg?.kind === "edit" && <PatternDialog key={dlg.pattern?.id ?? "new"} pattern={dlg.pattern} onClose={() => setDlg(null)} />}
      {dlg?.kind === "delete" && <DeleteDialog pattern={dlg.pattern} onClose={() => setDlg(null)} />}
      {dlg?.kind === "detect" && <DetectDialog onClose={() => setDlg(null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
interface LegRow {
  flight: string;
  dep: string;
  arr: string;
  day: string;
  etd: string;
  eta: string;
  notes: string;
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function rowFromLeg(l: PatternLeg, state: DomainState): LegRow {
  const idx = indexAirports(state.airports);
  return { flight: l.flightNumber + l.suffix, dep: pairLabel(l.depIcao, idx), arr: pairLabel(l.arrIcao, idx), day: String(l.dayOffset), etd: hhmm(l.etdMin), eta: hhmm((l.etdMin + l.blockMin) % 1440), notes: l.notes };
}

const blankRow = (): LegRow => ({ flight: "", dep: "", arr: "", day: "0", etd: "", eta: "", notes: "" });

/** The pattern the form describes. Fields that cannot be read become values that validatePattern rejects. */
function patternFromForm(id: string, f: FormState, state: DomainState): Pattern {
  const idx = indexAirports(state.airports);
  return {
    id,
    name: f.name,
    aircraftId: f.aircraft,
    backupAircraftId: state.aircraft.find((a) => a.id === f.aircraft)?.defaultBackupId ?? null,
    basis: f.basis,
    everyWeeks: f.every,
    days: f.days,
    from: f.from,
    to: f.to,
    legs: f.rows.map((r) => {
      const t = r.flight.toUpperCase().replace(/\s+/g, "");
      const d = /^[A-Z]{3}\d{1,4}D$/.test(t);
      const etd = parseHHMM(r.etd);
      const eta = parseHHMM(r.eta);
      const dep = resolveStation(r.dep, idx);
      const arr = resolveStation(r.arr, idx);
      return {
        flightNumber: d ? t.slice(0, -1) : t,
        suffix: d ? "D" : "",
        legType: (dep?.provisional || arr?.provisional ? "ferry" : "landing") as PatternLeg["legType"],
        depIcao: dep?.icao ?? "",
        arrIcao: arr?.icao ?? "",
        dayOffset: Number(r.day),
        etdMin: etd ?? -1,
        blockMin: etd === null || eta === null ? 0 : (((eta - etd) % 1440) + 1440) % 1440,
        notes: r.notes.trim(),
      };
    }),
  };
}

interface FormState {
  name: string;
  aircraft: string;
  basis: "utc" | "local";
  every: 1 | 2 | 3 | 4;
  days: number[];
  from: string;
  to: string;
  rows: LegRow[];
  permits: boolean;
}

function PatternDialog({ pattern, onClose }: { pattern: Pattern | null; onClose: () => void }) {
  const data = useDemo((s) => s.data);
  const [f, setF] = useState<FormState>(() =>
    pattern
      ? { name: pattern.name, aircraft: pattern.aircraftId, basis: pattern.basis, every: pattern.everyWeeks, days: pattern.days, from: pattern.from, to: pattern.to, rows: pattern.legs.map((l) => rowFromLeg(l, data)), permits: false }
      : { name: "", aircraft: data.aircraft[0]?.id ?? "", basis: "utc", every: 1, days: [], from: "", to: "", rows: [blankRow()], permits: true },
  );
  const [show, setShow] = useState(false);
  const set = (p: Partial<FormState>) => setF((x) => ({ ...x, ...p }));
  const setRow = (i: number, p: Partial<LegRow>) => setF((x) => ({ ...x, rows: x.rows.map((r, j) => (j === i ? { ...r, ...p } : r)) }));

  const id = pattern?.id ?? nextPatternId(data.patterns);
  const next = useMemo(() => patternFromForm(id, f, data), [id, f, data]);
  const problems = useMemo(() => validatePattern(data, next, data.patterns), [data, next]);
  const problemOf = (field: string) => (show ? problems.find((p) => p.field === field)?.message : undefined);
  const plan = useMemo(() => (problems.length ? null : planPattern(data, next, pattern, { permits: f.permits })), [problems, data, next, pattern, f.permits]);

  const save = () => {
    setShow(true);
    if (!plan) return;
    useDemo.getState().commit(plan.patch, `${next.name.trim()}: ${plan.inserted} added, ${plan.updated} updated, ${plan.removed} removed`);
    onClose();
  };

  const dayCount = occurrenceDates(next).length;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[820px]" style={{ maxHeight: "92vh", overflowY: "auto" }}>
        <DialogHeader>
          <DialogTitle>{pattern ? `Edit ${pattern.name}` : "New pattern"}</DialogTitle>
          <DialogDescription>
            {pattern ? "The legs this pattern made are updated. Legs someone edited by hand are left as they are." : "The legs are created when you save. Nothing is created until then."}
          </DialogDescription>
        </DialogHeader>

        <div className="fgrid">
          <div className="fld">
            <label htmlFor="pt-name">Name</label>
            <input id="pt-name" className="inp" value={f.name} onChange={(e) => set({ name: e.target.value })} aria-invalid={!!problemOf("name")} placeholder="Tbilisi to Belgrade and back" />
            <span className="err-t">{problemOf("name")}</span>
          </div>
          <div className="fld">
            <label htmlFor="pt-ac">Aircraft</label>
            <select id="pt-ac" className="sel" value={f.aircraft} onChange={(e) => set({ aircraft: e.target.value })}>
              {data.aircraft.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.registration} {a.type}
                </option>
              ))}
            </select>
            <span className="err-t">{problemOf("aircraft")}</span>
          </div>
          <div className="fld">
            <label htmlFor="pt-basis">Times are</label>
            <select id="pt-basis" className="sel" value={f.basis} onChange={(e) => set({ basis: e.target.value as "utc" | "local" })}>
              <option value="utc">UTC</option>
              <option value="local">Local at each departure station (follows daylight saving)</option>
            </select>
          </div>
          <div className="fld">
            <label htmlFor="pt-every">Repeats</label>
            <select id="pt-every" className="sel" value={f.every} onChange={(e) => set({ every: Number(e.target.value) as 1 | 2 | 3 | 4 })}>
              <option value={1}>Every week</option>
              <option value={2}>Every 2 weeks</option>
              <option value={3}>Every 3 weeks</option>
              <option value={4}>Every 4 weeks</option>
            </select>
          </div>
          <div className="fld">
            <label htmlFor="pt-from">First day</label>
            <input id="pt-from" type="date" className="inp mono" value={f.from} onChange={(e) => set({ from: e.target.value })} aria-invalid={!!problemOf("from")} />
            <span className="err-t">{problemOf("from")}</span>
          </div>
          <div className="fld">
            <label htmlFor="pt-to">Last day a rotation may start</label>
            <input id="pt-to" type="date" className="inp mono" value={f.to} onChange={(e) => set({ to: e.target.value })} aria-invalid={!!problemOf("to")} />
            <span className="err-t">{problemOf("to")}</span>
          </div>
        </div>

        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="lbl">Rotation starts on</legend>
          <div className="seg" role="group" aria-label="Weekdays">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <button key={d} type="button" aria-pressed={f.days.includes(d)} onClick={() => set({ days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d].sort() })}>
                {DAY_NAMES[d]}
              </button>
            ))}
          </div>
          <span className="err-t">{problemOf("days")}</span>
        </fieldset>

        <div>
          <b>Legs of one rotation</b>
          <div style={{ display: "grid", gridTemplateColumns: "92px 1fr 1fr 62px 70px 70px 28px", gap: 6, alignItems: "center", marginTop: 6, fontSize: 12 }} role="group" aria-label="Legs">
            <span className="lbl">Flight</span>
            <span className="lbl">From</span>
            <span className="lbl">To</span>
            <span className="lbl" title="0 same day, 1 next day">Day +</span>
            <span className="lbl">ETD</span>
            <span className="lbl">ETA</span>
            <span />
            {f.rows.map((r, i) => (
              <RowFields key={i} r={r} i={i} setRow={setRow} remove={f.rows.length > 1 ? () => set({ rows: f.rows.filter((_, j) => j !== i) }) : null} problem={(k) => problemOf(`leg${i}.${k}`)} />
            ))}
          </div>
          <button className="btn sm" style={{ marginTop: 8 }} onClick={() => set({ rows: [...f.rows, { ...blankRow(), dep: f.rows[f.rows.length - 1]?.arr ?? "" }] })}>
            + Add a leg to the rotation
          </button>
          <span className="err-t">{problemOf("legs")}</span>
        </div>

        {!pattern && (
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={f.permits} onChange={(e) => set({ permits: e.target.checked })} />
            Add the permit rows the route needs to the new legs, as pending
          </label>
        )}

        <div className="card cardb" aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {problems.length > 0 ? (
            <>
              <b>{show ? "Fix these to continue:" : "Fill in the pattern to see what it will do."}</b>
              {show && problems.slice(0, 5).map((p) => <span key={p.field + p.message} style={{ fontSize: 12 }}>{p.message}</span>)}
            </>
          ) : plan ? (
            <>
              <b>
                {dayCount} rotations, {dayCount * next.legs.length} legs
              </b>
              <span style={{ fontSize: 13 }}>
                {plan.inserted} to add, {plan.updated} to update, {plan.removed} to remove
                {plan.kept > 0 && `, ${plan.kept} left alone because someone changed them by hand`}
                {plan.unchanged > 0 && `, ${plan.unchanged} already right`}.
              </span>
              {plan.clashes.length > 0 && (
                <span style={{ fontSize: 13 }}>
                  <b>{plan.clashes.length} skipped:</b> a leg with the same flight, day and aircraft already exists ({plan.clashes.slice(0, 3).map((c) => c.label).join("; ")}
                  {plan.clashes.length > 3 ? "; ..." : ""}).
                </span>
              )}
              <span style={{ fontSize: 13 }}>
                {plan.newIssues.length === 0 ? "No new issues." : <b>{plan.newIssues.length} new issues:</b>}
                {plan.clearedIssues > 0 && ` ${plan.clearedIssues} existing issues are cleared.`}
              </span>
              {plan.newIssues.slice(0, 4).map((m) => (
                <span key={m} style={{ fontSize: 12 }}>
                  {m}
                </span>
              ))}
              {plan.warnings.slice(0, 3).map((m) => (
                <span key={m} style={{ fontSize: 12 }}>
                  {m}
                </span>
              ))}
            </>
          ) : null}
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn pri" onClick={save} disabled={show && !plan}>
            {pattern ? "Save and update legs" : "Create pattern and legs"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RowFields({ r, i, setRow, remove, problem }: { r: LegRow; i: number; setRow: (i: number, p: Partial<LegRow>) => void; remove: (() => void) | null; problem: (k: string) => string | undefined }) {
  const cell = (k: keyof LegRow, extra: React.InputHTMLAttributes<HTMLInputElement> = {}, pk: string = k) => (
    <input className="inp mono" aria-label={`Leg ${i + 1} ${k}`} value={r[k]} aria-invalid={!!problem(pk)} title={problem(pk)} onChange={(e) => setRow(i, { [k]: e.target.value } as Partial<LegRow>)} {...extra} />
  );
  return (
    <>
      {cell("flight", { placeholder: "PHC509", style: { width: "100%" } })}
      {cell("dep", { placeholder: "UGTB/TBS" })}
      {cell("arr", { placeholder: "LYBE/BEG" })}
      {cell("day", { inputMode: "numeric" })}
      {cell("etd", { placeholder: "03:30" })}
      {cell("eta", { placeholder: "06:30" }, "eta")}
      {remove ? (
        <button className="btn sm" onClick={remove} aria-label={`Remove leg ${i + 1}`} style={{ padding: "0 6px" }}>
          x
        </button>
      ) : (
        <span />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
function DeleteDialog({ pattern, onClose }: { pattern: Pattern; onClose: () => void }) {
  const data = useDemo((s) => s.data);
  const st = patternStats(data, pattern);
  const run = (removeLegs: boolean) => {
    const r = planDeletePattern(data, pattern, removeLegs);
    useDemo.getState().commit(r.patch, removeLegs ? `${pattern.name} deleted with ${r.removed} legs` : `${pattern.name} deleted, ${r.kept} legs kept`);
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Delete &quot;{pattern.name}&quot;?</DialogTitle>
          <DialogDescription>
            The pattern made {st.legs} legs{st.changed > 0 ? `, ${st.changed} of them changed by hand` : ""}. Choose what happens to them. You can undo this right after.
          </DialogDescription>
        </DialogHeader>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button className="btn dng" onClick={() => run(true)}>
            Delete the pattern and the legs nobody changed
          </button>
          <button className="btn" onClick={() => run(false)}>
            Delete the pattern, keep all {st.legs} legs as ordinary legs
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
function DetectDialog({ onClose }: { onClose: () => void }) {
  const data = useDemo((s) => s.data);
  const found = useMemo<DetectedPattern[]>(() => detectPatterns(data), [data]);
  const [chosen, setChosen] = useState<Set<number>>(() => new Set(found.map((_, i) => i)));
  const covered = found.filter((_, i) => chosen.has(i)).reduce((n, d) => n + d.legIds.length, 0);
  const create = () => {
    const picks = found.filter((_, i) => chosen.has(i));
    useDemo.getState().commit(adoptPatch(data, picks), `${picks.length} patterns created from ${covered} legs`);
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[760px]" style={{ maxHeight: "90vh", overflowY: "auto" }}>
        <DialogHeader>
          <DialogTitle>Patterns found in the schedule</DialogTitle>
          <DialogDescription>
            These legs already repeat on the same weekday at the same time at least three times. Turning them into patterns does not change a single leg: it only lets you change all of them at once later.
          </DialogDescription>
        </DialogHeader>
        {found.length === 0 ? (
          <div className="info">Nothing repeats often enough. A pattern needs the same leg on the same weekday, at the same time, at least three times in a row.</div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn sm" onClick={() => setChosen(new Set(found.map((_, i) => i)))}>
                Select all
              </button>
              <button className="btn sm" onClick={() => setChosen(new Set())}>
                Select none
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {found.map((d, i) => (
                <label key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={chosen.has(i)}
                    style={{ marginTop: 4 }}
                    onChange={() => {
                      const n = new Set(chosen);
                      if (n.has(i)) n.delete(i);
                      else n.add(i);
                      setChosen(n);
                    }}
                  />
                  <span>
                    <b>{d.pattern.name}</b> <span className="mono hint">{data.aircraft.find((a) => a.id === d.pattern.aircraftId)?.registration}</span> <span className="hint">({d.legIds.length} legs)</span>
                    <br />
                    <small className="hint">{describePattern(d.pattern, data)}</small>
                  </span>
                </label>
              ))}
            </div>
          </>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
          <span className="hint" style={{ marginRight: "auto" }}>
            {data.legs.length - found.reduce((n, d) => n + d.legIds.length, 0)} of {data.legs.length} legs do not repeat and stay as they are.
          </span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn pri" disabled={chosen.size === 0} onClick={create}>
            Create {chosen.size} patterns
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
