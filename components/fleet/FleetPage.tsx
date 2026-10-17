"use client";

import { useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDemo } from "@/lib/store";
import { useUi } from "@/lib/ui-store";
import { AIRCRAFT_TYPES, aircraftToForm, blankAircraftForm, missingFields, validateAircraft, type AircraftForm } from "@/lib/forms";
import type { Aircraft, AircraftStatus } from "@/lib/types";
import { ListGate } from "@/components/common/ListGate";
import { BlocksSection } from "./BlocksSection";

const ST: Record<AircraftStatus, { cls: string; txt: string }> = {
  active: { cls: "b b-ok", txt: "Active" },
  aog: { cls: "b b-ur", txt: "AOG" },
  maintenance: { cls: "b b-wa", txt: "Maintenance" },
};

const num = (n: number | null, unit = "") => (n === null ? "" : `${n.toLocaleString("en-US")}${unit}`);

export function FleetPage() {
  const fleet = useDemo((s) => s.data.aircraft);
  const [edit, setEdit] = useState<Aircraft | "new" | null>(null);

  return (
    <>
      <div className="head">
        <div>
          <h1>Fleet registry</h1>
          <p>Master data for every aircraft.</p>
        </div>
        <span className="grow" />
        <button className="btn pri" onClick={() => setEdit("new")}>
          + Add aircraft
        </button>
      </div>
      <div className="info">
        <span>
          <b>Why headers cannot disagree:</b> schedule columns, Gantt rows and checklists read the registration and type from this table. There is no second place to type them.
        </span>
      </div>
      <ListGate>
        <section className="card scroll" aria-label="Aircraft">
          <table className="tbl">
            <thead>
              <tr>
                {["Tail number", "Type", "Serial no.", "Year", "MTOW", "Cargo payload", "Status"].map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
                <th scope="col">
                  <span className="sr-only">Edit</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {fleet.map((a) => {
                const miss = missingFields(a);
                return (
                  <tr key={a.id}>
                    <th scope="row" className="mono" style={{ textTransform: "none", letterSpacing: 0, fontSize: 14, color: "var(--ink)", background: "none" }}>
                      {a.registration}
                      {miss.length > 0 && (
                        <>
                          {" "}
                          <span className="b b-wa" title={`Missing: ${miss.join(", ")}`}>
                            Incomplete
                          </span>
                        </>
                      )}
                    </th>
                    <td className="mono">{a.type}</td>
                    <td className="mono">{a.serialNo ?? <Missing />}</td>
                    <td className="mono">{a.yearOfManufacture ?? <Missing />}</td>
                    <td className="mono">{a.mtowKg === null ? <Missing /> : num(a.mtowKg, " kg")}</td>
                    <td className="mono">{a.cargoPayloadKg === null ? <Missing /> : num(a.cargoPayloadKg, " kg")}</td>
                    <td>
                      <span className={ST[a.status].cls}>{ST[a.status].txt}</span>
                    </td>
                    <td>
                      <button className="btn sm" onClick={() => setEdit(a)} aria-label={`Edit ${a.registration}`}>
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </ListGate>
      <BlocksSection />
      {edit && <AircraftDrawer key={edit === "new" ? "new" : edit.id} aircraft={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function Missing() {
  return <span style={{ color: "var(--wa)", fontWeight: 600 }}>Missing</span>;
}

function AircraftDrawer({ aircraft, onClose }: { aircraft: Aircraft | null; onClose: () => void }) {
  const fleet = useDemo((s) => s.data.aircraft);
  const [form, setForm] = useState<AircraftForm>(() => (aircraft ? aircraftToForm(aircraft) : blankAircraftForm()));
  const [initial] = useState(form);
  const [show, setShow] = useState(false);
  const result = validateAircraft(form, fleet, aircraft?.id ?? null);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const set = (p: Partial<AircraftForm>) => setForm((f) => ({ ...f, ...p }));
  const e = (k: keyof AircraftForm) => (show ? result.errors[k] : undefined);

  const save = () => {
    setShow(true);
    if (!result.value) return;
    useDemo.getState().saveAircraft(result.value, !aircraft);
    useUi.getState().say(`Aircraft ${result.value.registration} saved`);
    onClose();
  };
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const close = () => {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };

  const field = (id: keyof AircraftForm, label: string, extra?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <div className="fld">
      <label htmlFor={`a-${id}`}>{label}</label>
      <input id={`a-${id}`} className="inp mono" value={form[id]} aria-invalid={!!e(id)} onChange={(ev) => set({ [id]: ev.target.value } as Partial<AircraftForm>)} {...extra} />
      <span className="err-t">{e(id)}</span>
    </div>
  );

  return (
    <>
    <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Discard changes?</DialogTitle>
          <DialogDescription>Your edits to this aircraft have not been saved.</DialogDescription>
        </DialogHeader>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn" onClick={() => setConfirmDiscard(false)}>
            Keep editing
          </button>
          <button className="btn dng" onClick={onClose}>
            Discard changes
          </button>
        </div>
      </DialogContent>
    </Dialog>
    <Sheet open onOpenChange={(o) => !o && close()}>
      <SheetContent side="right" showCloseButton={false} className="w-full gap-0 p-0 sm:max-w-[480px]">
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
          <SheetTitle style={{ fontSize: 16 }}>{aircraft ? `Edit ${aircraft.registration}` : "Add aircraft"}</SheetTitle>
          <span className="grow" />
          <button className="btn sm" onClick={close}>
            Close <span className="kbd">Esc</span>
          </button>
        </div>
        <SheetDescription className="sr-only">Aircraft record</SheetDescription>
        <div style={{ flex: 1, overflow: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="fgrid">
            {field("registration", "Tail number", { placeholder: "4L-PXE", onChange: (ev) => set({ registration: ev.target.value.toUpperCase() }) })}
            <div className="fld">
              <label htmlFor="a-type">Type</label>
              <input id="a-type" className="inp mono" list="a-types" value={form.type} onChange={(ev) => set({ type: ev.target.value })} placeholder="B737-800SF" />
              <datalist id="a-types">
                {[...new Set([...AIRCRAFT_TYPES, ...fleet.map((x) => x.type)])].map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
            {field("serialNo", "Serial number")}
            {field("year", "Year of manufacture", { inputMode: "numeric" })}
            {field("mtow", "MTOW kg", { inputMode: "numeric" })}
            {field("payload", "Cargo payload kg", { inputMode: "numeric" })}
            <div className="fld">
              <label htmlFor="a-status">Status</label>
              <select id="a-status" className="sel" value={form.status} onChange={(ev) => set({ status: ev.target.value as AircraftStatus })}>
                <option value="active">Active</option>
                <option value="aog">AOG</option>
                <option value="maintenance">Maintenance</option>
              </select>
            </div>
            <div className="fld">
              <label htmlFor="a-backup">Default backup</label>
              <select id="a-backup" className="sel" value={form.backup} onChange={(ev) => set({ backup: ev.target.value })}>
                <option value="">None</option>
                {fleet
                  .filter((a) => a.id !== aircraft?.id)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.registration}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <div className="info">
            <span>Empty fields show a warning in the registry and appear as &quot;Missing&quot; on checklists. Setting the status to AOG or Maintenance blocks the aircraft from now onward and runs rule R3.</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid var(--line)", background: "var(--panel2)" }}>
          <button className="btn pri" onClick={save}>
            Save aircraft
          </button>
          <button className="btn" onClick={close}>
            Cancel
          </button>
        </div>
      </SheetContent>
    </Sheet>
    </>
  );
}
