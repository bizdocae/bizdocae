export const config = { runtime: "nodejs" };

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { Document, Packer, Paragraph, TextRun } from "docx";

// ---------- helpers ----------
function safeName(s) {
  s = String(s || "bizdoc").replace(/[\/\\<>:"|?*\x00-\x1F]/g, "-").replace(/\s+/g, " ").trim();
  if (s.length > 120) s = s.slice(0, 120);
  return s || "bizdoc";
}
function setDownloadHeaders(res, filename, contentType) {
  const enc = encodeURIComponent(filename);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"; filename*=UTF-8''${enc}`);
  res.setHeader("Cache-Control", "no-store, max-age=0");
}

// ---------- builders ----------
async function buildPdf({ title = "BizDoc PDF", body = "Hello from BizDoc.", analysis = null }) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const { width, height } = page.getSize();
  let y = height - 60;

  function drawLine(txt, size = 12) {
    const max = 86;
    const words = String(txt || "").split(/\s+/);
    let line = "";
    while (words.length) {
      const w = words.shift();
      const t = (line ? line + " " : "") + w;
      if (t.length > max) {
        page.drawText(line, { x: 50, y, size, font, color: rgb(0, 0, 0) });
        y -= size + 6;
        line = w;
      } else line = t;
    }
    if (line) {
      page.drawText(line, { x: 50, y, size, font, color: rgb(0, 0, 0) });
      y -= size + 6;
    }
  }

  function drawBarChart(titleTxt, items) {
    if (!Array.isArray(items) || !items.length) return;
    y -= 10;
    page.drawText(titleTxt, { x: 50, y, size: 14, font });
    y -= 20;

    const left = 70, right = 520, top = y, bottom = y - 160;
    const axisY = bottom + 20, axisX = left;
    const w = right - left, h = top - bottom;

    // axes
    page.drawLine({ start: { x: axisX, y: axisY }, end: { x: right, y: axisY }, thickness: 1 });
    page.drawLine({ start: { x: axisX, y: axisY }, end: { x: axisX, y: top }, thickness: 1 });

    const maxVal = Math.max(...items.map(i => Number(i.value) || 0)) || 1;
    const gap = 10;
    const barW = (w - gap * (items.length + 1)) / Math.max(1, items.length);
    let x = left + gap;

    for (const it of items) {
      const v = Math.max(0, Number(it.value) || 0);
      const barH = (v / maxVal) * (h - 40);
      const y0 = axisY, y1 = y0 + barH;
      page.drawRectangle({ x, y: y0, width: barW, height: barH, borderWidth: 0.5 });
      page.drawText(String(it.label || "").slice(0, 12), { x, y: y0 - 12, size: 10, font });
      page.drawText(String(v), { x, y: y1 + 4, size: 10, font });
      x += barW + gap;
    }
    y = bottom - 30;
  }

  // Title
  drawLine(title, 20);

  // Prefer ANALYSIS if provided
  if (analysis && typeof analysis === "object") {
    if (analysis.executive_summary) {
      y -= 4; drawLine("Executive Summary", 14); y -= 2;
      drawLine(analysis.executive_summary, 12);
      y -= 6;
    }
    if (Array.isArray(analysis.key_findings) && analysis.key_findings.length) {
      drawLine("Key Findings", 14); y -= 2;
      for (const k of analysis.key_findings) drawLine(`• ${k.label || "Item"}: ${k.detail || ""}`, 12);
      y -= 6;
    }
    if (Array.isArray(analysis.risks) && analysis.risks.length) {
      drawLine("Risks", 14); y -= 2;
      for (const r of analysis.risks) drawLine(`• ${r.label || "Risk"}: ${r.detail || ""}`, 12);
      y -= 6;
    }
    if (Array.isArray(analysis.charts) && analysis.charts.length) {
      for (const ch of analysis.charts) drawBarChart(ch.title || "Chart", ch.items || []);
    }
    if (analysis.recommendations) {
      drawLine("Recommendations", 14); y -= 2;
      drawLine(analysis.recommendations, 12);
    }
  } else {
    // fallback to raw body
    drawLine(body, 12);
  }

  return await pdf.save();
}

async function buildDocx({ title = "BizDoc DOCX", body = "Hello from BizDoc." }) {
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ children: [new TextRun({ text: title, bold: true, size: 28 })] }),
        new Paragraph({}),
        ...String(body).split(/\n+/).map(line => new Paragraph(line))
      ]
    }]
  });
  return await Packer.toBuffer(doc);
}

// ---------- handler ----------
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const method = req.method || "GET";
    let type, filename, title, body, analysis;

    if (method === "GET") {
      const q = req.query || {};
      type = (q.type || "txt").toString().toLowerCase();
      filename = q.filename || `bizdoc.${type}`;
      title = q.title || "BizDoc";
      body = q.text || q.body || "Hello from BizDoc.";
      analysis = undefined; // GET doesn’t pass analysis
    } else if (method === "POST") {
      const data = req.body || {};
      type = (data.type || "txt").toString().toLowerCase();
      filename = data.filename || `bizdoc.${type}`;
      title = data.title || "BizDoc";
      body = (data.text || data.body || "Hello from BizDoc.").toString();
      if (body.length > 60000) body = body.slice(0, 60000) + "\n[truncated]";
      analysis = data.analysis; // <-- crucial
    } else {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    filename = safeName(filename);

    if (type === "pdf") {
      const bytes = await buildPdf({ title, body, analysis });
      setDownloadHeaders(res, filename.endsWith(".pdf") ? filename : `${filename}.pdf`, "application/pdf");
      return res.status(200).send(Buffer.from(bytes));
    }

    if (type === "docx") {
      const buf = await buildDocx({ title, body });
      setDownloadHeaders(
        res,
        filename.endsWith(".docx") ? filename : `${filename}.docx`,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      return res.status(200).send(buf);
    }

    // default: txt
    setDownloadHeaders(res, filename.endsWith(".txt") ? filename : `${filename}.txt`, "text/plain; charset=utf-8");
    return res.status(200).send(Buffer.from(String(body), "utf-8"));
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err && err.message || err) });
  }
}
