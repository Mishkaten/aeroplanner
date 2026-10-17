"use client";

import { useMemo } from "react";
import type { ChecklistModel } from "@/lib/checklist/model";
import { routeMapPng } from "@/lib/checklist/map";

/** The preview is the document that gets exported: it renders the same layout model as the PDF, Excel and Word files. */
export function ChecklistPreview({ model }: { model: ChecklistModel }) {
  const png = useMemo(() => routeMapPng(model.route), [model.route]);
  return (
    <article className="doc" aria-label="Checklist preview">
      <div style={{ display: "flex", gap: 14, alignItems: "center", borderBottom: "2px solid #14202E", paddingBottom: 10 }}>
        {model.header.logoDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={model.header.logoDataUrl} alt="Company logo" style={{ width: 44, height: 44, objectFit: "contain" }} />
        ) : (
          <div style={{ width: 44, height: 44, border: "1px dashed #8A94A0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#46525F", textAlign: "center" }}>LOGO</div>
        )}
        <div style={{ flex: 1 }}>
          <h2>{model.header.legalName}</h2>
          <div className="mono" style={{ fontSize: 12 }}>
            {model.header.idLine}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <b>{model.header.title}</b>
          <div className="mono" style={{ fontSize: 12 }}>
            {model.header.dateSpan}
          </div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: "#46525F" }}>{model.header.text}</div>

      <section aria-label="Aircraft">
        <h4>Aircraft</h4>
        <table>
          <thead>
            <tr>
              {["Role", "Registration", "Type", "Serial no.", "Year", "MTOW", "Payload"].map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.aircraft.map((a) => (
              <tr key={a.role + a.registration}>
                <td>{a.role}</td>
                <td className="mono">
                  <b>{a.registration}</b>
                </td>
                <td className="mono">{a.type}</td>
                <td className="mono">{a.serialNo}</td>
                <td className="mono">{a.year}</td>
                <td className="mono">{a.mtow}</td>
                <td className="mono">{a.payload}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-label="Route and legs">
        <h4>Route</h4>
        {png && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={png} alt={`Route map: ${model.route.legend.join(", ")}. ${model.route.note}`} style={{ width: "100%", maxWidth: 520, display: "block", marginBottom: 6 }} />
        )}
        <div style={{ fontSize: 11, color: "#46525F", marginBottom: 8 }}>{model.route.legend.join("      ")}</div>
        <table>
          <thead>
            <tr>
              {["Flight", "Aircraft", "Route", "Date", "ETD (UTC)", "ETA (UTC)", "Block", "Type"].map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.legs.map((l) => (
              <tr key={l.legId}>
                <td className="mono">
                  <b>{l.flight}</b>
                </td>
                <td className="mono">{l.aircraft}</td>
                <td className="mono">{l.route}</td>
                <td className="mono">{l.date}</td>
                <td className="mono">{l.etd}</td>
                <td className="mono">
                  {l.eta}
                  {l.etaPlus ? " (+1)" : ""}
                  {l.dayTag && <div style={{ fontSize: 10.5, color: "#46525F" }}>{l.dayTag}</div>}
                </td>
                <td className="mono">{l.block}</td>
                <td>{l.type}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-label="Permits per country">
        <h4>Permits per country</h4>
        <table>
          <thead>
            <tr>
              {["Country", "Permit", "Flight", "Number", "Status", "Valid"].map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.permits.length === 0 && (
              <tr>
                <td colSpan={6}>No permits required for the selected legs.</td>
              </tr>
            )}
            {model.permits.map((p, i) => (
              <tr key={i}>
                <td>{p.country}</td>
                <td>{p.permit}</td>
                <td className="mono">{p.flight}</td>
                <td className="mono">{p.number}</td>
                <td>{p.status}</td>
                <td className="mono">{p.valid}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-label="Special notes">
        <h4>Special notes</h4>
        {model.notes.map((n, i) => (
          <div key={i}>{n}</div>
        ))}
      </section>

      <div className="sig">
        <div>{model.signatures[0]}</div>
        <div>{model.signatures[1]}</div>
      </div>
      <div style={{ fontSize: 11, color: "#46525F" }}>
        {model.footer.text}
        <div>{model.footer.generated}</div>
      </div>
    </article>
  );
}
