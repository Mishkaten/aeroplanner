"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { derive } from "@/lib/derived";
import { useDemo } from "@/lib/store";
import { useTour } from "@/lib/tour";

/** Setup checklist for the testing site. Ticks itself from the workspace data. */
export function GettingStarted() {
  const data = useDemo((s) => s.data);
  const c = derive(data).counts;
  const co = data.company;
  const items = [
    { label: "Enter your airline", hint: "Company profile: name, ICAO and IATA codes, base airport", href: "/company", done: Boolean(co.legalName && co.icao) },
    { label: "Add your aircraft", hint: "Fleet registry, or let the Excel import read your fleet table", href: "/fleet", done: data.aircraft.length > 0 },
    { label: "Add permit rules", hint: "Which route needs which country permit", href: "/rules", done: data.permitRules.length > 0 },
    { label: "Import your schedule", hint: "Upload the Excel sheet and review the flagged lines", href: "/import", done: data.legs.length > 0 },
    { label: "Clear the conflicts", hint: "Go through the list or use the one-click fixes", href: "/conflicts", done: data.legs.length > 0 && c.openIssues === 0 },
    { label: "Mark a permit as obtained", hint: "Permits page: type the permit number", href: "/permits", done: data.permits.some((p) => p.status === "obtained") },
  ];
  const left = items.filter((i) => !i.done).length;

  return (
    <section id="getting-started" className="card" aria-labelledby="gs-h">
      <div className="cardh">
        <h3 id="gs-h">Getting started</h3>
        <span className="hint">{left === 0 ? "All done. Keep testing with your real data." : `${items.length - left} of ${items.length} done`}</span>
        <span className="grow" />
        <button className="btn sm" onClick={() => useTour.getState().start(0)}>
          Take the tour
        </button>
      </div>
      <ul className="cardb" style={{ listStyle: "none", margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((i) => (
          <li key={i.href} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              aria-hidden="true"
              style={{ width: 20, height: 20, borderRadius: 10, border: "1.5px solid var(--line)", display: "grid", placeItems: "center", background: i.done ? "var(--acc)" : "transparent", color: "#fff", flex: "none" }}
            >
              {i.done && <Check size={13} />}
            </span>
            <span>
              <Link href={i.href} prefetch={false} style={{ fontWeight: 600 }}>
                {i.label}
              </Link>
              <span className="sr-only">{i.done ? " (done)" : " (to do)"}</span>
              <br />
              <small className="hint">{i.hint}</small>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
