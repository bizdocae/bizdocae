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
  res.setHeader("X-BizDoc-Renderer", "v2-sections"); // <— marker so we know this code is live
}

// ---------- PDF builder with section headers + pagination ----------
async function buildPdf({ title = "BizDoc PDF", body = "Hello from BizDoc.", analysis = null }) {
  const pdf = await PDFDocument.create();
  let page = pdf.addPage([595.28, 841.89]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const { width: PW, height: PH } = page.getSize();
  const MARGIN_X = 50, TOP = PH - 50, BOTTOM = 60;
  let y = TOP;

  function need(h) {
    if (y - h < BOTTOM) { page = pdf.addPage([595.28, 841.89]); y = TOP; }
  }

  function drawHeaderBar(label) {
    need(34); y -= 8;
    page.drawRectangle({ x: MARGIN_X - 6, y: y - 4, width: PW - (MARGIN_X * 2) + 12, height: 24, color: rgb(0.95, 0.95, 0.95) });
    page.drawText(label, { x: MARGIN_X, y, size: 14, font, color: rgb(0, 0, 0) });
    y -= 28;
  }

  function drawLine(txt, size = 12) {
    const max = 86;
    const words = String(txt || "").split(/\s+/);
    while (words.length) {
      let line = "";
      while (words.length && (line + (line ? " " : "") + words[0]).length <= max) {
        line += (line ? " " : "") + words.shift();
      }
      need(size + 6);
      page.drawText(line, { x: MARGIN_X, y, size, font });
      y -= size + 6;
    }
  }

  function drawBullets(items = []) {
    for (const it of items) {
      need(20);
      page.drawText(`• ${it.label || "Item"}: ${it.detail || ""}`, { x: MARGIN_X, y, size: 12, font });
      y -= 18;
    }
  }

  // simple charts (bar; pie/line omitted since you said “forget charts for now”)
  function drawBarChart(titleTxt, items = []) {
    if (!items.length) return;
    drawHeaderBar("📊 " + (titleTxt || "Bar Chart"));
    const left = MARGIN_X + 20, right = PW - MARGIN_X, h = 150; need(h + 36);
    const bottom = y - h, axisY = bottom + 20, top = bottom + h, w = right - left;
    page.drawLine({ start: { x: left, y: axisY }, end: { x: right, y: axisY }, thickness: 1 });
    page.drawLine({ start: { x: left, y: axisY }, end: { x: left, y: top }, thickness: 1 });
    const maxVal = Math.max(...items.map(i => Number(i.value) || 0)) || 1;
    const gap = 10, barW = (w - gap * (items.length + 1)) / Math.max(1, items.length);
    let x = left + gap;
    for (const it of items) {
      const v = Math.max(0, Number(it.value) || 0);
      const barH = (v / maxVal) * (h - 40);
      page.drawRectangle({ x, y: axisY, width: barW, height: barH, borderWidth: 0.5 });
      page.drawText(String(it.label || "").slice(0, 12), { x, y: axisY - 12, size: 9, font });
      page.drawText(String(v), { x, y: axisY + barH + 4, size: 9, font });
      x += barW + gap;
    }
    y = bottom - 20;
  }

  // Title
  drawHeaderBar("📄 " + title);

  if (analysis && typeof analysis === "object") {
    if (analysis.executive_summary) { drawHeaderBar("📄 Executive Summary"); drawLine(analysis.executive_summary, 12); }
    if (Array.isArray(analysis.key_findings) && analysis.key_findings.length) { drawHeaderBar("🔎 Key Findings"); drawBullets(analysis.key_findings); }
    if (Array.isArray(analysis.risks) && analysis.risks.length) { drawHeaderBar("⚠️ Risks"); drawBullets(analysis.risks); }
    if (Array.isArray(analysis.charts) && analysis.charts.length) {
      // only bar here (we can re-enable others later)
      for (const ch of analysis.charts) {
        const items = ch.items || [];
        drawBarChart(ch.title || "Chart", items);
      }
    }
    if (analysis.recommendations) { drawHeaderBar("✅ Recommendations"); drawLine(analysis.recommendations, 12); }
  } else {
    drawHeaderBar("📄 Body");
    drawLine(body, 12);
  }

  return await pdf.save();
}

// ---------- DOCX builder (unchanged) ----------
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
      analysis = undefined;
    } else if (method === "POST") {
      const data = req.body || {};
      type = (data.type || "txt").toString().toLowerCase();
      filename = data.filename || `bizdoc.${type}`;
      title = data.title || "BizDoc";
      body = (data.text || data.body || "Hello from BizDoc.").toString();
      if (body.length > 60000) body = body.slice(0, 60000) + "\n[truncated]";
      analysis = data.analysis; // important
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
