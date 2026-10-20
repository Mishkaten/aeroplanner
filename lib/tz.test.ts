import { describe, expect, it } from "vitest";
import { airportOffset, formatUtcOffset, isValidTz, localToUtc, observesDst, offsetAt, tzForFixedOffset } from "./tz";
import { defaultTzFor } from "./tzdata";
import { dayTag, localArrival } from "./legs";
import { indexAirports } from "./airports";
import { normalizeData } from "./workspace";
import { blankAirportForm, validateAirport } from "./forms";
import { buildRows } from "./export/rows";
import { buildSsim } from "./export/ssim";
import { fullDemoState } from "./seed";
import type { Leg } from "./types";

const state = fullDemoState();
const idx = indexAirports(state.airports);
const at = (iso: string) => Date.parse(iso);

describe("offsetAt", () => {
  it("follows daylight saving: Belgrade is +2 in summer and +1 after 25 Oct 2026", () => {
    expect(offsetAt("Europe/Belgrade", at("2026-09-14T12:00:00Z"))).toBe(120);
    expect(offsetAt("Europe/Belgrade", at("2026-10-25T00:59:00Z"))).toBe(120);
    expect(offsetAt("Europe/Belgrade", at("2026-10-25T01:00:00Z"))).toBe(60);
    expect(offsetAt("Europe/Belgrade", at("2026-11-02T12:00:00Z"))).toBe(60);
  });
  it("zones without daylight saving never change", () => {
    for (const d of ["2026-01-10T12:00:00Z", "2026-07-10T12:00:00Z"]) {
      expect(offsetAt("Asia/Tbilisi", at(d))).toBe(240);
      expect(offsetAt("Asia/Kolkata", at(d))).toBe(330);
      expect(offsetAt("Asia/Shanghai", at(d))).toBe(480);
    }
  });
  it("an unknown zone is null and invalid", () => {
    expect(offsetAt("Mars/Olympus", 0)).toBeNull();
    expect(isValidTz("Mars/Olympus")).toBe(false);
    expect(isValidTz("Europe/Rome")).toBe(true);
    expect(isValidTz("")).toBe(false);
  });
});

describe("the starter directory", () => {
  it("every station's zone gives its stored offset on the demo dates, so the demo data does not change", () => {
    for (const a of state.airports.filter((x) => !x.provisional)) {
      expect(a.tzId, a.icao).toBeTruthy();
      for (const d of ["2026-09-14T12:00:00Z", "2026-10-04T12:00:00Z"]) expect(airportOffset(a, at(d)), `${a.icao} ${d}`).toBe(a.utcOffsetMinutes);
    }
  });
  it("the placeholder has no zone", () => {
    expect(state.airports.find((a) => a.icao === "XXXX")!.tzId).toBeUndefined();
  });
  it("European stations observe daylight saving, Georgian and Chinese ones do not", () => {
    const get = (i: string) => state.airports.find((a) => a.icao === i)!;
    expect(observesDst(get("LYBE"), 2026)).toBe(true);
    expect(observesDst(get("UGTB"), 2026)).toBe(false);
    expect(observesDst(get("ZLXY"), 2026)).toBe(false);
  });
});

describe("airportOffset fallback", () => {
  it("uses the fixed offset when there is no zone", () => {
    expect(airportOffset({ utcOffsetMinutes: 90 }, at("2026-10-30T00:00:00Z"))).toBe(90);
    expect(airportOffset({ utcOffsetMinutes: 90, tzId: "nope/zone" }, 0)).toBe(90);
  });
});

