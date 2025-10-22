import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/* ---------- utils ---------- */
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
function readJson(req, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = "", size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > maxBytes) { reject(Object.assign(new Error("Request too large"), { status: 413 })); req.destroy(); }
      else data += chunk;
    });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(Object.assign(new Error("Invalid JSON body"), { status: 400 })); } });
    req.on("error", e => reject(Object.assign(e, { status: 400 })));
  });
}

/* ---------- simple text layout helpers ---------- */
function drawWrapped(page, text, opts) {
  const {
    x = 54, y = 742, width = 487, font, size = 12, color = rgb(0,0,0), lineHeight = 16
  } = opts;
  const words = String(text || "").split(/\s+/);
  let line = "", cursorY = y;
  page.setFont(font);
  page.setFontSize(size);
  page.setFontColor(color);
  for (const w of words) {
    const test = line ? line + " " + w : w;
    const tw = font.widthOfTextAtSize(test, size);
    if (tw > width) {
      page.drawText(line, { x, y: cursorY });
      cursorY -= lineHeight;
      line = w;
    } else {
      line = test;
    }
  }
  if (line) {
    page.drawText(line, { x, y: cursorY });
    cursorY -= lineHeight;
  }
  return cursorY;
}
function sectionTitle(page, text, opts) {
  const { x=54, y, font, size=14 } = opts;
  page.setFont(font);
  page.setFontSize(size);
  page.setFontColor(rgb(0.07,0.07,0.07));
  page.drawText(text, { x, y });
  return y - 20;
}
function drawBullets(page, items, opts) {
  const { x=54, y, font, size=12, width=487, lineHeight=16 } = opts;
  let cy = y;
  page.setFont(font); page.setFontSize(size);
  for (const it of (items || [])) {
    page.drawText("• ", { x, y: cy });
    cy = drawWrapped(page, String(it), { x: x+14, y: cy, width, font, size, lineHeight });
  }
  return cy;
}
function drawTable(page, rows, opts) {
  const { x=54, y, font, size=12, lineHeight=16 } = opts;
  let cy = y;
  const widths = [210, 110, 110, 90]; // Metric, Current, Prior, YoY
  const headers = ["Metric", "Current", "Prior", "YoY"];
  page.setFont(font); page.setFontSize(size);

  // headers
  let cx = x;
  headers.forEach((h, i) => { page.drawText(h, { x: cx, y: cy }); cx += widths[i]; });
  cy -= lineHeight * 0.9;

  // rows
  (rows || []).forEach(r => {
    let cx2 = x;
    const cells = [
      r.label ?? "",
      r.current ?? r.value ?? "",
      r.prior ?? "",
      (typeof r.yoy === "number" || typeof r.yoy === "string") ? String(r.yoy) : (r.yoy ?? "")
    ];
    cells.forEach((c, i) => { page.drawText(String(c), { x: cx2, y: cy }); cx2 += widths[i]; });
    cy -= lineHeight;
  });
  return cy;
}

/* ---------- main handler ---------- */
export default async function handler(req, res) {
  try {
    cors(res);
    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST") return res.status(405).json({ ok:false, error:"POST only" });

    const body = typeof req.body === "object" && req.body !== null ? req.body : await readJson(req);
    const analysis = body?.analysis || {};

    // unify schemas: prefer new sections, fallback to legacy
    const title = analysis.title || "Business Analysis";
    const sec = analysis.sections || {};
    const executiveSummary = sec.executive_summary ?? analysis.executive_summary ?? "";
    const kpiTable = (Array.isArray(sec.kpi_table) ? sec.kpi_table : null) ?? (Array.isArray(analysis.metrics) ? analysis.metrics : []) ?? [];
    const analysisPoints = Array.isArray(sec.analysis_points) ? sec.analysis_points : [];
    const conclusion = sec.conclusion ?? "";
    const recommendations = sec.recommendations ?? "";

    // build PDF in memory
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595.28, 841.89]); // A4 points
    const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

    // Title
    page.setFont(fontBold); page.setFontSize(22); page.setFontColor(rgb(0,0,0));
    page.drawText(title, { x: 54, y: 780 });

    // Executive Summary
    let cy = sectionTitle(page, "Executive Summary:", { x:54, y: 748, font: fontBold, size: 14 });
    cy = drawWrapped(page, executiveSummary || "—", { x:54, y: cy, width:487, font: fontRegular, size: 12, lineHeight: 16 });

    // KPI Snapshot
    cy = sectionTitle(page, "KPI Snapshot:", { x:54, y: cy-6, font: fontBold, size: 14 });
    cy -= 2;
    cy = drawTable(page, kpiTable, { x:54, y: cy, font: fontRegular, size: 12, lineHeight: 16 });

    // Key Insights
    if (analysisPoints.length) {
      cy = sectionTitle(page, "Key Insights:", { x:54, y: cy-6, font: fontBold, size: 14 });
      cy = drawBullets(page, analysisPoints, { x:54, y: cy, font: fontRegular, size: 12, width: 487, lineHeight: 16 });
    }

    // Conclusion
    if (conclusion) {
      cy = sectionTitle(page, "Conclusion:", { x:54, y: cy-6, font: fontBold, size: 14 });
      cy = drawWrapped(page, conclusion, { x:54, y: cy, width:487, font: fontRegular, size: 12, lineHeight: 16 });
    }

    // Recommendations
    if (recommendations) {
      cy = sectionTitle(page, "Recommendations:", { x:54, y: cy-6, font: fontBold, size: 14 });
      cy = drawWrapped(page, recommendations, { x:54, y: cy, width:487, font: fontRegular, size: 12, lineHeight: 16 });
    }

    const bytes = await pdf.save();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="BizDoc_Report.pdf"');
    res.setHeader("Content-Length", String(bytes.length));
    return res.status(200).end(Buffer.from(bytes));
  } catch (err) {
    console.error("UNCAUGHT /api/download error:", err);
    return res.status(500).json({ ok:false, error:"PDF generation failed: " + err.message });
  }
}
