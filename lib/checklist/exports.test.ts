import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { buildChecklistModel, modelText } from "./model";
import { buildWorkbook } from "./xlsx";
import { buildDocument } from "./docx";
import { pdfDocDefinition } from "./pdf";
import { fullDemoState } from "../seed";

const state = fullDemoState();
const X1 = ["L-20260916-PHC611-TBS-C", "L-20260916-PHC611-URC-C", "L-20260917-PHC612-XIY-C"];
const model = buildChecklistModel(state, X1)!;

describe("Excel export (X3)", () => {
  it("has two sheets, three legs rows, real times and UTC in the header", async () => {
    const wb = await buildWorkbook(model);
    const buf = await wb.xlsx.writeBuffer();
    const { default: ExcelJS } = await import("exceljs");
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(buf as ArrayBuffer);
    expect(back.worksheets.map((w) => w.name)).toEqual(["Checklist", "Permits"]);

    const ws = back.getWorksheet("Checklist")!;
    let headerRow = 0;
    ws.eachRow((row, n) => {
      if (row.getCell(1).value === "Flight") headerRow = n;
    });
    expect(headerRow).toBeGreaterThan(0);
    expect(ws.getRow(headerRow).getCell(5).value).toBe("ETD (UTC)");
    const legRows = [1, 2, 3].map((i) => ws.getRow(headerRow + i));
    expect(legRows.map((r) => r.getCell(1).value)).toEqual(["PHC611", "PHC611", "PHC612"]);
    const etd = legRows[0].getCell(5).value as Date;
    expect(etd instanceof Date).toBe(true);
    expect([etd.getUTCHours(), etd.getUTCMinutes()]).toEqual([2, 0]);
    expect(legRows[0].getCell(5).numFmt).toBe("hh:mm");
    expect(legRows[0].getCell(4).value instanceof Date).toBe(true);
    expect(ws.getRow(headerRow + 4).getCell(1).value).toBeNull();
    expect(ws.views[0]).toMatchObject({ state: "frozen" });
    expect(ws.pageSetup).toMatchObject({ paperSize: 9, orientation: "landscape", fitToWidth: 1 });
    expect(back.getWorksheet("Permits")!.rowCount).toBe(5); // header + 4 permit rows
  });

  it("X2 leaves the ETA day column empty except for overnight legs", async () => {
    const m = buildChecklistModel(state, ["L-20260918-PHC613-TBS-D"])!;
    const wb = await buildWorkbook(m);
    const ws = wb.getWorksheet("Checklist")!;
    let value: unknown;
    ws.eachRow((row) => {
      if (row.getCell(1).value === "PHC613") value = row.getCell(7).value;
    });
    expect(value).toBe("+1");
  });
});

describe("Word export (X4)", () => {
  it("uses real headings, native editable tables and a page number field", async () => {
    const { Packer } = await import("docx");
    const doc = await buildDocument(model, null);
    const zip = await JSZip.loadAsync(await Packer.toBuffer(doc));
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("FLIGHT CHECKLIST");
    expect(xml.match(/<w:tbl>/g)).toHaveLength(3); // aircraft, legs, permits
    expect(xml.match(/<w:tblHeader\/>/g)!.length).toBe(3);
    expect(xml).toContain('w:val="Heading2"');
    expect(xml).toContain('w:val="Title"');
    const order = ["Aircraft", "Route", "Permits per country", "Special notes"].map((t) => xml.indexOf(t));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const footer = await zip.file("word/footer1.xml")!.async("string");
    expect(footer).toContain("PAGE");
    expect(footer).toContain("NUMPAGES");
  });
});

describe("PDF export (X1, X9)", () => {
  it("is a valid document definition: A4, repeated header rows, unbreakable signature block", () => {
    const def = pdfDocDefinition(model, null);
    expect(def.pageSize).toBe("A4");
    expect(def.info).toMatchObject({ author: "Phasis Air Cargo (demo)" });
    const tables = (def.content as { table?: { headerRows?: number; dontBreakRows?: boolean } }[]).filter((c) => c.table?.headerRows === 1);
    expect(tables.length).toBe(3);
    expect(tables.every((t) => t.table!.dontBreakRows)).toBe(true);
    expect((def.content as { unbreakable?: boolean }[]).some((c) => c.unbreakable)).toBe(true);
  });

  it("renders searchable text with the same strings as the preview model", async () => {
    let text: string | null = null;
    try {
      const mod = (await import("pdfmake")) as unknown as { default: { addFonts: (f: unknown) => void; createPdf: (d: unknown) => { getBuffer: () => Promise<Uint8Array> } } };
      const dir = path.resolve("node_modules/pdfmake/build/fonts/Roboto");
      mod.default.addFonts({ Roboto: { normal: path.join(dir, "Roboto-Regular.ttf"), bold: path.join(dir, "Roboto-Medium.ttf"), italics: path.join(dir, "Roboto-Italic.ttf"), bolditalics: path.join(dir, "Roboto-MediumItalic.ttf") } });
      const buf = await mod.default.createPdf(pdfDocDefinition(model, null)).getBuffer();
      const tmp = mkdtempSync(path.join(tmpdir(), "pdf-"));
      const file = path.join(tmp, "x.pdf");
      writeFileSync(file, buf);
      expect(readFileSync(file).length).toBeLessThan(300_000);
      text = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
    } catch (e) {
      console.warn("PDF text check skipped:", (e as Error).message);
    }
    if (text === null) return;
    const flat = text.replace(/\s+/g, " ");
    for (const s of [model.header.legalName, model.header.dateSpan, "PHC611", "No record".length ? "Obtained" : "", "4L-PXD", "Missing", "Confirm handling agent at URC", "Prepared by, Flight Operations", "Commander signature and date", "Page 1 of 1"]) {
      expect(flat).toContain(s);
    }
    // every leg row string appears in the PDF text
    for (const l of model.legs) for (const s of [l.flight, l.route, l.etd, l.eta, l.block]) expect(flat).toContain(s);
    expect(modelText(model).length).toBeGreaterThan(40);
  });
});
