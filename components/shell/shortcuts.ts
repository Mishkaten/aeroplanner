"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, type RefObject } from "react";
import { useUi } from "@/lib/ui-store";

export const SHORTCUTS: { keys: string; text: string }[] = [
  { keys: "?", text: "Open this list of shortcuts" },
  { keys: "/", text: "Focus the global search" },
  { keys: "N", text: "Add a leg" },
  { keys: "G O", text: "Go to Overview" },
  { keys: "G S", text: "Go to Schedule" },
  { keys: "G C", text: "Go to Conflicts" },
  { keys: "G P", text: "Go to Permits" },
  { keys: "G E", text: "Go to Checklist export" },
  { keys: "G F", text: "Go to Fleet registry" },
  { keys: "G A", text: "Go to Airport directory" },
  { keys: "G I", text: "Go to Import from Excel" },
  { keys: "Esc", text: "Close a dialog or drawer" },
];

const CHORDS: Record<string, string> = {
  o: "/",
  s: "/schedule/",
  c: "/conflicts/",
  p: "/permits/",
  e: "/checklist/",
  f: "/fleet/",
  a: "/airports/",
  y: "/company/",
  i: "/import/",
};

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
};

export function useGlobalShortcuts(searchRef: RefObject<HTMLInputElement | null>) {
  const router = useRouter();
  const gAt = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      const ui = useUi.getState();
      if (ui.helpOpen || ui.resetOpen || ui.drawer.kind !== "none") return;
      const k = e.key;
      if (k === "?") {
        e.preventDefault();
        ui.setHelp(true);
      } else if (k === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (k === "n" || k === "N") {
        e.preventDefault();
        ui.openNew();
      } else if (k === "g" || k === "G") {
        gAt.current = e.timeStamp;
      } else if (gAt.current && e.timeStamp - gAt.current < 1200 && CHORDS[k.toLowerCase()]) {
        e.preventDefault();
        gAt.current = 0;
        router.push(CHORDS[k.toLowerCase()]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, searchRef]);
}
