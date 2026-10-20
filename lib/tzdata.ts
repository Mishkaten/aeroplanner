import { tzForFixedOffset } from "./tz";

/** IANA time zone of every station in the starter directory. */
export const TZ_BY_ICAO: Record<string, string> = {
  UGTB: "Asia/Tbilisi",
  ZWWW: "Asia/Shanghai", // Urumqi uses Beijing time officially
  ZLXY: "Asia/Shanghai",
  UAAA: "Asia/Almaty",
  LYBE: "Europe/Belgrade",
  LGAV: "Europe/Athens",
  LHBP: "Europe/Budapest",
  LROP: "Europe/Bucharest",
  LIMC: "Europe/Rome",
  VHHH: "Asia/Hong_Kong",
  VECC: "Asia/Kolkata",
  LIPK: "Europe/Rome",
  OMDW: "Asia/Dubai",
  UAKK: "Asia/Almaty",
  UACC: "Asia/Almaty",
  UZSA: "Asia/Tashkent",
  ZHEC: "Asia/Shanghai",
  VVNB: "Asia/Ho_Chi_Minh",
  VIDP: "Asia/Kolkata",
  LCLK: "Asia/Nicosia",
  LBBG: "Europe/Sofia",
  LROD: "Europe/Bucharest",
  LHDC: "Europe/Budapest",
  LZIB: "Europe/Bratislava",
  LKPR: "Europe/Prague",
  LIME: "Europe/Rome",
  LFSB: "Europe/Paris",
  LEMD: "Europe/Madrid",
  LEVT: "Europe/Madrid",
  GMMN: "Africa/Casablanca",
  DTTA: "Africa/Tunis",
};

/** Zones offered as suggestions when editing an airport. Any valid IANA name is accepted. */
export const COMMON_ZONES: string[] = [
  "Europe/London",
  "Europe/Paris",
  "Europe/Rome",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Athens",
  "Europe/Istanbul",
  "Europe/Moscow",
  "Asia/Tbilisi",
  "Asia/Baku",
  "Asia/Yerevan",
  "Asia/Dubai",
  "Asia/Tashkent",
  "Asia/Almaty",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Africa/Cairo",
  "Africa/Casablanca",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
];

/** The zone to store for an airport that has none: from the directory by ICAO, else the zone that matches its fixed offset. */
export function defaultTzFor(icao: string, utcOffsetMinutes: number): string | undefined {
  return TZ_BY_ICAO[icao] ?? tzForFixedOffset(utcOffsetMinutes);
}
