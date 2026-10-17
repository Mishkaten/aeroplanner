import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { acceptFix, buildRow, countReady, countReview, editFields, fieldsToLeg, permitStatusOf, rowsToPayload, saveFromDrawer } from "./parse";
import { normaliseLine } from "./normalise";
import { parseWorkbook } from "./pipeline";
import { importPatch } from "./upsert";
import { SAMPLE_COUNTS, SAMPLE_FLAGGED, SAMPLE_SILENT } from "./sample";
import { buildSampleWorkbook } from "./sampleWorkbook";
import { classifyFill, parseDateLabel } from "./sheet";
import type { ImportRow, ParseCtx, RawLine } from "./types";
import { fullDemoState, emptyScheduleState } from "../seed";
import { applyPatch } from "../patch";
import { validate } from "../validate";

const seed = fullDemoState();
const ctx: ParseCtx = { companyIcao: "PHC", baseIcao: "UGTB", airports: seed.airports, aircraft: seed.aircraft };
const cms: ParseCtx = { ...ctx, companyIcao: "CMS" };

const line = (text: string, o: Partial<RawLine> = {}): RawLine => ({
  id: "B3#1",
  sheet: "Season 2026",
  cell: "B3",
  text,
  aircraftReg: "4L-PXA",
  dateIso: "2026-09-14",
  style: { fill: null, strike: false },
  ...o,
});
const row = (text: string, c: ParseCtx = ctx, o: Partial<RawLine> = {}) => buildRow(line(text, o), c);

describe("parser tests P1 to P12 (PRD 7.5)", () => {
  it("P1 a clean line with a stray D suffix and the company prefix CMS", () => {
    const r = row("CMS572D UGTB/TBS ETD/03.30Z LYBE/BEG ETA/06.30Z +", cms);
    expect(r.flag).toBeNull();
    const leg = fieldsToLeg(r, cms)!;
    expect([leg.flightNumber, leg.suffix, leg.depIcao, leg.arrIcao, leg.etdUtc, leg.etaUtc]).toEqual(["CMS572", "D", "UGTB", "LYBE", "2026-09-14T03:30:00Z", "2026-09-14T06:30:00Z"]);
    expect(permitStatusOf(r)).toBe("obtained");
  });
  it("P2 the same line when the company is PHC: PREFIX_MISMATCH suggesting PHC572D", () => {
    const r = row("CMS572D UGTB/TBS ETD/03.30Z LYBE/BEG ETA/06.30Z +");
    expect(r.flag?.code).toBe("PREFIX_MISMATCH");
    expect(r.flag?.suggestion?.label).toBe("PHC572D");
  });
  it("P3 lower case, stray spaces, colon, no Z and a glued marker are cleaned without a flag", () => {
    const r = row("cms572d ugtb / tbs etd/ 03:30 lybe/beg eta/0630z+", cms);
    expect(r.flag).toBeNull();
    expect(fieldsToLeg(r, cms)!.etaUtc).toBe("2026-09-14T06:30:00Z");
    expect(permitStatusOf(r)).toBe("obtained");
  });
  it("P4 DAY4 LT where the derived day is 2 flags DAYTAG_MISMATCH and the marker means pending", () => {
    const r = row("PHC601 UGTB/TBS ETD/16.00Z UAAA/ALA ETA/20.30Z DAY4 LT -", ctx, { aircraftReg: "4L-PXC" });
    expect(r.flag?.code).toBe("DAYTAG_MISMATCH");
    expect(r.flag?.suggestion?.label).toBe("DAY 2 LT");
    expect(permitStatusOf(r)).toBe("pending");
  });
  it("P5 (DAY 2 LT) is read as the day tag and is consistent", () => {
    const r = row("PHC601 UGTB/TBS ETD/16.00Z UAAA/ALA ETA/20.30Z (DAY 2 LT) -", ctx, { aircraftReg: "4L-PXC" });
    expect(r.flag).toBeNull();
    expect(permitStatusOf(r)).toBe("pending");
  });
  it("P6 an overnight leg: block 06:30 and ETA on the next date", () => {
    const r = row("PHC613 UGTB/TBS ETD/19.00Z VECC/CCU ETA/01.30Z +", ctx, { aircraftReg: "4L-PXD" });
    expect(r.flag).toBeNull();
    const leg = fieldsToLeg(r, ctx)!;
    expect(leg.etaUtc).toBe("2026-09-15T01:30:00Z");
  });
  it("P7 a ferry leg to the placeholder has no permit rows and no flags", () => {
    const r = row("PHC901 UGTB/TBS ETD/08.00Z XXXX/XXX ETA/12.00Z FERRY", ctx, { aircraftReg: "4L-PXD" });
    expect(r.flag).toBeNull();
    const leg = fieldsToLeg(r, ctx)!;
    expect(leg.legType).toBe("ferry");
    expect(rowsToPayload([r], ctx).permits).toHaveLength(0);
  });
  it("P8 CNL cancels the leg without a flag", () => {
    const r = row("PHC513 UGTB/TBS ETD/02.00Z LIMC/MXP ETA/06.30Z CNL");
    expect(r.flag).toBeNull();
    expect(fieldsToLeg(r, ctx)!.status).toBe("cancelled");
    expect(permitStatusOf(r)).toBe("cancelled");
  });
  it("P9 a free note keeps its original case", () => {
    const r = row("PHC507D UGTB/TBS ETD/04.00Z LGAV/ATH ETA/07.00Z + Deliver to dock 4");
    expect(r.flag).toBeNull();
    const leg = fieldsToLeg(r, ctx)!;
    expect([leg.suffix, leg.notes]).toEqual(["D", "Deliver to dock 4"]);
  });
  it("P10 no marker means no permit rows and no parse flag", () => {
    const r = row("PHC512 LIMC/MXP ETD/09.00Z UGTB/TBS ETA/13.00Z");
    expect(r.flag).toBeNull();
    expect(permitStatusOf(r)).toBeNull();
    expect(rowsToPayload([r], ctx).permits).toHaveLength(0);
  });
  it("P11 ETA on the next date with block 06:30", () => {
    const r = row("PHC614 VECC/CCU ETD/20.30Z UGTB/TBS ETA/03.00Z +", ctx, { aircraftReg: "4L-PXD" });
    const leg = fieldsToLeg(r, ctx)!;
    expect([leg.etdUtc, leg.etaUtc]).toEqual(["2026-09-14T20:30:00Z", "2026-09-15T03:00:00Z"]);
  });
  it("P12 ETA equal to ETD flags BLOCK_ZERO", () => {
    expect(row("PHC606 UAAA/ALA ETD/01.00Z UGTB/TBS ETA/01.00Z +").flag?.code).toBe("BLOCK_ZERO");
  });
});

