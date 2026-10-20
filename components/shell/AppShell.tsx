"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Briefcase, Compass, Layers, Mail, Moon, Plane, RotateCcw, Search, Sun } from "lucide-react";
import { Toaster } from "sonner";
import { NAV } from "./nav";
import { applyTheme, type Theme } from "@/lib/theme";
import { useDemo } from "@/lib/store";
import { RangeControl } from "./RangeControl";
import { useUi } from "@/lib/ui-store";
import { derive } from "@/lib/derived";
import { StoreBoot } from "./StoreBoot";
import { ResetDialog, HelpDialog } from "./Dialogs";
import { useGlobalShortcuts } from "./shortcuts";
import { LegDrawerHost } from "@/components/leg/LegDrawerHost";
import { submitGlobalSearch } from "@/lib/search";
import { FEEDBACK_EMAIL, WORKSPACE_MODE } from "@/lib/mode";
import { useWorkspace } from "@/lib/workspace";
import { LoginScreen } from "./LoginScreen";
import { SyncStatus } from "./SyncStatus";
import { Tour } from "./Tour";
import { useTour } from "@/lib/tour";
import { activeVersion, isDraft, liveVersion } from "@/lib/versions";



function ShellInner({ children }: { children: React.ReactNode }) {
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
  const email = useWorkspace((s) => s.email);
  const co = data.company;
  const navItems = WORKSPACE_MODE ? [...NAV, { id: "workspace", label: "Workspace", href: "/workspace", Icon: Briefcase }] : NAV;
  const airline = WORKSPACE_MODE ? co.legalName || "Your airline" : "Phasis Air Cargo";

  useGlobalShortcuts(searchRef);

  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    useUi.getState().setTheme(next);
  };

  const d = hydrated ? derive(data) : null;
  const badges: Partial<Record<string, number>> = d ? { conflicts: d.counts.openIssues, permits: d.counts.urgentPermits } : {};

  const isCurrent = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href.replace(/\/$/, "")));

  const current = navItems.find((n) => isCurrent(n.href));
  useEffect(() => {
    document.title = `${current?.label ?? "AeroPlanner"} | AeroPlanner${WORKSPACE_MODE ? "" : ", Phasis Air Cargo demo"}`;
  }, [current?.label]);

  return (
    <>
      <a className="skip" href="#main">
        Skip to main content
      </a>
      <div className="app-shell flex min-h-screen">
        <nav className="side" aria-label="Main navigation">
          <div className="brand">
            <Plane size={26} aria-hidden="true" color="#6FA1FF" />
            <div>
              <b>AeroPlanner</b>
              <small>{airline}</small>
            </div>
          </div>
          {navItems.map(({ id, label, href, Icon }) => {
            const n = badges[id];
            return (
              <Link key={id} href={href} prefetch={false} className="navb" aria-current={isCurrent(href) ? "page" : undefined}>
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
            {WORKSPACE_MODE ? "Test workspace" : "Fictional demo operator"}
            <br />
            <span className="mono">{WORKSPACE_MODE ? `${co.icao || "?"} / ${co.iata || "?"} / ${co.baseIcao}` : "PHC / P7 / UGTB/TBS"}</span>
          </div>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="top">
            <div className="leading-tight">
              <b>{airline}</b>
              <div className="hint">
                {WORKSPACE_MODE ? "Test workspace" : "Fictional demo operator"}{" "}
                <span className="mono">{WORKSPACE_MODE ? `${co.icao || "?"} / ${co.iata || "?"} / ${co.baseIcao}` : "PHC / P7 / UGTB/TBS"}</span>
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
            <RangeControl />
            <Link href="/versions/" prefetch={false} className="btn sm" title="Schedule versions" aria-label={`Version ${activeVersion(data).name}, ${isDraft(data) ? "draft" : "live"}. Open versions`}>
              <Layers size={14} aria-hidden="true" /> {activeVersion(data).name}
              <span className={`b ${isDraft(data) ? "b-wa" : "b-ok"}`}>{isDraft(data) ? "Draft" : "Live"}</span>
            </Link>
            <span className="grow" />
            {WORKSPACE_MODE ? (
              <>
                <SyncStatus />
                <a
                  className="btn sm"
                  href={`mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent("AeroPlanner feedback")}&body=${encodeURIComponent(`Page: ${pathname}\n\nWhat happened:\n\nWhat I expected:\n`)}`}
                >
                  <Mail size={14} aria-hidden="true" /> Feedback
                </a>
                <button className="btn sm" onClick={() => useTour.getState().start(0)}>
                  <Compass size={14} aria-hidden="true" /> Tour
                </button>
              </>
            ) : (
              <button className="btn sm" onClick={() => useUi.getState().setResetOpen(true)}>
                <RotateCcw size={14} aria-hidden="true" /> Reset demo data
              </button>
            )}
            <button className="btn sm" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
              {theme === "dark" ? <Sun size={14} aria-hidden="true" /> : <Moon size={14} aria-hidden="true" />}
              {theme === "dark" ? "Light" : "Dark"}
            </button>
            <button className="btn sm" onClick={() => useUi.getState().setHelp(true)} aria-label="Keyboard shortcuts">
              ?
            </button>
            <div style={{ position: "relative" }}>
              <button className="btn sm" aria-label={WORKSPACE_MODE ? `${email ?? "User"}, user menu` : "OP Ops planner, user menu"} aria-expanded={menu} onClick={() => setMenu(!menu)}>
                {WORKSPACE_MODE ? (
                  <b>{(email ?? "?").slice(0, 2).toUpperCase()}</b>
                ) : (
                  <>
                    <b>OP</b> Ops planner
                  </>
                )}
              </button>
              {menu && (
                <div className="card" style={{ position: "absolute", right: 0, top: 34, width: 240, padding: 10, display: "flex", flexDirection: "column", gap: 6, boxShadow: "var(--shadow)", zIndex: 40 }}>
                  <small className="lbl">Signed in as</small>
                  <span>{WORKSPACE_MODE ? email : "Ops planner (demo user, no login)"}</span>
                  {WORKSPACE_MODE && (
                    <button className="btn sm" onClick={() => void useWorkspace.getState().signOut()}>
                      Sign out
                    </button>
                  )}
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
          {isDraft(data) && (
            <div className="demo" role="status" style={{ borderColor: "var(--warn, #b8860b)" }}>
              <b>Draft: {activeVersion(data).name}</b>
              <span>
                You are editing a draft, not the live schedule ({liveVersion(data).name}). Every screen and export shows this draft. Nothing here changes the live schedule until you publish.
              </span>
              <span className="grow" />
              <button className="btn sm" onClick={() => useDemo.getState().switchVersion(liveVersion(data).id)}>
                Back to live
              </button>
              <Link className="btn sm pri" href="/versions/" prefetch={false}>
                Versions
              </Link>
            </div>
          )}
          {!banner && (
            <div className="demo">
              <b>{WORKSPACE_MODE ? "Test workspace" : "Demo data"}</b>
              <span>
                {WORKSPACE_MODE
                  ? "Shared by everyone with the login. Changes save automatically and the last save wins. Start with Import from Excel or add your fleet."
                  : "Fictional operator, all permit numbers are fake. Edits live in this session only."}
              </span>
              <span className="grow" />
              {!WORKSPACE_MODE && (
                <button className="btn sm" onClick={() => useUi.getState().setResetOpen(true)}>
                  Reset demo
                </button>
              )}
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
          AeroPlanner is a desktop app and needs a window at least 768 px wide.
        </p>
      </div>
      <LegDrawerHost />
      {WORKSPACE_MODE && <Tour />}
      <ResetDialog />
      <HelpDialog />
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announce}
      </div>
      <Toaster position="bottom-right" closeButton visibleToasts={3} />
    </>
  );
}

/** Gate for the shared workspace: sign-in, loading and error screens until the data has arrived. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const status = useWorkspace((s) => s.status);
  const error = useWorkspace((s) => s.error);
  const gated = WORKSPACE_MODE && status !== "ready";
  return (
    <>
      <StoreBoot />
      {gated ? (
        status === "signedout" ? (
          <LoginScreen />
        ) : status === "error" ? (
          <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
            <div className="card empty" role="alert" style={{ width: "min(480px, 100%)" }}>
              <span className="b b-er">Error</span>
              <b>Could not load the workspace</b>
              <span>{error}</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn pri" onClick={() => void useWorkspace.getState().reload(true)}>
                  Try again
                </button>
                <button className="btn" onClick={() => void useWorkspace.getState().signOut()}>
                  Sign out
                </button>
              </div>
            </div>
          </main>
        ) : (
          <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }} aria-busy="true">
            <span className="hint">Loading the workspace...</span>
          </main>
        )
      ) : (
        <ShellInner>{children}</ShellInner>
      )}
    </>
  );
}
