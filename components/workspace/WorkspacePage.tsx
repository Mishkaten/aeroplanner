"use client";

import { canonicalState } from "@/lib/versions";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDemo } from "@/lib/store";
import { blankWorkspaceState } from "@/lib/seed";
import { normalizeData, useWorkspace, type Snapshot } from "@/lib/workspace";
import { FEEDBACK_EMAIL } from "@/lib/mode";
import { realNow } from "@/lib/clock";

type Confirm = { title: string; text: string; run: () => Promise<void> } | null;

/** Backups, download and upload of the whole workspace, and clearing it. */
export function WorkspacePage() {
  const data = useDemo((s) => s.data);
  const email = useWorkspace((s) => s.email);
  const [snaps, setSnaps] = useState<Snapshot[] | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => useWorkspace.getState().listSnapshots().then(setSnaps).catch((e) => toast.error(String(e?.message ?? e)));
  useEffect(() => {
    void load();
  }, []);

  const run = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      await confirm.run();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
    setBusy(false);
    setConfirm(null);
  };

  const download = () => {
    const blob = new Blob([JSON.stringify(canonicalState(data), null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `aeroplanner-workspace-${realNow().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.legs)) throw new Error("This file is not an AeroPlanner workspace.");
      const d = normalizeData(parsed);
      setConfirm({ title: "Replace the workspace with this file?", text: `${d.legs.length} legs, ${d.aircraft.length} aircraft. The current workspace is backed up first.`, run: () => useWorkspace.getState().replaceAll(d, "Workspace replaced from file") });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read the file");
    }
  };

  const counts = { legs: data.legs.length, aircraft: data.aircraft.length, airports: data.airports.length, rules: data.permitRules.length, permits: data.permits.length, blocks: data.blocks.length };

  return (
    <>
      <div className="head">
        <div>
          <h1>Workspace</h1>
          <p>Shared by everyone with the login. Signed in as {email}. Changes save to the server by themselves, and the last save wins.</p>
        </div>
      </div>

      <section className="kpis" aria-label="What is in the workspace">
        {Object.entries(counts).map(([k, v]) => (
          <div key={k} className="kpi">
            <small style={{ textTransform: "capitalize" }}>{k}</small>
            <b className="mono">{v}</b>
          </div>
        ))}
      </section>

      <section className="card cardb" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h3 style={{ margin: 0 }}>Your data</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn" onClick={download}>
            Download workspace (.json)
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden aria-label="Workspace file" onChange={(e) => void upload(e.target.files?.[0])} />
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Replace from a file
          </button>
          <button
            className="btn"
            onClick={() => setConfirm({ title: "Clear all data?", text: "Removes every leg, aircraft, permit, rule and period and starts an empty workspace for everyone. A backup is kept.", run: () => useWorkspace.getState().replaceAll(blankWorkspaceState(), "Workspace cleared") })}
          >
            Clear all data
          </button>
        </div>
        <span className="hint">Everyone signs in with the same login, so nobody is identified. If something is deleted by mistake, restore a backup below.</span>
      </section>

      <section className="card" aria-labelledby="bk-h">
        <div className="cardh">
          <h3 id="bk-h">Backups</h3>
          <span className="hint">The previous version is kept about every 10 minutes of editing, latest 60.</span>
          <span className="grow" />
          <button className="btn sm" onClick={() => void load()}>
            Refresh
          </button>
        </div>
        {snaps === null ? (
          <div className="cardb hint">Loading...</div>
        ) : snaps.length === 0 ? (
          <div className="empty">
            <b>No backups yet</b>
            <span>The first one appears after you have edited for a while.</span>
          </div>
        ) : (
          <div className="scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Saved (UTC)</th>
                  <th scope="col">By</th>
                  <th scope="col">
                    <span className="sr-only">Restore</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {snaps.map((s) => (
                  <tr key={s.id}>
                    <td className="mono">{new Date(s.saved_at).toISOString().replace("T", " ").slice(0, 16)}Z</td>
                    <td>{s.saved_by ?? "-"}</td>
                    <td>
                      <button
                        className="btn sm"
                        onClick={() => setConfirm({ title: "Restore this backup?", text: `Replaces the workspace with the version saved ${s.saved_at.slice(0, 16).replace("T", " ")}Z. The current one is backed up first.`, run: () => useWorkspace.getState().restoreSnapshot(s.id) })}
                      >
                        Restore
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="hint">
        Questions or problems? <a href={`mailto:${FEEDBACK_EMAIL}?subject=AeroPlanner%20feedback`}>{FEEDBACK_EMAIL}</a>
      </p>

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>{confirm?.title}</DialogTitle>
            <DialogDescription>{confirm?.text}</DialogDescription>
          </DialogHeader>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button className="btn dng" disabled={busy} onClick={() => void run()}>
              {busy ? "Working..." : "Yes, do it"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
