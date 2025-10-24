import { cors, isOptions } from "./_utils/cors.js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    try {
      let data = [];
      req.on("data", (c) => data.push(c));
      req.on("end", () => resolve(Buffer.concat(data).toString("utf8")));
      req.on("error", reject);
    } catch (e) { reject(e); }
  });
}

function safeJSONParse(str, fallback = {}) {
  try { return JSON.parse(str); } catch { return fallback; }
}

function coerceAnalysis(input = {}) {
  const a = input || {};
  const text = a.text || {};
  const numbers = a.numbers || {};
  const series = Array.isArray(numbers.series) ? numbers.series : [];
  const stats = numbers.stats || {};
  return {
    title: a.title || "BizDocAE Report",
    text: {
      length: Number.isFinite(text.length) ? text.length : 0,
      words: Number.isFinite(text.words) ? text.words : 0,
      topWords: Array.isArray(text.topWords) ? text.topWords : [],
      sentiment: text.sentiment || { score: 0, label: "neutral" }
    },
    numbers: {
      stats: {
        n: Number.isFinite(stats.n) ? stats.n : series.length,
        min: stats.min ?? null,
        p50: stats.p50 ?? null,
        p90: stats.p90 ?? null,
        max: stats.max ?? null,
        mean: stats.mean ?? null,
        stdev: stats.stdev ?? null
      },
      series: series.filter(n => Number.isFinite(Number(n))).map(Number)
    }
  };
}

function drawBarChart(page, data = [], { x = 60, y = 360, w = 480, h = 180, maxBars = 10 } = {}) {
  const series = data.slice(0, maxBars).map(Number).filter(n => Number.isFinite(n));
  const max = Math.max(1, ...series);
  // axes
  page.drawLine({ start: { x, y }, end: { x, y: y + h }, thickness: 1, color: rgb(0, 0, 0) });
  page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness: 1, color: rgb(0, 0, 0) });
  const barGap = 8;
  const barW = Math.max(4, (w - barGap * (series.length + 1)) / Math.max(series.length, 1));
  let cx = x + barGap;
  for (const v of series) {
    const bh = (v / max) * (h - 10);
    page.drawRectangle({ x: cx, y, width: barW, height: bh, color: rgb(0.2, 0.2, 0.2) });
    cx += barW + barGap;
  }
}

async function makeReportPDF(analysis) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const small = await pdf.embedFont(StandardFonts.HelveticaOblique);

  // Header
  page.drawText(analysis.title || "BizDocAE Report", { x: 60, y: 790, size: 18, font, color: rgb(0,0,0) });
  page.drawText(new Date().toLocaleString(), { x: 60, y: 770, size: 10, font: small });

  // Text metrics
  const t = analysis.text || {};
  page.drawText("Text Summary", { x: 60, y: 740, size: 12, font });
  page.drawText(`Chars: ${t.length ?? "-"}`, { x: 60, y: 720, size: 10, font: small });
  page.drawText(`Words: ${t.words ?? "-"}`, { x: 160, y: 720, size: 10, font: small });
  const s = (t.sentiment || {}).label || "-";
  page.drawText(`Sentiment: ${s}`, { x: 260, y: 720, size: 10, font: small });

  // Top words
  const tw = (t.topWords || []).map(([w, c]) => `${w}:${c}`).slice(0, 8).join(", ");
  page.drawText(`Top Words: ${tw || "-"}`, { x: 60, y: 700, size: 10, font: small });

  // Numeric stats + chart
  const n = (analysis.numbers || {}).stats || {};
  page.drawText("Numeric Summary", { x: 60, y: 670, size: 12, font });
  page.drawText(`n:${n.n ?? 0}  min:${n.min ?? "-"}  p50:${n.p50 ?? "-"}  p90:${n.p90 ?? "-"}  max:${n.max ?? "-"}`, { x: 60, y: 650, size: 10, font: small });
  page.drawText(`mean:${n.mean ?? "-"}  stdev:${n.stdev ?? "-"}`, { x: 60, y: 635, size: 10, font: small });

  drawBarChart(page, (analysis.numbers || {}).series || []);

  return pdf.save();
}

async function makeErrorPDF(message) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 200]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("BizDocAE — Report Error", { x: 40, y: 160, size: 16, font, color: rgb(0.6,0,0) });
  page.drawText(String(message).slice(0, 500), { x: 40, y: 130, size: 10, font, color: rgb(0,0,0) });
  return pdf.save();
}

export default async function handler(req, res) {
  cors(res);
  if (isOptions(req)) return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Use POST" });

  try {
    // Parse body robustly across runtimes
    let body = {};
    if (typeof req.body === "object" && req.body !== null) {
      body = req.body;
    } else {
      const raw = await readRawBody(req);
      body = typeof raw === "string" && raw.trim() ? safeJSONParse(raw, {}) : {};
    }

    // Allow { analysis } or full raw input
    const analysisInput = body.analysis || body;
    const analysis = coerceAnalysis(analysisInput);

    const bytes = await makeReportPDF(analysis);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="BizDocAE_Report.pdf"');
    return res.status(200).send(Buffer.from(bytes));
  } catch (e) {
    // Always return a PDF on error so client code doesn't break
    try {
      const bytes = await makeErrorPDF(`Report generation failed: ${String(e)}`);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'attachment; filename="BizDocAE_Report_ERROR.pdf"');
      return res.status(200).send(Buffer.from(bytes));
    } catch {
      return res.status(500).send("Report generation failed");
    }
  }
}
