"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Derived } from "@/lib/derived";
import { blockKindLabel } from "@/lib/validate";
import { blocksOnDay, groupByDayAircraft } from "@/lib/schedule";
import { isActive } from "@/lib/legs";
import { fmtDate, fmtDow, isoWeekday, fmtHHMM, ms, dateMs, DAY } from "@/lib/time";
import type { DomainState, Leg } from "@/lib/types";
import { LegChip } from "./LegChip";

interface Props {
  state: DomainState;
  d: Derived;
  days: string[];
  legs: Leg[]; // already filtered
  calendar: "dates" | "weekday";
  selected: Set<string>;
  focusId: string | null;
  focusNonce: number;
  onOpen: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onToggleCancel: (id: string, cancel: boolean) => void;
  /** Drag a leg onto another aircraft column and/or day. Keyboard route: the leg drawer. */
  onMove: (legId: string, aircraftId: string, date: string) => void;
}

export function TableView({ state, d, days, legs, calendar, selected, focusId, focusNonce, onOpen, onToggleSelect, onToggleCancel, onMove }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hl, setHl] = useState<string | null>(null);

  const cols = useMemo(() => {
    const seen = new Set(legs.map((l) => l.aircraftId));
    return state.aircraft.filter((a) => seen.has(a.id) || legs.length === 0);
  }, [state.aircraft, legs]);
  const columns = cols.length ? cols : state.aircraft;

  const grouped = useMemo(() => groupByDayAircraft(legs), [legs]);
  const dayCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of legs) if (isActive(l)) m.set(l.etdUtc.slice(0, 10), (m.get(l.etdUtc.slice(0, 10)) ?? 0) + 1);
    return m;
  }, [legs]);

  // eslint-disable-next-line react-hooks/incompatible-library
  const virt = useVirtualizer({
    count: days.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 150,
    overscan: 5,
  });

  // Go to flight: scroll to the leg's day and highlight it for 2 s.
  useEffect(() => {
    if (!focusId) return;
    const leg = d.legById.get(focusId);
    if (!leg) return;
    const i = days.indexOf(leg.etdUtc.slice(0, 10));
    if (i >= 0) virt.scrollToIndex(i, { align: "center" });
    setHl(focusId);
    const t = setTimeout(() => setHl(null), 2000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  const items = virt.getVirtualItems();
  const padTop = items.length ? items[0].start : 0;
  const padBottom = items.length ? virt.getTotalSize() - items[items.length - 1].end : 0;

  return (
    <div ref={scrollRef} className="card" style={{ maxHeight: "calc(100vh - 330px)", minHeight: 320, overflow: "auto", overflowAnchor: "none" }} tabIndex={-1}>
      <table className="tbl" aria-label="Schedule by day and aircraft" style={{ minWidth: 150 + columns.length * 250 }}>
        <thead>
          <tr>
            <th scope="col" className="daycol" style={{ position: "sticky", top: 0, zIndex: 4 }}>
              Day
            </th>
            {columns.map((a) => (
              <th key={a.id} scope="col" style={{ position: "sticky", top: 0, zIndex: 3 }}>
                {a.registration}{" "}
                <span className="mono" style={{ fontWeight: 400, textTransform: "none" }}>
                  {a.type}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {padTop > 0 && (
            <tr aria-hidden="true">
              <td colSpan={columns.length + 1} style={{ height: padTop, padding: 0, border: 0 }} />
            </tr>
          )}
          {items.map((v) => {
            const date = days[v.index];
            const count = dayCounts.get(date) ?? 0;
            const head = calendar === "dates" ? fmtDate(date) : `${fmtDow(date)}, ${isoWeekday(date)}`;
            return (
              <tr key={date} data-index={v.index} ref={virt.measureElement}>
                <th scope="row" className="daycol" style={{ verticalAlign: "top", textTransform: "none", letterSpacing: 0, fontSize: 13 }}>
                  <b className="mono" style={{ color: "var(--ink)" }}>
                    {head}
                  </b>
                  <br />
                  <span className="b b-nt" style={{ marginTop: 4 }}>
                    {count} {count === 1 ? "flight" : "flights"}
                  </span>
                </th>
                {columns.map((a) => {
                  const cell = grouped.get(`${date}|${a.id}`) ?? [];
                  const blks = blocksOnDay(state, a.id, date);
                  return (
                    <td
                      key={a.id}
                      style={{ verticalAlign: "top" }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const id = e.dataTransfer.getData("text/plain");
                        if (id) onMove(id, a.id, date);
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 230 }}>
                        {blks.map((b) => {
                          const s = ms(b.startUtc);
                          const e = b.endUtc ? ms(b.endUtc) : null;
                          const ds = dateMs(date);
                          const from = s > ds ? `from ${fmtHHMM(s)}Z` : "";
                          const to = e !== null && e < ds + DAY ? `until ${fmtHHMM(e)}Z` : "";
                          return (
                            <div key={b.id} className="blk">
                              {blockKindLabel(b.kind).replace("in ", "")} {from} {to || (from ? "" : "all day")}
                            </div>
                          );
                        })}
                        {cell.map((l) => (
                          <LegChip
                            key={l.id}
                            leg={l}
                            d={d}
                            reg={a.registration}
                            selected={selected.has(l.id)}
                            highlighted={hl === l.id}
                            through={d.through.groupOf.has(l.id)}
                            onOpen={onOpen}
                            onToggleSelect={onToggleSelect}
                            onToggleCancel={onToggleCancel}
                          />
                        ))}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {padBottom > 0 && (
            <tr aria-hidden="true">
              <td colSpan={columns.length + 1} style={{ height: padBottom, padding: 0, border: 0 }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
