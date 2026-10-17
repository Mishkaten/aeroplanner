"use client";

import { useUi } from "@/lib/ui-store";

/** Loading, error and empty states for every list (PRD 6.11). They appear only through the presenter switcher. */
export function ListGate({ children, emptyText }: { children: React.ReactNode; emptyText?: string }) {
  const state = useUi((s) => s.listState);
  const set = useUi((s) => s.setListState);

  if (state === "loading")
    return (
      <div className="card cardb" style={{ display: "flex", flexDirection: "column", gap: 14 }} aria-busy="true" aria-label="Loading">
        <div className="skel" style={{ width: 220, height: 20 }} />
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skel" style={{ height: 34 }} />
        ))}
      </div>
    );
  if (state === "error")
    return (
      <div className="card empty" role="alert">
        <span className="b b-er">Error</span>
        <b>Could not load this list</b>
        <span>The planning service did not respond (demo error, code 503). Your edits are safe.</span>
        <button className="btn pri" onClick={() => set("normal")}>
          Try again
        </button>
      </div>
    );
  if (state === "empty")
    return (
      <div className="card empty">
        <b>Nothing here yet</b>
        <span>{emptyText ?? "No records match this view. Add a leg, import your Excel sheet, or change the filters."}</span>
        <button className="btn pri" onClick={() => set("normal")}>
          Back to normal data
        </button>
      </div>
    );
  return <>{children}</>;
}
