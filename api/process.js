// api/process.js
export const config = { runtime: "nodejs" };

import fs from "fs";
import path from "path";
import multiparty from "multiparty";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { Document, Packer, Paragraph } from "docx";
import OpenAI from "openai";

// ---------- helpers ----------
function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = new multiparty.Form({ maxFilesSize: 5 * 1024 * 1024 }); // ~5MB
    form.parse(req, (err, fields, files) => (err ? reject(err) : resolve({ fields, files })));
  });
}

async function extractText(file) {
  const buf = fs.readFileSync(file.path);
  const name = file.originalFilename || "upload";
  const ext = path.extname(name).toLowerCase();
  const mime = (file.headers?.["content-type"] || "").toLowerCase();

  if (ext === ".pdf" || mime.includes("pdf")) {
    const data = await pdfParse(buf);
    return { text: (data.text || "").trim(), meta: { type: "pdf", pages: data.numpages || undefined } };
  }
  if (ext === ".docx" || mime.includes("officedocument.wordprocessingml.document")) {
    const data = await mammoth.extractRawText({ buffer: buf });
    return { text: (data.value || "").trim(), meta: { type: "docx" } };
  }
  if (ext === ".txt" || mime.startsWith("text/")) {
    return { text: buf.toString("utf8").trim(), meta: { type: "txt" } };
  }
  throw new Error("Unsupported file type. Please upload PDF, DOCX, or TXT.");
}

function clampText(s, max = 12000) {
  if (!s) return "";
  return s.length > max ? s.slice(0, max) + "\n\n[TRUNCATED]" : s;
}

function mkPrompt(docText) {
  // Compact, auto-analysis prompt that covers your 20 items without asking user to type anything.
  return `
You are BizDoc, an analyst. Analyze the uploaded business document and produce a structured report in clear markdown.

Include these sections (only if evidence exists; otherwise say "Not specified"):
1) Executive Summary (goals, business model, financial highlights)
2) Structure & Sections (list with approximate % weight)
3) Financial Data Extraction (numbers, currencies, growth; small table)
4) SWOT
5) KPIs (dashboard list)
6) Sentiment & Tone (per major section, 1–2 words)
7) Risks & Compliance (severity × likelihood)
8) Competitors & Market Mentions (short table)
9) Keyword Frequency (top 15; counts)
10) Actionable Recommendations (5–10, with priority & confidence)
11) Trend & Timeline (if dates present)
12) Profitability & Margins (if possible)
13) Forecast (simple projection if growth given)
14) Resource Allocation (if present)
15) Customer/Stakeholder insights
16) Bottlenecks (Pareto-style bullets)
17) Consistency Check (flag mismatches)
18) ROI Scenarios (base/optimistic/conservative when possible)
19) Legal/Regulatory mentions
20) Strategic Alignment Index (0–100) with 2-line rationale.

Document text:
"""${docText}"""
`;
}

async function summarizeWithOpenAI(text) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  // Trim to keep token usage sane on small plans
  const prompt = mkPrompt(clampText(text));

  // Use a small, reliable reasoning/chat model name you have access to
  const resp = await client.responses.create({
    model: "gpt-4.1-mini",
    input: prompt,
  });

  const out =
    resp?.output_text?.trim() ||
    resp?.content?.map((c) => ("text" in c ? c.text : "")).join("\n").trim() ||
    "No analysis generated.";
  return out;
}

async function toPDF(markdownText) {
  // Very lightweight: drop markdown as plain text into a single-page PDF.
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]); // Letter
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontSize = 11;
  const maxWidth = 560;
  const left = 26;
  const top = 760;

  // crude line-wrap
  function wrap(text) {
    const words = text.replace(/\r/g, "").split(/\s+/);
    const lines = [];
    let line = "";
    for (const w of words) {
      const test = (line ? line + " " : "") + w;
      const width = font.widthOfTextAtSize(test, fontSize);
      if (width > maxWidth && line) {
        lines.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  const lines = markdownText.split("\n").flatMap((ln) => wrap(ln || " "));
  let y = top;
  for (const ln of lines) {
    if (y < 40) {
      y = top;
      pdfDoc.addPage([612, 792]);
    }
    const current = pdfDoc.getPages().at(-1);
    current.drawText(ln, { x: left, y, font, size: fontSize });
    y -= 14;
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

async function toDOCX(markdownText) {
  // Quick & simple: each line is a paragraph (no rich md rendering, but valid DOCX).
  const paras = markdownText.split("\n").map((ln) => new Paragraph({ text: ln || " " }));
  const doc = new Document({ sections: [{ properties: {}, children: paras }] });
  const buf = await Packer.toBuffer(doc);
  return Buffer.from(buf);
}

// ---------- route ----------
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Use POST (multipart/form-data)" });
    }

    const { files, fields } = await parseForm(req);
    const file = files?.file?.[0];
    if (!file) return res.status(400).json({ ok: false, error: "No file uploaded (field name: file)" });

    // size guard (hobby defaults)
    const stat = fs.statSync(file.path);
    if (stat.size > 4.5 * 1024 * 1024) {
      return res.status(413).json({ ok: false, error: "File too large (~4.5MB max)." });
    }

    const wanted = (fields?.format?.[0] || req.query?.format || "pdf").toString().toLowerCase();
    const { text, meta } = await extractText(file);
    if (!text || text.length < 10) return res.status(422).json({ ok: false, error: "Could not extract readable text." });

    const md = await summarizeWithOpenAI(text);

    if (wanted === "txt") {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="bizdoc-analysis.txt"');
      return res.status(200).send(md);
    }

    if (wanted === "docx") {
      const docx = await toDOCX(md);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      res.setHeader("Content-Disposition", 'attachment; filename="bizdoc-analysis.docx"');
      return res.status(200).send(docx);
    }

    // default: PDF
    const pdf = await toPDF(md);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="bizdoc-analysis.pdf"');
    return res.status(200).send(pdf);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e?.message || "process error" });
  }
}
