"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fullFlight } from "@/lib/legs";
import { MAX_VERSIONS, activeVersion, diffLegs, liveVersion, switchVersion, versionContent } from "@/lib/versions";
import { useDemo } from "@/lib/store";
import { validateAll } from "@/lib/validate";
import { effectiveClock } from "@/lib/clock";
import type { DomainState, Leg, ScheduleVersion } from "@/lib/types";

const fmtWhen = (iso: string) => (iso ? iso.slice(0, 10) : "");

function counts(state: DomainState, id: string) {
  const view = switchVersion(state, id);
  const { issues } = validateAll(view, effectiveClock(view));
  return {
    legs: view.legs.length,
    active: view.legs.filter((l) => l.status !== "cancelled").length,
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
  };
}

type Dlg = { kind: "new" } | { kind: "rename"; v: ScheduleVersion } | { kind: "delete"; v: ScheduleVersion } | { kind: "compare"; v: ScheduleVersion } | { kind: "publish"; v: ScheduleVersion } | null;

export function VersionsPage() {
  const router = useRouter();
  const data = useDemo((s) => s.data);
  const [dlg, setDlg] = useState<Dlg>(null);
  const live = liveVersion(data);
  const active = activeVersion(data);
  const stats = useMemo(() => new Map(data.versions.map((v) => [v.id, counts(data, v.id)])), [data]);

  return (
    <>
      <div className="head">
        <div>
          <h1>Versions</h1>
          <p>
            A version is a full copy of the schedule: a season, a client request, or a what-if. Every screen and export shows the version you are editing, and a banner tells you when it is a draft. The live version is the current
            plan. Change a draft safely, compare it with the live schedule, then publish it.
          </p>
        </div>
        <span className="grow" />
        <button className="btn pri" onClick={() => setDlg({ kind: "new" })} disabled={data.versions.length >= MAX_VERSIONS}>
          + New version
        </button>
      </div>

      <section className="card scroll" aria-label="Versions">
        <table className="tbl">
          <thead>
            <tr>
              {["Version", "Legs", "Open issues", "Created", ""].map((h, i) => (
                <th key={i} scope="col">
                  {h || <span className="sr-only">Actions</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.versions.map((v) => {
              const st = stats.get(v.id)!;
              return (
                <tr key={v.id}>
                  <th scope="row" style={{ textTransform: "none", letterSpacing: 0, fontSize: 14, color: "var(--ink)", background: "none" }}>
                    {v.name} {v.live && <span className="b b-ok">Live</span>} {v.id === active.id && <span className="b b-in">Editing now</span>}
                    {v.note && (
                      <>
                        <br />
                        <small className="hint">{v.note}</small>
                      </>
                    )}
                  </th>
                  <td className="mono">
                    {st.active}
                    {st.legs !== st.active && <small className="hint"> +{st.legs - st.active} CNL</small>}
                  </td>
                  <td>
                    {st.errors + st.warnings === 0 ? (
                      <span className="b b-ok">None</span>
                    ) : (
                      <>
                        {st.errors > 0 && <span className="b b-er">{st.errors} errors</span>} {st.warnings > 0 && <span className="b b-wa">{st.warnings} warnings</span>}
                      </>
                    )}
                  </td>
                  <td className="mono">{fmtWhen(v.createdAt)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {v.id !== active.id && (
                      <button
                        className="btn sm"
                        onClick={() => {
                          useDemo.getState().switchVersion(v.id);
                          router.push("/schedule/");
                        }}
                      >
                        Open
                      </button>
                    )}{" "}
                    {!v.live && (
                      <>
                        <button className="btn sm" onClick={() => setDlg({ kind: "compare", v })}>
                          Compare with live
                        </button>{" "}
                        <button className="btn sm pri" onClick={() => setDlg({ kind: "publish", v })}>
                          Publish
                        </button>{" "}
                      </>
                    )}
                    <button className="btn sm" onClick={() => setDlg({ kind: "rename", v })} aria-label={`Rename ${v.name}`}>
                      Rename
                    </button>{" "}
                    <button className="btn sm" disabled={v.live} title={v.live ? "The live version cannot be deleted. Publish another version first." : undefined} onClick={() => setDlg({ kind: "delete", v })} aria-label={`Delete ${v.name}`}>
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <p className="hint">
        Fleet, airports, permit rules, maintenance blocks and the company profile are shared by all versions. Legs and permits belong to one version. Conflicts are checked inside each version on its own. Currently live: {live.name}.
      </p>

      {dlg?.kind === "new" && <NewDialog onClose={() => setDlg(null)} />}
      {dlg?.kind === "rename" && <RenameDialog v={dlg.v} onClose={() => setDlg(null)} />}
      {dlg?.kind === "delete" && (
        <ConfirmDialog
          title={`Delete "${dlg.v.name}"?`}
          text={`${stats.get(dlg.v.id)?.legs ?? 0} legs and their permit rows in this version are removed. The live schedule is not touched. This cannot be undone.`}
          action="Delete version"
          danger
          onClose={() => setDlg(null)}
          onConfirm={() => useDemo.getState().deleteVersion(dlg.v.id)}
        />
      )}
      {dlg?.kind === "publish" && (
        <ConfirmDialog
          title={`Publish "${dlg.v.name}"?`}
          text={`It becomes the live schedule. "${live.name}" is kept as a draft, so you can go back. Overview, permits and exports will show the new live schedule when you open it.`}
          action="Publish"
          onClose={() => setDlg(null)}
          onConfirm={() => useDemo.getState().publishVersion(dlg.v.id)}
        />
      )}
      {dlg?.kind === "compare" && <CompareDialog v={dlg.v} onClose={() => setDlg(null)} />}
    </>
  );
}

function NewDialog({ onClose }: { onClose: () => void }) {
  const data = useDemo((s) => s.data);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [from, setFrom] = useState<"copy" | "blank">("copy");
  const [error, setError] = useState<string | null>(null);
  const create = () => {
    const err = useDemo.getState().createVersion(name, note, from);
    if (err) setError(err);
    else onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>New version</DialogTitle>
          <DialogDescription>The new version opens for editing. Nothing changes in the live schedule.</DialogDescription>
        </DialogHeader>
        <div className="fld">
          <label htmlFor="nv-name">Name</label>
          <input id="nv-name" className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder="Winter 2026/27" aria-invalid={!!error} autoFocus />
          <span className="err-t">{error}</span>
        </div>
        <div className="fld">
          <label htmlFor="nv-note">Note (optional)</label>
          <input id="nv-note" className="inp" value={note} onChange={(e) => setNote(e.target.value)} placeholder="For client X, draft 2" />
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          <legend className="lbl">Start from</legend>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="radio" name="nv-from" checked={from === "copy"} onChange={() => setFrom("copy")} />A copy of &quot;{activeVersion(data).name}&quot; ({data.legs.length} legs)
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="radio" name="nv-from" checked={from === "blank"} onChange={() => setFrom("blank")} />
            An empty schedule
          </label>
        </fieldset>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn pri" onClick={create}>
            Create and open
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RenameDialog({ v, onClose }: { v: ScheduleVersion; onClose: () => void }) {
  const [name, setName] = useState(v.name);
  const [note, setNote] = useState(v.note);
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const err = useDemo.getState().renameVersion(v.id, name, note);
    if (err) setError(err);
    else onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Rename version</DialogTitle>
          <DialogDescription>Only the name and note change.</DialogDescription>
        </DialogHeader>
        <div className="fld">
          <label htmlFor="rv-name">Name</label>
          <input id="rv-name" className="inp" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!error} />
          <span className="err-t">{error}</span>
        </div>
        <div className="fld">
          <label htmlFor="rv-note">Note</label>
          <input id="rv-note" className="inp" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn pri" onClick={save}>
            Save
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmDialog({ title, text, action, danger, onClose, onConfirm }: { title: string; text: string; action: string; danger?: boolean; onClose: () => void; onConfirm: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{text}</DialogDescription>
        </DialogHeader>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`btn ${danger ? "dng" : "pri"}`}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {action}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const line = (l: Leg) => `${fullFlight(l)} ${l.depIcao}-${l.arrIcao} ${l.etdUtc.slice(5, 10)} ${l.etdUtc.slice(11, 16)}Z ${l.aircraftId}`;
const FIELD_NAMES: Record<string, string> = { flightNumber: "flight", suffix: "suffix", aircraftId: "aircraft", depIcao: "from", arrIcao: "to", etdUtc: "ETD", etaUtc: "ETA", status: "status", legType: "type", notes: "note" };

function CompareDialog({ v, onClose }: { v: ScheduleVersion; onClose: () => void }) {
  const data = useDemo((s) => s.data);
  const live = liveVersion(data);
  const diff = useMemo(() => diffLegs(versionContent(data, live.id).legs, versionContent(data, v.id).legs), [data, live.id, v.id]);
  const section = (title: string, rows: string[]) => (
    <div>
      <b>
        {title} ({rows.length})
      </b>
      {rows.slice(0, 25).map((r, i) => (
        <div key={i} className="mono" style={{ fontSize: 12 }}>
          {r}
        </div>
      ))}
      {rows.length > 25 && <div style={{ fontSize: 12, opacity: 0.7 }}>and {rows.length - 25} more</div>}
    </div>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[640px]" style={{ maxHeight: "88vh", overflowY: "auto" }}>
        <DialogHeader>
          <DialogTitle>
            &quot;{v.name}&quot; compared with &quot;{live.name}&quot;
          </DialogTitle>
          <DialogDescription>
            {diff.same} legs are identical. Legs are matched by flight, day, departure station and aircraft, so a leg moved to another aircraft shows as removed and added.
          </DialogDescription>
        </DialogHeader>
        {diff.added.length + diff.removed.length + diff.changed.length === 0 ? (
          <div className="info">No differences. The two versions have the same legs.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {section("Only in this version", diff.added.map(line))}
            {section("Only in the live schedule", diff.removed.map(line))}
            {section(
              "Changed",
              diff.changed.map((c) => `${line(c.before)}: ${c.fields.map((f) => `${FIELD_NAMES[f] ?? f} ${String(c.before[f as keyof Leg] ?? "")} to ${String(c.after[f as keyof Leg] ?? "")}`).join(", ")}`),
            )}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
