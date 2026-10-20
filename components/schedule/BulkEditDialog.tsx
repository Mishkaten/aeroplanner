"use client";

import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { resolveStation, indexAirports } from "@/lib/airports";
import { planBulk, planSwap, type BulkOp, type BulkPlan } from "@/lib/bulk";
import { useDemo } from "@/lib/store";
import { parseHHMM } from "@/lib/time";
import type { Leg } from "@/lib/types";

type Kind = "shift" | "block" | "flight" | "aircraft" | "swap" | "route" | "status" | "notes";
type Scope = "shown" | "selected";

const KINDS: { id: Kind; label: string; hint: string }[] = [
  { id: "shift", label: "Shift time", hint: "Move ETD and ETA together, by days and hours." },
  { id: "block", label: "Block time", hint: "Set or change the block time. The ETA follows the ETD." },
  { id: "flight", label: "Flight number", hint: "Give all chosen legs one flight number. A trailing D makes it a D flight." },
  { id: "aircraft", label: "Move to aircraft", hint: "Put all chosen legs on one aircraft." },
  { id: "swap", label: "Swap two aircraft", hint: "Every leg of one tail goes to the other and the other way round." },
  { id: "route", label: "Change airports", hint: "Replace the departure and/or arrival station." },
  { id: "status", label: "Cancel or restore", hint: "Mark the chosen legs CNL, or bring them back." },
  { id: "notes", label: "Notes", hint: "Replace the note or add text to it." },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shown: Leg[];
  selected: Leg[];
}

