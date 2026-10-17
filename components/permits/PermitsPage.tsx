"use client";

import { useState } from "react";
import { COUNTRY_NAMES, iataOf } from "@/lib/airports";
import { derive } from "@/lib/derived";
import { fullFlight } from "@/lib/legs";
import { useDemo } from "@/lib/store";
import type { PermitRow } from "@/lib/selectors";
import { fmtDowTime } from "@/lib/time";
import { ListGate } from "@/components/common/ListGate";
import { useGoToLeg } from "@/components/common/useGoToLeg";
import type { CountryCode, PermitStatus } from "@/lib/types";

const STATUS: Record<PermitStatus, { cls: string; txt: string }> = {
  obtained: { cls: "b b-ok", txt: "Obtained" },
  pending: { cls: "b b-pe", txt: "Pending" },
  cancelled: { cls: "b b-cn", txt: "Cancelled" },
};

export function PermitsPage() {
  const data = useDemo((s) => s.data);
  const d = derive(data);
  const goTo = useGoToLeg();
  const [country, setCountry] = useState<string>("all");
  const [status, setStatus] = useState<"all" | PermitStatus>("all");
  const [numbers, setNumbers] = useState<Record<string, string>>({});

  const ok = (r: PermitRow) => (country === "all" || r.permit.countryCode === country) && (status === "all" || r.permit.status === status);
  const rows = d.board.filter(ok);
  const pinned = d.urgent.filter(ok);

  const groups = new Map<CountryCode, PermitRow[]>();
  for (const r of rows) {
    const g = groups.get(r.permit.countryCode);
    if (g) g.push(r);
    else groups.set(r.permit.countryCode, [r]);
  }
  const sections = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || (COUNTRY_NAMES[a[0]] < COUNTRY_NAMES[b[0]] ? -1 : 1));
  const countries = [...new Set(d.board.map((r) => r.permit.countryCode))].sort((a, b) => (COUNTRY_NAMES[a] < COUNTRY_NAMES[b] ? -1 : 1));

  const route = (r: PermitRow) => `${iataOf(r.leg.depIcao, d.idx)} > ${iataOf(r.leg.arrIcao, d.idx)}`;
  const reg = (r: PermitRow) => d.aircraftById.get(r.leg.aircraftId)?.registration ?? r.leg.aircraftId;
  const act = (r: PermitRow) =>
    r.permit.status === "obtained" ? null : (
      <>
        <input
          className="inp mono"
          style={{ width: 130, height: 28 }}
          placeholder="Permit number"
          aria-label={`Permit number for ${fullFlight(r.leg)} ${COUNTRY_NAMES[r.permit.countryCode]} ${r.permit.type}`}
          value={numbers[r.permit.id] ?? ""}
          onChange={(e) => setNumbers((n) => ({ ...n, [r.permit.id]: e.target.value }))}
        />{" "}
        <button className="btn sm fix" onClick={() => useDemo.getState().setPermitStatus(r.permit.id, "obtained", numbers[r.permit.id])}>
          Mark obtained
        </button>
      </>
    );

  return (
    <>
      <div className="head">
        <div>
          <h1>Permits board</h1>
          <p>Overflight and landing permits grouped by country. Urgent items are pinned on top.</p>
        </div>
        <span className="grow" />
        <label>
          Country{" "}
          <select className="sel" value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="all">All countries</option>
            {countries.map((c) => (
              <option key={c} value={c}>
                {COUNTRY_NAMES[c]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ListGate>
        <div className="fbar">
          <div className="seg" role="group" aria-label="Status">
            {(["all", "pending", "obtained"] as const).map((s) => (
              <button key={s} aria-pressed={status === s} onClick={() => setStatus(s)}>
                {s === "all" ? "All statuses" : STATUS[s].txt}
              </button>
            ))}
          </div>
          <span className="hint" aria-live="polite">
            {rows.length} {rows.length === 1 ? "row" : "rows"}
            {" · "}
            {rows.filter((r) => r.permit.status === "obtained").length} obtained, {rows.filter((r) => r.permit.status === "pending").length} pending
          </span>
        </div>

        {pinned.length > 0 && (
          <section className="card" style={{ borderColor: "var(--urg-bg)" }} aria-labelledby="pin-h">
            <div className="cardh">
              <span className="b b-ur">Pinned</span>
              <h3 id="pin-h">Urgent, departing within 48 hours</h3>
            </div>
            <div className="scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    {["Country", "Permit", "Flight", "Departs (UTC)", "Aircraft", "Status"].map((h) => (
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
                  {pinned.map((r) => (
                    <tr key={r.permit.id}>
                      <td>
                        <b>{COUNTRY_NAMES[r.permit.countryCode]}</b>
                      </td>
                      <td style={{ textTransform: "capitalize" }}>{r.permit.type}</td>
                      <td className="mono">
                        {fullFlight(r.leg)} {route(r)}
                      </td>
                      <td className="mono">{fmtDowTime(r.leg.etdUtc)}</td>
                      <td className="mono">{reg(r)}</td>
                      <td>
                        <span className={STATUS[r.permit.status].cls}>{STATUS[r.permit.status].txt}</span>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {act(r)}{" "}
                        <button className="btn sm" onClick={() => goTo(r.leg.id)}>
                          Go to flight
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {sections.map(([code, list]) => (
          <section key={code} className="card" aria-label={COUNTRY_NAMES[code]}>
            <div className="cardh">
              <h3>{COUNTRY_NAMES[code]}</h3>
              <span className="b b-nt">{list.length} permits</span>
            </div>
            <div className="scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    {["Permit", "Number", "Flight", "Departs (UTC)", "Aircraft", "Status"].map((h) => (
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
                  {list.map((r) => (
                    <tr key={r.permit.id}>
                      <td style={{ textTransform: "capitalize" }}>{r.permit.type}</td>
                      <td className="mono">{r.permit.number ?? (r.permit.status === "obtained" ? "Not entered" : "-")}</td>
                      <td className="mono">
                        {fullFlight(r.leg)} {route(r)}
                      </td>
                      <td className="mono">{fmtDowTime(r.leg.etdUtc)}</td>
                      <td className="mono">{reg(r)}</td>
                      <td>
                        <span className={STATUS[r.permit.status].cls}>{STATUS[r.permit.status].txt}</span>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {act(r)}{" "}
                        <button className="btn sm" onClick={() => goTo(r.leg.id)}>
                          Go to flight
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}

        {rows.length === 0 && (
          <div className="card empty">
            <b>No permits match</b>
            <span>Try another status or country.</span>
            <button
              className="btn"
              onClick={() => {
                setCountry("all");
                setStatus("all");
              }}
            >
              Clear filters
            </button>
          </div>
        )}
      </ListGate>
    </>
  );
}
