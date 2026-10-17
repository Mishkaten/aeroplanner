import { buildRow } from "./parse";
import { readWorkbook } from "./sheet";
import type { ImportRow, ParseCtx, SheetStructure } from "./types";

export interface ImportResult {
  fileName: string;
  structure: SheetStructure;
  rows: ImportRow[];
  unknownAircraft: string[];
}

export interface Progress {
  pct: number;
  parsed: number;
  stage: string;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** Reads and parses a workbook. Runs inside a Web Worker for real files (see run.ts), so the page stays responsive. */
export async function parseWorkbook(data: ArrayBuffer | Uint8Array, fileName: string, ctx: ParseCtx, onProgress: (p: Progress) => void): Promise<ImportResult> {
  onProgress({ pct: 5, parsed: 0, stage: "Opening the workbook" });
  await tick();
  const wb = await readWorkbook(data, fileName, { knownRegistrations: new Set(ctx.aircraft.map((a) => a.registration)) });
  onProgress({ pct: 35, parsed: 0, stage: "Reading cells and merged ranges" });
  await tick();

  const rows: ImportRow[] = [];
  const total = wb.lines.length || 1;
  for (let i = 0; i < wb.lines.length; i++) {
    rows.push(buildRow(wb.lines[i], ctx));
    if (i % 8 === 7 || i === wb.lines.length - 1) {
      onProgress({ pct: 35 + Math.round(((i + 1) / total) * 60), parsed: i + 1, stage: "Parsing cell text" });
      await tick();
    }
  }
  onProgress({ pct: 100, parsed: rows.length, stage: "Done" });
  return { fileName, structure: wb.structure, rows, unknownAircraft: wb.unknownAircraft };
}
