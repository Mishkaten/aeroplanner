"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { driver, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import { markTourSeen, tourSeen, TOUR_STEPS, useTour } from "@/lib/tour";
import { useUi } from "@/lib/ui-store";
import { useWorkspace } from "@/lib/workspace";

const norm = (p: string) => p.replace(/\/+$/, "") || "/";

function button(label: string, cls: string, onClick: () => void) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.className = `btn sm ${cls}`;
  b.addEventListener("click", onClick);
  return b;
}

/** Guided tour: highlights one element per step and moves between the pages. Starts by itself on a first sign-in. */
export function Tour() {
  const router = useRouter();
  const pathname = usePathname();
  const running = useTour((s) => s.running);
  const step = useTour((s) => s.step);
  const email = useWorkspace((s) => s.email);
  const hydrated = useUi((s) => s.hydrated);
  const auto = useRef(false);
  const drv = useRef<Driver | null>(null);

  // First sign-in in this browser: start the tour once.
  useEffect(() => {
    if (!hydrated || !email || auto.current || tourSeen(email)) return;
    const t = setTimeout(() => {
      auto.current = true;
      useTour.getState().start(0);
    }, 600);
    return () => clearTimeout(t);
  }, [hydrated, email]);

  useEffect(() => {
    if (!running) return;
    const s = TOUR_STEPS[step];
    if (!s) {
      useTour.getState().stop();
      return;
    }
    if (norm(pathname) !== norm(s.path)) {
      router.push(s.path);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let moving = false;
    const finish = () => {
      if (email) markTourSeen(email);
      useTour.getState().stop();
    };
    const show = (tries: number) => {
      if (cancelled) return;
      const el = s.find?.() ?? null;
      if (!el && s.find && tries < 25) {
        timer = setTimeout(() => show(tries + 1), 100); // the page is still drawing
        return;
      }
      el?.scrollIntoView({ block: "center" });
      const last = step === TOUR_STEPS.length - 1;
      const d = driver({
        popoverClass: "aero-tour",
        overlayOpacity: 0.55,
        stagePadding: 6,
        stageRadius: 6,
        allowClose: true,
        onDestroyed: () => {
          if (!moving) finish();
        },
      });
      drv.current = d;
      d.highlight({
        element: el ?? undefined,
        popover: {
          title: s.title,
          description: s.text,
          side: s.side,
          align: "start",
          showButtons: [],
          onPopoverRender: (pop) => {
            const foot = document.createElement("div");
            foot.className = "aero-tour-foot";
            const count = document.createElement("span");
            count.className = "hint";
            count.textContent = `${step + 1} of ${TOUR_STEPS.length}`;
            const grow = document.createElement("span");
            grow.style.flex = "1";
            foot.append(count, grow);
            const go = (n: number) => {
              moving = true;
              d.destroy();
              useTour.getState().go(n);
            };
            if (!last) foot.append(button("Skip tour", "", () => d.destroy()));
            if (step > 0) foot.append(button("Back", "", () => go(step - 1)));
            foot.append(
              last
                ? button("Finish", "pri", () => d.destroy())
                : button(step === 0 ? "Start tour" : "Next", "pri", () => go(step + 1)),
            );
            pop.wrapper.append(foot);
          },
        },
      });
    };
    show(0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      moving = true;
      drv.current?.destroy();
      drv.current = null;
    };
  }, [running, step, pathname, router, email]);

  return null;
}
