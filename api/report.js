import { cors, isOptions } from "./_utils/cors.js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

function drawBarChart(page, data=[], {x=60,y=360,w=480,h=180,maxBars=10}={}) {
  const series = data.slice(0,maxBars).map(Number).filter(n=>Number.isFinite(n));
  const max = Math.max(1, ...series);
  // axes
  page.drawLine({ start: {x, y}, end: {x, y+h}, thickness: 1, color: rgb(0,0,0) });
  page.drawLine({ start: {x, y}, end: {x+w, y}, thickness: 1, color: rgb(0,0,0) });
  const barGap=8;
  const barW = Math.max(4, (w - barGap*(series.length+1)) / Math.max(series.length,1));
  let cx = x + barGap;
  for (const v of series) {
    const bh = (v/max) * (h-10);
    page.drawRectangle({ x: cx, y: y, width: barW, height: bh, color: rgb(0.2,0.2,0.2) });
    cx += barW + barGap;
  }
}

export default async function handler(req, res) {
  cors(res);
  if (isOptions(req)) return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"Use POST" });

  try {
    const body = typeof req.body === "object" ? req.body : JSON.parse(req.body||"{}");
    const a = body.analysis || {};
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]); // A4 portrait
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const small = await pdf.embedFont(StandardFonts.HelveticaOblique);

    // Header
    page.drawText(a.title || "BizDocAE Report", { x: 60, y: 790, size: 18, font, color: rgb(0,0,0) });
    page.drawText(new Date().toLocaleString(), { x: 60, y: 770, size: 10, font: small, color: rgb(0,0,0) });

    // Text metrics
    const t = a.text || {};
    page.drawText("Text Summary", { x: 60, y: 740, size: 12, font });
    page.drawText(`Chars: ${t.length ?? "-"}`, { x: 60, y: 720, size: 10, font: small });
    page.drawText(`Words: ${t.words ?? "-"}`, { x: 160, y: 720, size: 10, font: small });
    const s = (t.sentiment||{}).label || "-";
    page.drawText(`Sentiment: ${s}`, { x: 260, y: 720, size: 10, font: small });

    // Top words
    const tw = (t.topWords||[]).map(([w,c])=>`${w}:${c}`).slice(0,8).join(", ");
    page.drawText(`Top Words: ${tw || "-"}`, { x: 60, y: 700, size: 10, font: small });

    // Numeric stats + chart
    const n = (a.numbers||{}).stats || {};
    page.drawText("Numeric Summary", { x: 60, y: 670, size: 12, font });
    page.drawText(`n:${n.n ?? 0}  min:${n.min ?? "-"}  p50:${n.p50 ?? "-"}  p90:${n.p90 ?? "-"}  max:${n.max ?? "-"}`, { x: 60, y: 650, size: 10, font: small });
    page.drawText(`mean:${n.mean ?? "-"}  stdev:${n.stdev ?? "-"}`, { x: 60, y: 635, size: 10, font: small });

    drawBarChart(page, (a.numbers||{}).series || []);

    const bytes = await pdf.save();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="BizDocAE_Report.pdf"');
    res.status(200).send(Buffer.from(bytes));
  } catch (e) {
    res.status(400).json({ ok:false, error:String(e) });
  }
}
