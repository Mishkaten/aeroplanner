import type { RuleId } from "./types";

export interface RuleInfo {
  id: "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7";
  title: string;
  definition: string;
  fix: string;
  severity: "error" | "warning" | "error or warning" | "none";
}

// Section 5. Shown in "Rules checked".
export const RULES: RuleInfo[] = [
  {
    id: "R1",
    title: "Flight number conflict",
    definition: "One full flight number on two aircraft on the same UTC date, unless the legs form a chain. PHC507 and PHC507D never conflict.",
    fix: "Add suffix D to the later-departing leg.",
    severity: "error",
  },
  {
    id: "R2",
    title: "Station continuity",
    definition: "An aircraft must depart from the station where its previous active leg arrived. The placeholder XXXX/XXX skips the check.",
    fix: "Set the departure to the previous arrival, or insert a ferry leg.",
    severity: "error",
  },
  {
    id: "R3",
    title: "Aircraft unavailable",
    definition: "A leg falls inside an AOG, maintenance or C-Check window of its aircraft. Touching boundaries are not an overlap.",
    fix: "Reassign the legs to their backup aircraft, or cancel them.",
    severity: "error",
  },
  {
    id: "R4",
    title: "Permit risk",
    definition: "Urgent (error): departs within 48 h of the demo clock and a required permit is not obtained. Missing (warning): a later leg has a required permit with no record.",
    fix: "Mark the permits obtained, or add pending permit rows.",
    severity: "error or warning",
  },
  {
    id: "R5",
    title: "Overlapping legs",
    definition: "On one aircraft the next leg departs before the previous one has arrived. Equal times touch and are allowed.",
    fix: "Move the later leg to the previous ETA plus the minimum ground time (60 min).",
    severity: "error",
  },
  {
    id: "R6",
    title: "Block time across midnight",
    definition: "ETA is read as a time of day. Block time must be above 0 and under 24 h, and above 18 h raises a warning.",
    fix: "Open the leg (no automatic fix).",
    severity: "error or warning",
  },
  {
    id: "R7",
    title: "Soft cancellation",
    definition: "A cancelled leg (CNL) stays visible, is excluded from every count and from rules R1 to R5, and cannot be ticked for a checklist.",
    fix: "Cancel leg and Restore leg.",
    severity: "none",
  },
];

export const TYPE_FILTERS: { value: string; label: string; rules: RuleId[] }[] = [
  { value: "all", label: "All types", rules: [] },
  { value: "R1", label: "R1 Flight number", rules: ["R1"] },
  { value: "R2", label: "R2 Continuity", rules: ["R2"] },
  { value: "R3", label: "R3 Aircraft unavailable", rules: ["R3"] },
  { value: "R4", label: "R4 Permits", rules: ["R4a", "R4b"] },
  { value: "R5", label: "R5 Overlap", rules: ["R5"] },
  { value: "R6", label: "R6 Block time", rules: ["R6"] },
];

export const RULE_TYPE_LABEL: Record<RuleId, string> = {
  R1: "R1 Flight number",
  R2: "R2 Continuity",
  R3: "R3 Aircraft unavailable",
  R4a: "R4 Permit urgent",
  R4b: "R4 Permit missing",
  R5: "R5 Overlap",
  R6: "R6 Block time",
};
