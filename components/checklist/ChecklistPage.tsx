"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { derive } from "@/lib/derived";
import { liveSelection, useDemo } from "@/lib/store";
import { useUi } from "@/lib/ui-store";
import { buildChecklistModel } from "@/lib/checklist/model";
import { buildExport, downloadBlob, FORMAT_LABEL, type ExportFormat } from "@/lib/checklist/export";
import { fmtDate, fmtHHMM, ms } from "@/lib/time";
import { fullFlight, isActive } from "@/lib/legs";
import { ChecklistPreview } from "./ChecklistPreview";

export function ChecklistPage() {
  const router = useRouter();
  const data = useDemo((s) => s.data);
  const selection = useDemo((s) => s.selection);
  const d = derive(data);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<{ format: ExportFormat; pct: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirm, setConfirm] = useState<ExportFormat | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const ticked = useMemo(() => liveSelection(selection, data), [selection, data]);
  const tickedSet = useMemo(() => new Set(ticked), [ticked]);
  const model = useMemo(() => buildChecklistModel(data, ticked), [data, ticked]);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return [...data.legs]
      .sort((a, b) => ms(a.etdUtc) - ms(b.etdUtc) || (a.id < b.id ? -1 : 1))
      .filter((l) => {
        if (!t) return true;
        const dep = d.idx.byIcao.get(l.depIcao);
        const arr = d.idx.byIcao.get(l.arrIcao);
        return [fullFlight(l), l.aircraftId, l.depIcao, l.arrIcao, dep?.iata, arr?.iata].some((v) => v?.toLowerCase().includes(t));
      });
  }, [data.legs, q, d.idx]);

  // eslint-disable-next-line react-hooks/incompatible-library
  const virt = useVirtualizer({ count: rows.length, getScrollElement: () => listRef.current, estimateSize: () => 38, overscan: 12 });

  const errorLegs = ticked.filter((id) => (d.issuesByLeg.get(id) ?? []).some((i) => i.severity === "error")).length;

  const run = async (format: ExportFormat) => {
    if (!model) return;
    setFailed(false);
    setBusy({ format, pct: 0 });
    try {
      const blob = await buildExport(format, model, (pct) => setBusy({ format, pct }));
      const name = `${model.fileBase}.${format}`;
      downloadBlob(blob, name);
      toast.success(`${name} downloaded`);
      useUi.getState().say(`${FORMAT_LABEL[format]} file ${name} downloaded`);
      setBusy(null);
    } catch (e) {
      console.warn("Export failed", e);
      setFailed(true);
      setBusy({ format, pct: 0 });
    }
  };

  const start = (format: ExportFormat) => {
    if (!model) return;
    if (errorLegs > 0) setConfirm(format);
    else void run(format);
  };

  const selectThrough = () => {
    const first = [...d.through.groups.entries()].find(([, ids]) => d.legById.get(ids[0])?.flightNumber === "PHC611");
    const ids = first ? first[1] : [];
    if (ids.length) useDemo.getState().setSelection(ids);
  };

  return (
    <>
      <div className="head">
        <div>
          <h1>Checklist export</h1>
          <p>Pick one leg or many. The preview is the document that gets exported.</p>
        </div>
        <span className="grow" />
        <button className="btn pri" disabled={!model || !!busy} onClick={() => start("pdf")}>
          Export PDF
        </button>
        <button className="btn" disabled={!model || !!busy} onClick={() => start("xlsx")}>
          Excel
        </button>
        <button className="btn" disabled={!model || !!busy} onClick={() => start("docx")}>
          Word
        </button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
        <section className="card" style={{ flex: "1 1 320px", maxWidth: 400 }} aria-label="Legs to include">
          <div className="cardh">
            <h3>Legs</h3>
            <span className="b b-in" aria-live="polite">
              {ticked.length} selected
            </span>
            <span className="grow" />
            <button className="btn sm" onClick={() => useDemo.getState().clearSelection()} disabled={ticked.length === 0}>
              Clear
            </button>
          </div>
          <div className="cardb" style={{ paddingBottom: 6 }}>
            <input className="inp" style={{ width: "100%" }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by flight, station or tail" aria-label="Filter legs" />
          </div>
          <div ref={listRef} style={{ maxHeight: 620, overflow: "auto", position: "relative" }}>
            <div style={{ height: virt.getTotalSize(), position: "relative" }}>
              {virt.getVirtualItems().map((v) => {
                const l = rows[v.index];
                const cancelled = !isActive(l);
                const dep = d.idx.byIcao.get(l.depIcao)?.iata ?? l.depIcao;
                const arr = d.idx.byIcao.get(l.arrIcao)?.iata ?? l.arrIcao;
                return (
                  <label
                    key={l.id}
                    title={cancelled ? "Cancelled legs cannot be added to a checklist" : undefined}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: v.size,
                      transform: `translateY(${v.start}px)`,
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      padding: "0 14px",
                      borderTop: "1px solid var(--line2)",
                      cursor: cancelled ? "not-allowed" : "pointer",
                      opacity: cancelled ? 0.65 : 1,
                    }}
                  >
                    <input type="checkbox" checked={tickedSet.has(l.id)} disabled={cancelled} onChange={() => useDemo.getState().toggleSelect(l.id)} />
                    <span className="mono" style={{ fontWeight: 600, minWidth: 74, textDecoration: cancelled ? "line-through" : undefined }}>
                      {fullFlight(l)}
                    </span>
                    <span className="mono hint">
                      {dep} &gt; {arr}
                    </span>
                    {cancelled && <span className="b b-cn">CNL</span>}
                    <span className="grow" />
                    <span className="mono hint">
                      {fmtDate(l.etdUtc)} {fmtHHMM(l.etdUtc)}
                    </span>
                  </label>
                );
              })}
            </div>
            {rows.length === 0 && <div className="empty">No legs match this filter.</div>}
          </div>
        </section>

        <div style={{ flex: "999 1 520px", minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          {model ? (
            <ChecklistPreview model={model} />
          ) : (
            <div className="card empty">
              <b>No legs selected</b>
              <span>Tick legs in the list, or on the Schedule, to build a checklist.</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn pri" onClick={selectThrough}>
                  Select the PHC611 through flight
                </button>
                <button className="btn" onClick={() => router.push("/schedule/")}>
                  Open Schedule
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {busy && (
        <>
          <div className="scrim" style={{ zIndex: 70 }} />
          <div role="alertdialog" aria-modal="true" aria-label={failed ? "Export failed" : `Building ${FORMAT_LABEL[busy.format]} file`} className="card" style={{ position: "fixed", left: "50%", top: "38%", transform: "translateX(-50%)", width: "min(440px, 92vw)", padding: 20, zIndex: 80, boxShadow: "var(--shadow)" }}>
            {failed ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <b style={{ fontSize: 16 }}>Could not build the file. Try again.</b>
                <span className="hint">Your selection is kept.</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn pri" onClick={() => run(busy.format)}>
                    Try again
                  </button>
                  <button className="btn" onClick={() => setBusy(null)}>
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }} aria-live="polite">
                <b style={{ fontSize: 16 }}>Building {FORMAT_LABEL[busy.format]} file</b>
                <div className="bar" role="progressbar" aria-valuenow={busy.pct} aria-valuemin={0} aria-valuemax={100}>
                  <i style={{ width: `${busy.pct}%` }} />
                </div>
                <span className="mono">{busy.pct}%</span>
              </div>
            )}
          </div>
        </>
      )}

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>
              {errorLegs} selected {errorLegs === 1 ? "leg has" : "legs have"} open errors
            </DialogTitle>
            <DialogDescription>
              {errorLegs === 1 ? "1 selected leg has open errors." : `${errorLegs} selected legs have open errors.`} Export anyway or review. The document itself carries no issue text.
            </DialogDescription>
          </DialogHeader>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              className="btn"
              onClick={() => {
                setConfirm(null);
                router.push("/conflicts/");
              }}
            >
              Review
            </button>
            <button
              className="btn pri"
              onClick={() => {
                const f = confirm;
                setConfirm(null);
                if (f) void run(f);
              }}
            >
              Export anyway
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
