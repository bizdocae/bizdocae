// api/download.js — robust pagination + debug JSON mode

export const config = { api: { bodyParser: { sizeLimit: "1mb" } } };

function wrapText(text, maxChars) {
  const words = String(text || "").split(/\s+/);
  const lines = []; let line = "";
  for (const w of words) {
    const cand = line ? line + " " + w : w;
    if (cand.length > maxChars) { if (line) lines.push(line); line = w; } else { line = cand; }
  }
  if (line) lines.push(line);
  return lines;
}

export default async function handler(req, res) {
  const debug = req.query?.debug === "1" || String(req.headers["x-debug"]||"") === "1";

  try {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ ok:false, error:"POST JSON with { filenameBase, analysis, charts }" }));
    }

    const payload = req.body || {};
    // Basic validation up-front so bugs show in JSON
    const filenameBase = (payload.filenameBase || "analysis").toString().replace(/[^\w\-]+/g, "_");
    const analysis = payload.analysis || {};
    const title = (analysis.title || "Analysis").toString();
    const execSummary = (analysis.executive_summary || "").toString();
    const keyFindings = Array.isArray(analysis.key_findings) ? analysis.key_findings : [];
    const metrics = Array.isArray(analysis.metrics) ? analysis.metrics : [];
    const risks = Array.isArray(analysis.risks) ? analysis.risks : [];
    const recs = Array.isArray(analysis.recommendations) ? analysis.recommendations : [];
    const charts = Array.isArray(payload.charts) ? payload.charts : [];

    if (debug) {
      return res.status(200).json({
        ok: true,
        debug: true,
        received: { filenameBase, hasAnalysis: !!analysis, chartsLen: charts.length }
      });
    }

    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
    const doc = await PDFDocument.create();

    // Page helpers
    const A4 = [595.28, 841.89];
    const margin = 40;
    let page, width, height, y;
    const newPage = () => { page = doc.addPage(A4); ({ width, height } = page.getSize()); y = height - margin; };
    const needSpace = (needed = 40) => { if (y - needed < margin) newPage(); };

    newPage();

    // Fonts
    const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

    const drawHeading = (h) => { needSpace(24); page.drawText(String(h), { x: margin, y, size: 12, font: fontBold }); y -= 16; };
    const drawParagraph = (t, size=10) => {
      const lines = wrapText(String(t||""), 90);
      for (const line of lines) { needSpace(size+8); page.drawText(line, { x: margin, y, size, font: fontRegular }); y -= size + 4; }
      y -= 4;
    };
    const drawBullets = (arr) => {
      for (const item of (arr||[])) {
        const text = typeof item === "string" ? item : (item?.detail ?? item?.label ?? JSON.stringify(item));
        const lines = wrapText("• " + String(text), 90);
        for (const line of lines) { needSpace(18); page.drawText(line, { x: margin, y, size: 10, font: fontRegular }); y -= 14; }
      }
      y -= 6;
    };

    // Title
    needSpace(40);
    page.drawText(title, { x: margin, y: y - 4, size: 20, font: fontBold });
    y -= 28;

    if (execSummary) { drawHeading("Executive Summary"); drawParagraph(execSummary); }
    if (keyFindings.length) { drawHeading("Key Findings"); drawBullets(keyFindings.map(k => ({ detail: `(${k.label||""}) ${k.detail||""}`}))); }
    if (metrics.length) { drawHeading("Metrics"); drawBullets(metrics.map(m => ({ detail: `${m.name||""}: ${m.value??""}${m.unit ? " "+m.unit : ""}`}))); }
    if (risks.length) { drawHeading("Risks & Mitigations"); drawBullets(risks.map(r => ({ detail: `${r.risk||""}${r.mitigation ? " — "+r.mitigation : ""}`}))); }
    if (recs.length) { drawHeading("Recommendations"); drawBullets(recs); }

    // Bar chart (first only)
    if (charts.length && charts[0]?.type === "bar") {
      const chart = charts[0];
      const labels = Array.isArray(chart.x) ? chart.x.map(String) : [];
      const series0 = (Array.isArray(chart.series) && chart.series[0]) ? chart.series[0] : { data: [] };
      const data = Array.isArray(series0.data) ? series0.data.map(v => Number(v) || 0) : [];
      const n = Math.max(1, Math.min(labels.length, data.length));
      const ch = 180, cw = width - margin * 2;

      needSpace(ch + 40);

      if (chart.title) page.drawText(String(chart.title), { x: margin, y: y - 4, size: 12, font: fontBold });
      const cx = margin;
      const cy = y - 20 - ch;

      page.drawLine({ start: { x: cx, y: cy }, end: { x: cx, y: cy + ch } });
      page.drawLine({ start: { x: cx, y: cy }, end: { x: cx + cw, y: cy } });

      const maxVal = Math.max(1, ...data.slice(0, n));
      const scaleY = (ch - 20) / maxVal;
      const gapArea = cw - 40;
      const slotW = gapArea / n;
      const barW = Math.max(8, slotW * 0.6);

      for (let i = 0; i < n; i++) {
        const x = cx + 30 + i * slotW;
        const h = Math.max(0, data[i] * scaleY);
        page.drawRectangle({ x, y: cy, width: barW, height: h, color: rgb(0.2, 0.2, 0.7) });
        const lbl = (labels[i] || "").slice(0, 12) + (labels[i] && labels[i].length > 12 ? "…" : "");
        page.drawText(lbl, { x, y: cy - 12, size: 8, font: fontRegular });
      }

      y = cy - 24;
    }

    const bytes = await doc.save();
    const filename = `${filenameBase}.pdf`;
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.end(Buffer.from(bytes));
  } catch (err) {
    const body = { ok:false, error:"Download failed", detail:String(err?.message||err), stack: String(err?.stack||"") };
    res.statusCode = 500;
    // If debug query/header, force JSON so UI shows the error
    if (req.query?.debug === "1" || String(req.headers["x-debug"]||"") === "1") {
      res.setHeader("Content-Type","application/json; charset=utf-8");
      return res.end(JSON.stringify(body));
    }
    // default JSON too (so your UI can print it)
    res.setHeader("Content-Type","application/json; charset=utf-8");
    return res.end(JSON.stringify(body));
  }
}
