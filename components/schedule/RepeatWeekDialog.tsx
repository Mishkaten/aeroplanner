"use client";

import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MAX_REPEAT_WEEKS, planRepeatWeek, type RepeatOptions } from "@/lib/repeat";
import { mondayOf } from "@/lib/schedule";
import { useDemo } from "@/lib/store";
import { addDaysIso } from "@/lib/time";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A date in the week to copy by default: the first week on screen. */
  defaultWeek: string;
}

export function RepeatWeekDialog({ open, onOpenChange, defaultWeek }: Props) {
  const data = useDemo((s) => s.data);
  const [week, setWeek] = useState(defaultWeek);
  const [weeks, setWeeks] = useState("4");
  const [basis, setBasis] = useState<RepeatOptions["basis"]>("utc");
  const [aircraft, setAircraft] = useState("");
  const [cancelled, setCancelled] = useState(false);
  const [permits, setPermits] = useState(true);

  const n = Number(weeks);
  const weeksOk = Number.isInteger(n) && n >= 1 && n <= MAX_REPEAT_WEEKS;
  const weekOk = /^\d{4}-\d{2}-\d{2}$/.test(week) && !Number.isNaN(Date.parse(week));
  const monday = weekOk ? mondayOf(week) : null;

  const plan = useMemo(
    () => (weekOk && weeksOk ? planRepeatWeek(data, { week, weeks: n, basis, includeCancelled: cancelled, permits, aircraftId: aircraft || null }) : null),
    [data, week, n, basis, cancelled, permits, aircraft, weekOk, weeksOk],
  );

  const apply = () => {
    if (!plan || !plan.patch.length) return;
    useDemo.getState().commit(plan.patch, `${plan.inserted} legs added by repeating the week of ${monday}`);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]" style={{ maxHeight: "90vh", overflowY: "auto" }}>
        <DialogHeader>
          <DialogTitle>Repeat a week</DialogTitle>
          <DialogDescription>Copies the legs of one week onto the weeks after it, as ordinary legs you can edit one by one. Days that already have the same leg are skipped, so you can run it again safely.</DialogDescription>
        </DialogHeader>

        <div className="fgrid">
          <div className="fld">
            <label htmlFor="rw-week">Copy the week of</label>
            <input id="rw-week" type="date" className="inp mono" value={week} onChange={(e) => setWeek(e.target.value)} aria-invalid={!weekOk} />
            <span className="hint">{monday ? `Monday ${monday} to Sunday ${addDaysIso(monday, 6)}` : "Enter a date"}</span>
          </div>
          <div className="fld">
            <label htmlFor="rw-n">Repeat for how many weeks</label>
            <input id="rw-n" className="inp mono" inputMode="numeric" value={weeks} onChange={(e) => setWeeks(e.target.value)} aria-invalid={!weeksOk} />
            <span className="err-t">{weeksOk ? "" : `Enter 1 to ${MAX_REPEAT_WEEKS}`}</span>
          </div>
          <div className="fld">
            <label htmlFor="rw-basis">Keep the time</label>
            <select id="rw-basis" className="sel" value={basis} onChange={(e) => setBasis(e.target.value as RepeatOptions["basis"])}>
              <option value="utc">The same in UTC</option>
              <option value="local">The same local time at the departure station (follows daylight saving)</option>
            </select>
          </div>
          <div className="fld">
            <label htmlFor="rw-ac">Which aircraft</label>
            <select id="rw-ac" className="sel" value={aircraft} onChange={(e) => setAircraft(e.target.value)}>
              <option value="">All aircraft</option>
              {data.aircraft.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.registration}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={permits} onChange={(e) => setPermits(e.target.checked)} />
          Add the same permit rows to the copies, as pending
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={cancelled} onChange={(e) => setCancelled(e.target.checked)} />
          Also copy cancelled legs (the copies are planned, not cancelled)
        </label>

        <div className="card cardb" aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {!plan ? (
            <b>Fix the highlighted fields to see what will be added.</b>
          ) : plan.sourceLegs === 0 ? (
            <b>That week has no legs to copy.</b>
          ) : (
            <>
              <b>
                {plan.inserted} legs will be added
                {plan.firstDate && ` between ${plan.firstDate} and ${plan.lastDate}`}
              </b>
              <span style={{ fontSize: 13 }}>
                {plan.sourceLegs} legs in the week
                {plan.existing > 0 && `, ${plan.existing} copies skipped because the leg already exists on that day`}.
              </span>
              <span style={{ fontSize: 13 }}>
                {plan.newIssues.length === 0 ? "No new issues." : <b>{plan.newIssues.length} new issues:</b>}
                {plan.clearedIssues > 0 && ` ${plan.clearedIssues} existing issues are cleared.`}
              </span>
              {plan.newIssues.slice(0, 4).map((m) => (
                <span key={m} style={{ fontSize: 12 }}>
                  {m}
                </span>
              ))}
              {plan.warnings.slice(0, 3).map((m) => (
                <span key={m} style={{ fontSize: 12 }}>
                  {m}
                </span>
              ))}
            </>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button className="btn pri" disabled={!plan || plan.patch.length === 0} onClick={apply}>
            Add {plan?.inserted ?? 0} legs
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
