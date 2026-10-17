"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { useDemo } from "@/lib/store";
import { mondayOf } from "@/lib/schedule";
import { addDaysIso } from "@/lib/time";
import { useUi } from "@/lib/ui-store";
import { SAMPLE_FILE } from "@/lib/import/sample";
import { importCounts, importPayload, useImport } from "@/lib/import/store";
import { flagRange } from "@/lib/import/highlight";
import { permitStatusOf, readTime } from "@/lib/import/parse";
import type { ImportRow } from "@/lib/import/types";

const PERMIT_BADGE = {
  obtained: { cls: "b b-ok", txt: "Permits obtained" },
  pending: { cls: "b b-pe", txt: "Permits pending" },
  cancelled: { cls: "b b-cn", txt: "Cancelled" },
} as const;

const fmt = (raw: string) => {
  const r = readTime(raw);
  return r.ok ? `${String(Math.floor(r.minutes / 60)).padStart(2, "0")}:${String(r.minutes % 60).padStart(2, "0")}` : raw;
};

export function ImportPage() {
  const router = useRouter();
  const phase = useImport((s) => s.phase);
  const fileName = useImport((s) => s.fileName);
  const pct = useImport((s) => s.pct);
  const parsed = useImport((s) => s.parsed);
  const stage = useImport((s) => s.stage);
  const structure = useImport((s) => s.structure);
  const fleet = useImport((s) => s.fleet);
  const maintenance = useImport((s) => s.maintenance);
  const registered = useDemo((s) => s.data.aircraft);
  const rows = useImport((s) => s.rows);
  const error = useImport((s) => s.error);
  const [over, setOver] = useState(false);
  const [onlyReview, setOnlyReview] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // RV8: the parse lives in memory only. Leaving the screen discards it.
  useEffect(() => () => useImport.getState().reset(), []);

  const counts = useMemo(() => importCounts(rows), [rows]);
  const shown = onlyReview ? rows.filter((r) => r.status === "flagged") : rows;

  const open = async (file: File) => {
    if (!/\.xlsx$/i.test(file.name)) {
      useImport.getState().error_("Only .xlsx files can be imported. Save the sheet as an Excel workbook (.xlsx) and try again.");
      return;
    }
    useImport.getState().error_(null);
    await useImport.getState().start(await file.arrayBuffer(), file.name);
  };

  const loadSample = async () => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/${SAMPLE_FILE}`);
      if (!res.ok) throw new Error(String(res.status));
      await useImport.getState().start(await res.arrayBuffer(), SAMPLE_FILE);
    } catch {
      useImport.getState().error_("The sample workbook could not be loaded. Try again.");
    }
  };

  const doImport = () => {
    const { legs, permits, blocks } = importPayload();
    const skipped = counts.review + counts.skipped;
    const { inserted, updated } = useDemo.getState().importLegs(legs, permits, blocks);
    const n = inserted + updated;
    const msg = `${n} legs imported${blocks.length ? `, ${blocks.length} unavailable periods` : ""}${skipped ? `. ${skipped} rows skipped` : ""}`;
    toast.success(msg);
    useUi.getState().say(msg);
    useUi.getState().clearFilters();
    if (legs.length) {
      const first = legs.map((l) => l.etdUtc.slice(0, 10)).sort()[0];
      const from = mondayOf(first);
      useDemo.getState().setRange({ from, to: addDaysIso(from, 20) });
    }
    useImport.getState().reset();
    router.push("/schedule");
  };

  return (
    <>
      <div className="head">
        <div>
          <h1>Import from Excel</h1>
          <p>Turn the season sheet into structured legs. Nothing is saved until you confirm. Your file stays in your browser.</p>
        </div>
      </div>

      {error && (
        <div className="vmsg er" role="alert">
          <span className="b b-er">Error</span>
          <span className="t">{error}</span>
        </div>
      )}

      {phase === "idle" && (
        <div
          className={`drop ${over ? "over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void open(f);
          }}
        >
          <Upload size={40} aria-hidden="true" />
          <b style={{ fontSize: 17 }}>Drop your .xlsx here</b>
          <span className="hint" style={{ color: "var(--ink)" }}>
            Merged cells, free text such as &quot;ETD/03.30Z&quot; and colour codes are all read.
          </span>
          <input ref={fileRef} type="file" accept=".xlsx" hidden aria-label="Choose an Excel file" onChange={(e) => e.target.files?.[0] && void open(e.target.files[0])} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            <button className="btn pri" onClick={() => fileRef.current?.click()}>
              Browse files
            </button>
            <button className="btn" onClick={() => void loadSample()}>
              Use sample: {SAMPLE_FILE}
            </button>
          </div>
          <span className="hint" style={{ color: "var(--ink)" }}>
            Your file stays in your browser.
          </span>
        </div>
      )}

      {phase === "running" && (
        <section className="card cardb" style={{ display: "flex", flexDirection: "column", gap: 12 }} aria-busy="true" aria-live="polite">
          <b style={{ fontSize: 16 }}>Reading {fileName}</b>
          <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <i style={{ width: `${pct}%` }} />
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <span>{stage}</span>
            <span className="grow" />
            <span className="mono">{parsed} legs parsed</span>
            <span className="mono">{pct}%</span>
          </div>
        </section>
      )}

      {phase === "review" && structure && (
        <>
          <section className="kpis" aria-label="Import summary">
            <div className="kpi">
              <small>Legs parsed</small>
              <b className="mono">{counts.parsed}</b>
              <small>
                from {structure.rows} rows, 1 sheet
              </small>
            </div>
            <div className={`kpi ${counts.review ? "warn" : ""}`}>
              <small>Need review</small>
              <b className="mono">{counts.review}</b>
              <small>highlighted below</small>
            </div>
            <div className="kpi">
              <small>Ready to import</small>
              <b className="mono">{counts.ready}</b>
              <small>no issues found</small>
            </div>
          </section>

          {(fleet || maintenance.length > 0) && (
            <section className="card" aria-label="Also found in the sheet">
              <div className="cardh">
                <h3>Also found in the sheet</h3>
              </div>
              <div className="cardb" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {fleet && (
                  <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                    <span>
                      Fleet table: {fleet.aircraft.map((a) => `${a.registration} ${a.type}`).join(", ")}. Company designators{" "}
                      <b className="mono">
                        {fleet.company.icao || "?"} / {fleet.company.iata || "?"}
                      </b>
                      {fleet.company.name ? ` (${fleet.company.name})` : ""}.
                    </span>
                    <span className="grow" />
                    <button
                      className="btn pri sm"
                      disabled={fleet.aircraft.every((a) => registered.some((r) => r.registration === a.registration)) && !fleet.company.icao}
                      onClick={() => {
                        const r = useImport.getState().addFleet();
                        toast.success(`${r.aircraft} aircraft added${r.company ? ", company designators set" : ""}. Rows were read again.`);
                      }}
                    >
                      Add this fleet and set the company
                    </button>
                  </div>
                )}
                {maintenance.length > 0 && (
                  <div>
                    {maintenance.length} whole-day AOG, C-Check or Maintenance entries become unavailable periods on import (consecutive days merge). You can edit them on the Fleet registry page.
                  </div>
                )}
              </div>
            </section>
          )}

          <section className="card" aria-label="Parsed rows">
            <div className="cardh">
              <h3>
                {counts.parsed} legs parsed, {counts.review} need review{counts.skipped ? `, ${counts.skipped} skipped` : ""}
              </h3>
              <span className="grow" />
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)} /> Show only rows that need review
              </label>
              <button className="btn sm" onClick={() => useImport.getState().reset()}>
                Start over
              </button>
              <button className="btn pri sm" onClick={doImport} disabled={counts.ready === 0}>
                Import {counts.ready} legs
              </button>
            </div>
            <div className="scroll">
              <div style={{ minWidth: 820 }}>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.1fr)", borderBottom: "1px solid var(--line)" }}>
                  <div className="lbl" style={{ padding: "8px 14px" }}>
                    Messy cell text
                  </div>
                  <div className="lbl" style={{ padding: "8px 14px", borderLeft: "1px solid var(--line)" }}>
                    Structured legs
                  </div>
                </div>
                {shown.map((r) => (
                  <RowView key={r.id} row={r} />
                ))}
                {shown.length === 0 && (
                  <div className="empty">
                    <b>Nothing left to review</b>
                    <span>All rows are ready. Import them when you are ready.</span>
                  </div>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </>
  );
}

