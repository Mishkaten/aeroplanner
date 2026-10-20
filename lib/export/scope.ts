import type { Leg } from "../types";

/** Cancelled legs stay out unless asked for, so a file sent to another system never revives a cancelled flight. */
export const filterLegsForExport = (legs: Leg[], includeCancelled: boolean): Leg[] => (includeCancelled ? legs : legs.filter((l) => l.status !== "cancelled"));
