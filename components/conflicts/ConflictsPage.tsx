"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { derive } from "@/lib/derived";
import { useDemo } from "@/lib/store";
import { useUi } from "@/lib/ui-store";
import { RULES, RULE_TYPE_LABEL, TYPE_FILTERS } from "@/lib/rules";
import { fmtDow, fmtDowTime } from "@/lib/time";
import { ListGate } from "@/components/common/ListGate";
import { FixButtons, SeverityBadge } from "@/components/common/IssueParts";
import { useGoToLeg } from "@/components/common/useGoToLeg";

export function ConflictsPage() {
  const router = useRouter();
  const data = useDemo((s) => s.data);
  const d = derive(data);
  const goTo = useGoToLeg();
  const [sev, setSev] = useState("all");
  const [type, setType] = useState("all");
  const [ac, setAc] = useState("all");

  const rulesOf = TYPE_FILTERS.find((t) => t.value === type)?.rules ?? [];
  const rows = d.issues.filter(
    (i) => (sev === "all" || i.severity === sev) && (type === "all" || rulesOf.includes(i.ruleId)) && (ac === "all" || i.aircraftId === ac),
  );
  const open = d.issues.length;

  // Deliberately not flagged: the earliest hit of each kind (through flights repeat weekly).
  const seen = new Set<string>();
  const exemptions = d.exemptions.filter((e) => {
    if (seen.has(e.kind)) return false;
    seen.add(e.kind);
    return true;
  });

  const resetDemo = () => useUi.getState().setResetOpen(true);

  return (
    <>
      <div className="head">
        <div>
          <h1>Conflicts and validation</h1>
          <p>Every rule runs on every edit. Fixes apply in one click and the list updates at once.</p>
        </div>
        <span className="grow" />
        <span className="b b-in" aria-live="polite">
          {open} open
        </span>
      </div>

      <ListGate>
        <div className="fbar">
          <label>
            Severity{" "}
            <select className="sel" value={sev} onChange={(e) => setSev(e.target.value)}>
              <option value="all">Errors and warnings</option>
              <option value="error">Errors</option>
              <option value="warning">Warnings</option>
            </select>
          </label>
          <label>
            Type{" "}
            <select className="sel" value={type} onChange={(e) => setType(e.target.value)}>
              {TYPE_FILTERS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Aircraft{" "}
            <select className="sel" value={ac} onChange={(e) => setAc(e.target.value)}>
              <option value="all">All aircraft</option>
              {data.aircraft.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.registration}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn sm"
            disabled={sev === "all" && type === "all" && ac === "all"}
            onClick={() => {
              setSev("all");
              setType("all");
              setAc("all");
            }}
          >
            Clear filters
          </button>
        </div>

        <section className="card" aria-label="Open issues">
          {rows.length > 0 && (
            <div className="scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th scope="col">Severity</th>
                    <th scope="col">Type</th>
                    <th scope="col">Aircraft</th>
                    <th scope="col">Date and time (UTC)</th>
                    <th scope="col">Issue and one-click fix</th>
                    <th scope="col">
                      <span className="sr-only">Go to flight</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((i) => (
                    <tr key={i.id} style={{ verticalAlign: "top" }}>
                      <td>
                        <SeverityBadge severity={i.severity} />
                      </td>
                      <td>{RULE_TYPE_LABEL[i.ruleId]}</td>
                      <td className="mono">{i.aircraftId ? d.aircraftById.get(i.aircraftId)?.registration ?? i.aircraftId : "-"}</td>
                      <td className="mono">{fmtDowTime(i.whenUtc)}</td>
                      <td style={{ maxWidth: 560 }}>
                        <div>{i.message}</div>
                        <FixButtons fixes={i.fixes} />
                      </td>
                      <td>
                        <button className="btn sm" onClick={() => goTo(i.legIds[0], i.ruleId === "R3" ? "gantt" : undefined)}>
                          Go to flight
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rows.length === 0 && open === 0 && (
            <div className="empty">
              <span className="b b-ok">Clear</span>
              <b>No conflicts in this view</b>
              <span>Restore the demo data to see the seeded problems again.</span>
              <button className="btn" onClick={resetDemo}>
                Reset demo data
              </button>
            </div>
          )}
          {rows.length === 0 && open > 0 && (
            <div className="empty">
              <b>No conflicts in this view</b>
              <span>Try another severity, type or aircraft.</span>
              <button
                className="btn"
                onClick={() => {
                  setSev("all");
                  setType("all");
                  setAc("all");
                }}
              >
                Clear filters
              </button>
            </div>
          )}
        </section>

        <div className="cols2">
          <section className="card" aria-labelledby="rules-h">
            <div className="cardh">
              <h3 id="rules-h">Rules checked</h3>
            </div>
            <div className="cardb" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {RULES.map((r) => (
                <div key={r.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span className={`b ${r.severity === "error" ? "b-er" : r.severity === "none" ? "b-nt" : "b-wa"}`}>{r.id}</span>
                  <div>
                    <b>{r.title}</b>
                    <div className="hint">{r.definition}</div>
                    <div>Fix: {r.fix}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className="card" aria-labelledby="nf-h">
            <div className="cardh">
              <h3 id="nf-h">Deliberately not flagged</h3>
            </div>
            <div className="cardb" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {exemptions.map((e) => (
                <div key={e.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span className="b b-nt">Not flagged</span>
                  <div style={{ flex: 1 }}>
                    {e.kind === "parallel" ? (
                      <>
                        <b className="mono">{e.flight}</b> and <b className="mono">{e.flight}D</b>, {fmtDow(e.dateUtc)}
                      </>
                    ) : (
                      <>
                        <b className="mono">{e.flight}</b> {e.kind === "through" ? "Through flight" : "Chain with aircraft change"}, {fmtDow(e.dateUtc)}
                      </>
                    )}
                    <div className="hint">
                      {e.kind === "through" && `${e.text} Consecutive legs of one number are grouped with a double bar on the Schedule and never raise a conflict.`}
                      {e.kind === "parallel" && `${e.text} The D suffix is part of the full number, so the two never share a group.`}
                      {e.kind === "chain" && e.text}
                    </div>
                    <button className="btn sm" style={{ marginTop: 6 }} onClick={() => goTo(e.legIds[0])}>
                      Go to flight
                    </button>
                  </div>
                </div>
              ))}
              {exemptions.length === 0 && <span className="hint">No exemptions were used in the current schedule.</span>}
              <button className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => router.push("/schedule/")}>
                Open Schedule
              </button>
            </div>
          </section>
        </div>
      </ListGate>
    </>
  );
}
