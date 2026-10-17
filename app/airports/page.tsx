"use client";

import { useState } from "react";
import { COUNTRY_NAMES, formatOffset, searchAirports } from "@/lib/airports";
import { useDemo } from "@/lib/store";
import { ListGate } from "@/components/common/ListGate";

export default function Page() {
  const airports = useDemo((s) => s.data.airports);
  const [q, setQ] = useState("");
  const rows = searchAirports(airports, q);

  return (
    <>
      <div className="head">
        <div>
          <h1>Airport directory</h1>
          <p>Time zones and UTC offsets used for local day tags (LT). The directory is read only in the demo.</p>
        </div>
        <span className="grow" />
        <label className="search" style={{ flex: "0 1 300px" }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ICAO, IATA or airport" aria-label="Search airports" />
        </label>
      </div>
      <ListGate>
        <section className="card scroll" aria-label="Airports">
          {rows.length > 0 && (
            <table className="tbl">
              <thead>
                <tr>
                  {["IATA", "ICAO", "Airport", "Country", "UTC offset"].map((h) => (
                    <th key={h} scope="col">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.icao}>
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
                    <td className="mono">{a.provisional ? "n/a" : formatOffset(a.utcOffsetMinutes)}</td>
                  </tr>
                ))}
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
      </ListGate>
    </>
  );
}
