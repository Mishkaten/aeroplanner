"use client";

import type { Leg } from "@/lib/types";
import type { ImportCtx } from "@/components/leg/LegDrawer";

// Wired to the import store in step 8.
export function useImportDrawer(rowId: string | null): { leg: Leg; ctx: ImportCtx } | null {
  void rowId;
  return null;
}
