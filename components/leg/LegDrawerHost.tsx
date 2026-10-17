"use client";

import { useDemo } from "@/lib/store";
import { useUi } from "@/lib/ui-store";
import { LegDrawer } from "./LegDrawer";
import { useImportDrawer } from "@/components/import/useImportDrawer";

/** Opens the leg drawer for editing, adding, or fixing an imported row. */
export function LegDrawerHost() {
  const drawer = useUi((s) => s.drawer);
  const hydrated = useUi((s) => s.hydrated);
  const leg = useDemo((s) => (drawer.kind === "leg" ? s.data.legs.find((l) => l.id === drawer.legId) ?? null : null));
  const imp = useImportDrawer(drawer.kind === "import" ? drawer.rowId : null);
  const close = () => useUi.getState().closeDrawer();

  if (!hydrated) return null;
  if (drawer.kind === "leg" && leg) return <LegDrawer key={`${leg.id}:${JSON.stringify(leg)}`} mode="edit" leg={leg} onClose={close} />;
  if (drawer.kind === "new") return <LegDrawer key={`new-${JSON.stringify(drawer.draft ?? {})}`} mode="new" leg={null} draft={drawer.draft} onClose={close} />;
  if (drawer.kind === "import" && imp) return <LegDrawer key={`imp-${drawer.rowId}`} mode="import" leg={imp.leg} importCtx={imp.ctx} onClose={close} />;
  return null;
}
