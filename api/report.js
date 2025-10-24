import { cors, isOptions } from "./_utils/cors.js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

export default async function handler(req, res) {
  cors(res);
  if (isOptions(req)) return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"Use POST" });

  try {
    // Parse JSON body
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    const analysis = body.analysis || body;

    // Create and configure PDF
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);           // ✅ register fontkit
    const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const page = pdfDoc.addPage([595, 842]);
    page.drawText(analysis.title || "BizDocAE Report", {
      x: 60, y: 780, size: 18, font: helv, color: rgb(0, 0, 0)
    });
    page.drawText("Generated at: " + new Date().toISOString(), {
      x: 60, y: 760, size: 10, font: helv
    });

    const bytes = await pdfDoc.save();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="BizDocAE_Report.pdf"');
    res.status(200).send(Buffer.from(bytes));
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e) });
  }
}
