"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { COUNTRY_NAMES, formatOffset, isPlaceholder } from "@/lib/airports";
import { derive } from "@/lib/derived";
import {
  LEG_TYPES,
  blankForm,
  blockText,
  evaluateForm,
  formFromLeg,
  legFromForm,
  normaliseFlight,
  type LegForm,
} from "@/lib/legform";
import { fullFlight, isActive } from "@/lib/legs";
import { permitKey, requiredPermits } from "@/lib/permits";
import { resolveStation } from "@/lib/airports";
import { useDemo, liveSelection, MAX_CHECKLIST_LEGS } from "@/lib/store";
import { useUi } from "@/lib/ui-store";
import { fmtDate, fmtDow, fmtHHMM, ms, MIN } from "@/lib/time";
import type { Leg, PermitStatus } from "@/lib/types";

export interface ImportCtx {
  rawText: string;
  cell: string;
  message?: string;
  onSave: (leg: Leg) => void;
}

interface Props {
  mode: "edit" | "new" | "import";
  leg: Leg | null; // stored leg (edit) or best-effort parse (import)
  draft?: Partial<Leg>;
  importCtx?: ImportCtx;
  onClose: () => void;
}

const STATUS_LABEL: Record<PermitStatus, string> = { obtained: "Obtained", pending: "Pending", cancelled: "Cancelled" };
const STATUS_CLS: Record<PermitStatus, string> = { obtained: "b b-ok", pending: "b b-pe", cancelled: "b b-cn" };

