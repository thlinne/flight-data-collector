import type { FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "@flight-data-collector/db";

export type R1Report = {
  reportCode: "R1";
  title: string;
  provider: { id: string; code: string; name: string };
  date: string;
  windowStart: string;
  windowEnd: string;
  countries: Array<{ id: string; iso3: string; name: string }>;
  rows: Array<{ hour: number; windowStart: string; windowEnd: string; counts: Record<string, number> }>;
  totalsByCountry: Record<string, number>;
  totalFlights: number;
  generatedAt: string;
  assumptions: string[];
};

const reportQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  providerId: z.string().min(1)
});

const colors = ["#0f766e", "#1d4ed8", "#b45309", "#7c3aed", "#be123c", "#0369a1", "#15803d", "#a21caf", "#334155", "#ca8a04"];

function parseDateWindow(date: string): { start: Date; end: Date } {
  const [year, month, day] = date.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function pdfEscape(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

export async function buildR1Report(query: unknown): Promise<R1Report> {
  const { date, providerId } = reportQuerySchema.parse(query);
  const { start, end } = parseDateWindow(date);
  const [provider, countries, flightCountries] = await Promise.all([
    prisma.provider.findUnique({ where: { id: providerId } }),
    prisma.country.findMany({ where: { enabled: true }, orderBy: { iso3: "asc" } }),
    prisma.providerDetectedFlightCountry.findMany({
      where: {
        firstObservedAt: { gte: start, lt: end },
        detectedFlight: { providerId }
      },
      select: {
        countryId: true,
        firstObservedAt: true,
        detectedFlightId: true
      }
    })
  ]);

  if (!provider) {
    throw new Error("Provider not found");
  }

  const countryIds = new Set(countries.map((country) => country.id));
  const rows = Array.from({ length: 24 }, (_, hour) => {
    const windowStart = new Date(start.getTime() + hour * 60 * 60 * 1000);
    const windowEnd = new Date(windowStart.getTime() + 60 * 60 * 1000);
    return {
      hour,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      counts: Object.fromEntries(countries.map((country) => [country.id, 0]))
    };
  });

  for (const flightCountry of flightCountries) {
    if (!countryIds.has(flightCountry.countryId)) continue;
    const hour = flightCountry.firstObservedAt.getUTCHours();
    rows[hour].counts[flightCountry.countryId] += 1;
  }

  const totalsByCountry = Object.fromEntries(
    countries.map((country) => [country.id, rows.reduce((sum, row) => sum + row.counts[country.id], 0)])
  );
  const totalFlights = Object.values(totalsByCountry).reduce((sum, count) => sum + count, 0);

  return {
    reportCode: "R1",
    title: "R1 - One Day Overview, All Countries",
    provider: { id: provider.id, code: provider.code, name: provider.name },
    date,
    windowStart: start.toISOString(),
    windowEnd: new Date(end.getTime() - 1).toISOString(),
    countries: countries.map((country) => ({ id: country.id, iso3: country.iso3, name: country.name })),
    rows,
    totalsByCountry,
    totalFlights,
    generatedAt: new Date().toISOString(),
    assumptions: [
      "The report covers exactly one UTC day from 00:00:00.000 to 23:59:59.999.",
      "Only one provider is selected for each report run.",
      "All currently enabled countries are included.",
      "Flights are counted from provider-separated ProviderDetectedFlight records, not from raw data points.",
      "A flight is counted in the hour when it first appears in the selected country's monitored airspace.",
      "If the same aircraft remains visible across multiple hours, it is still counted once for the first observed hour only.",
      "Providers are not deduplicated against each other; this report intentionally preserves provider separation for later quality comparison.",
      "Flight recognition depends on the provider identifiers available in raw provider payloads and the current grouping logic."
    ]
  };
}

function line(text: string, x: number, y: number, size = 10): string {
  return `BT /F1 ${size} Tf ${x} ${y} Td (${pdfEscape(text)}) Tj ET\n`;
}

function pdfPage(content: string): string {
  return content;
}

function drawMatrixPage(report: R1Report): string {
  const width = 842;
  const left = 32;
  const top = 548;
  const providerWidth = 62;
  const countryWidth = Math.floor((width - left * 2 - providerWidth) / Math.max(report.countries.length, 1));
  let out = "";
  out += line(report.title, left, top, 16);
  out += line(`Provider: ${report.provider.name} (${report.provider.code})`, left, top - 22, 10);
  out += line(`Date: ${report.date} UTC | Window: ${report.windowStart} to ${report.windowEnd}`, left, top - 36, 10);
  out += line(`Total detected flights: ${report.totalFlights}`, left, top - 50, 10);

  const tableTop = top - 76;
  out += "0.85 0.87 0.91 RG 0.5 w\n";
  out += `${left} ${tableTop} m ${width - left} ${tableTop} l S\n`;
  out += line("Hour", left + 4, tableTop - 14, 8);
  report.countries.forEach((country, index) => {
    out += line(country.iso3, left + providerWidth + index * countryWidth + 4, tableTop - 14, 8);
  });
  for (const row of report.rows) {
    const y = tableTop - 24 - row.hour * 17;
    out += `${left} ${y + 9} m ${width - left} ${y + 9} l S\n`;
    out += line(`${String(row.hour).padStart(2, "0")}:00`, left + 4, y, 8);
    report.countries.forEach((country, index) => {
      out += line(String(row.counts[country.id]), left + providerWidth + index * countryWidth + 4, y, 8);
    });
  }
  out += line("Totals", left + 4, 48, 8);
  report.countries.forEach((country, index) => {
    out += line(String(report.totalsByCountry[country.id]), left + providerWidth + index * countryWidth + 4, 48, 8);
  });
  return pdfPage(out);
}

function drawChartPage(report: R1Report): string {
  const left = 56;
  const bottom = 90;
  const chartWidth = 720;
  const chartHeight = 360;
  const maxValue = Math.max(1, ...report.rows.flatMap((row) => report.countries.map((country) => row.counts[country.id])));
  let out = "";
  out += line("Hourly Flight Count by Country", left, 548, 16);
  out += line(`Provider: ${report.provider.name} | Date: ${report.date} UTC`, left, 526, 10);
  out += "0.25 0.29 0.35 RG 0.8 w\n";
  out += `${left} ${bottom} m ${left} ${bottom + chartHeight} l ${left + chartWidth} ${bottom + chartHeight} l S\n`;
  out += line("Hour UTC", left + chartWidth - 42, bottom - 28, 8);
  out += line(`Max ${maxValue}`, left - 38, bottom + chartHeight - 4, 8);
  for (let hour = 0; hour < 24; hour += 3) {
    const x = left + (hour / 23) * chartWidth;
    out += `0.85 0.87 0.91 RG 0.4 w ${x.toFixed(1)} ${bottom} m ${x.toFixed(1)} ${bottom + chartHeight} l S\n`;
    out += line(String(hour), x - 3, bottom - 16, 7);
  }
  report.countries.forEach((country, index) => {
    const color = colors[index % colors.length];
    const r = parseInt(color.slice(1, 3), 16) / 255;
    const g = parseInt(color.slice(3, 5), 16) / 255;
    const b = parseInt(color.slice(5, 7), 16) / 255;
    let path = "";
    report.rows.forEach((row, rowIndex) => {
      const x = left + (row.hour / 23) * chartWidth;
      const y = bottom + (row.counts[country.id] / maxValue) * chartHeight;
      path += `${x.toFixed(1)} ${y.toFixed(1)} ${rowIndex === 0 ? "m" : "l"} `;
    });
    out += `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG 1.4 w ${path}S\n`;
    const legendX = left + (index % 5) * 145;
    const legendY = 48 - Math.floor(index / 5) * 15;
    out += `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG 2 w ${legendX} ${legendY + 3} m ${legendX + 14} ${legendY + 3} l S\n`;
    out += line(`${country.iso3} ${country.name}`, legendX + 18, legendY, 8);
  });
  return pdfPage(out);
}

function drawAppendixPage(report: R1Report): string {
  let out = "";
  out += line("Appendix - Assumptions and Decisions", 56, 548, 16);
  out += line(`Generated at: ${report.generatedAt}`, 56, 526, 10);
  let y = 500;
  report.assumptions.forEach((assumption, index) => {
    out += line(`${index + 1}. ${assumption}`, 56, y, 10);
    y -= 20;
  });
  return pdfPage(out);
}

export function buildR1Pdf(report: R1Report): Buffer {
  const pages = [drawMatrixPage(report), drawChartPage(report), drawAppendixPage(report)];
  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids ${pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ")} /Count ${pages.length} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  pages.forEach((content, index) => {
    const pageObjectId = 4 + index * 2;
    const contentObjectId = pageObjectId + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}endstream`);
  });

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(files: Array<{ name: string; content: string }>): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const data = Buffer.from(file.content, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, data);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(0, 10);
    dir.writeUInt32LE(0, 12);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += local.length + name.length + data.length;
  }
  const centralStart = offset;
  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralStart, 16);
  return Buffer.concat([...chunks, ...central, end]);
}

function worksheetXml(name: string, rows: Array<Array<string | number>>): string {
  const body = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, colIndex) => {
          const ref = `${String.fromCharCode(65 + colIndex)}${rowIndex + 1}`;
          if (typeof value === "number") return `<c r="${ref}"><v>${value}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetData>${body}</sheetData></worksheet>`;
}

export function buildR1Xlsx(report: R1Report): Buffer {
  const matrixRows: Array<Array<string | number>> = [
    ["Report", report.title],
    ["Provider", `${report.provider.name} (${report.provider.code})`],
    ["Date UTC", report.date],
    ["Window start", report.windowStart],
    ["Window end", report.windowEnd],
    ["Total flights", report.totalFlights],
    [],
    ["Hour UTC", ...report.countries.map((country) => `${country.iso3} ${country.name}`)]
  ];
  report.rows.forEach((row) => {
    matrixRows.push([`${String(row.hour).padStart(2, "0")}:00`, ...report.countries.map((country) => row.counts[country.id])]);
  });
  matrixRows.push(["Total", ...report.countries.map((country) => report.totalsByCountry[country.id])]);

  const assumptionsRows: Array<Array<string | number>> = [["Appendix - Assumptions and Decisions"], ["Generated at", report.generatedAt], []];
  report.assumptions.forEach((assumption, index) => assumptionsRows.push([index + 1, assumption]));

  return zipStore([
    {
      name: "[Content_Types].xml",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
    },
    {
      name: "_rels/.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>'
    },
    {
      name: "xl/workbook.xml",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Matrix" sheetId="1" r:id="rId1"/><sheet name="Appendix" sheetId="2" r:id="rId2"/></sheets></workbook>'
    },
    { name: "xl/worksheets/sheet1.xml", content: worksheetXml("Matrix", matrixRows) },
    { name: "xl/worksheets/sheet2.xml", content: worksheetXml("Appendix", assumptionsRows) }
  ]);
}

export function sendReportFile(reply: FastifyReply, body: Buffer, contentType: string, filename: string): FastifyReply {
  return reply
    .header("Content-Type", contentType)
    .header("Content-Disposition", `attachment; filename="${filename}"`)
    .send(body);
}
