import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export async function generateClientPDF(data = {}) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([600, 800]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const { title = "BizDoc Report", summary = "No content" } = data;

  page.drawText(title, { x: 50, y: 750, size: 20, font, color: rgb(0, 0, 0) });
  page.drawText(summary, { x: 50, y: 710, size: 12, font, color: rgb(0, 0, 0) });

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}
