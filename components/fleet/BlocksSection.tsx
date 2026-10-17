"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDemo } from "@/lib/store";
import { blockKindLabel } from "@/lib/validate";
import { dateMs, fmtDowTime, iso, MIN, parseHHMM, utcDate } from "@/lib/time";
import type { MaintenanceBlock, MaintenanceKind } from "@/lib/types";

interface Form {
  aircraftId: string;
  kind: MaintenanceKind;
  startDate: string;
  startTime: string;
  openEnded: boolean;
  endDate: string;
  endTime: string;
  note: string;
}

const KIND_LABEL: Record<MaintenanceKind, string> = { aog: "AOG", maintenance: "Maintenance", c_check: "C-Check" };

function toForm(b: MaintenanceBlock | null, firstAircraft: string): Form {
  if (!b) return { aircraftId: firstAircraft, kind: "maintenance", startDate: "", startTime: "00:00", openEnded: false, endDate: "", endTime: "23:59", note: "" };
  return {
    aircraftId: b.aircraftId,
    kind: b.kind,
    startDate: utcDate(b.startUtc),
    startTime: b.startUtc.slice(11, 16),
    openEnded: b.endUtc === null,
    endDate: b.endUtc ? utcDate(b.endUtc) : "",
    endTime: b.endUtc ? b.endUtc.slice(11, 16) : "23:59",
    note: b.note,
  };
}

/** Times when an aircraft cannot fly. Legs inside them raise rule R3 in the Conflicts centre. */
export function BlocksSection() {
  const data = useDemo((s) => s.data);
  const [edit, setEdit] = useState<MaintenanceBlock | "new" | null>(null);
  const reg = (id: string) => data.aircraft.find((a) => a.id === id)?.registration ?? id;
  const rows = [...data.blocks].sort((a, b) => (a.startUtc < b.startUtc ? -1 : 1));

  return (
    <section className="card" aria-labelledby="blk-h">
      <div className="cardh">
        <h3 id="blk-h">Unavailable periods: AOG, maintenance, C-Check</h3>
        <span className="grow" />
        <button className="btn sm pri" disabled={data.aircraft.length === 0} onClick={() => setEdit("new")}>
          + Add period
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="empty">
          <b>No unavailable periods</b>
          <span>Add an AOG or maintenance window and legs inside it are flagged.</span>
        </div>
      ) : (
        <div className="scroll">
          <table className="tbl">
            <thead>
              <tr>
                {["Aircraft", "Kind", "From (UTC)", "Until (UTC)", "Note"].map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td className="mono">{reg(b.aircraftId)}</td>
                  <td>
                    <span className={`b ${b.kind === "aog" ? "b-ur" : "b-wa"}`}>{blockKindLabel(b.kind).replace("in ", "")}</span>
                  </td>
                  <td className="mono">{fmtDowTime(b.startUtc)}</td>
                  <td className="mono">{b.endUtc ? fmtDowTime(b.endUtc) : "Open-ended"}</td>
                  <td>{b.note}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn sm" aria-label={`Edit period for ${reg(b.aircraftId)}`} onClick={() => setEdit(b)}>
                      Edit
                    </button>{" "}
                    <button className="btn sm" aria-label={`Delete period for ${reg(b.aircraftId)}`} onClick={() => useDemo.getState().commit([{ op: "remove", coll: "blocks", id: b.id }], "Unavailable period deleted")}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <BlockDialog key={edit === "new" ? "new" : edit.id} block={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </section>
  );
}

function BlockDialog({ block, onClose }: { block: MaintenanceBlock | null; onClose: () => void }) {
  const aircraft = useDemo((s) => s.data.aircraft);
  const [form, setForm] = useState<Form>(() => toForm(block, aircraft[0]?.id ?? ""));
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));

  const save = () => {
    const sm = parseHHMM(form.startTime);
    const em = parseHHMM(form.endTime);
    if (!form.startDate || sm === null) return setError("Enter the start date and time (HH:MM)");
    const start = dateMs(form.startDate) + sm * MIN;
    let end: number | null = null;
    if (!form.openEnded) {
      if (!form.endDate || em === null) return setError("Enter the end date and time, or tick Open-ended");
      end = dateMs(form.endDate) + em * MIN;
      if (end <= start) return setError("The end must be after the start");
    }
    const value: MaintenanceBlock = {
      id: block?.id ?? `B-${form.aircraftId}-${form.kind}-${iso(start).replace(/[-:TZ]/g, "")}`,
      aircraftId: form.aircraftId,
      kind: form.kind,
      startUtc: iso(start),
      endUtc: end === null ? null : iso(end),
      note: form.note.trim(),
    };
    useDemo.getState().commit(
      block ? [{ op: "set", coll: "blocks", id: block.id, value: { ...value } }] : [{ op: "insert", coll: "blocks", value: value as never }],
      "Unavailable period saved",
    );
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{block ? "Edit unavailable period" : "Add unavailable period"}</DialogTitle>
          <DialogDescription>All times are UTC. For AOG with no known end, tick Open-ended. For a C-Check of several days or weeks, set the last day it is in the hangar.</DialogDescription>
        </DialogHeader>
        <div className="fgrid">
          <div className="fld">
            <label htmlFor="b-ac">Aircraft</label>
            <select id="b-ac" className="sel" value={form.aircraftId} onChange={(e) => set({ aircraftId: e.target.value })}>
              {aircraft.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.registration}
                </option>
              ))}
            </select>
          </div>
          <div className="fld">
            <label htmlFor="b-kind">Kind</label>
            <select id="b-kind" className="sel" value={form.kind} onChange={(e) => set({ kind: e.target.value as MaintenanceKind })}>
              {(Object.keys(KIND_LABEL) as MaintenanceKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="fld">
            <label htmlFor="b-sd">Start date</label>
            <input id="b-sd" type="date" className="inp mono" value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} />
          </div>
          <div className="fld">
            <label htmlFor="b-st">Start time (HH:MM)</label>
            <input id="b-st" className="inp mono" value={form.startTime} placeholder="00:00" onChange={(e) => set({ startTime: e.target.value })} />
          </div>
          <div className="fld" style={{ gridColumn: "1 / -1" }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center", textTransform: "none", letterSpacing: 0, fontSize: 14 }}>
              <input type="checkbox" checked={form.openEnded} onChange={(e) => set({ openEnded: e.target.checked })} /> Open-ended (no end date yet)
            </label>
          </div>
          {!form.openEnded && (
            <>
              <div className="fld">
                <label htmlFor="b-ed">End date</label>
                <input id="b-ed" type="date" className="inp mono" value={form.endDate} onChange={(e) => set({ endDate: e.target.value })} />
              </div>
              <div className="fld">
                <label htmlFor="b-et">End time (HH:MM)</label>
                <input id="b-et" className="inp mono" value={form.endTime} placeholder="23:59" onChange={(e) => set({ endTime: e.target.value })} />
              </div>
            </>
          )}
          <div className="fld" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="b-note">Note</label>
            <input id="b-note" className="inp" value={form.note} onChange={(e) => set({ note: e.target.value })} />
          </div>
        </div>
        {error && (
          <div className="err-t" role="alert">
            {error}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn pri" onClick={save}>
            Save period
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
