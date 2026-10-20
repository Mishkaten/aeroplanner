"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { derive } from "@/lib/derived";
import { toast } from "sonner";
import { daysBetween, filtersActive, legMatches, planMove, rangeLabel, resolveRange } from "@/lib/schedule";
import { fullFlight, isActive } from "@/lib/legs";
import { useDemo, liveSelection } from "@/lib/store";
import { useUi, type ScheduleFilters } from "@/lib/ui-store";
import { ms, dateMs, DAY, fmtDow } from "@/lib/time";
import { ListGate } from "@/components/common/ListGate";
import { BulkEditDialog } from "./BulkEditDialog";
import { activeVersion } from "@/lib/versions";
import { ExportDialog } from "./ExportDialog";
import { TableView } from "./TableView";
import { GanttView } from "./GanttView";

const TYPES = ["B737-800SF", "B737-800BCF", "B767-300ER"];

export function SchedulePage() {
  const router = useRouter();
  const data = useDemo((s) => s.data);
  const range = useDemo((s) => s.range);
  const layout = useDemo((s) => s.layout);
  const calendar = useDemo((s) => s.calendar);
  const timeMode = useDemo((s) => s.timeMode);
  const selection = useDemo((s) => s.selection);
  const filters = useUi((s) => s.filters);
  const focusId = useUi((s) => s.focusLegId);
  const focusNonce = useUi((s) => s.focusNonce);
  const d = derive(data);
  const [exportOpen, setExportOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  const today = d.clock.slice(0, 10);
  const resolved = useMemo(() => resolveRange(range, data.legs, today), [range, data.legs, today]);
  const days = useMemo(() => daysBetween(resolved), [resolved]);
  const dayStart = dateMs(days[0]);
  const dayEnd = dateMs(days[days.length - 1]) + DAY;

  const typeOf = useCallback((id: string) => d.aircraftById.get(id)?.type, [d]);
  const legs = useMemo(
    () => data.legs.filter((l) => ms(l.etdUtc) >= dayStart && ms(l.etdUtc) < dayEnd && legMatches(l, filters, d, typeOf)),
    [data.legs, dayStart, dayEnd, filters, d, typeOf],
  );
  const activeCount = legs.filter(isActive).length;
  const selected = useMemo(() => new Set(liveSelection(selection, data)), [selection, data]);
  const stations = useMemo(() => data.airports.filter((a) => !a.provisional && a.icao !== data.company.baseIcao), [data]);

  const set = useUi.getState().setFilters;
  const f = (k: keyof ScheduleFilters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => set({ [k]: e.target.value } as Partial<ScheduleFilters>);
  const open = useCallback((id: string) => useUi.getState().openLeg(id), []);
  const toggleSel = useCallback((id: string) => useDemo.getState().toggleSelect(id), []);
  const toggleCnl = useCallback((id: string, cancel: boolean) => useDemo.getState().setLegStatus(id, cancel ? "cancelled" : "planned"), []);

  const move = useCallback((legId: string, aircraftId: string, date: string) => {
    const st = useDemo.getState().data;
    const leg = st.legs.find((l) => l.id === legId);
    if (!leg) return;
    const plan = planMove(st, leg, aircraftId, date);
    if (!plan.ok) {
      toast.error(plan.message);
      return;
    }
    const reg = st.aircraft.find((a) => a.id === aircraftId)?.registration ?? aircraftId;
    useDemo.getState().commit([{ op: "set", coll: "legs", id: legId, value: plan.value }], `${fullFlight(leg)} moved to ${reg}, ${fmtDow(date)}`);
  }, []);

  const tabs = [{ id: "all", label: "All aircraft" }, ...data.aircraft.map((a) => ({ id: a.id, label: a.registration }))];

  return (
    <>
      <div className="head">
        <div>
          <h1>Schedule</h1>
          <p>
            {activeCount} active {activeCount === 1 ? "leg" : "legs"} in {rangeLabel(resolved)}. Every aircraft header comes from the Fleet registry.
          </p>
        </div>
        <span className="grow" />
        {data.versions.length > 1 && (
          <label className="hint" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            Version
            <select className="sel" value={activeVersion(data).id} onChange={(e) => useDemo.getState().switchVersion(e.target.value)} aria-label="Schedule version">
              {data.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.live ? " (live)" : " (draft)"}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="seg" role="group" aria-label="Layout">
          <button aria-pressed={layout === "table"} onClick={() => useDemo.getState().setLayout("table")}>
            Table
          </button>
          <button aria-pressed={layout === "gantt"} onClick={() => useDemo.getState().setLayout("gantt")}>
            Gantt
          </button>
        </div>
        <div className="seg" role="group" aria-label="Times">
          <button aria-pressed={timeMode === "utc"} onClick={() => useDemo.getState().setTimeMode("utc")}>
            UTC
          </button>
          <button aria-pressed={timeMode === "local"} onClick={() => useDemo.getState().setTimeMode("local")} title="Departure at the departure station, arrival at the arrival station, with daylight saving">
            Local
          </button>
        </div>
        <div className="seg" role="group" aria-label="Calendar format">
          <button aria-pressed={calendar === "dates"} onClick={() => useDemo.getState().setCalendar("dates")}>
            Dates
          </button>
          <button aria-pressed={calendar === "weekday"} onClick={() => useDemo.getState().setCalendar("weekday")}>
            Days + dates + ISO weekday
          </button>
        </div>
        <button className="btn" onClick={() => setBulkOpen(true)} disabled={data.legs.length === 0}>
          Bulk edit
        </button>
        <button className="btn" onClick={() => setExportOpen(true)} disabled={data.legs.length === 0}>
          Export
        </button>
        <button className="btn pri" onClick={() => useUi.getState().openNew()}>
          + Add leg <span className="kbd">N</span>
        </button>
      </div>
      <BulkEditDialog open={bulkOpen} onOpenChange={setBulkOpen} shown={legs} selected={data.legs.filter((l) => selected.has(l.id))} />
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} shown={legs} selected={data.legs.filter((l) => selected.has(l.id))} />

      <ListGate>
        <div className="tabs" role="tablist" aria-label="Aircraft">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={filters.tab === t.id} onClick={() => set({ tab: t.id })}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="fbar">
          <label>
            Type{" "}
            <select className="sel" value={filters.type} onChange={f("type")}>
              <option value="all">All types</option>
              {TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            Station{" "}
            <select className="sel" value={filters.station} onChange={f("station")}>
              <option value="all">All stations</option>
              {stations.map((a) => (
                <option key={a.icao} value={a.icao}>
                  {a.icao}/{a.iata}
                </option>
              ))}
            </select>
          </label>
          <label>
            Flight{" "}
            <input className="inp mono" style={{ width: 110 }} value={filters.flight} onChange={f("flight")} placeholder="PHC5" />
          </label>
          <label>
            Status{" "}
            <select className="sel" value={filters.status} onChange={f("status")}>
              <option value="all">Any status</option>
              <option value="issue">Has an issue</option>
              <option value="pending">Permit pending or missing</option>
              <option value="obtained">Permits obtained</option>
              <option value="cnl">Cancelled</option>
            </select>
          </label>
          <button className="btn sm" onClick={() => useUi.getState().clearFilters()} disabled={!filtersActive(filters)}>
            Clear filters
          </button>
        </div>

        {selected.size > 0 && (
          <div className="info" style={{ alignItems: "center" }}>
            <b>
              {selected.size} {selected.size === 1 ? "leg" : "legs"} selected
            </b>
            <span className="grow" />
            <button className="btn sm" onClick={() => useDemo.getState().clearSelection()}>
              Clear
            </button>
            <button className="btn sm pri" onClick={() => router.push("/checklist/")}>
              Open checklist preview
            </button>
          </div>
        )}

        {legs.length === 0 ? (
          <div className="card empty">
            <b>No legs match these filters</b>
            <span>{data.legs.length === 0 ? "The schedule is empty. Import your Excel sheet or add a leg." : "Widen the date range or clear the filters."}</span>
            {data.legs.length === 0 ? (
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn pri" onClick={() => router.push("/import/")}>
                  Import from Excel
                </button>
                <button className="btn" onClick={() => useUi.getState().openNew()}>
                  + Add leg
                </button>
              </div>
            ) : (
              <button className="btn pri" onClick={() => useUi.getState().clearFilters()}>
                Clear filters
              </button>
            )}
          </div>
        ) : layout === "table" ? (
          <TableView
            state={data}
            d={d}
            days={days}
            legs={legs}
            calendar={calendar}
            local={timeMode === "local"}
            selected={selected}
            focusId={focusId}
            focusNonce={focusNonce}
            onOpen={open}
            onToggleSelect={toggleSel}
            onToggleCancel={toggleCnl}
            onMove={move}
          />
        ) : (
          <GanttView state={data} d={d} days={days} legs={legs} calendar={calendar} focusId={focusId} focusNonce={focusNonce} onOpen={open} />
        )}
      </ListGate>
    </>
  );
}
