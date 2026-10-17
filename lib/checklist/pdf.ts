import type { Content, TDocumentDefinitions, TableCell } from "pdfmake/interfaces";
import type { ChecklistModel } from "./model";

const MM = 2.8346; // points per mm
const INK = "#14202E";
const MUT = "#46525F";

const grid = {
  hLineWidth: () => 0.5,
  vLineWidth: () => 0.5,
  hLineColor: () => "#C9CFC6",
  vLineColor: () => "#C9CFC6",
  paddingLeft: () => 4,
  paddingRight: () => 4,
  paddingTop: () => 2.5,
  paddingBottom: () => 2.5,
};

const th = (text: string): TableCell => ({ text, bold: true, fillColor: "#EEF0EB", fontSize: 8 });
const heading = (text: string): Content => ({ text: text.toUpperCase(), fontSize: 8, bold: true, color: MUT, characterSpacing: 0.6, margin: [0, 10, 0, 4] });

/** Pure: the pdfmake document definition for a checklist model. A4 portrait, 15 mm margins. */
export function pdfDocDefinition(m: ChecklistModel, mapPng: string | null): TDocumentDefinitions {
  const logo: Content = m.header.logoDataUrl
    ? { image: m.header.logoDataUrl, fit: [44, 44] }
    : { table: { widths: [42], heights: [42], body: [[{ text: "LOGO", fontSize: 7, color: MUT, alignment: "center", margin: [0, 14, 0, 0] }]] }, layout: { hLineStyle: () => ({ dash: { length: 2 } }), vLineStyle: () => ({ dash: { length: 2 } }), hLineColor: () => "#8A94A0", vLineColor: () => "#8A94A0" } };

  const content: Content[] = [
    {
      table: {
        widths: [50, "*", "auto"],
        body: [
          [
            logo,
            { stack: [{ text: m.header.legalName, fontSize: 15, bold: true, color: INK }, { text: m.header.idLine, fontSize: 8.5, margin: [0, 2, 0, 0] }] },
            { stack: [{ text: m.header.title, bold: true, fontSize: 11, alignment: "right" }, { text: m.header.dateSpan, fontSize: 9, alignment: "right", margin: [0, 2, 0, 0] }] },
          ],
        ],
      },
      layout: { hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === node.table.body.length ? 1.5 : 0), vLineWidth: () => 0, hLineColor: () => INK, paddingBottom: () => 6 },
    },
    { text: m.header.text, fontSize: 8.5, color: MUT, margin: [0, 6, 0, 0] },

    heading("Aircraft"),
    {
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths: ["auto", "auto", "*", "auto", "auto", "auto", "auto"],
        body: [
          ["Role", "Registration", "Type", "Serial no.", "Year", "MTOW", "Payload"].map(th),
          ...m.aircraft.map((a) => [a.role, { text: a.registration, bold: true }, a.type, a.serialNo, a.year, a.mtow, a.payload] as TableCell[]),
        ],
      },
      layout: grid,
    },

    heading("Route"),
    ...(mapPng ? [{ image: mapPng, width: 500, margin: [0, 0, 0, 4] } as Content] : []),
    { text: m.route.legend.join("      "), fontSize: 7.5, color: MUT, margin: [0, 0, 0, 6] },
    {
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths: ["auto", "auto", "auto", "auto", "auto", "auto", "auto", "*"],
        body: [
          ["Flight", "Aircraft", "Route", "Date", "ETD (UTC)", "ETA (UTC)", "Block", "Type"].map(th),
          ...m.legs.map(
            (l) =>
              [
                { text: l.flight, bold: true },
                l.aircraft,
                l.route,
                l.date,
                l.etd,
                { stack: [{ text: l.eta + (l.etaPlus ? " (+1)" : "") }, ...(l.dayTag ? [{ text: l.dayTag, fontSize: 7, color: MUT }] : [])] },
                l.block,
                l.type,
              ] as TableCell[],
          ),
        ],
      },
      layout: grid,
    },

    heading("Permits per country"),
    {
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths: ["*", "auto", "auto", "auto", "auto", "auto"],
        body: [
          ["Country", "Permit", "Flight", "Number", "Status", "Valid"].map(th),
          ...(m.permits.length
            ? m.permits.map((p) => [p.country, p.permit, p.flight, p.number, p.status, p.valid] as TableCell[])
            : [[{ text: "No permits required for the selected legs.", colSpan: 6 }, "", "", "", "", ""] as TableCell[]]),
        ],
      },
      layout: grid,
    },

    heading("Special notes"),
    ...m.notes.map((n) => ({ text: n, fontSize: 9, margin: [0, 0, 0, 2] }) as Content),

    {
      unbreakable: true,
      margin: [0, 28, 0, 0],
      columns: m.signatures.map((s, i) => ({
        width: "*",
        margin: [i === 0 ? 0 : 20, 0, i === 0 ? 20 : 0, 0],
        stack: [{ canvas: [{ type: "line", x1: 0, y1: 0, x2: 230, y2: 0, lineWidth: 0.8, lineColor: INK }] }, { text: s, fontSize: 8, color: MUT, margin: [0, 3, 0, 0] }],
      })),
    },
  ];

  return {
    pageSize: "A4",
    pageMargins: [15 * MM, 15 * MM, 15 * MM, 22 * MM],
    info: {
      title: `${m.header.title} ${m.header.dateSpan}`,
      author: "Phasis Air Cargo (demo)",
      subject: "Consolidated flight packet, demo document",
    },
    defaultStyle: { font: "Roboto", fontSize: 9, color: INK },
    content,
    footer: (page: number, count: number) => ({
      margin: [15 * MM, 8, 15 * MM, 0],
      stack: [
        { columns: [{ text: m.footer.text, width: "*" }, { text: `Page ${page} of ${count}`, width: 80, alignment: "right" }] },
        { text: m.footer.generated },
      ],
      fontSize: 7,
      color: MUT,
    }),
  };
}

export async function buildPdf(m: ChecklistModel, mapPng: string | null, onProgress: (pct: number) => void): Promise<Blob> {
  onProgress(10);
  const [{ default: pdfMake }, vfsMod] = await Promise.all([import("pdfmake/build/pdfmake"), import("pdfmake/build/vfs_fonts")]);
  onProgress(45);
  const vfs = (vfsMod as { default?: unknown }).default ?? vfsMod;
  (pdfMake as unknown as { addVirtualFileSystem: (v: unknown) => void }).addVirtualFileSystem(vfs);
  onProgress(60);
  const doc = pdfMake.createPdf(pdfDocDefinition(m, mapPng));
  const blob = (await doc.getBlob()) as Blob;
  onProgress(100);
  return blob;
}