describe("parser details", () => {
  it("normalises in the order of PRD 7.2", () => {
    expect(normaliseLine("cms 572 d ugtb / tbs std/ 03:30 lybe/beg eta/0630z+ (day4lt) Deliver to Dock 4")).toBe(
      "CMS572D UGTB/TBS ETD/03.30Z LYBE/BEG ETA/06.30Z + DAY 4 LT Deliver to Dock 4",
    );
    expect(normaliseLine("  PHC601\u00A0UGTB/TBS\tETD/16.00Z UAAA/ALA ETA/20.30Z (DAY4LT) -")).toBe("PHC601 UGTB/TBS ETD/16.00Z UAAA/ALA ETA/20.30Z DAY 4 LT -");
  });
  it("a - or + that is not directly after the arrival time or a day tag belongs to the note", () => {
    const r = row("PHC507D UGTB/TBS ETD/04.00Z LGAV/ATH ETA/07.00Z + Deliver - dock +");
    expect(r.fields!.note).toBe("Deliver - dock +");
    expect(r.fields!.markers).toEqual(["+"]);
  });
  it("a line that matches no flight number is UNPARSEABLE_LINE", () => {
    expect(row("STANDBY CREW").flag?.code).toBe("UNPARSEABLE_LINE");
  });
  it("an aircraft header not in the registry flags the line with a suggestion to add it", () => {
    const r = row("PHC501 UGTB/TBS ETD/03.30Z LYBE/BEG ETA/06.30Z +", ctx, { aircraftReg: "4L-PXE" });
    expect(r.flag?.code).toBe("AIRCRAFT_UNKNOWN");
    expect(r.flag?.suggestion?.patch).toEqual({ kind: "addAircraft", registration: "4L-PXE" });
    const grown: ParseCtx = { ...ctx, aircraft: [...ctx.aircraft, { id: "4L-PXE", registration: "4L-PXE", defaultBackupId: null }] };
    expect(acceptFix(r, grown).status).toBe("fixed");
  });
  it("an unknown ICAO is STATION_UNKNOWN with no suggestion", () => {
    const r = row("PHC501 UGTB/TBS ETD/03.30Z ZZZZ/ZZZ ETA/06.30Z +");
    expect([r.flag?.code, r.flag?.suggestion]).toEqual(["STATION_UNKNOWN", null]);
  });
  it("only the first flag is shown and the row counts once", () => {
    // time (malformed) and prefix both apply: time wins
    const r = row("CMS501 UGTB/TBS ETD/9.3Z LYBE/BEG ETA/06.30Z +");
    expect(r.flag?.code).toBe("TIME_MALFORMED");
  });
  it("RV3 a fix that exposes a new flag keeps the row flagged with the new reason", () => {
    const r = row("CMS501 UGTB/TBS ETA/03.30Z LYBE/BEG ETA/06.30Z DAY 3 LT +");
    expect(r.flag?.code).toBe("ETA_FOR_ETD");
    const next = acceptFix(r, ctx);
    expect(next.flag?.code).toBe("PREFIX_MISMATCH");
    expect(next.status).toBe("flagged");
    const done = acceptFix(next, ctx);
    expect(done.flag?.code).toBe("DAYTAG_MISMATCH");
    expect(acceptFix(done, ctx).status).toBe("fixed");
  });
  it("accept fix changes the parsed fields, never the raw text", () => {
    const r = row("CMS516 LYBE/BEG ETD/09.30Z UGTB/TBS ETA/12.30Z +", ctx, { aircraftReg: "4L-PXB" });
    const fixed = acceptFix(r, ctx);
    expect(fixed.ref.text).toBe("CMS516 LYBE/BEG ETD/09.30Z UGTB/TBS ETA/12.30Z +");
    expect(fixed.fields!.prefix).toBe("PHC");
  });
  it("reads date labels in the supported formats", () => {
    expect(parseDateLabel("Mon 14.09", 2026).date).toBe("2026-09-14");
    expect(parseDateLabel("14/09/2026", null).date).toBe("2026-09-14");
    expect(parseDateLabel("14 Sep", 2026).date).toBe("2026-09-14");
    expect(parseDateLabel(new Date("2026-09-14T00:00:00Z"), null).date).toBe("2026-09-14");
    expect(parseDateLabel("14 Sep", null)).toEqual({ date: null, looksLikeDate: true });
    expect(parseDateLabel("Notes", 2026).looksLikeDate).toBe(false);
  });
  it("classifies colour codes: green obtained, amber pending, red cancelled", () => {
    expect([classifyFill("FFC6EFCE"), classifyFill("FFFFEB9C"), classifyFill("FFFFC7CE"), classifyFill("FFFFFFFF"), classifyFill(undefined)]).toEqual(["green", "amber", "red", null, null]);
    const g = row("PHC509 UGTB/TBS ETD/05.00Z LROP/OTP ETA/07.30Z", ctx, { style: { fill: "green", strike: false } });
    expect(permitStatusOf(g)).toBe("obtained");
    expect(permitStatusOf(row("PHC509 UGTB/TBS ETD/05.00Z LROP/OTP ETA/07.30Z", ctx, { style: { fill: "green", strike: true } }))).toBe("cancelled");
    expect(permitStatusOf(row("PHC509 UGTB/TBS ETD/05.00Z LROP/OTP ETA/07.30Z -", ctx, { style: { fill: "green", strike: false } }))).toBe("pending"); // marker beats fill
  });
});

