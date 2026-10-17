"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useDemo } from "@/lib/store";
import { useUi } from "@/lib/ui-store";
import { mondayOf } from "@/lib/schedule";
import { addDaysIso, utcDate } from "@/lib/time";

/** "Go to flight": opens the Schedule on the leg's week, scrolls to it and highlights it for 2 s. */
export function useGoToLeg() {
  const router = useRouter();
  return useCallback(
    (legId: string, layout?: "table" | "gantt") => {
      const leg = useDemo.getState().data.legs.find((l) => l.id === legId);
      if (!leg) return;
      const demo = useDemo.getState();
      const from = mondayOf(utcDate(leg.etdUtc));
      demo.setRange({ from, to: addDaysIso(from, 20) });
      if (layout) demo.setLayout(layout);
      const ui = useUi.getState();
      ui.clearFilters();
      ui.setListState("normal");
      ui.focusLeg(legId);
      router.push("/schedule");
    },
    [router],
  );
}
