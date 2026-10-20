"use client";

import { memo } from "react";
import { COUNTRY_NAMES, iataOf } from "@/lib/airports";
import type { Derived } from "@/lib/derived";
import { blockMinutes, dayPlus, dayTag, fullFlight, localArrival } from "@/lib/legs";
import { MIN, fmtDow, fmtDuration, fmtHHMM, ms, utcDate } from "@/lib/time";
import { airportOffset } from "@/lib/tz";
import type { Leg } from "@/lib/types";

const PERMIT_TXT: Record<string, { cls: string; txt: string } | undefined> = {
  obtained: { cls: "b b-ok", txt: "Obtained" },
  pending: { cls: "b b-pe", txt: "Pending" },
  missing: { cls: "b b-er", txt: "No record" },
};

export function tooltipLines(leg: Leg, d: Derived, reg: string): string[] {
  const { idx } = d;
  const dep = idx.byIcao.get(leg.depIcao);
  const arr = idx.byIcao.get(leg.arrIcao);
  const lines = [
    `${fullFlight(leg)} on ${reg}${leg.status === "cancelled" ? " (cancelled, CNL)" : ""}`,
    `${dep?.name ?? leg.depIcao} to ${arr?.name ?? leg.arrIcao}`,
    `ETD ${fmtHHMM(leg.etdUtc)}Z, ETA ${fmtHHMM(leg.etaUtc)}Z${dayPlus(leg) ? " (+1)" : ""}, block ${fmtDuration(blockMinutes(leg))}`,
  ];
  const la = localArrival(leg, idx);
  if (la) {
    const sign = la.offsetMinutes < 0 ? "-" : "+";
    const off = Math.abs(la.offsetMinutes);
    lines.push(`Lands ${fmtDow(la.ms)} ${fmtHHMM(la.ms)} local (UTC${sign}${Math.floor(off / 60)}${off % 60 ? ":" + String(off % 60).padStart(2, "0") : ""})`);
  }
  for (const p of d.permitsByLeg.get(leg.id) ?? []) lines.push(`${COUNTRY_NAMES[p.countryCode]} ${p.type}: ${p.status}`);
  if (leg.status !== "cancelled") for (const i of d.issuesByLeg.get(leg.id) ?? []) lines.push(`${i.severity === "error" ? "Error" : "Warning"}: ${i.message}`);
  if (leg.notes) lines.push(`Note: ${leg.notes}`);
  return lines;
}

interface Props {
  leg: Leg;
  d: Derived;
  selected: boolean;
  highlighted: boolean;
  through: boolean;
  onOpen: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onToggleCancel: (id: string, cancel: boolean) => void;
  reg: string;
  /** Show local times at each station instead of UTC. */
  local?: boolean;
}

export const LegChip = memo(function LegChip({ leg, d, selected, highlighted, through, onOpen, onToggleSelect, onToggleCancel, reg, local }: Props) {
  const cancelled = leg.status === "cancelled";
  const issues = cancelled ? [] : d.issuesByLeg.get(leg.id) ?? [];
  const plus = dayPlus(leg);
  const tag = dayTag(leg, d.idx);
  const ps = PERMIT_TXT[d.permitState.get(leg.id) ?? "none"];
  const cls = ["leg", cancelled ? "cnl" : "", selected ? "sel" : "", issues.length ? "iss" : "", through ? "thru" : "", highlighted ? "hl" : ""].filter(Boolean).join(" ");
  const dep = iataOf(leg.depIcao, d.idx);
  const arr = iataOf(leg.arrIcao, d.idx);
  // Local mode: departure at the departure station's time, arrival at the arrival station's, each with its own offset on that date.
  const depA = d.idx.byIcao.get(leg.depIcao);
  const arrA = d.idx.byIcao.get(leg.arrIcao);
  const depLocal = local && depA && !depA.provisional ? ms(leg.etdUtc) + airportOffset(depA, ms(leg.etdUtc)) * MIN : null;
  const arrLocal = local && arrA && !arrA.provisional ? ms(leg.etaUtc) + airportOffset(arrA, ms(leg.etaUtc)) * MIN : null;
  const showLocal = depLocal !== null && arrLocal !== null;
  const plusShown = showLocal ? (utcDate(arrLocal) > utcDate(depLocal) ? 1 : 0) : plus;

  return (
    <div
      className={cls}
      id={`leg-${leg.id}`}
      data-leg-id={leg.id}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", leg.id);
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      <button className="legmain" onClick={() => onOpen(leg.id)}>
        <span className="r1">
          <span className="fn mono strike">{fullFlight(leg)}</span>
          {cancelled && <span className="b b-cn">CNL</span>}
          {through && <span className="b b-in">Through</span>}
          {issues.length > 0 && (
            <span className={`b ${issues.some((i) => i.severity === "error") ? "b-er" : "b-wa"}`} title={issues.map((i) => i.message).join("\n")}>
              {issues.some((i) => i.severity === "error") ? "Error" : "Warning"}
            </span>
          )}
        </span>
        <span className="r2 mono strike pair">
          {dep} &gt; {arr}
        </span>
        <span className="r2 mono strike">
          {showLocal ? `${fmtHHMM(depLocal)} to ${fmtHHMM(arrLocal)}` : `${fmtHHMM(leg.etdUtc)} to ${fmtHHMM(leg.etaUtc)}`}
          {showLocal && <span className="lt"> LT</span>}
          {plusShown === 1 && <span className="plus1">(+1)</span>}
        </span>
        <span className="r3">
          {tag !== null && <span className="lt mono">DAY {tag} LT</span>}
          {ps && !cancelled && <span className={ps.cls}>{ps.txt}</span>}
        </span>
      </button>
      <span className="legact">
        <input
          type="checkbox"
          checked={selected}
          disabled={cancelled}
          title={cancelled ? "Cancelled legs cannot be added to a checklist" : undefined}
          onChange={() => onToggleSelect(leg.id)}
          aria-label={`Select ${fullFlight(leg)} for checklist`}
        />
      </span>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="btn sm" style={{ height: 22, padding: "0 6px", fontSize: 12 }} onClick={() => onToggleCancel(leg.id, !cancelled)} aria-label={`${cancelled ? "Restore" : "CNL"} ${fullFlight(leg)}`}>
          {cancelled ? "Restore" : "CNL"}
        </button>
      </div>
      <div className="tip" role="tooltip">
        {tooltipLines(leg, d, reg).map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  );
});
