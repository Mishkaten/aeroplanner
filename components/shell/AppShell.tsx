"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Moon, Sun, Plane } from "lucide-react";
import { NAV } from "./nav";
import { applyTheme, readTheme, type Theme } from "@/lib/theme";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [theme, setTheme] = useState<Theme>("light");
  const [bannerOpen, setBannerOpen] = useState(true);

  useEffect(() => {
    setTheme(readTheme());
  }, []);

  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  };

  const isCurrent = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href.replace(/\/$/, ""));

  return (
    <>
      <div className="app-shell flex min-h-screen">
        <nav className="side" aria-label="Main navigation">
          <div className="brand">
            <Plane size={26} aria-hidden="true" color="#6FA1FF" />
            <div>
              <b>AeroPlanner</b>
              <small>Phasis Air Cargo</small>
            </div>
          </div>
          {NAV.map(({ id, label, href, Icon }) => (
            <Link key={id} href={href} className="navb" aria-current={isCurrent(href) ? "page" : undefined}>
              <Icon size={16} aria-hidden="true" />
              {label}
            </Link>
          ))}
          <div className="sidefoot">
            Fictional demo operator
            <br />
            <span className="mono">PHC / P7 / UGTB/TBS</span>
          </div>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="top">
            <span className="utc">
              <span className="dotg" />
              ALL TIMES UTC
            </span>
            <span className="grow" />
            <button className="btn sm" onClick={toggleTheme} aria-label="Toggle dark mode">
              {theme === "dark" ? <Sun size={14} aria-hidden="true" /> : <Moon size={14} aria-hidden="true" />}
              {theme === "dark" ? "Light" : "Dark"}
            </button>
          </header>
          {bannerOpen && (
            <div className="demo">
              <b>Demo data</b>
              <span>Fictional operator, all permit numbers are fake. Edits live in this session only.</span>
              <span className="grow" />
              <button className="btn sm" onClick={() => setBannerOpen(false)} aria-label="Dismiss banner">
                Dismiss
              </button>
            </div>
          )}
          <main className="content" id="main">
            {children}
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
    </>
  );
}
