"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { derive } from "@/lib/derived";
import { mondayOf, resolveRange } from "@/lib/schedule";
import { useDemo } from "@/lib/store";
import { addDaysIso } from "@/lib/time";

/** The date range of the Schedule: previous and next week, two dates, and "This week". */
export function RangeControl() {
  const data = useDemo((s) => s.data);
  const range = useDemo((s) => s.range);
  const setRange = useDemo((s) => s.setRange);
  const today = derive(data).clock.slice(0, 10);
  const r = resolveRange(range, data.legs, today);
  const shift = (days: number) => setRange({ from: addDaysIso(r.from, days), to: addDaysIso(r.to, days) });
  const set = (from: string, to: string) => {
    if (!from || !to) return;
    setRange(from <= to ? { from, to } : { from: to, to: from });
  };
  return (
    <div className="fbar" style={{ gap: 4 }} role="group" aria-label="Date range">
      <button className="btn sm" style={{ padding: "0 6px" }} aria-label="Previous week" onClick={() => shift(-7)}>
        <ChevronLeft size={14} aria-hidden="true" />
      </button>
      <label className="sr-only" htmlFor="range-from">
        From date
      </label>
      <input id="range-from" type="date" className="inp mono" style={{ height: 28 }} value={r.from} onChange={(e) => set(e.target.value, r.to)} />
      <span aria-hidden="true">to</span>
      <label className="sr-only" htmlFor="range-to">
        To date
      </label>
      <input id="range-to" type="date" className="inp mono" style={{ height: 28 }} value={r.to} onChange={(e) => set(r.from, e.target.value)} />
      <button className="btn sm" style={{ padding: "0 6px" }} aria-label="Next week" onClick={() => shift(7)}>
        <ChevronRight size={14} aria-hidden="true" />
      </button>
      <button className="btn sm" onClick={() => setRange(null)} title={`Three weeks from ${mondayOf(today)}`}>
        This week
      </button>
    </div>
  );
}
