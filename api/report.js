import { cors, isOptions } from "./_utils/cors.js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = [];
    req.on("data", c => data.push(c));
    req.on("end", () => resolve(Buffer.concat(data).toString("utf8")));
    req.on("error", reject);
  });
}

async function handler(req, res) {
  cors(res);
  if (isOptions(req)) return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"Use POST" });

  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw || "{}");
    const a = body.analysis || body;

    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595,842]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText(a.title || "BizDocAE Report", { x:60, y:780, size:18, font });
    page.drawText("Auto-generated: " + new Date().toISOString(), { x:60, y:760, size:10, font });
    page.drawText("Sentiment: " + ((a.text?.sentiment?.label) || "unknown"), { x:60, y:740, size:10, font });
    page.drawText("Mean: " + (a.numbers?.stats?.mean || "-"), { x:60, y:720, size:10, font });
    const bytes = await pdf.save();

    res.setHeader("Content-Type","application/pdf");
    res.setHeader("Content-Disposition",'attachment; filename="BizDocAE_Report.pdf"');
    res.status(200).send(Buffer.from(bytes));
  } catch(e) {
    res.status(500).json({ ok:false, error:String(e) });
  }
}
export default handler;