function RowView({ row }: { row: ImportRow }) {
  const f = row.fields;
  const range = row.status === "flagged" ? flagRange(row) : null;
  const text = row.ref.text;
  const leg = row.override;
  const ps = permitStatusOf(row);
  const reg = row.ref.aircraftReg;

  const summary = leg
    ? { flight: leg.flightNumber + leg.suffix, route: `${leg.depIcao} > ${leg.arrIcao}`, times: `${leg.etdUtc.slice(11, 16)} to ${leg.etaUtc.slice(11, 16)}`, note: leg.notes }
    : f
      ? { flight: `${f.prefix}${f.number}${f.suffix}`, route: `${f.dep.iata} > ${f.arr.iata}`, times: `${fmt(f.depTime.raw)} to ${fmt(f.arrTime.raw)}`, note: f.note }
      : null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.1fr)", borderBottom: "1px solid var(--line2)" }}>
      <div style={{ padding: "10px 14px" }}>
        <div className="mono" style={{ background: "var(--panel2)", border: "1px solid var(--line)", borderRadius: 4, padding: "6px 8px", wordBreak: "break-word" }}>
          {range ? (
            <>
              {text.slice(0, range[0])}
              <mark style={{ background: "var(--er-bg)", color: "var(--er)", fontWeight: 700, textDecoration: "underline wavy", borderRadius: 2 }}>{text.slice(range[0], range[1])}</mark>
              {text.slice(range[1])}
            </>
          ) : (
            text
          )}
        </div>
        <div className="hint mono" style={{ marginTop: 4 }}>
          {row.ref.cell} Â· {reg}
        </div>
      </div>
      <div style={{ padding: "10px 14px", borderLeft: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 6 }}>
        {summary ? (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <b className="mono">{summary.flight}</b>
            <span className="mono">{summary.route}</span>
            <span className="mono">{summary.times}</span>
            {ps ? <span className={PERMIT_BADGE[ps].cls}>{PERMIT_BADGE[ps].txt}</span> : <span className="b b-nt">No permit marker</span>}
          </div>
        ) : (
          <div className="hint">Nothing could be read from this line.</div>
        )}
        {summary?.note && <div className="hint">Note: {summary.note}</div>}

        {row.status === "flagged" && row.flag && (
          <div className="vmsg wa">
            <span className="b b-wa">Needs review</span>
            <span className="t">
              {row.flag.message}
              {row.flag.suggestion && (
                <>
                  {" "}
                  Suggested: <b>{row.flag.suggestion.label}</b>
                </>
              )}
            </span>
            {row.flag.suggestion ? (
              <button className="btn sm fix" onClick={() => useImport.getState().accept(row.id)}>
                Accept fix
              </button>
            ) : (
              <button className="btn sm fix" onClick={() => useUi.getState().openImportRow(row.id)}>
                Edit
              </button>
            )}
            {row.flag.suggestion && (
              <button className="btn sm" onClick={() => useUi.getState().openImportRow(row.id)}>
                Edit
              </button>
            )}
            <button className="btn sm" onClick={() => useImport.getState().skip(row.id, true)} title="Leave this line out of the import">
              Skip row
            </button>
          </div>
        )}
        {row.status === "skipped" && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="b b-nt">Skipped</span>
            <button className="btn sm" onClick={() => useImport.getState().skip(row.id, false)}>
              Undo skip
            </button>
          </div>
        )}
        {row.status === "fixed" && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="b b-ok">Fixed</span>
            <button className="btn sm" onClick={() => useUi.getState().openImportRow(row.id)}>
              Edit
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