export function BulkEditDialog({ open, onOpenChange, shown, selected }: Props) {
  const data = useDemo((s) => s.data);
  const [kind, setKind] = useState<Kind>("shift");
  const [scope, setScope] = useState<Scope>("shown");
  const [dir, setDir] = useState<1 | -1>(1);
  const [days, setDays] = useState("0");
  const [time, setTime] = useState("01:00");
  const [blockMode, setBlockMode] = useState<"set" | "add" | "sub">("set");
  const [flight, setFlight] = useState("");
  const [aircraft, setAircraft] = useState("");
  const [swapB, setSwapB] = useState("");
  const [dep, setDep] = useState("");
  const [arr, setArr] = useState("");
  const [status, setStatus] = useState<Leg["status"]>("cancelled");
  const [noteMode, setNoteMode] = useState<"set" | "append">("append");
  const [note, setNote] = useState("");

  const effectiveScope: Scope = scope === "selected" && selected.length === 0 ? "shown" : scope;
  const legs = effectiveScope === "selected" ? selected : shown;
  const idx = useMemo(() => indexAirports(data.airports), [data.airports]);
  const first = aircraft || data.aircraft[0]?.id || "";

  const built = useMemo((): { plan: BulkPlan & { warning?: string | null }; error: string | null } => {
    const empty: BulkPlan = { patch: [], changes: [], skipped: [], newIssues: [], clearedIssues: 0, message: "" };
    const t = parseHHMM(time.trim().length === 4 && !time.includes(":") ? `${time.slice(0, 2)}:${time.slice(2)}` : time);
    let op: BulkOp | null = null;
    let error: string | null = null;
    switch (kind) {
      case "shift": {
        const d = Number(days);
        if (!Number.isInteger(d) || d < 0 || d > 366) error = "Days must be a whole number from 0 to 366.";
        else if (t === null) error = "Enter the time as HH:MM.";
        else op = { kind: "shift", minutes: dir * (d * 1440 + t) };
        break;
      }
      case "block":
        if (t === null) error = "Enter the block time as HH:MM.";
        else op = { kind: "block", mode: blockMode === "set" ? "set" : "add", minutes: blockMode === "sub" ? -t : t };
        break;
      case "flight":
        op = flight.trim() ? { kind: "flight", flight } : null;
        break;
      case "aircraft":
        op = first ? { kind: "aircraft", aircraftId: first } : null;
        break;
      case "swap": {
        const b = swapB || data.aircraft.find((a) => a.id !== first)?.id || "";
        if (!first || !b || first === b) return { plan: empty, error: "Choose two different aircraft." };
        return { plan: planSwap(data, legs, first, b), error: null };
      }
      case "route": {
        const d = dep.trim() ? resolveStation(dep, idx) : null;
        const a = arr.trim() ? resolveStation(arr, idx) : null;
        if (dep.trim() && !d) error = `Unknown departure station "${dep}".`;
        else if (arr.trim() && !a) error = `Unknown arrival station "${arr}".`;
        else if (!d && !a) op = null;
        else op = { kind: "route", depIcao: d?.icao ?? null, arrIcao: a?.icao ?? null };
        break;
      }
      case "status":
        op = { kind: "status", status };
        break;
      case "notes":
        op = note.trim() || noteMode === "set" ? { kind: "notes", mode: noteMode, text: note } : null;
        break;
    }
    if (!op) return { plan: empty, error };
    return { plan: planBulk(data, legs, op), error };
  }, [kind, dir, days, time, blockMode, flight, first, swapB, dep, arr, status, noteMode, note, data, legs, idx]);

  const { plan, error } = built;
  const apply = () => {
    if (!plan.patch.length) return;
    useDemo.getState().commit(plan.patch, plan.message);
    onOpenChange(false);
  };
  const info = KINDS.find((k) => k.id === kind)!;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]" style={{ maxHeight: "90vh", overflowY: "auto" }}>
        <DialogHeader>
          <DialogTitle>Bulk edit</DialogTitle>
          <DialogDescription>Change many legs in one step. You see what changes and what new issues it causes before anything is saved. Undo is one click afterwards.</DialogDescription>
        </DialogHeader>

        <div className="fgrid">
          <div className="fld">
            <label htmlFor="bk-kind">What to change</label>
            <select id="bk-kind" className="sel" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              {KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
            <span style={{ fontSize: 12, opacity: 0.75 }}>{info.hint}</span>
          </div>
          <div className="fld">
            <label htmlFor="bk-scope">Which legs</label>
            <select id="bk-scope" className="sel" value={effectiveScope} onChange={(e) => setScope(e.target.value as Scope)}>
              <option value="shown">Shown on screen ({shown.length})</option>
              <option value="selected" disabled={selected.length === 0}>
                Selected in the table ({selected.length})
              </option>
            </select>
          </div>
        </div>

        {kind === "shift" && (
          <div className="fgrid">
            <div className="fld">
              <label htmlFor="bk-dir">Direction</label>
              <select id="bk-dir" className="sel" value={dir} onChange={(e) => setDir(Number(e.target.value) as 1 | -1)}>
                <option value={1}>Later</option>
                <option value={-1}>Earlier</option>
              </select>
            </div>
            <div className="fld">
              <label htmlFor="bk-days">Days</label>
              <input id="bk-days" className="inp mono" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
            </div>
            <div className="fld">
              <label htmlFor="bk-time">Hours and minutes</label>
              <input id="bk-time" className="inp mono" value={time} onChange={(e) => setTime(e.target.value)} placeholder="01:00" />
            </div>
          </div>
        )}
        {kind === "block" && (
          <div className="fgrid">
            <div className="fld">
              <label htmlFor="bk-bm">Block time</label>
              <select id="bk-bm" className="sel" value={blockMode} onChange={(e) => setBlockMode(e.target.value as "set" | "add" | "sub")}>
                <option value="set">Set to</option>
                <option value="add">Make longer by</option>
                <option value="sub">Make shorter by</option>
              </select>
            </div>
            <div className="fld">
              <label htmlFor="bk-bt">Hours and minutes</label>
              <input id="bk-bt" className="inp mono" value={time} onChange={(e) => setTime(e.target.value)} placeholder="03:30" />
            </div>
          </div>
        )}
        {kind === "flight" && (
          <div className="fld">
            <label htmlFor="bk-fl">New flight number</label>
            <input id="bk-fl" className="inp mono" value={flight} onChange={(e) => setFlight(e.target.value)} placeholder="PHC509D" />
          </div>
        )}
        {(kind === "aircraft" || kind === "swap") && (
          <div className="fgrid">
            <div className="fld">
              <label htmlFor="bk-ac">{kind === "swap" ? "Aircraft A" : "Aircraft"}</label>
              <select id="bk-ac" className="sel" value={first} onChange={(e) => setAircraft(e.target.value)}>
                {data.aircraft.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.registration} {a.type}
                  </option>
                ))}
              </select>
            </div>
            {kind === "swap" && (
              <div className="fld">
                <label htmlFor="bk-ac2">Aircraft B</label>
                <select id="bk-ac2" className="sel" value={swapB || data.aircraft.find((a) => a.id !== first)?.id || ""} onChange={(e) => setSwapB(e.target.value)}>
                  {data.aircraft
                    .filter((a) => a.id !== first)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.registration} {a.type}
                      </option>
                    ))}
                </select>
              </div>
            )}
          </div>
        )}
        {kind === "route" && (
          <div className="fgrid">
            <div className="fld">
              <label htmlFor="bk-dep">New departure (leave empty to keep)</label>
              <input id="bk-dep" className="inp mono" value={dep} onChange={(e) => setDep(e.target.value)} placeholder="UGTB/TBS" />
            </div>
            <div className="fld">
              <label htmlFor="bk-arr">New arrival (leave empty to keep)</label>
              <input id="bk-arr" className="inp mono" value={arr} onChange={(e) => setArr(e.target.value)} placeholder="LYBE/BEG" />
            </div>
          </div>
        )}
        {kind === "status" && (
          <div className="fld">
            <label htmlFor="bk-st">Set status</label>
            <select id="bk-st" className="sel" value={status} onChange={(e) => setStatus(e.target.value as Leg["status"])}>
              <option value="cancelled">Cancelled (CNL)</option>
              <option value="planned">Planned (restore)</option>
            </select>
          </div>
        )}
        {kind === "notes" && (
          <div className="fgrid">
            <div className="fld">
              <label htmlFor="bk-nm">Note</label>
              <select id="bk-nm" className="sel" value={noteMode} onChange={(e) => setNoteMode(e.target.value as "set" | "append")}>
                <option value="append">Add text to the note</option>
                <option value="set">Replace the note</option>
              </select>
            </div>
            <div className="fld">
              <label htmlFor="bk-nt">Text</label>
              <input id="bk-nt" className="inp" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
        )}

        {error && (
          <div className="info" role="alert">
            {error}
          </div>
        )}
        {"warning" in plan && plan.warning && (
          <div className="info" role="status">
            {plan.warning} Leon only allows swaps between aircraft of the same type.
          </div>
        )}

        <div className="card cardb" aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <b>
            {plan.changes.length} of {legs.length} legs would change
            {plan.skipped.length > 0 && `, ${plan.skipped.length} cannot`}
          </b>
          {plan.changes.slice(0, 6).map((c) => (
            <div key={c.legId} className="mono" style={{ fontSize: 12 }}>
              {c.label}: {c.before} to {c.after}
            </div>
          ))}
          {plan.changes.length > 6 && <div style={{ fontSize: 12, opacity: 0.7 }}>and {plan.changes.length - 6} more</div>}
          {plan.skipped.slice(0, 3).map((s) => (
            <div key={s.legId} style={{ fontSize: 12, color: "var(--err, #b3261e)" }}>
              {s.label} skipped: {s.reason}
            </div>
          ))}
          {plan.changes.length > 0 && (
            <div style={{ fontSize: 13 }}>
              {plan.newIssues.length === 0 ? "No new issues." : <b>{plan.newIssues.length} new {plan.newIssues.length === 1 ? "issue" : "issues"}:</b>}
              {plan.clearedIssues > 0 && ` ${plan.clearedIssues} existing ${plan.clearedIssues === 1 ? "issue is" : "issues are"} cleared.`}
              {plan.newIssues.slice(0, 4).map((m) => (
                <div key={m} style={{ fontSize: 12 }}>
                  {m}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button className="btn pri" disabled={plan.patch.length === 0} onClick={apply}>
            Apply to {plan.changes.length} {plan.changes.length === 1 ? "leg" : "legs"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
