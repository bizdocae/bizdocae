import fs from "fs";
import path from "path";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { drawBarChart } from "../utils/simpleBarChart.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function loadInter() {
  const p = path.join(process.cwd(), "fonts", "Inter-Regular.ttf");
  return fs.readFileSync(p);
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"POST only" });

  try {
    const { analysis } = req.body || {};
    if (!analysis) return res.status(400).json({ ok:false, error:"analysis required" });

    const doc = await PDFDocument.create();
    // Embed deterministic English font (no shadows, no anti-aliased overlays)
    const interBytes = await loadInter();
    const inter = await doc.embedFont(interBytes, { subset: true });

    const page = doc.addPage([595.28, 841.89]); // A4 portrait
    const { width, height } = page.getSize();

    const black = rgb(0,0,0);

    // Header
    page.drawText(analysis.title || "Financial Overview", {
      x: 40, y: height - 60, size: 20, color: black, font: inter
    });

    // Executive Summary
    page.drawText("Executive Summary", { x: 40, y: height - 95, size: 12, color: black, font: inter });
    const summary = (analysis.executive_summary || "").replace(/\s+/g, " ").slice(0, 1200);
    // simple text wrap
    const wrapWidth = 90; // chars per line (approx for this font size)
    let sx = 40, sy = height - 115, ln = "";
    for (const w of summary.split(" ")) {
      const t = (ln ? ln + " " : "") + w;
      if (t.length > wrapWidth) {
        page.drawText(ln, { x: sx, y: sy, size: 10.5, color: black, font: inter });
        sy -= 14;
        ln = w;
      } else ln = t;
    }
    if (ln) page.drawText(ln, { x: sx, y: sy, size: 10.5, color: black, font: inter });
    sy -= 24;

    // Metrics list
    page.drawText("KPI Snapshot", { x: 40, y: sy, size: 12, color: black, font: inter });
    sy -= 16;
    const m = analysis.metrics || [];
    m.slice(0, 8).forEach((kv, i) => {
      const line = `• ${kv.label}: ${kv.value}`;
      page.drawText(line, { x: 48, y: sy - i*14, size: 10.5, color: black, font: inter });
    });

    // Bar chart
    drawBarChart(page, {
      x: 40, y: 140, w: width - 80, h: 220,
      labels: m.map(o => o.label),
      values: m.map(o => Number(o.value) || 0)
    }, inter, 8.5);

    const pdfBytes = await doc.save();
    const fname = (analysis.filename || "report") + ".pdf";

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    res.status(200).send(Buffer.from(pdfBytes));
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
}
