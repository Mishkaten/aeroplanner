import { filterLegsForExport } from "./scope";
import { buildCsv, buildIcs, buildJson, buildPdf, buildXlsxGrid, buildXlsxList, type ExportInput } from "./formats";
import { buildSsim } from "./ssim";
import { buildRows } from "./rows";
import { activeVersion, isDraft } from "../versions";
import type { DomainState, Leg } from "../types";

export type ExportFormatId = "xlsx-grid" | "xlsx-list" | "csv" | "json" | "ssim" | "ics" | "pdf";

export interface FormatInfo {
  id: ExportFormatId;
  label: string;
  ext: string;
  mime: string;
  /** One line for the picker: what it is for. */
  hint: string;
}

export const EXPORT_FORMATS: FormatInfo[] = [
  { id: "xlsx-grid", label: "Excel season grid", ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", hint: "Our own layout: aircraft columns, one row per day. AeroPlanner imports it back." },
  { id: "xlsx-list", label: "Excel list", ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", hint: "One row per leg with local and UTC times. Sort, filter, pivot." },
  { id: "csv", label: "CSV", ext: "csv", mime: "text/csv", hint: "The same rows as the Excel list, for any tool that reads CSV." },
  { id: "ssim", label: "SSIM (Leon, DCS, PSS)", ext: "txt", mime: "text/plain", hint: "IATA schedule standard. Leon Sched imports it directly. Needs your IATA code." },
  { id: "ics", label: "Calendar (.ics)", ext: "ics", mime: "text/calendar", hint: "Outlook, Google Calendar, Apple Calendar. One event per leg." },
  { id: "pdf", label: "PDF", ext: "pdf", mime: "application/pdf", hint: "A printable list for the ops desk or a customer." },
  { id: "json", label: "JSON", ext: "json", mime: "application/json", hint: "For developers and other systems." },
];

export interface ExportOptions {
  format: ExportFormatId;
  /** Legs to export, already chosen by the caller (filtered, selected or all). */
  legs: Leg[];
  includeCancelled: boolean;
  createdAt: string;
}

export interface ExportResult {
  blob: Blob;
  filename: string;
  legCount: number;
  /** Things the user should know, such as legs an SSIM file cannot hold. */
  notes: string[];
}

export class ExportBlocked extends Error {}

export function exportFilename(state: DomainState, rows: { date: string }[], ext: string): string {
  const dates = rows.map((r) => r.date).sort();
  const span = dates.length ? (dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]}_${dates[dates.length - 1]}`) : "empty";
  const who = (state.company.icao || "schedule").toLowerCase();
  const draft = isDraft(state) ? `-draft-${activeVersion(state).name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}` : "";
  return `${who}-schedule${draft}-${span}.${ext}`;
}

/** Builds the file. The Excel and PDF libraries load on first use, so the initial bundle is unaffected. */
export async function buildScheduleExport(state: DomainState, o: ExportOptions): Promise<ExportResult> {
  const info = EXPORT_FORMATS.find((f) => f.id === o.format)!;
  const rows = buildRows(state, filterLegsForExport(o.legs, o.includeCancelled));
  const inp: ExportInput = { state, rows, createdAt: o.createdAt };
  const notes: string[] = [];
  let blob: Blob;
  switch (o.format) {
    case "csv":
      blob = new Blob([buildCsv(rows)], { type: "text/csv;charset=utf-8" });
      break;
    case "json":
      blob = new Blob([buildJson(inp)], { type: info.mime });
      break;
    case "ics":
      blob = new Blob([buildIcs(inp)], { type: "text/calendar;charset=utf-8" });
      break;
    case "xlsx-list":
      blob = await buildXlsxList(inp);
      break;
    case "xlsx-grid":
      blob = await buildXlsxGrid(inp);
      break;
    case "pdf":
      blob = await buildPdf(inp);
      break;
    case "ssim": {
      const carrier = state.company.iata.trim();
      if (!/^[A-Za-z0-9]{2}$/.test(carrier)) throw new ExportBlocked("SSIM needs your two-character IATA airline designator. Enter it on the Company page, then export again.");
      const r = buildSsim(rows, { carrier, title: state.company.legalName || "AeroPlanner schedule", createdAt: o.createdAt });
      for (const s of r.skipped) notes.push(`${s.flight} on ${s.date} left out: ${s.reason}.`);
      blob = new Blob([r.text], { type: "text/plain;charset=us-ascii" });
      break;
    }
  }
  return { blob, filename: exportFilename(state, rows, info.ext), legCount: rows.length, notes };
}
