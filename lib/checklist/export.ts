import { routeMapPng } from "./map";
import type { ChecklistModel } from "./model";

export type ExportFormat = "pdf" | "xlsx" | "docx";

export const FORMAT_LABEL: Record<ExportFormat, string> = { pdf: "PDF", xlsx: "Excel", docx: "Word" };

/** Builds the file. The libraries load on first use, so the initial bundle is unaffected (B6). */
export async function buildExport(format: ExportFormat, model: ChecklistModel, onProgress: (pct: number) => void): Promise<Blob> {
  const png = routeMapPng(model.route);
  if (format === "pdf") return (await import("./pdf")).buildPdf(model, png, onProgress);
  if (format === "xlsx") return (await import("./xlsx")).buildXlsx(model, onProgress);
  return (await import("./docx")).buildDocx(model, png, onProgress);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
