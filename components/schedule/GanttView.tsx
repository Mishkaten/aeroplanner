"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { Derived } from "@/lib/derived";
import { blockMinutes, fullFlight, isActive } from "@/lib/legs";
import { DAY, dateMs, fmtDate, fmtDow, fmtDowTime, fmtHHMM, isoWeekday, iso, ms, snapToMinutes } from "@/lib/time";
import { blockKindLabel, blockUntilText, effectiveBlocks, legHitsBlock } from "@/lib/validate";
import { useDemo } from "@/lib/store";
import type { DomainState, Leg } from "@/lib/types";
import { tooltipLines } from "./LegChip";

const DAY_W = 480; // px per UTC day, 20 px per hour
const LABEL_W = 130;
const ROW_H = 50;
const HOURS = [0, 6, 12, 18];

interface Props {
  state: DomainState;
  d: Derived;
  days: string[];
  legs: Leg[];
  calendar: "dates" | "weekday";
  focusId: string | null;
  focusNonce: number;
  onOpen: (id: string) => void;
}

interface DragState {
  id: string;
  dx: number;
  dy: number;
}

export function GanttView({ state, d, days, legs, calendar, focusId, focusNonce, onOpen }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [win, setWin] = useState({ from: 0, to: 2400 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hl, setHl] = useState<string | null>(null);
  const dragMeta = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const startMs = dateMs(days[0]);
  const width = days.length * DAY_W;
  const xOf = (t: number) => ((t - startMs) / DAY) * DAY_W;

  const aircraft = useMemo(() => {
    const only = new Set(legs.map((l) => l.aircraftId));
    return state.aircraft.filter((a) => only.has(a.id) || legs.length === 0);
  }, [state.aircraft, legs]);
  const lanes = aircraft.length ? aircraft : state.aircraft;

  const blocks = useMemo(() => effectiveBlocks(state), [state]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setWin({ from: el.scrollLeft - 600, to: el.scrollLeft + el.clientWidth + 600 });
  }, []);
  useEffect(() => {
    onScroll();
    window.addEventListener("resize", onScroll);
    return () => window.removeEventListener("resize", onScroll);
  }, [onScroll, days.length]);

  // Go to flight
  useEffect(() => {
    if (!focusId) return;
    const leg = d.legById.get(focusId);
    const el = scrollRef.current;
    if (!leg || !el) return;
    el.scrollTo({ left: Math.max(0, xOf(ms(leg.etdUtc)) - el.clientWidth / 2 + LABEL_W), behavior: "auto" });
    setHl(focusId);
    const t = setTimeout(() => setHl(null), 2000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  const laneBars = useMemo(() => {
    const out = new Map<string, { leg: Leg; x: number; w: number; row: number }[]>();
    for (const a of lanes) {
      const own = legs.filter((l) => l.aircraftId === a.id).sort((x, y) => ms(x.etdUtc) - ms(y.etdUtc));
      const rowEnd: number[] = [];
      const bars = own.map((l) => {
        const x = xOf(ms(l.etdUtc));
        const w = Math.max(18, (blockMinutes(l) / 1440) * DAY_W);
        let row = rowEnd.findIndex((end) => end <= x + 0.5);
        if (row < 0) {
          row = rowEnd.length;
          rowEnd.push(0);
        }
        rowEnd[row] = x + w;
        return { leg: l, x, w, row };
      });
      out.set(a.id, bars);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legs, lanes, startMs]);

  const finishDrag = (e: React.PointerEvent, leg: Leg) => {
    const meta = dragMeta.current;
    dragMeta.current = null;
    setDrag(null);
    if (!meta || !meta.moved) return;
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 0);

    const dx = e.clientX - meta.x;
    const newEtd = snapToMinutes(ms(leg.etdUtc) + (dx / DAY_W) * DAY, 5);
    const block = ms(leg.etaUtc) - ms(leg.etdUtc);
    const newEta = newEtd + block;

    // The lane under the pointer decides the aircraft.
    const hit = document.elementsFromPoint(e.clientX, e.clientY).find((el) => (el as HTMLElement).dataset?.lane) as HTMLElement | undefined;
    const aircraftId = hit?.dataset.lane ?? leg.aircraftId;
    const reg = d.aircraftById.get(aircraftId)?.registration ?? aircraftId;

    const clash = blocks.find((b) => b.aircraftId === aircraftId && legHitsBlock({ etdUtc: iso(newEtd), etaUtc: iso(newEta) }, b));
    if (clash) {
      const msg = `${reg} is ${blockKindLabel(clash.kind)} ${blockUntilText(clash)}`;
      toast.error(msg);
      useDemo.setState({}); // leg returns to its place (the drag offset is cleared)
      return;
    }
    if (newEtd === ms(leg.etdUtc) && aircraftId === leg.aircraftId) return;
    const value: Record<string, unknown> = { etdUtc: iso(newEtd), etaUtc: iso(newEta) };
    if (aircraftId !== leg.aircraftId) {
      value.aircraftId = aircraftId;
      value.backupAircraftId = d.aircraftById.get(aircraftId)?.defaultBackupId ?? null;
    }
    useDemo.getState().commit([{ op: "set", coll: "legs", id: leg.id, value }], `${fullFlight(leg)} moved to ${reg}, ${fmtDowTime(newEtd)}`);
  };

  return (
    <div>
      <div className="info" style={{ marginBottom: 8 }}>
        Drag a leg to another aircraft row or time (snaps to 5 minutes, block time is kept). Dropping onto a hatched maintenance or AOG block is refused. Press Enter on a leg to open it. The Table view holds the same data as a table.
      </div>
      <div ref={scrollRef} onScroll={onScroll} className="card" style={{ overflow: "auto", position: "relative" }} tabIndex={-1}>
        <div style={{ width: LABEL_W + width, position: "relative" }} role="group" aria-label="Gantt chart, one lane per aircraft">
          {/* header */}
          <div style={{ display: "flex", position: "sticky", top: 0, zIndex: 6, background: "var(--panel2)", borderBottom: "1px solid var(--line)" }}>
            <div style={{ width: LABEL_W, flex: "none", position: "sticky", left: 0, zIndex: 7, background: "var(--panel2)", padding: "6px 8px", fontWeight: 600, color: "var(--mut)" }}>Aircraft</div>
            <div style={{ display: "flex" }}>
              {days.map((date) => (
                <div key={date} style={{ width: DAY_W, flex: "none", borderLeft: "1px solid var(--line2)", padding: "6px 8px" }}>
                  <b className="mono" style={{ fontSize: 12 }}>
                    {calendar === "dates" ? fmtDate(date) : `${fmtDow(date)}, ${isoWeekday(date)}`}
                  </b>
                  <div className="mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--mut)", marginTop: 2 }}>
                    {HOURS.map((h) => (
                      <span key={h} style={{ width: DAY_W / 4 - 4 }}>
                        {String(h).padStart(2, "0")}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {lanes.map((a) => {
            const bars = laneBars.get(a.id) ?? [];
            const rows = Math.max(1, ...bars.map((b) => b.row + 1));
            const h = 14 + rows * ROW_H;
            return (
              <div key={a.id} style={{ display: "flex", borderBottom: "1px solid var(--line2)" }}>
                <div style={{ width: LABEL_W, flex: "none", position: "sticky", left: 0, zIndex: 5, background: "var(--panel)", padding: 8, fontWeight: 600 }}>
                  <span className="mono">{a.registration}</span>
                  <br />
                  <small style={{ color: "var(--mut)", fontWeight: 400 }}>{a.type}</small>
                </div>
                <div
                  data-lane={a.id}
                  style={{
                    position: "relative",
                    width,
                    height: h,
                    backgroundImage: "repeating-linear-gradient(90deg, transparent 0 479px, var(--line2) 479px 480px)",
                  }}
                >
                  {blocks
                    .filter((b) => b.aircraftId === a.id)
                    .map((b) => {
                      const x0 = Math.max(0, xOf(ms(b.startUtc)));
                      const x1 = Math.min(width, b.endUtc ? xOf(ms(b.endUtc)) : width);
                      if (x1 <= x0) return null;
                      return (
                        <div key={b.id} className="gblk" style={{ left: x0, width: x1 - x0, height: h - 12 }} title={b.note}>
                          {blockKindLabel(b.kind).replace("in ", "")} {fmtHHMM(b.startUtc)}Z {b.endUtc ? `to ${fmtDowTime(b.endUtc)}` : "open-ended"}
                        </div>
                      );
                    })}
                  {bars
                    .filter((b) => b.x + b.w >= win.from && b.x <= win.to)
                    .map(({ leg, x, w, row }) => {
                      const cancelled = !isActive(leg);
                      const issue = !cancelled && d.issuesByLeg.has(leg.id);
                      const dragging = drag?.id === leg.id;
                      const cls = ["gbar", cancelled ? "cnl" : "", issue ? "iss" : "", dragging ? "drag" : "", hl === leg.id ? "hl" : ""].filter(Boolean).join(" ");
                      return (
                        <button
                          key={leg.id}
                          className={cls}
                          style={{
                            left: x,
                            width: w,
                            top: 7 + row * ROW_H,
                            height: ROW_H - 6,
                            transform: dragging ? `translate(${drag!.dx}px, ${drag!.dy}px)` : undefined,
                          }}
                          onPointerDown={(e) => {
                            if (e.button !== 0) return;
                            e.currentTarget.setPointerCapture(e.pointerId);
                            dragMeta.current = { id: leg.id, x: e.clientX, y: e.clientY, moved: false };
                          }}
                          onPointerMove={(e) => {
                            const m = dragMeta.current;
                            if (!m || m.id !== leg.id) return;
                            const dx = e.clientX - m.x;
                            const dy = e.clientY - m.y;
                            if (!m.moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
                            m.moved = true;
                            setDrag({ id: leg.id, dx, dy });
                          }}
                          onPointerUp={(e) => finishDrag(e, leg)}
                          onPointerCancel={() => {
                            dragMeta.current = null;
                            setDrag(null);
                          }}
                          onClick={() => {
                            if (suppressClick.current) return;
                            onOpen(leg.id);
                          }}
                          aria-label={`${fullFlight(leg)} ${fmtHHMM(leg.etdUtc)} to ${fmtHHMM(leg.etaUtc)} on ${a.registration}${cancelled ? ", cancelled" : ""}${issue ? ", has an issue" : ""}. Press Enter to open.`}
                        >
                          <b style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{fullFlight(leg)}</b>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                            {d.idx.byIcao.get(leg.depIcao)?.iata}&gt;{d.idx.byIcao.get(leg.arrIcao)?.iata}
                          </span>
                          <div className="tip" role="tooltip" style={{ left: 0, whiteSpace: "normal" }}>
                            {tooltipLines(leg, d, a.registration).map((l, i) => (
                              <div key={i}>{l}</div>
                            ))}
                          </div>
                        </button>
                      );
                    })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
