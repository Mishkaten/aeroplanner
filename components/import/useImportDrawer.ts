"use client";

import { useDemo } from "@/lib/store";
import { useImport } from "@/lib/import/store";
import { permitStatusOf, readTime } from "@/lib/import/parse";
import type { Leg } from "@/lib/types";
import type { ImportCtx } from "@/components/leg/LegDrawer";

const hhmm = (raw: string): string => {
  const r = readTime(raw);
  return r.ok ? `${String(Math.floor(r.minutes / 60)).padStart(2, "0")}:${String(r.minutes % 60).padStart(2, "0")}` : "";
};

/** The leg drawer for an imported row: opens pre-filled with the best parse and the raw text shown above the fields. */
export function useImportDrawer(rowId: string | null): { leg: Leg | null; ctx: ImportCtx } | null {
  const row = useImport((s) => (rowId ? s.rows.find((r) => r.id === rowId) ?? null : null));
  const aircraft = useDemo((s) => s.data.aircraft);
  if (!row) return null;
  const f = row.fields;
  const ac = aircraft.find((a) => a.registration === row.ref.aircraftReg);
  const initialForm = f
    ? {
        fn: `${f.prefix}${f.number}`,
        dSuffix: f.suffix === "D",
        type: f.typeWord === "FERRY" || f.dep.icao === "XXXX" || f.arr.icao === "XXXX" ? ("ferry" as const) : f.typeWord === "OVERFLIGHT" ? ("overflight" as const) : f.typeWord === "TECHSTOP" ? ("technical_stop" as const) : ("landing" as const),
        ac: ac?.id ?? aircraft[0]?.id ?? "",
        backup: ac?.defaultBackupId ?? "",
        dep: `${f.dep.icao}/${f.dep.iata}`,
        arr: `${f.arr.icao}/${f.arr.iata}`,
        date: row.ref.dateIso ?? "2026-09-14",
        etd: hhmm(f.depTime.raw),
        eta: hhmm(f.arrTime.raw),
        notes: f.note,
      }
    : undefined;
  return {
    leg: null,
    ctx: {
      rawText: row.ref.text,
      cell: row.ref.cell,
      message: row.flag ? `${row.flag.message}` : undefined,
      initialForm,
      defaultPermit: permitStatusOf(row),
      onSave: (leg, permits) => useImport.getState().saveDrawer(row.id, leg, permits),
    },
  };
}
