import {
  AlertTriangle,
  Building2,
  FileSpreadsheet,
  LayoutDashboard,
  CalendarDays,
  ClipboardList,
  PlaneTakeoff,
  ShieldCheck,
  MapPin,
  Scale,
  Layers,
  Repeat,
  type LucideIcon,
} from "lucide-react";

export type NavId =
  | "overview"
  | "schedule"
  | "conflicts"
  | "permits"
  | "checklist"
  | "fleet"
  | "rules"
  | "airports"
  | "company"
  | "versions"
  | "patterns"
  | "import";

export interface NavItem {
  id: NavId;
  label: string;
  href: string;
  Icon: LucideIcon;
}

export const NAV: NavItem[] = [
  { id: "overview", label: "Overview", href: "/", Icon: LayoutDashboard },
  { id: "schedule", label: "Schedule", href: "/schedule", Icon: CalendarDays },
  { id: "patterns", label: "Patterns", href: "/patterns", Icon: Repeat },
  { id: "versions", label: "Versions", href: "/versions", Icon: Layers },
  { id: "conflicts", label: "Conflicts", href: "/conflicts", Icon: AlertTriangle },
  { id: "permits", label: "Permits", href: "/permits", Icon: ShieldCheck },
  { id: "checklist", label: "Checklist export", href: "/checklist", Icon: ClipboardList },
  { id: "fleet", label: "Fleet registry", href: "/fleet", Icon: PlaneTakeoff },
  { id: "rules", label: "Permit rules", href: "/rules", Icon: Scale },
  { id: "airports", label: "Airport directory", href: "/airports", Icon: MapPin },
  { id: "company", label: "Company profile", href: "/company", Icon: Building2 },
  { id: "import", label: "Import from Excel", href: "/import", Icon: FileSpreadsheet },
];
