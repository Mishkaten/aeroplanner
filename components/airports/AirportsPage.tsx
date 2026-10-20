"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { COUNTRY_NAMES, formatOffset, searchAirports } from "@/lib/airports";
import { effectiveClock } from "@/lib/clock";
import { airportOffset, isValidTz, observesDst } from "@/lib/tz";
import { COMMON_ZONES } from "@/lib/tzdata";
import { airportToForm, blankAirportForm, validateAirport, type AirportForm } from "@/lib/forms";
import { useDemo } from "@/lib/store";
import type { Airport } from "@/lib/types";
import { ListGate } from "@/components/common/ListGate";

export function AirportsPage() {
  const data = useDemo((s) => s.data);
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<Airport | "new" | null>(null);
  const rows = searchAirports(data.airports, q);
  const nowMs = Date.parse(effectiveClock(data));
  const nowYear = new Date(nowMs).getUTCFullYear();

  const usedBy = (a: Airport): string | null => {
    if (a.provisional) return "The placeholder airport is built in";
    if (data.legs.some((l) => l.depIcao === a.icao || l.arrIcao === a.icao)) return "Used by legs in the schedule";
    if (data.permitRules.some((r) => r.aIcao === a.icao || r.bIcao === a.icao)) return "Used by a permit rule";
    if (data.company.baseIcao === a.icao) return "It is the company base";
    return null;
  };

  return (
    <>
      <div className="head">
        <div>
          <h1>Airport directory</h1>
          <p>ICAO and IATA codes, country and time zone. The time zone gives the local time and the day tag (LT), and follows daylight saving. Add the stations your schedule uses.</p>
        </div>
        <span className="grow" />
        <label className="search" style={{ flex: "0 1 300px" }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ICAO, IATA or airport" aria-label="Search airports" />
        </label>
        <button className="btn pri" onClick={() => setEdit("new")}>
          + Add airport
        </button>
      </div>
      <ListGate>
        <section className="card scroll" aria-label="Airports">
          {rows.length > 0 && (
            <table className="tbl">
              <thead>
                <tr>
                  {["IATA", "ICAO", "Airport", "Country", "Time zone", "UTC offset now"].map((h) => (
                    <th key={h} scope="col">
                      {h}
                    </th>
                  ))}
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const why = usedBy(a);
                  return (
                    <tr key={a.id}>
                      <th scope="row" className="mono" style={{ textTransform: "none", letterSpacing: 0, fontSize: 14, color: "var(--ink)", background: "none" }}>
                        {a.iata}
                      </th>
                      <td className="mono">{a.icao}</td>
                      <td>
                        {a.name}
                        {a.provisional && (
                          <>
                            {" "}
                            <span className="b b-nt">Provisional (TBD)</span>{" "}
                            <small className="hint">Placeholder XXXX/XXX for ferry legs whose destination is not decided. It skips continuity and permit checks.</small>
                          </>
                        )}
                      </td>
                      <td>{COUNTRY_NAMES[a.countryCode]}</td>
                      <td className="mono" style={{ fontSize: 12 }}>{a.provisional ? "n/a" : isValidTz(a.tzId) ? a.tzId : "fixed offset"}</td>
                      <td className="mono">
                        {a.provisional ? (
                          "n/a"
                        ) : (
                          <>
                            {formatOffset(airportOffset(a, nowMs))}
                            {observesDst(a, nowYear) && <small className="hint"> daylight saving</small>}
                          </>
                        )}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {!a.provisional && (
                          <>
                            <button className="btn sm" onClick={() => setEdit(a)} aria-label={`Edit ${a.icao}`}>
                              Edit
                            </button>{" "}
                            <button
                              className="btn sm"
                              disabled={!!why}
                              title={why ?? undefined}
                              aria-label={`Delete ${a.icao}`}
                              onClick={() => useDemo.getState().commit([{ op: "remove", coll: "airports", id: a.id }], `${a.icao}/${a.iata} deleted`)}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {rows.length === 0 && (
            <div className="empty">
              <b>No airport matches</b>
              <span>Check the code or clear the search.</span>
              <button className="btn" onClick={() => setQ("")}>
                Clear search
              </button>
            </div>
          )}
        </section>
        <p className="hint">Stations with a time zone follow daylight saving automatically: local times, day tags and the SSIM offsets change on the right date. A station with no time zone keeps one fixed offset.</p>
      </ListGate>
      {edit && <AirportDialog key={edit === "new" ? "new" : edit.id} airport={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function AirportDialog({ airport, onClose }: { airport: Airport | null; onClose: () => void }) {
  const all = useDemo((s) => s.data.airports);
  const [form, setForm] = useState<AirportForm>(() => (airport ? airportToForm(airport) : blankAirportForm()));
  const [show, setShow] = useState(false);
  const result = validateAirport(form, all, airport?.id ?? null);
  const set = (p: Partial<AirportForm>) => setForm((f) => ({ ...f, ...p }));
  const err = (k: keyof AirportForm) => (show ? result.errors[k] : undefined);

  const save = () => {
    setShow(true);
    const v = result.value;
    if (!v) return;
    useDemo.getState().commit(
      airport ? [{ op: "set", coll: "airports", id: airport.id, value: { ...v } }] : [{ op: "insert", coll: "airports", value: v as never }],
      `${v.icao}/${v.iata} ${airport ? "saved" : "added"}`,
    );
    onClose();
  };

  const f = (k: keyof AirportForm, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="fld">
      <label htmlFor={`ap-${k}`}>{label}</label>
      <input id={`ap-${k}`} className="inp mono" value={form[k]} aria-invalid={!!err(k)} onChange={(e) => set({ [k]: e.target.value } as Partial<AirportForm>)} {...extra} />
      <span className="err-t">{err(k)}</span>
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{airport ? `Edit ${airport.icao}` : "Add airport"}</DialogTitle>
          <DialogDescription>Coordinates are optional and only used for the schematic route map on the checklist.</DialogDescription>
        </DialogHeader>
        <div className="fgrid">
          {f("icao", "ICAO (4 letters)", { maxLength: 4, readOnly: !!airport, onChange: (e) => set({ icao: e.target.value.toUpperCase() }) })}
          {f("iata", "IATA (3 letters)", { maxLength: 3, onChange: (e) => set({ iata: e.target.value.toUpperCase() }) })}
          <div style={{ gridColumn: "1 / -1" }}>{f("name", "Airport name")}</div>
          {f("countryCode", "Country code", { maxLength: 2, placeholder: "GE", onChange: (e) => set({ countryCode: e.target.value.toUpperCase() }) })}
          <div className="fld">
            <label htmlFor="ap-tzId">Time zone (IANA name)</label>
            <input id="ap-tzId" className="inp mono" list="ap-zones" value={form.tzId} aria-invalid={!!err("tzId")} placeholder="Europe/Belgrade" onChange={(e) => set({ tzId: e.target.value })} />
            <datalist id="ap-zones">
              {COMMON_ZONES.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
            <span className="err-t">{err("tzId")}</span>
          </div>
          {f("offset", "Fixed UTC offset (only without a time zone)", { placeholder: "+4", disabled: isValidTz(form.tzId.trim()) })}
          {f("lat", "Latitude", { inputMode: "decimal" })}
          {f("lon", "Longitude", { inputMode: "decimal" })}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn pri" onClick={save}>
            Save airport
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
