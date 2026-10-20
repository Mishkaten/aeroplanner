"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { realNow } from "@/lib/clock";
import { buildScheduleExport, EXPORT_FORMATS, ExportBlocked, type ExportFormatId } from "@/lib/export";
import { downloadBlob } from "@/lib/checklist/export";
import { useDemo } from "@/lib/store";
import { useUi } from "@/lib/ui-store";
import type { Leg } from "@/lib/types";

type Scope = "shown" | "selected" | "all";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Legs on screen after the date range and filters. */
  shown: Leg[];
  /** Legs ticked in the table. */
  selected: Leg[];
}

export function ExportDialog({ open, onOpenChange, shown, selected }: Props) {
  const data = useDemo((s) => s.data);
  const [format, setFormat] = useState<ExportFormatId>("xlsx-grid");
  const [scope, setScope] = useState<Scope>("shown");
  const [cancelled, setCancelled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; fix: boolean } | null>(null);
  const [notes, setNotes] = useState<string[]>([]);

  const legsFor = (s: Scope): Leg[] => (s === "selected" ? selected : s === "all" ? data.legs : shown);
  const effectiveScope: Scope = scope === "selected" && selected.length === 0 ? "shown" : scope;
  const count = useMemo(() => {
    const legs = legsFor(effectiveScope);
    return cancelled ? legs.length : legs.filter((l) => l.status !== "cancelled").length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveScope, cancelled, shown, selected, data.legs]);
  const info = EXPORT_FORMATS.find((f) => f.id === format)!;
  const needsCode = format === "ssim" && !/^[A-Za-z0-9]{2}$/.test(data.company.iata.trim());

  const run = async () => {
    setBusy(true);
    setError(null);
    setNotes([]);
    try {
      const out = await buildScheduleExport(data, { format, legs: legsFor(effectiveScope), includeCancelled: cancelled, createdAt: realNow() });
      downloadBlob(out.blob, out.filename);
      toast.success(`${out.filename} downloaded (${out.legCount} legs)`);
      useUi.getState().say(`${info.label} file ${out.filename} downloaded`);
      if (out.notes.length) setNotes(out.notes);
      else onOpenChange(false);
    } catch (e) {
      if (e instanceof ExportBlocked) setError({ text: e.message, fix: true });
      else {
        console.warn("Export failed", e);
        setError({ text: "The file could not be built. Your schedule is unchanged. Try again or pick another format.", fix: false });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Export schedule</DialogTitle>
          <DialogDescription>Times are UTC unless a column says local. Cancelled legs stay out unless you tick the box.</DialogDescription>
        </DialogHeader>

        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          <legend className="lbl" style={{ marginBottom: 6 }}>
            Format
          </legend>
          {EXPORT_FORMATS.map((f) => (
            <label key={f.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
              <input type="radio" name="export-format" checked={format === f.id} onChange={() => setFormat(f.id)} style={{ marginTop: 3 }} />
              <span>
                <b>{f.label}</b> <span className="mono" style={{ opacity: 0.6 }}>.{f.ext}</span>
                <br />
                <span style={{ fontSize: 12, opacity: 0.75 }}>{f.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset style={{ border: 0, padding: 0, margin: "10px 0 0", display: "flex", flexDirection: "column", gap: 6 }}>
          <legend className="lbl" style={{ marginBottom: 6 }}>
            Which legs
          </legend>
          {(
            [
              ["shown", `Shown on screen (${shown.length})`],
              ["selected", `Selected in the table (${selected.length})`],
              ["all", `Every leg in the workspace (${data.legs.length})`],
            ] as [Scope, string][]
          ).map(([id, label]) => (
            <label key={id} style={{ display: "flex", gap: 10, alignItems: "center", opacity: id === "selected" && selected.length === 0 ? 0.5 : 1 }}>
              <input type="radio" name="export-scope" disabled={id === "selected" && selected.length === 0} checked={effectiveScope === id} onChange={() => setScope(id)} />
              {label}
            </label>
          ))}
          <label style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4 }}>
            <input type="checkbox" checked={cancelled} onChange={(e) => setCancelled(e.target.checked)} />
            Include cancelled legs
          </label>
        </fieldset>

        {needsCode && (
          <div className="info" role="status">
            SSIM needs your two-character IATA airline designator. <Link href="/company/">Enter it on the Company page</Link> first.
          </div>
        )}
        {error && (
          <div className="info" role="alert">
            {error.text} {error.fix && <Link href="/company/">Open Company</Link>}
          </div>
        )}
        {notes.length > 0 && (
          <div className="info" role="status">
            <div>
              <b>Downloaded. Some legs are not in the file:</b>
              <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                {notes.slice(0, 6).map((n) => (
                  <li key={n}>{n}</li>
                ))}
                {notes.length > 6 && <li>and {notes.length - 6} more</li>}
              </ul>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
          <span style={{ fontSize: 12, opacity: 0.75, marginRight: "auto" }}>{count} legs will be exported</span>
          <button className="btn" onClick={() => onOpenChange(false)}>
            {notes.length ? "Close" : "Cancel"}
          </button>
          <button className="btn pri" onClick={run} disabled={busy || count === 0 || needsCode}>
            {busy ? "Building..." : `Download ${info.label}`}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
