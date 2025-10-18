export const config = { runtime: "nodejs" };

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { Document, Packer, Paragraph, TextRun } from "docx";

function setDownloadHeaders(res, filename, contentType) {
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
}

async function buildPdf({ title = "BizDoc PDF", body = "Hello from BizDoc." }) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const { width, height } = page.getSize();

  // Title
  page.drawText(title, { x: 50, y: height - 90, size: 20, font, color: rgb(0,0,0) });

  // Simple wrap for body
  const maxChars = 82, words = String(body).split(/\s+/);
  let line = "", y = height - 130;
  for (const w of words) {
    const t = (line ? line + " " : "") + w;
    if (t.length > maxChars) {
      page.drawText(line, { x: 50, y, size: 12, font });
      y -= 18; line = w;
    } else line = t;
  }
  if (line) page.drawText(line, { x: 50, y, size: 12, font });

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

export default async function handler(req, res) {
  try {
    // CORS (optional)
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.status(204).end();

    const method = req.method || "GET";
    let type, filename, title, body;

    if (method === "GET") {
      const q = req.query || {};
      type = (q.type || "txt").toString().toLowerCase();
      filename = q.filename || `bizdoc.${type}`;
      title = q.title || "BizDoc";
      body = q.text || q.body || "Hello from BizDoc.";
    } else if (method === "POST") {
      const data = req.body || {};
      type = (data.type || "txt").toString().toLowerCase();
      filename = data.filename || `bizdoc.${type}`;
      title = data.title || "BizDoc";
      body = data.text || data.body || "Hello from BizDoc.";
    } else {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    if (type === "pdf") {
      const bytes = await buildPdf({ title, body });
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
