"use client";

import { RefreshCw } from "lucide-react";
import { useWorkspace } from "@/lib/workspace";

/** Save state of the shared workspace, always visible in the top bar. */
export function SyncStatus() {
  const save = useWorkspace((s) => s.save);
  const savedAt = useWorkspace((s) => s.savedAt);
  const error = useWorkspace((s) => s.error);
  const label =
    save === "saving" ? "Saving..." : save === "dirty" ? "Unsaved changes" : save === "error" ? "Not saved" : savedAt ? `Saved ${new Date(savedAt).toISOString().slice(11, 16)}Z` : "Saved";
  const cls = save === "error" ? "b b-er" : save === "dirty" || save === "saving" ? "b b-wa" : "b b-ok";
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <span className={cls} role="status" aria-live="polite" title={error ?? undefined}>
        {label}
      </span>
      {save === "error" && (
        <button className="btn sm" onClick={() => void useWorkspace.getState().saveNow()}>
          Retry
        </button>
      )}
      <button className="btn sm" style={{ padding: "0 6px" }} aria-label="Reload the workspace from the server" title="Reload the workspace from the server" onClick={() => void useWorkspace.getState().reload()}>
        <RefreshCw size={14} aria-hidden="true" />
      </button>
    </span>
  );
}