describe("local wall clock to UTC", () => {
  const bud = { tzId: "Europe/Budapest", utcOffsetMinutes: 120 };
  const wall = (s: string) => Date.parse(s + "Z");
  it("an ordinary time", () => {
    const r = localToUtc(bud, wall("2026-09-14T10:00:00"));
    expect(new Date(r.utcMs).toISOString()).toBe("2026-09-14T08:00:00.000Z");
    expect([r.nonexistent, r.ambiguous]).toEqual([false, false]);
  });
  it("a time that does not exist when the clocks go forward (29 Mar 2026, 02:30)", () => {
    expect(localToUtc(bud, wall("2026-03-29T02:30:00")).nonexistent).toBe(true);
  });
  it("a time that happens twice when the clocks go back (25 Oct 2026, 02:30) uses the first", () => {
    const r = localToUtc(bud, wall("2026-10-25T02:30:00"));
    expect(r.ambiguous).toBe(true);
    expect(new Date(r.utcMs).toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });
  it("the same wall time a week later is one hour later in UTC", () => {
    const before = localToUtc(bud, wall("2026-10-24T10:00:00")).utcMs;
    const after = localToUtc(bud, wall("2026-10-26T10:00:00")).utcMs;
    expect(after - before).toBe(49 * 3_600_000);
  });
});

describe("day tags and local arrival across the change", () => {
  const leg = (arrIcao: string, etaUtc: string) => ({ arrIcao, etaUtc }) as Pick<Leg, "arrIcao" | "etaUtc">;
  it("arrival in Belgrade at 22:30Z on 24 Oct is already the next day (UTC+2) but on 26 Oct it is not (UTC+1)", () => {
    expect(dayTag(leg("LYBE", "2026-10-24T22:30:00Z"), idx)).not.toBeNull();
    expect(dayTag(leg("LYBE", "2026-10-26T22:30:00Z"), idx)).toBeNull();
  });
  it("localArrival reports the offset that applies on that date", () => {
    expect(localArrival(leg("LYBE", "2026-09-14T10:00:00Z"), idx)!.offsetMinutes).toBe(120);
    expect(localArrival(leg("LYBE", "2026-11-02T10:00:00Z"), idx)!.offsetMinutes).toBe(60);
  });
});

describe("saved workspaces from before time zones", () => {
  it("get a zone from the directory by ICAO, or a fixed zone that matches their offset", () => {
    const old = state.airports.map(({ tzId, ...a }) => {
      void tzId;
      return a;
    });
    const custom = { id: "ZZZZ", icao: "ZZZZ", iata: "ZZZ", name: "Custom", countryCode: "GE", utcOffsetMinutes: 240, lat: null, lon: null, provisional: false };
    const n = normalizeData({ airports: [...old, custom] as never });
    expect(n.airports.find((a) => a.icao === "LYBE")!.tzId).toBe("Europe/Belgrade");
    expect(n.airports.find((a) => a.icao === "ZZZZ")!.tzId).toBe("Etc/GMT-4");
    expect(n.airports.find((a) => a.icao === "XXXX")!.tzId).toBeUndefined();
  });
  it("a zone that is already stored is kept", () => {
    const a = { ...state.airports[0], tzId: "Asia/Baku" };
    expect(normalizeData({ airports: [a] }).airports[0].tzId).toBe("Asia/Baku");
  });
  it("fixed-offset helpers", () => {
    expect(tzForFixedOffset(240)).toBe("Etc/GMT-4");
    expect(tzForFixedOffset(-300)).toBe("Etc/GMT+5");
    expect(tzForFixedOffset(0)).toBe("Etc/UTC");
    expect(tzForFixedOffset(330)).toBe("Asia/Kolkata");
    expect(tzForFixedOffset(345)).toBeUndefined();
    expect(defaultTzFor("LGAV", 180)).toBe("Europe/Athens");
    expect(formatUtcOffset(330)).toBe("UTC+5:30");
    expect(formatUtcOffset(-180)).toBe("UTC-3");
  });
});

describe("airport form", () => {
  const base = { ...blankAirportForm(), icao: "LTFM", iata: "IST", name: "Istanbul", countryCode: "TR" };
  it("an unknown zone is an error", () => {
    expect(validateAirport({ ...base, tzId: "Nowhere/City" }, state.airports, null).errors.tzId).toMatch(/Unknown time zone/);
  });
  it("a valid zone is stored and the offset comes from it", () => {
    const r = validateAirport({ ...base, tzId: "Europe/Istanbul", offset: "+9" }, state.airports, null);
    expect(r.value?.tzId).toBe("Europe/Istanbul");
    expect(r.value?.utcOffsetMinutes).toBe(180);
  });
  it("no zone keeps the typed fixed offset", () => {
    const r = validateAirport({ ...base, tzId: "", offset: "+3" }, state.airports, null);
    expect(r.value?.tzId).toBeUndefined();
    expect(r.value?.utcOffsetMinutes).toBe(180);
  });
});

describe("export and SSIM across the change", () => {
  const src = state.legs.find((l) => l.depIcao === "UGTB" && l.arrIcao === "LYBE" && l.status === "planned")!;
  const shiftDays = (n: number): Leg => {
    const f = (s: string) => new Date(Date.parse(s) + n * 86_400_000).toISOString().replace(".000Z", "Z");
    return { ...src, id: `${src.id}+${n}`, etdUtc: f(src.etdUtc), etaUtc: f(src.etaUtc) };
  };
  // src is on Mon 14 Sep: +35 is Mon 19 Oct (summer time), +42 is Mon 26 Oct (winter time)
  const legs = [shiftDays(35), shiftDays(42)];
  it("local times use the offset of the day", () => {
    const rows = buildRows(state, legs);
    expect(rows.map((r) => r.arrOffsetMin)).toEqual([120, 60]);
  });
  it("a weekly SSIM pattern is split where the offset changes", () => {
    const rows = buildRows(state, legs);
    const text = buildSsim(rows, { carrier: "P7", title: "T", createdAt: "2026-10-01T10:00:00Z" }).text;
    const recs = text.split("\r\n").filter((l) => l[0] === "3");
    expect(recs).toHaveLength(2);
    expect(recs.map((r) => r.slice(65, 70))).toEqual(["+0200", "+0100"]);
  });
});
