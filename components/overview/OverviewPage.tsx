"use client";

import { useRouter } from "next/navigation";
import { derive } from "@/lib/derived";
import { isDemoClock } from "@/lib/clock";
import { useDemo } from "@/lib/store";
import { fleetAvailability } from "@/lib/selectors";
import { RULE_TYPE_LABEL } from "@/lib/rules";
import { fmtDowTime, fmtDow, dateMs } from "@/lib/time";
import { SeverityBadge } from "@/components/common/IssueParts";
import { useGoToLeg } from "@/components/common/useGoToLeg";
import { UTCDate } from "@date-fns/utc";
import { format } from "date-fns";

const AVL: Record<string, { cls: string; short: string; full: string }> = {
  available: { cls: "", short: "Avail.", full: "Available" },
  maintenance: { cls: "m", short: "Maint.", full: "Maintenance" },
  aog: { cls: "a", short: "AOG", full: "AOG" },
};

export function OverviewPage() {
  const router = useRouter();
  const data = useDemo((s) => s.data);
  const d = derive(data);
  const goTo = useGoToLeg();
  const c = d.counts;
  const avail = fleetAvailability(data);
  const first = d.issues.slice(0, 6);
  const regOf = (id: string | null) => (id ? d.aircraftById.get(id)?.registration ?? id : "-");

  return (
    <>
      <div className="head">
        <div>
          <h1>Operations overview</h1>
          <p>
            {isDemoClock(data)
              ? "Week of 14 Sep 2026. Demo clock: Sun 13 Sep, 14:00Z."
              : `Now: ${fmtDowTime(d.clock)} (real clock, all times UTC).`}
          </p>
        </div>
      </div>

      <section className="kpis" aria-label="Key figures">
        <div className="kpi">
          <small>Active legs</small>
          <b className="mono">{c.active}</b>
          <small>{c.cancelled} cancelled, not counted</small>
        </div>
        <div className="kpi">
          <small>Flights in the next 7 days</small>
          <b className="mono">{c.next7Days}</b>
          <small>{isDemoClock(data) ? "from the demo clock" : "from now"}</small>
        </div>
        <div className={`kpi ${c.openIssues ? "bad" : ""}`}>
          <small>Open issues</small>
          <b className="mono">{c.openIssues}</b>
          <small>
            {c.errors} errors, {c.warnings} warnings
          </small>
        </div>
        <div className={`kpi ${c.urgentPermits ? "warn" : ""}`}>
          <small>Urgent permits</small>
          <b className="mono">{c.urgentPermits}</b>
          <small>rows departing within 48 h</small>
        </div>
      </section>

      <section className="card" aria-labelledby="att-h">
        <div className="cardh">
          <h3 id="att-h">Needs attention</h3>
          <span className="b b-in">{c.openIssues} open</span>
          <span className="grow" />
          <button className="btn sm" onClick={() => router.push("/conflicts/")}>
            Open Conflicts centre
          </button>
        </div>
        {first.length > 0 ? (
          <div className="scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Level</th>
                  <th scope="col">Type</th>
                  <th scope="col">Issue</th>
                  <th scope="col">Aircraft</th>
                  <th scope="col">When (UTC)</th>
                  <th scope="col">
                    <span className="sr-only">Go to flight</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {first.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <SeverityBadge severity={i.severity} />
                    </td>
                    <td>{RULE_TYPE_LABEL[i.ruleId]}</td>
                    <td style={{ maxWidth: 520 }}>{i.message}</td>
                    <td className="mono">{regOf(i.aircraftId)}</td>
                    <td className="mono">{fmtDowTime(i.whenUtc)}</td>
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
        ) : (
          <div className="empty">
            <b>All clear</b>
            <span>No open conflicts, urgent permits or continuity errors.</span>
          </div>
        )}
        {c.openIssues > 6 && (
          <div className="cardb" style={{ paddingTop: 8 }}>
            <button className="btn sm" onClick={() => router.push("/conflicts/")}>
              Show all {c.openIssues} issues
            </button>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="fleet-h">
        <div className="cardh">
          <h3 id="fleet-h">Fleet availability, next 14 days</h3>
          <span className="grow" />
          <span className="b b-ok">Available</span>
          <span className="b b-wa">Maintenance</span>
          <span className="b b-ur">AOG</span>
        </div>
        <div className="cardb" style={{ display: "flex", flexDirection: "column", gap: 6, overflowX: "auto" }}>
          <div className="avl" style={{ minWidth: 700 }} aria-hidden="true">
            <span />
            {avail[0]?.cells.map((cell) => (
              <small key={cell.date} className="mono">
                {format(new UTCDate(dateMs(cell.date)), "EEE d")}
              </small>
            ))}
          </div>
          {avail.map((r) => (
            <div key={r.aircraftId} className="avl" style={{ minWidth: 700 }} role="group" aria-label={`${r.registration} availability`}>
              <span className="mono" style={{ fontWeight: 600 }}>
                {r.registration}
              </span>
              {r.cells.map((cell) => {
                const a = AVL[cell.state];
                return (
                  <i key={cell.date} className={a.cls} title={`${fmtDow(cell.date)}: ${a.full}`}>
                    <span aria-hidden="true">{a.short}</span>
                    <span className="sr-only">
                      {fmtDow(cell.date)}: {a.full}
                    </span>
                  </i>
                );
              })}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
