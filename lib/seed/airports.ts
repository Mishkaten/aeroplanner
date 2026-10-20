import type { Airport } from "../types";
import { defaultTzFor } from "../tzdata";

// Offsets are the European summer offsets of the demo range. Each airport also has a time zone, which follows daylight saving.
// Coordinates are approximate and used only for the schematic route map.
const RAW: Omit<Airport, "id">[] = [
  { icao: "UGTB", iata: "TBS", name: "Tbilisi International", countryCode: "GE", utcOffsetMinutes: 240, lat: 41.669, lon: 44.955, provisional: false },
  { icao: "ZWWW", iata: "URC", name: "Urumqi Diwopu", countryCode: "CN", utcOffsetMinutes: 480, lat: 43.907, lon: 87.474, provisional: false },
  { icao: "ZLXY", iata: "XIY", name: "Xi'an Xianyang", countryCode: "CN", utcOffsetMinutes: 480, lat: 34.447, lon: 108.752, provisional: false },
  { icao: "UAAA", iata: "ALA", name: "Almaty International", countryCode: "KZ", utcOffsetMinutes: 300, lat: 43.352, lon: 77.04, provisional: false },
  { icao: "LYBE", iata: "BEG", name: "Belgrade Nikola Tesla", countryCode: "RS", utcOffsetMinutes: 120, lat: 44.818, lon: 20.309, provisional: false },
  { icao: "LGAV", iata: "ATH", name: "Athens Eleftherios Venizelos", countryCode: "GR", utcOffsetMinutes: 180, lat: 37.936, lon: 23.944, provisional: false },
  { icao: "LHBP", iata: "BUD", name: "Budapest Ferenc Liszt", countryCode: "HU", utcOffsetMinutes: 120, lat: 47.437, lon: 19.262, provisional: false },
  { icao: "LROP", iata: "OTP", name: "Bucharest Henri Coanda", countryCode: "RO", utcOffsetMinutes: 180, lat: 44.572, lon: 26.102, provisional: false },
  { icao: "LIMC", iata: "MXP", name: "Milan Malpensa", countryCode: "IT", utcOffsetMinutes: 120, lat: 45.63, lon: 8.723, provisional: false },
  { icao: "VHHH", iata: "HKG", name: "Hong Kong International", countryCode: "HK", utcOffsetMinutes: 480, lat: 22.309, lon: 113.915, provisional: false },
  { icao: "VECC", iata: "CCU", name: "Kolkata Netaji Subhas Chandra Bose", countryCode: "IN", utcOffsetMinutes: 330, lat: 22.654, lon: 88.447, provisional: false },
  { icao: "LIPK", iata: "FRL", name: "Forli", countryCode: "IT", utcOffsetMinutes: 120, lat: 44.195, lon: 12.07, provisional: false },
  { icao: "OMDW", iata: "DWC", name: "Dubai Al Maktoum International", countryCode: "AE", utcOffsetMinutes: 240, lat: 24.896, lon: 55.161, provisional: false },
  { icao: "XXXX", iata: "XXX", name: "Placeholder (TBD)", countryCode: "XX", utcOffsetMinutes: 0, lat: null, lon: null, provisional: true },
];

const withTz = <T extends { icao: string; utcOffsetMinutes: number }>(a: T): T & { tzId?: string } => {
  const tzId = a.icao === "XXXX" ? undefined : defaultTzFor(a.icao, a.utcOffsetMinutes);
  return tzId ? { ...a, tzId } : a;
};

export const SEED_AIRPORTS: Airport[] = RAW.map((a) => ({ id: a.icao, ...withTz(a) }));

const EXTRA: Omit<Airport, "id" | "provisional">[] = [
  { icao: "UAKK", iata: "KGF", name: "Sary-Arka Karaganda", countryCode: "KZ", utcOffsetMinutes: 300, lat: 49.671, lon: 73.334 },
  { icao: "UACC", iata: "NQZ", name: "Astana Nursultan Nazarbayev", countryCode: "KZ", utcOffsetMinutes: 300, lat: 51.022, lon: 71.467 },
  { icao: "UZSA", iata: "NVI", name: "Navoi", countryCode: "UZ", utcOffsetMinutes: 300, lat: 40.117, lon: 65.171 },
  { icao: "ZHEC", iata: "EHU", name: "Ezhou Huahu", countryCode: "CN", utcOffsetMinutes: 480, lat: 30.34, lon: 115.04 },
  { icao: "VVNB", iata: "HAN", name: "Hanoi Noi Bai", countryCode: "VN", utcOffsetMinutes: 420, lat: 21.221, lon: 105.807 },
  { icao: "VIDP", iata: "DEL", name: "Delhi Indira Gandhi", countryCode: "IN", utcOffsetMinutes: 330, lat: 28.556, lon: 77.1 },
  { icao: "LCLK", iata: "LCA", name: "Larnaca", countryCode: "CY", utcOffsetMinutes: 180, lat: 34.875, lon: 33.625 },
  { icao: "LBBG", iata: "BOJ", name: "Burgas", countryCode: "BG", utcOffsetMinutes: 180, lat: 42.57, lon: 27.515 },
  { icao: "LROD", iata: "OMR", name: "Oradea", countryCode: "RO", utcOffsetMinutes: 180, lat: 47.025, lon: 21.9 },
  { icao: "LHDC", iata: "DEB", name: "Debrecen", countryCode: "HU", utcOffsetMinutes: 120, lat: 47.489, lon: 21.615 },
  { icao: "LZIB", iata: "BTS", name: "Bratislava", countryCode: "SK", utcOffsetMinutes: 120, lat: 48.17, lon: 17.213 },
  { icao: "LKPR", iata: "PRG", name: "Prague Vaclav Havel", countryCode: "CZ", utcOffsetMinutes: 120, lat: 50.101, lon: 14.26 },
  { icao: "LIME", iata: "BGY", name: "Bergamo Orio al Serio", countryCode: "IT", utcOffsetMinutes: 120, lat: 45.669, lon: 9.704 },
  { icao: "LFSB", iata: "BSL", name: "Basel Mulhouse Freiburg", countryCode: "FR", utcOffsetMinutes: 120, lat: 47.59, lon: 7.529 },
  { icao: "LEMD", iata: "MAD", name: "Madrid Barajas", countryCode: "ES", utcOffsetMinutes: 120, lat: 40.472, lon: -3.561 },
  { icao: "LEVT", iata: "VIT", name: "Vitoria Foronda", countryCode: "ES", utcOffsetMinutes: 120, lat: 42.883, lon: -2.724 },
  { icao: "GMMN", iata: "CMN", name: "Casablanca Mohammed V", countryCode: "MA", utcOffsetMinutes: 60, lat: 33.367, lon: -7.59 },
  { icao: "DTTA", iata: "TUN", name: "Tunis Carthage", countryCode: "TN", utcOffsetMinutes: 60, lat: 36.851, lon: 10.227 },
];

/** Airports a new workspace starts with: the demo directory plus stations common on cargo routes. Fully editable. Offsets are summer offsets. */
export function starterAirports(): Airport[] {
  return [...SEED_AIRPORTS.map((a) => ({ ...a })), ...EXTRA.map((a) => ({ id: a.icao, ...withTz(a), provisional: false }))];
}
