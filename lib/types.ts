// Domain model. Only these seven entities are stored (PRD section 4).
// Block time, (+1), "DAY n LT", through-flight groups, required permits and
// every ValidationIssue are derived on each change and never stored.

export type IsoInstant = string; // UTC, e.g. "2026-09-16T03:30:00Z"
export type IsoDate = string; // UTC calendar date, e.g. "2026-09-16"

/** ISO 3166 alpha-2 code, or "XX" for the placeholder airport. */
export type CountryCode = string;

export interface Company {
  id: string;
  legalName: string;
  vatNumber: string;
  icao: string;
  iata: string;
  aocNumber: string;
  baseIcao: string;
  address: string;
  opsContact: string;
  checklistHeaderText: string;
  logoDataUrl: string | null;
  minGroundMinutes: number;
  /** What "DAY n LT" in an Excel line means: the weekday of the local arrival date, of the departure date, or nothing (not checked). */
  dayTagMode: "arrival_local" | "departure_day" | "ignore";
}

/** Free text, for example "B737-800SF". */
export type AircraftType = string;
export type AircraftStatus = "active" | "aog" | "maintenance";

export interface Aircraft {
  id: string; // same as registration
  registration: string;
  type: AircraftType;
  serialNo: string | null;
  yearOfManufacture: number | null;
  mtowKg: number | null;
  cargoPayloadKg: number | null;
  status: AircraftStatus;
  defaultBackupId: string | null;
}

export interface Airport {
  /** Same as icao. Patches address rows by id. */
  id: string;
  icao: string; // key, e.g. "UGTB"
  iata: string; // "TBS"
  name: string;
  countryCode: CountryCode;
  /** Fixed offset used only when the airport has no valid tzId. With a tzId the offset follows daylight saving. */
  utcOffsetMinutes: number;
  /** IANA time zone, for example "Europe/Belgrade". Drives local times and "DAY n LT" across daylight saving changes. */
  tzId?: string;
  lat: number | null; // null only for the placeholder XXXX/XXX
  lon: number | null;
  provisional: boolean;
}

export type LegType = "landing" | "overflight" | "technical_stop" | "ferry";

export interface LegSource {
  kind: "seed" | "import" | "manual";
  sheetRef?: { sheet: string; cell: string; rawText: string };
}

export interface Leg {
  id: string;
  flightNumber: string; // prefix + number without suffix, e.g. "PHC507"
  suffix: "" | "D";
  aircraftId: string;
  backupAircraftId: string | null;
  legType: LegType;
  depIcao: string;
  arrIcao: string;
  etdUtc: IsoInstant;
  etaUtc: IsoInstant;
  status: "planned" | "cancelled";
  notes: string;
  source: LegSource;
}

export type PermitType = "landing" | "overflight";
export type PermitStatus = "obtained" | "pending" | "cancelled";

export interface Permit {
  id: string;
  legId: string;
  countryCode: CountryCode;
  type: PermitType;
  number: string | null;
  status: PermitStatus;
  validFromUtc: IsoInstant | null;
  validToUtc: IsoInstant | null;
}

export type MaintenanceKind = "aog" | "maintenance" | "c_check";

export interface MaintenanceBlock {
  id: string;
  aircraftId: string;
  kind: MaintenanceKind;
  startUtc: IsoInstant;
  endUtc: IsoInstant | null; // null = open-ended
  note: string;
}

/** Which permits a route needs. Entered by the planner, the route is matched by station pair. */
export interface PermitRule {
  id: string;
  aIcao: string;
  bIcao: string;
  /** true: applies in both directions, false: only A to B */
  both: boolean;
  countryCode: CountryCode;
  type: PermitType;
}

/** A named copy of the schedule, for example a season or a client request. Exactly one version is live. */
export interface ScheduleVersion {
  id: string;
  name: string;
  note: string;
  live: boolean;
  createdAt: IsoInstant;
}

/** The legs and permits of a version that is not the one being edited. */
export interface ParkedVersion {
  legs: Leg[];
  permits: Permit[];
}

export interface DomainState {
  /** The "now" used for the 48 h permit rule. null means the real clock. The demo seed pins it. */
  clock: IsoInstant | null;
  permitRules: PermitRule[];
  /** At least one. `legs` and `permits` below always belong to the active version. */
  versions: ScheduleVersion[];
  activeVersionId: string;
  /** Legs and permits of every other version, by version id. */
  parked: Record<string, ParkedVersion>;
  company: Company;
  aircraft: Aircraft[];
  airports: Airport[];
  legs: Leg[];
  permits: Permit[];
  blocks: MaintenanceBlock[];
}

export type RuleId = "R1" | "R2" | "R3" | "R4a" | "R4b" | "R5" | "R6"; // R7 produces no issue

export type Coll = "legs" | "permits" | "blocks" | "aircraft" | "airports" | "permitRules";

export type PatchOp =
  | { op: "set"; coll: Coll; id: string; value: Record<string, unknown> }
  | { op: "insert"; coll: Coll; value: { id: string } & Record<string, unknown> }
  | { op: "remove"; coll: Coll; id: string };

/** A list of set / insert / remove operations, applied atomically and undoable. */
export type StatePatch = PatchOp[];

export interface Fix {
  id: string;
  label: string;
  enabled: boolean;
  disabledReason: string | null;
  patch: StatePatch;
  /** Secondary actions open the leg drawer pre-filled instead of applying a patch. */
  draft?: Partial<Leg>;
  secondary?: boolean;
  /** Plain-language result for the live region, e.g. "PHC509 on 4L-PXB is now PHC509D". */
  result: string;
}

export interface ValidationIssue {
  id: string; // `${ruleId}:${sorted legIds}:${blockId ?? ""}`
  ruleId: RuleId;
  severity: "error" | "warning";
  legIds: string[];
  aircraftId: string | null;
  blockId: string | null;
  whenUtc: IsoInstant; // earliest ETD among legIds
  message: string;
  fixes: Fix[];
}

/** An R1 exemption hit, shown under "Deliberately not flagged". */
export interface Exemption {
  id: string;
  kind: "through" | "parallel" | "chain";
  flight: string;
  dateUtc: IsoDate;
  legIds: string[];
  aircraftIds: string[];
  text: string;
}

export interface ValidationResult {
  issues: ValidationIssue[];
  exemptions: Exemption[];
}
