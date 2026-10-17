"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Moon, Plane, RotateCcw, Search, Sun } from "lucide-react";
import { Toaster } from "sonner";
import { NAV } from "./nav";
import { applyTheme, type Theme } from "@/lib/theme";
import { useDemo, type RangeSel } from "@/lib/store";
import { useUi } from "@/lib/ui-store";
import { derive } from "@/lib/derived";
import { StoreBoot } from "./StoreBoot";
import { ResetDialog, HelpDialog } from "./Dialogs";
import { useGlobalShortcuts } from "./shortcuts";
import { LegDrawerHost } from "@/components/leg/LegDrawerHost";
import { submitGlobalSearch } from "@/lib/search";

const RANGE_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "14 Sep to 4 Oct 2026" },
  { value: "0", label: "Week 1, 14 to 20 Sep" },
  { value: "1", label: "Week 2, 21 to 27 Sep" },
  { value: "2", label: "Week 3, 28 Sep to 4 Oct" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const theme = useUi((s) => s.theme);
  const [menu, setMenu] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const hydrated = useUi((s) => s.hydrated);
  const presenter = useUi((s) => s.presenter);
  const listState = useUi((s) => s.listState);
  const announce = useUi((s) => s.announce);
  const data = useDemo((s) => s.data);
  const banner = useDemo((s) => s.bannerDismissed);
  const range = useDemo((s) => s.range);

  useGlobalShortcuts(searchRef);

  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    useUi.getState().setTheme(next);
  };

  const d = hydrated ? derive(data) : null;
  const badges: Partial<Record<string, number>> = d ? { conflicts: d.counts.openIssues, permits: d.counts.urgentPermits } : {};

  const isCurrent = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href.replace(/\/$/, "")));

  const current = NAV.find((n) => isCurrent(n.href));
  useEffect(() => {
    document.title = `${current?.label ?? "AeroPlanner"} | AeroPlanner, Phasis Air Cargo demo`;
  }, [current?.label]);

  return (
    <>
      <StoreBoot />
      <a className="skip" href="#main">
        Skip to main content
      </a>
      <div className="app-shell flex min-h-screen">
        <nav className="side" aria-label="Main navigation">
          <div className="brand">
            <Plane size={26} aria-hidden="true" color="#6FA1FF" />
            <div>
              <b>AeroPlanner</b>
              <small>Phasis Air Cargo</small>
            </div>
          </div>
          {NAV.map(({ id, label, href, Icon }) => {
            const n = badges[id];
            return (
              <Link key={id} href={href} className="navb" aria-current={isCurrent(href) ? "page" : undefined}>
                <Icon size={16} aria-hidden="true" />
                <span className="nl">{label}</span>
                {n !== undefined && n > 0 && (
                  <span className="cnt" aria-label={`${n} ${id === "conflicts" ? "open issues" : "urgent permit rows"}`}>
                    {n}
                  </span>
                )}
              </Link>
            );
          })}
          <div className="sidefoot">
            Fictional demo operator
            <br />
            <span className="mono">PHC / P7 / UGTB/TBS</span>
          </div>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="top">
            <div className="leading-tight">
              <b>Phasis Air Cargo</b>
              <div className="hint">
                Fictional demo operator <span className="mono">PHC / P7 / UGTB/TBS</span>
              </div>
            </div>
            <span className="utc">
              <span className="dotg" />
              ALL TIMES UTC
            </span>
            <form
              role="search"
              className="search"
              onSubmit={(e) => {
                e.preventDefault();
                const v = searchRef.current?.value ?? "";
                if (submitGlobalSearch(v)) router.push("/schedule/");
              }}
            >
              <Search size={14} aria-hidden="true" />
              <input ref={searchRef} placeholder="Search flight, tail or airport, then Enter" aria-label="Global search" />
              <span className="kbd" aria-hidden="true">/</span>
            </form>
            <label className="fbar" style={{ gap: 6 }}>
              Range
              <select
                className="sel"
                value={String(range)}
                aria-label="Date range"
                onChange={(e) => {
                  const v = e.target.value;
                  useDemo.getState().setRange(v === "all" ? "all" : (Number(v) as RangeSel));
                }}
              >
                {RANGE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <span className="grow" />
            <button className="btn sm" onClick={() => useUi.getState().setResetOpen(true)}>
              <RotateCcw size={14} aria-hidden="true" /> Reset demo data
            </button>
            <button className="btn sm" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
              {theme === "dark" ? <Sun size={14} aria-hidden="true" /> : <Moon size={14} aria-hidden="true" />}
              {theme === "dark" ? "Light" : "Dark"}
            </button>
            <button className="btn sm" onClick={() => useUi.getState().setHelp(true)} aria-label="Keyboard shortcuts">
              ?
            </button>
            <div style={{ position: "relative" }}>
              <button className="btn sm" aria-label="OP Ops planner, user menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
                <b>OP</b> Ops planner
              </button>
              {menu && (
                <div className="card" style={{ position: "absolute", right: 0, top: 34, width: 240, padding: 10, display: "flex", flexDirection: "column", gap: 6, boxShadow: "var(--shadow)", zIndex: 40 }}>
                  <small className="lbl">Signed in as</small>
                  <span>Ops planner (demo user, no login)</span>
                  {presenter && (
                    <>
                      <small className="lbl" style={{ marginTop: 6 }}>Preview list states</small>
                      {(["normal", "loading", "error", "empty"] as const).map((s) => (
                        <button key={s} className={`btn sm ${listState === s ? "pri" : ""}`} onClick={() => useUi.getState().setListState(s)}>
                          {s[0].toUpperCase() + s.slice(1)}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          </header>
          {presenter && (
            <div className="demo" role="group" aria-label="Preview list states">
              <b>Preview list states</b>
              <div className="seg">
                {(["normal", "loading", "error", "empty"] as const).map((s) => (
                  <button key={s} aria-pressed={listState === s} onClick={() => useUi.getState().setListState(s)}>
                    {s[0].toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {!banner && (
            <div className="demo">
              <b>Demo data</b>
              <span>Fictional operator, all permit numbers are fake. Edits live in this session only.</span>
              <span className="grow" />
              <button className="btn sm" onClick={() => useUi.getState().setResetOpen(true)}>
                Reset demo
              </button>
              <button className="btn sm" onClick={() => useDemo.getState().dismissBanner()} aria-label="Dismiss banner">
                Dismiss
              </button>
            </div>
          )}
          <main className="content" id="main" tabIndex={-1}>
            {hydrated ? children : <div className="skel" style={{ height: 24, width: 240 }} aria-busy="true" />}
          </main>
        </div>
      </div>
      <div className="too-small min-h-screen items-center justify-center p-8 text-center">
        <p>
          <b>Open on a larger screen.</b>
          <br />
          AeroPlanner is a desktop demo and needs a window at least 1024 px wide.
        </p>
      </div>
      <LegDrawerHost />
      <ResetDialog />
      <HelpDialog />
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announce}
      </div>
      <Toaster position="bottom-right" closeButton visibleToasts={3} />
    </>
  );
}
