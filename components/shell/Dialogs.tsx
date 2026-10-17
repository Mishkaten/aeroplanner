"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDemo, type ResetKind } from "@/lib/store";
import { useUi } from "@/lib/ui-store";
import { SHORTCUTS } from "./shortcuts";

export function ResetDialog() {
  const open = useUi((s) => s.resetOpen);
  const router = useRouter();

  const choose = (kind: ResetKind) => {
    const t0 = performance.now();
    useDemo.getState().reset(kind);
    const ui = useUi.getState();
    ui.clearFilters();
    ui.setListState("normal");
    ui.closeDrawer();
    ui.setResetOpen(false);
    const msg = kind === "full" ? "Demo reset to the full demo: 88 active legs, 9 open issues." : "Demo reset to an empty schedule. Fleet, airports and company are kept.";
    ui.say(msg);
    toast.success(msg);
    router.push("/");
    void t0;
  };

  return (
    <Dialog open={open} onOpenChange={(o) => useUi.getState().setResetOpen(o)}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Reset demo data</DialogTitle>
          <DialogDescription>
            Choose the state to return to. Filters, ticks, import state and the dismissed banner are cleared, and the demo clock is restored to Sun 13 Sep, 14:00Z.
          </DialogDescription>
        </DialogHeader>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button className="btn pri" style={{ height: 40, justifyContent: "flex-start" }} onClick={() => choose("full")}>
            Full demo
            <span style={{ fontWeight: 400, opacity: 0.85 }}>90 legs, 4 aircraft, 9 open issues</span>
          </button>
          <button className="btn" style={{ height: 40, justifyContent: "flex-start" }} onClick={() => choose("empty")}>
            Empty schedule
            <span className="hint">keeps company, fleet, airports and maintenance blocks</span>
          </button>
          <button className="btn" onClick={() => useUi.getState().setResetOpen(false)}>
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function HelpDialog() {
  const open = useUi((s) => s.helpOpen);
  return (
    <Dialog open={open} onOpenChange={(o) => useUi.getState().setHelp(o)}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Shortcuts are off while you type in a field. Esc closes dialogs and drawers.</DialogDescription>
        </DialogHeader>
        <div style={{ display: "grid", gridTemplateColumns: "130px 1fr", gap: "8px 12px", alignItems: "center" }}>
          {SHORTCUTS.map((s) => (
            <div key={s.keys} style={{ display: "contents" }}>
              <span>
                {s.keys.split(" ").map((k, i) => (
                  <span key={i} className="kbd" style={{ marginRight: 4 }}>
                    {k}
                  </span>
                ))}
              </span>
              <span>{s.text}</span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
