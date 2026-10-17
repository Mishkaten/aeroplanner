"use client";

import { useDemo } from "@/lib/store";
import { useUi } from "@/lib/ui-store";
import type { Fix, ValidationIssue } from "@/lib/types";

export function SeverityBadge({ severity, urgent }: { severity: ValidationIssue["severity"]; urgent?: boolean }) {
  if (urgent) return <span className="b b-ur">Urgent</span>;
  return severity === "error" ? <span className="b b-er">Error</span> : <span className="b b-wa">Warning</span>;
}

/** Applies a one-click fix as one atomic, undoable patch. Secondary fixes open the leg drawer pre-filled. */
export function applyFix(fix: Fix) {
  if (!fix.enabled) return;
  if (fix.secondary && fix.draft) {
    useUi.getState().openNew(fix.draft);
    return;
  }
  useDemo.getState().commit(fix.patch, fix.result);
  useUi.getState().say(fix.result);
}

export function FixButtons({ fixes }: { fixes: Fix[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
      {fixes.map((f) => (
        <div key={f.id} style={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 320 }}>
          <button className="btn sm fix" disabled={!f.enabled} aria-describedby={f.disabledReason ? `${f.id}-why` : undefined} title={f.disabledReason ?? undefined} onClick={() => applyFix(f)}>
            {f.label}
          </button>
          {f.disabledReason && (
            <span id={`${f.id}-why`} className="hint">
              {f.disabledReason}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
