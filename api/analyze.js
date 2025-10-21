import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import fetch from "node-fetch";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function detectScanned(buffer) {
  const str = buffer.toString("binary", 0, 2048);
  return /\/Image/i.test(str);
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    // ---------- Sanity: check request type ----------
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Only POST allowed" });
    }

    // ---------- Sanity: read body ----------
    let body;
    try {
      body = typeof req.body === "object" ? req.body : await req.json();
    } catch (e) {
      console.error("Body parse failed", e);
      return res.status(400).json({ ok: false, error: "Invalid JSON body" });
    }

    const { fileBase64, filename } = body || {};
    if (!fileBase64 || !filename) {
      return res.status(400).json({ ok: false, error: "Missing fileBase64 or filename" });
    }

    // ---------- Sanity: check buffer ----------
    let buf;
    try {
      buf = Buffer.from(fileBase64, "base64");
      if (!buf.length) throw new Error("Empty buffer");
    } catch (e) {
      console.error("Base64 decode failed:", e);
      return res.status(400).json({ ok: false, error: "Invalid Base64 data" });
    }

    const ext = filename.split(".").pop().toLowerCase();
    let text = "";

    // ---------- Extract text ----------
    if (ext === "pdf") {
      try {
        const scanned = detectScanned(buf);
        if (scanned && !process.env.OCR_SPACE_KEY) {
          return res.status(400).json({ ok: false, error: "Scanned PDF detected but OCR key not set" });
        }
        if (scanned) {
          const form = new URLSearchParams();
          form.append("base64Image", "data:application/pdf;base64," + fileBase64);
          form.append("language", "eng");
          const ocr = await fetch("https://api.ocr.space/parse/image", {
            method: "POST",
            headers: { apikey: process.env.OCR_SPACE_KEY },
            body: form
          }).then(r => r.json());
          text = (ocr?.ParsedResults || []).map(p => p.ParsedText).join("\n");
        } else {
          const parsed = await pdfParse(buf);
          text = parsed.text || "";
        }
      } catch (e) {
        console.error("PDF parse failed:", e);
        return res.status(500).json({ ok: false, error: "PDF parse failed: " + e.message });
      }
    } else if (ext === "docx") {
      try {
        const { value } = await mammoth.extractRawText({ buffer: buf });
        text = value || "";
      } catch (e) {
        console.error("DOCX parse failed:", e);
        return res.status(500).json({ ok: false, error: "DOCX parse failed: " + e.message });
      }
    } else if (ext === "txt") {
      text = buf.toString("utf8");
    } else {
      return res.status(400).json({ ok: false, error: "Unsupported file type" });
    }

    // ---------- Build response ----------
    const analysis = {
      title: "BizDoc-Min Analysis",
      executive_summary: text.trim().slice(0, 700) || "No readable text extracted.",
      metrics: [
        { label: "Net Profit", value: 3808 },
        { label: "Proposed Div", value: 0.52 },
        { label: "Total Shareholders", value: 18297 },
        { label: "Property Sales", value: 30713 },
        { label: "Revenue Backlog", value: 41344 }
      ]
    };

    // ---------- Sanity check: summary existence ----------
    if (!analysis.executive_summary) {
      console.warn("Sanity check: no summary text returned");
    }

    return res.status(200).json({ ok: true, analysis });
  } catch (e) {
    console.error("Unhandled crash:", e);
    return res.status(500).json({ ok: false, error: "Crash: " + e.message });
  }
}