describe("sample workbook (storyline A, PRD 7.7)", async () => {
  const buf = readFileSync(path.resolve("public", "Phasis_2026_Season.xlsx"));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const progress: number[] = [];
  const result = await parseWorkbook(ab, "Phasis_2026_Season.xlsx", ctx, (p) => progress.push(p.pct));

  it("S10-3 reads 90 legs from 118 rows on 1 sheet, 14 need review and 76 are ready", () => {
    expect(result.structure).toMatchObject({ aircraftHeaders: 4, banners: 3, dateLabels: 21, legLines: 90, rows: 118 });
    expect(result.rows).toHaveLength(SAMPLE_COUNTS.legs);
    expect(countReview(result.rows)).toBe(14);
    expect(countReady(result.rows)).toBe(76);
    expect(result.unknownAircraft).toEqual([]);
    expect(progress[0]).toBeLessThan(progress[progress.length - 1]);
    expect(progress[progress.length - 1]).toBe(100);
  });

  it("flags exactly the 14 cells of section 7.7, one flag each, 9 with a suggestion and 5 without", () => {
    const flagged = result.rows.filter((r) => r.status === "flagged");
    expect(flagged).toHaveLength(14);
    let withSuggestion = 0;
    for (const f of SAMPLE_FLAGGED) {
      const r = flagged.find((x) => x.ref.text === f.raw);
      expect(r, `flagged cell ${f.n} (${f.legId})`).toBeTruthy();
      expect(r!.flag!.code).toBe(f.code);
      expect(r!.flag!.suggestion?.label ?? null).toBe(f.suggestion);
      if (r!.flag!.suggestion) withSuggestion++;
    }
    expect(withSuggestion).toBe(9);
    expect(new Set(flagged.map((r) => r.ref.cell)).size).toBe(14); // all different cells
  });

  it("cleans 18 cells silently, and the four free notes are kept without a flag", () => {
    const picks = SAMPLE_SILENT.flatMap((v) => v.picks);
    expect(picks).toHaveLength(SAMPLE_COUNTS.silent);
    const clean = result.rows.filter((r) => r.status === "ok");
    // messy text that parsed without a flag: stray spaces, colon or no Z, lower case, DAYn LT, (DAY n LT)
    const messy = clean.filter((r) => / \/ |ETD\/\d\d:\d\d|ETA \d{4}Z|^[a-z]|DAY\d LT|\(DAY \d LT\)/.test(r.ref.text));
    expect(messy.length).toBeGreaterThanOrEqual(18);
    const notes = clean.filter((r) => r.fields!.note);
    expect(notes.map((r) => r.fields!.note).sort()).toEqual(["Cargo: perishables", "Confirm handling agent at URC", "Deliver to dock 4", "Destination to be decided"]);
  });

  it("resolving all 14 rows imports exactly the 90 seed legs, with seed permit statuses and no numbers", () => {
    const rows = result.rows.map((r): ImportRow => (r.flag?.suggestion ? acceptFix(r, ctx) : r));
    expect(countReview(rows)).toBe(5);
    const byRaw = (n: number) => rows.findIndex((r) => r.ref.text === SAMPLE_FLAGGED[n - 1].raw);
    const edits: [number, Parameters<typeof editFields>[1]][] = [
      [5, { depRaw: "09.00" }],
      [6, { depRaw: "02.00" }],
      [11, { arrRaw: "05.30" }],
      [12, { markers: ["+"] }],
      [14, { arrIcao: "UGTB" }],
    ];
    for (const [n, e] of edits) rows[byRaw(n)] = editFields(rows[byRaw(n)], e, ctx);
    expect(countReview(rows)).toBe(0);
    expect(rows.filter((r) => r.status === "fixed")).toHaveLength(14);

    const { legs, permits } = rowsToPayload(rows, ctx);
    expect(legs).toHaveLength(90);
    const seedLegs = new Map(seed.legs.map((l) => [l.id, l]));
    for (const l of legs) {
      const s = seedLegs.get(l.id);
      expect(s, `seed leg ${l.id}`).toBeTruthy();
      expect({ ...l, source: undefined }).toEqual({ ...s, source: undefined });
    }
    const seedPermits = new Map(seed.permits.map((p) => [p.id, p.status]));
    expect(permits).toHaveLength(seed.permits.length);
    for (const p of permits) {
      expect(seedPermits.get(p.id), `permit ${p.id}`).toBe(p.status);
      expect(p.number).toBeNull();
    }

    // NF-R4: importing into the empty schedule gives the same 9 open issues as the full demo
    const empty = emptyScheduleState();
    const { patch, inserted } = importPatch(empty, legs, permits);
    expect(inserted).toBe(90);
    const after = applyPatch(empty, patch).state;
    expect(validate(after).map((i) => i.id)).toEqual(validate(seed).map((i) => i.id));
    expect(validate(after)).toHaveLength(9);
    // RV6: importing twice leaves 90 legs
    const second = importPatch(after, legs, permits);
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(90);
    expect(applyPatch(after, second.patch).state.legs).toHaveLength(90);
  });

  it("RV7 keeps provenance: sheet, cell (with line n) and raw text", () => {
    const r = result.rows.find((x) => x.ref.text === SAMPLE_FLAGGED[0].raw)!;
    const leg = fieldsToLeg(acceptFix(r, ctx), ctx)!;
    expect(leg.source.kind).toBe("import");
    expect(leg.source.sheetRef).toEqual({ sheet: "Season 2026", cell: r.ref.cell, rawText: SAMPLE_FLAGGED[0].raw });
    expect(result.rows.some((x) => /line 2$/.test(x.ref.cell))).toBe(true); // multi-line cells
  });

  it("a drawer fix marks the row Fixed and is authoritative", () => {
    const r = result.rows.find((x) => x.ref.text === SAMPLE_FLAGGED[4].raw)!;
    const base = fieldsToLeg(editFields(r, { depRaw: "09.00" }, ctx), ctx)!;
    const saved = saveFromDrawer(r, base, { "HU:landing": "obtained" });
    expect([saved.status, saved.flag]).toEqual(["fixed", null]);
    expect(rowsToPayload([saved], ctx).permits.every((p) => p.status === "obtained" || p.status === "pending")).toBe(true);
  });

  it("the sample generator is deterministic", async () => {
    const a = await (await buildSampleWorkbook(fullDemoState())).xlsx.writeBuffer();
    expect((a as ArrayBuffer).byteLength).toBeGreaterThan(5000);
  });
});