export function LegDrawer({ mode, leg, draft, importCtx, onClose }: Props) {
  const data = useDemo((s) => s.data);
  const selection = useDemo((s) => s.selection);
  const d = derive(data);
  const { idx } = d;

  // The host remounts this component (key) when the stored leg changes, for example after a one-click fix,
  // so the form always starts from the stored values.
  const [initial] = useState<LegForm>(() => (leg ? formFromLeg(leg, idx) : blankForm(data, idx, draft, "2026-09-14")));
  const [form, setForm] = useState<LegForm>(initial);
  const [permitEdits, setPermitEdits] = useState<Record<string, PermitStatus>>({});
  const [showErrors, setShowErrors] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const result = evaluateForm(form, data, idx);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial) || Object.keys(permitEdits).length > 0;
  const set = (patch: Partial<LegForm>) => setForm((f) => ({ ...f, ...patch }));

  const requestClose = () => {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };

  const isNew = mode === "new";
  const cancelled = leg ? !isActive(leg) : false;
  const issues = leg && mode === "edit" && !cancelled ? d.issuesByLeg.get(leg.id) ?? [] : [];
  const title =
    mode === "new" ? "Add leg" : mode === "import" ? `Fix imported row ${importCtx?.cell ?? ""}` : leg ? `${fullFlight(leg)} ${idxLabel(leg, d.idx)}` : "Leg";

  // Permits for the route currently in the form.
  const required = result.depIcao && result.arrIcao ? requiredPermits(result.depIcao, result.arrIcao, idx, data.company.baseIcao) : [];
  const stored = new Map((leg ? d.permitsByLeg.get(leg.id) ?? [] : []).map((p) => [permitKey(p), p]));

  const times = result.times;
  const arrAirport = result.arrIcao ? idx.byIcao.get(result.arrIcao) : undefined;
  const summary = (() => {
    if (!times || !times.valid) return null;
    const utc = `${fmtDow(times.etaUtc)} ${fmtHHMM(times.etaUtc)}Z`;
    if (!arrAirport || isPlaceholder(arrAirport.icao)) return `Arrives ${utc}`;
    const local = ms(times.etaUtc) + arrAirport.utcOffsetMinutes * MIN;
    const tag = new Date(local).toISOString().slice(0, 10) !== times.etaUtc.slice(0, 10);
    return `Arrives ${utc} | ${fmtDow(local)} ${fmtHHMM(local)} local at ${arrAirport.iata} (UTC${formatOffset(arrAirport.utcOffsetMinutes)})${tag ? ", next day locally" : ""}`;
  })();

  const save = () => {
    setShowErrors(true);
    if (!result.ok) return;
    const existing = mode === "edit" ? leg : null;
    const built = legFromForm({ ...form, ...normaliseFlight(form.fn, form.dSuffix) }, result, data, idx, existing);
    if (!built) return;
    if (mode === "import") {
      importCtx?.onSave(built);
      onClose();
      return;
    }
    if (isNew && data.legs.some((l) => l.id === built.id)) {
      toast.error("A leg with this flight number, date, departure and aircraft already exists");
      return;
    }
    useDemo.getState().saveLeg(built, isNew, permitEdits);
    useUi.getState().say(`Leg ${fullFlight(built)} saved`);
    onClose();
  };

  const err = (k: keyof typeof result.errors) => (showErrors || touchedField(k, form, initial) ? result.errors[k] : undefined);

  const checklistOn = leg ? liveSelection(selection, data).includes(leg.id) : false;
  const addToChecklist = () => {
    if (!leg) return;
    if (checklistOn) useDemo.getState().toggleSelect(leg.id);
    else {
      useDemo.getState().toggleSelect(leg.id);
      toast.success(`${fullFlight(leg)} added to the checklist`);
    }
  };

  return (
    <>
      <Sheet open onOpenChange={(o) => !o && requestClose()}>
        <SheetContent side="right" showCloseButton={false} className="w-full gap-0 p-0 sm:max-w-[500px]" aria-describedby={undefined}>
          <div className="ph" style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
            <SheetTitle style={{ fontSize: 16, margin: 0 }}>{title}</SheetTitle>
            {cancelled && <span className="b b-cn">Cancelled</span>}
            <span className="grow" />
            <button className="btn sm" onClick={requestClose} aria-label="Close panel">
              Close <span className="kbd">Esc</span>
            </button>
          </div>
          <SheetDescription className="sr-only">Leg details, validation, permits and notes.</SheetDescription>

          <div style={{ flex: 1, overflow: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
            {importCtx && (
              <div className="msy" style={{ fontSize: 13 }}>
                <b>Imported from {importCtx.cell}</b>
                <div className="mono" style={{ marginTop: 4, wordBreak: "break-word" }}>
                  {importCtx.rawText}
                </div>
                {importCtx.message && <div style={{ marginTop: 4 }}>{importCtx.message}</div>}
              </div>
            )}
            {mode === "edit" && leg?.source.sheetRef && !importCtx && (
              <div className="msy">
                <b>Imported from {leg.source.sheetRef.cell}</b>
                <div className="mono" style={{ marginTop: 4, wordBreak: "break-word" }}>
                  {leg.source.sheetRef.rawText}
                </div>
              </div>
            )}

            {mode === "edit" && (
              <section aria-label="Validation" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {issues.map((i) => (
                  <div key={i.id} className={`vmsg ${i.severity === "error" ? "er" : "wa"}`}>
                    <span className={`b ${i.severity === "error" ? "b-er" : "b-wa"}`}>{i.severity === "error" ? "Error" : "Warning"}</span>
                    <span className="t">{i.message}</span>
                    {i.fixes.map((fx) => (
                      <button
                        key={fx.id}
                        className="btn sm fix"
                        disabled={!fx.enabled}
                        title={fx.disabledReason ?? undefined}
                        onClick={() => {
                          if (fx.secondary && fx.draft) {
                            useUi.getState().openNew(fx.draft);
                            return;
                          }
                          useDemo.getState().commit(fx.patch, fx.result);
                          useUi.getState().say(fx.result);
                        }}
                      >
                        {fx.label}
                      </button>
                    ))}
                  </div>
                ))}
                {issues.length === 0 && !cancelled && (
                  <div className="vmsg ok">
                    <span className="b b-ok">OK</span>
                    <span className="t">No validation issues for this leg.</span>
                  </div>
                )}
              </section>
            )}

            <div className="fgrid">
              <div className="fld">
                <label htmlFor="f-fn">Flight number</label>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    id="f-fn"
                    className="inp mono"
                    style={{ flex: 1 }}
                    value={form.fn}
                    aria-invalid={!!err("fn")}
                    aria-describedby="f-fn-msg"
                    onChange={(e) => set({ fn: e.target.value.toUpperCase() })}
                    onBlur={() => set(normaliseFlight(form.fn, form.dSuffix))}
                  />
                  <button type="button" className={`btn sm ${form.dSuffix ? "pri" : ""}`} aria-pressed={form.dSuffix} onClick={() => set({ dSuffix: !form.dSuffix })} title="Suffix D marks a parallel flight on the same day">
                    D
                  </button>
                </div>
                <span id="f-fn-msg" className={err("fn") ? "err-t" : "hint"}>
                  {err("fn") ?? result.warnings.fn ?? (form.dSuffix ? `Full number ${form.fn}D` : "")}
                </span>
              </div>
              <div className="fld">
                <label htmlFor="f-type">Flight type</label>
                <select id="f-type" className="sel" value={form.type} onChange={(e) => set({ type: e.target.value as LegForm["type"] })}>
                  {LEG_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="fld">
                <label htmlFor="f-ac">Aircraft (primary)</label>
                <select
                  id="f-ac"
                  className="sel"
                  value={form.ac}
                  onChange={(e) => set({ ac: e.target.value, backup: data.aircraft.find((a) => a.id === e.target.value)?.defaultBackupId ?? "" })}
                >
                  {data.aircraft.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.registration} {a.type}
                    </option>
                  ))}
                </select>
              </div>
              <div className="fld">
                <label htmlFor="f-bac">Backup aircraft</label>
                <select id="f-bac" className="sel" value={form.backup} onChange={(e) => set({ backup: e.target.value })}>
                  <option value="">None</option>
                  {data.aircraft
                    .filter((a) => a.id !== form.ac)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.registration} {a.type}
                      </option>
                    ))}
                </select>
              </div>
              <StationField id="f-dep" label="Departure station" value={form.dep} error={err("dep")} onChange={(v) => set({ dep: v })} />
              <StationField id="f-arr" label="Arrival station" value={form.arr} error={err("arr")} onChange={(v) => set({ arr: v })} />
              <div className="fld">
                <label htmlFor="f-date">Departure date (UTC)</label>
                <input id="f-date" type="date" className="inp mono" value={form.date} aria-invalid={!!err("date")} onChange={(e) => set({ date: e.target.value })} />
                <span className="err-t">{err("date")}</span>
              </div>
              <div className="fld">
                <label>Block time</label>
                <div className="mono" style={{ height: 32, display: "flex", alignItems: "center", gap: 8 }} aria-live="polite">
                  <b>{blockText(times)}</b>
                  {times?.valid && times.dayPlus === 1 && <span className="plus1">+1</span>}
                </div>
              </div>
              <div className="fld">
                <label htmlFor="f-etd">ETD UTC</label>
                <input
                  id="f-etd"
                  className="inp mono"
                  inputMode="numeric"
                  placeholder="HH:MM"
                  maxLength={5}
                  value={form.etd}
                  aria-invalid={!!err("etd")}
                  onChange={(e) => set({ etd: e.target.value })}
                  onBlur={() => set({ etd: tidyTime(form.etd) })}
                />
                <span className="err-t">{err("etd")}</span>
              </div>
              <div className="fld">
                <label htmlFor="f-eta">ETA UTC</label>
                <input
                  id="f-eta"
                  className="inp mono"
                  inputMode="numeric"
                  placeholder="HH:MM"
                  maxLength={5}
                  value={form.eta}
                  aria-invalid={!!err("eta")}
                  aria-describedby="f-eta-msg"
                  onChange={(e) => set({ eta: e.target.value })}
                  onBlur={() => set({ eta: tidyTime(form.eta) })}
                />
                <span id="f-eta-msg" className={err("eta") ? "err-t" : "hint"}>
                  {err("eta") ?? result.warnings.eta ?? ""}
                </span>
              </div>
            </div>
            <div className="mono hint" aria-live="polite">
              {summary ?? "Arrival summary appears when ETD and ETA are set."}
            </div>

            <section>
              <h3 style={{ margin: "0 0 6px", fontSize: 14 }}>Permits for this route</h3>
              <div className="card scroll">
                {required.length > 0 ? (
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th scope="col">Country</th>
                        <th scope="col">Type</th>
                        <th scope="col">Number</th>
                        <th scope="col">Status</th>
                        <th scope="col">Valid</th>
                      </tr>
                    </thead>
                    <tbody>
                      {required.map((r) => {
                        const key = permitKey(r);
                        const row = stored.get(key);
                        const status: PermitStatus = permitEdits[key] ?? row?.status ?? "pending";
                        const noRecord = !row && !permitEdits[key];
                        return (
                          <tr key={key}>
                            <td>{COUNTRY_NAMES[r.countryCode]}</td>
                            <td style={{ textTransform: "capitalize" }}>{r.type}</td>
                            <td className="mono">{status === "obtained" ? row?.number ?? "Not entered" : "-"}</td>
                            <td>
                              <span className={STATUS_CLS[status]}>{noRecord ? "No record, saves as pending" : STATUS_LABEL[status]}</span>
                              <br />
                              <select
                                className="sel"
                                style={{ height: 28, marginTop: 4 }}
                                value={status}
                                aria-label={`${COUNTRY_NAMES[r.countryCode]} ${r.type} permit status`}
                                onChange={(e) => setPermitEdits((p) => ({ ...p, [key]: e.target.value as PermitStatus }))}
                              >
                                <option value="obtained">Obtained</option>
                                <option value="pending">Pending</option>
                                <option value="cancelled">Cancelled</option>
                              </select>
                            </td>
                            <td className="mono">{row?.validFromUtc && row.validToUtc ? `${fmtDate(row.validFromUtc)} to ${fmtDate(row.validToUtc)}` : "-"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div className="cardb hint">
                    {result.depIcao && result.arrIcao ? "No third country permits needed for this route." : "Pick a departure and an arrival station to see the permits for this route."}
                  </div>
                )}
              </div>
              <small className="hint">Rows are added or removed automatically when you change the route.</small>
            </section>

            <div className="fld">
              <label htmlFor="f-notes">Special notes</label>
              <textarea id="f-notes" className="inp" value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
            </div>

            {mode === "edit" && leg && (
              <div>
                {cancelled ? (
                  <button
                    className="btn"
                    onClick={() => {
                      useDemo.getState().setLegStatus(leg.id, "planned");
                      onClose();
                    }}
                  >
                    Restore leg
                  </button>
                ) : (
                  <button
                    className="btn"
                    onClick={() => {
                      useDemo.getState().setLegStatus(leg.id, "cancelled");
                      useUi.getState().say(`${fullFlight(leg)} cancelled`);
                      onClose();
                    }}
                  >
                    Cancel this leg (CNL)
                  </button>
                )}
                <div className="hint" style={{ marginTop: 4 }}>
                  It stays in history and leaves the daily count. Restore leg brings it back.
                </div>
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid var(--line)", background: "var(--panel2)" }}>
            <button className="btn pri" onClick={save}>
              Save leg
            </button>
            <button className="btn" onClick={requestClose}>
              Cancel
            </button>
            <span className="grow" />
            {mode === "edit" && leg && !cancelled && (
              <button className="btn" onClick={addToChecklist} aria-pressed={checklistOn}>
                {checklistOn ? "Remove from checklist" : "Add to checklist"}
              </button>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Discard changes?</DialogTitle>
            <DialogDescription>Your edits to this leg have not been saved.</DialogDescription>
          </DialogHeader>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn" onClick={() => setConfirmDiscard(false)}>
              Keep editing
            </button>
            <button
              className="btn dng"
              onClick={() => {
                setConfirmDiscard(false);
                onClose();
              }}
            >
              Discard changes
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** "0330", "3.30", "03:30" -> "03:30". Anything else is left for the validator to reject. */
function tidyTime(text: string): string {
  const t = text.trim().replace(".", ":");
  const m = /^(\d{1,2}):?(\d{2})$/.exec(t);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : text;
}

function touchedField(k: string, form: LegForm, initial: LegForm): boolean {
  const map: Record<string, keyof LegForm> = { fn: "fn", dep: "dep", arr: "arr", date: "date", etd: "etd", eta: "eta", ac: "ac" };
  const f = map[k];
  return !!f && form[f] !== initial[f];
}

function idxLabel(leg: Leg, idx: ReturnType<typeof derive>["idx"]): string {
  const a = idx.byIcao.get(leg.depIcao)?.iata ?? leg.depIcao;
  const b = idx.byIcao.get(leg.arrIcao)?.iata ?? leg.arrIcao;
  return `${a} to ${b}`;
}

function StationField({ id, label, value, error, onChange }: { id: string; label: string; value: string; error?: string; onChange: (v: string) => void }) {
  const data = useDemo((s) => s.data);
  const idx = derive(data).idx;
  const hit = resolveStation(value, idx);
  return (
    <div className="fld">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="inp mono"
        list="aplist"
        value={value}
        aria-invalid={!!error}
        placeholder="ICAO, IATA or XXXX/XXX"
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        onBlur={() => hit && onChange(`${hit.icao}/${hit.iata}`)}
      />
      <span className={error ? "err-t" : "hint mono"}>{error ?? (hit ? hit.name : "")}</span>
      <datalist id="aplist">
        {data.airports.map((a) => (
          <option key={a.icao} value={`${a.icao}/${a.iata}`} />
        ))}
      </datalist>
    </div>
  );
}

export { MAX_CHECKLIST_LEGS };
