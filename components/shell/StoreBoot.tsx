"use client";

import { useEffect } from "react";
import { useDemo } from "@/lib/store";
import { useUi } from "@/lib/ui-store";
import { readTheme } from "@/lib/theme";

/**
 * Runs once on the client: reads URL parameters, restores the tab session from
 * sessionStorage (a new tab starts from the full demo) and marks the app ready.
 *
 *   ?reset=1       full demo, then the parameter is removed
 *   ?start=empty   empty schedule, then the parameter is removed
 *   ?presenter=1   shows the list-state switcher
 *   ?legs=1000     stress mode for the performance tests (not linked from the interface)
 */
export function StoreBoot() {
  useEffect(() => {
    const url = new URL(window.location.href);
    const p = url.searchParams;
    const ui = useUi.getState();
    ui.setPresenter(p.get("presenter") === "1");
    ui.setTheme(readTheme());

    void Promise.resolve(useDemo.persist.rehydrate()).then(() => {
      const demo = useDemo.getState();
      const stress = Number(p.get("legs"));
      let changed = false;
      if (p.get("reset") === "1") {
        demo.reset("full");
        p.delete("reset");
        changed = true;
      } else if (p.get("start") === "empty") {
        demo.reset("empty");
        p.delete("start");
        changed = true;
      } else if (stress > 0 && demo.data.legs.length !== stress) {
        demo.reset("full", Math.min(stress, 5000));
      }
      if (changed) {
        const qs = p.toString();
        window.history.replaceState(null, "", url.pathname + (qs ? `?${qs}` : "") + url.hash);
      }
      useUi.getState().setHydrated();
    });
  }, []);
  return null;
}
