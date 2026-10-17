import { create } from "zustand";

export interface TourStep {
  id: string;
  /** Route to be on (with trailing slash). */
  path: string;
  title: string;
  text: string;
  /** Finds the element to highlight. A step without a match is shown centred. */
  find?: () => Element | null;
  side?: "top" | "bottom" | "left" | "right";
}

const q = (sel: string) => () => document.querySelector(sel);
const withText = (sel: string, re: RegExp) => () => Array.from(document.querySelectorAll(sel)).find((e) => re.test(e.textContent ?? "")) ?? null;
const head = q("#main .head");

export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    path: "/",
    title: "Welcome to the AeroPlanner test",
    text: "This is a shared workspace: everyone who signs in sees the same data. Changes save by themselves, and the last save wins. Use your real data. This tour takes about three minutes, and you can leave it at any time and restart it with the Tour button.",
  },
  {
    id: "company",
    path: "/company/",
    title: "1. Enter your airline",
    text: "Fill in the legal name, the ICAO and IATA codes and the base airport. The ICAO code is the flight prefix (for example CMS581), and the importer checks every flight against it. Also set the minimum ground time here.",
    find: q("#main form, #main .card"),
    side: "right",
  },
  {
    id: "fleet",
    path: "/fleet/",
    title: "2. Add your aircraft",
    text: "Add each aircraft with its registration and type, and choose a backup aircraft if you have one. You can skip this: the Excel import can also read the fleet table at the top of your sheet.",
    find: withText("#main button", /Add aircraft/),
    side: "bottom",
  },
  {
    id: "airports",
    path: "/airports/",
    title: "3. Check the airports",
    text: "Make sure every station you fly to is listed and that its UTC offset is right. Local times and the DAY tags depend on it. Add any missing station.",
    find: q("#main table.tbl"),
    side: "top",
  },
  {
    id: "rules",
    path: "/rules/",
    title: "4. Tell the app which permits you need",
    text: "A rule says that flying between two airports needs a permit from a country, either for landing or for overflight. Nothing is required until you add rules, and permits are never added by themselves.",
    find: q("#main form, #main .card"),
    side: "right",
  },
  {
    id: "import",
    path: "/import/",
    title: "5. Import your Excel schedule",
    text: "Drop your .xlsx file here. Lines the app cannot read safely are marked for review: accept the suggested fix, correct the line, or skip it. Importing the same file again updates flights instead of duplicating them.",
    find: () => document.querySelector('#main [aria-label="Choose an Excel file"]')?.parentElement ?? null,
    side: "bottom",
  },
  {
    id: "schedule",
    path: "/schedule/",
    title: "6. Look at the schedule",
    text: "Switch between the table and the Gantt chart. Drag a flight to another aircraft or day, and click it to open its details. Change the date range at the top of the page.",
    find: q('#main [aria-label="Layout"]'),
    side: "bottom",
  },
  {
    id: "conflicts",
    path: "/conflicts/",
    title: "7. Clear the conflicts",
    text: "The app lists overlaps, broken continuity, aircraft on the ground (AOG) clashes and missing permits. Use Go to flight to see the problem, or the one-click fix where it offers one.",
    find: () => q("#main table.tbl")() ?? head(),
    side: "top",
  },
  {
    id: "permits",
    path: "/permits/",
    title: "8. Track the permits",
    text: "Filter by status, mark a permit as obtained and type its permit number. Urgent ones are counted next to Permits in the menu.",
    find: () => q('#main [aria-label="Status"]')() ?? head(),
    side: "bottom",
  },
  {
    id: "checklist",
    path: "/checklist/",
    title: "9. Export flight packets",
    text: "Tick the flights you want, then export the packet as PDF, Excel or Word for the crew and the handling agents.",
    find: withText("#main button", /Export PDF/),
    side: "bottom",
  },
  {
    id: "workspace",
    path: "/workspace/",
    title: "10. Backups and your data",
    text: "Download a copy of the whole workspace, restore an earlier backup if something is deleted by mistake, or clear everything. Spotted a problem or missing something? The Feedback button in the top bar writes to us.",
    find: q("#main section.card"),
    side: "top",
  },
  {
    id: "done",
    path: "/",
    title: "You are ready to test",
    text: "The Getting started card on this page shows what is still to do and ticks itself as you go. Please put in your real data and tell us anything that is confusing, slow or wrong.",
    find: q("#getting-started"),
    side: "bottom",
  },
];

interface TourState {
  running: boolean;
  step: number;
  start: (step?: number) => void;
  go: (step: number) => void;
  stop: () => void;
}

export const useTour = create<TourState>((set) => ({
  running: false,
  step: 0,
  start: (step = 0) => set({ running: true, step }),
  go: (step) => set({ step }),
  stop: () => set({ running: false }),
}));

const key = (email: string) => `aeroplanner.tour.v1:${email.toLowerCase()}`;

export function tourSeen(email: string): boolean {
  try {
    return localStorage.getItem(key(email)) === "1";
  } catch {
    return true; // storage blocked: do not nag on every load
  }
}

export function markTourSeen(email: string) {
  try {
    localStorage.setItem(key(email), "1");
  } catch {
    /* ignore */
  }
}
