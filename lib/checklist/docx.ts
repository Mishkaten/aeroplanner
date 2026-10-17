import type { Document as DocxDocument } from "docx";
import { dataUrlToBytes } from "./map";
import type { ChecklistModel } from "./model";

const MM_TWIPS = 56.7;

/** Pure document builder: the same blocks as the PDF, as editable text and native tables. */
export async function buildDocument(m: ChecklistModel, mapPng: string | null): Promise<DocxDocument> {
  const d = await import("docx");
  const { Document, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, ImageRun, Footer, PageNumber, AlignmentType, BorderStyle, ShadingType } = d;

  const border = { style: BorderStyle.SINGLE, size: 4, color: "C9CFC6" };
  const borders = { top: border, bottom: border, left: border, right: border };
  const cell = (text: string, opts: { bold?: boolean; head?: boolean; width?: number } = {}) =>
    new TableCell({
      borders,
      width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
      shading: opts.head ? { type: ShadingType.CLEAR, fill: "EEF0EB", color: "auto" } : undefined,
      children: [new Paragraph({ children: [new TextRun({ text, bold: opts.bold || opts.head, size: 18 })] })],
    });
  const table = (head: string[], rows: string[][], boldFirst = false) =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ tableHeader: true, cantSplit: true, children: head.map((h) => cell(h, { head: true })) }),
        ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((v, i) => cell(v, { bold: boldFirst && i === 0 })) })),
      ],
    });
  const h2 = (text: string) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 80 }, children: [new TextRun({ text, size: 22 })] });

  const logo = m.header.logoDataUrl
    ? [new Paragraph({ children: [new ImageRun({ type: "png", data: dataUrlToBytes(m.header.logoDataUrl), transformation: { width: 48, height: 48 } })] })]
    : [new Paragraph({ children: [new TextRun({ text: "LOGO", size: 14, color: "46525F" })] })];

  const children = [
    ...logo,
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: m.header.legalName, bold: true, size: 32 })] }),
    new Paragraph({ children: [new TextRun({ text: m.header.idLine, size: 18 })] }),
    new Paragraph({ children: [new TextRun({ text: m.header.text, size: 18, color: "46525F" })] }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 200 }, children: [new TextRun({ text: `${m.header.title}   ${m.header.dateSpan}`, size: 26 })] }),

    h2("Aircraft"),
    table(["Role", "Registration", "Type", "Serial no.", "Year", "MTOW", "Payload"], m.aircraft.map((a) => [a.role, a.registration, a.type, a.serialNo, a.year, a.mtow, a.payload])),

    h2("Route"),
    ...(mapPng
      ? [new Paragraph({ children: [new ImageRun({ type: "png", data: dataUrlToBytes(mapPng), transformation: { width: 520, height: 170 } })] })]
      : []),
    new Paragraph({ children: [new TextRun({ text: m.route.legend.join("     "), size: 15, color: "46525F" })] }),
    table(
      ["Flight", "Aircraft", "Route", "Date", "ETD (UTC)", "ETA (UTC)", "Block", "Type"],
      m.legs.map((l) => [l.flight, l.aircraft, l.route, l.date, l.etd, l.eta + (l.etaPlus ? " (+1)" : "") + (l.dayTag ? ` ${l.dayTag}` : ""), l.block, l.type]),
      true,
    ),

    h2("Permits per country"),
    table(["Country", "Permit", "Flight", "Number", "Status", "Valid"], m.permits.map((p) => [p.country, p.permit, p.flight, p.number, p.status, p.valid])),

    h2("Special notes"),
    ...m.notes.map((n) => new Paragraph({ children: [new TextRun({ text: n, size: 18 })] })),

    new Paragraph({ spacing: { before: 600 }, children: [new TextRun({ text: "______________________________          ______________________________", size: 18 })] }),
    new Paragraph({ children: [new TextRun({ text: `${m.signatures[0]}                    ${m.signatures[1]}`, size: 16, color: "46525F" })] }),
  ];

  return new Document({
    creator: "Phasis Air Cargo (demo)",
    title: `${m.header.title} ${m.header.dateSpan}`,
    description: "Consolidated flight packet, demo document",
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 15 * MM_TWIPS, bottom: 15 * MM_TWIPS, left: 15 * MM_TWIPS, right: 15 * MM_TWIPS } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.LEFT,
                children: [
                  new TextRun({ text: m.footer.text + "   ", size: 14, color: "46525F" }),
                  new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], size: 14, color: "46525F" }),
                ],
              }),
              new Paragraph({ children: [new TextRun({ text: m.footer.generated, size: 14, color: "46525F" })] }),
            ],
          }),
        },
        children,
      },
    ],
  });
}

export async function buildDocx(m: ChecklistModel, mapPng: string | null, onProgress: (pct: number) => void): Promise<Blob> {
  onProgress(15);
  const { Packer } = await import("docx");
  const doc = await buildDocument(m, mapPng);
  onProgress(70);
  const blob = await Packer.toBlob(doc);
  onProgress(100);
  return blob;
}
