import { isScannedPdf } from "../utils/isScannedPdf.js";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import fetch from "node-fetch";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"POST only" });

  try {
    const { fileBase64, filename } = req.body || {};
    if (!fileBase64 || !filename) return res.status(400).json({ ok:false, error:"fileBase64 & filename required" });

    const buf = Buffer.from(fileBase64, "base64");
    const lower = filename.toLowerCase();

    let text = "";
    if (lower.endsWith(".pdf")) {
      // Decide: OCR only if needed
      const needsOCR = await isScannedPdf(buf);
      if (!needsOCR) {
        const parsed = await pdfParse(buf);
        text = parsed.text || "";
      } else {
        // OCR only when required (OCR.SPACE). If no key, return hint.
        const key = process.env.OCR_SPACE_KEY;
        if (!key) {
          return res.status(200).json({
            ok: true,
            usedOCR: true,
            warning: "Scanned PDF detected but OCR_SPACE_KEY is not set. Please set it to enable OCR.",
            text: ""
          });
        }
        const form = new URLSearchParams();
        form.append("base64Image", "data:application/pdf;base64," + fileBase64);
        form.append("language", "eng");
        form.append("isTable", "false");
        form.append("OCREngine", "2");

        const ocrRes = await fetch("https://api.ocr.space/parse/image", {
          method: "POST",
          headers: { apikey: key, "Content-Type": "application/x-www-form-urlencoded" },
          body: form
        });
        const ocrJson = await ocrRes.json();
        const parts = (ocrJson?.ParsedResults || []).map(p => p.ParsedText || "");
        text = parts.join("\n");
        return res.status(200).json({ ok:true, usedOCR:true, text });
      }
    } else if (lower.endsWith(".docx")) {
      const { value } = await mammoth.extractRawText({ buffer: buf });
      text = value || "";
    } else if (lower.endsWith(".txt")) {
      text = buf.toString("utf8");
    } else {
      return res.status(400).json({ ok:false, error:"Unsupported file type" });
    }

    // Minimal placeholder “analysis” – you likely have your own logic here
    const analysis = {
      title: "Financial Overview (Auto)",
      executive_summary: text.split("\n").slice(0, 6).join(" ").slice(0, 600),
      metrics: [
        { label: "Net Profit", value: 3808 },
        { label: "Proposed Dividend", value: 0.52 },
        { label: "Total Shareholders' Funds", value: 18297 },
        { label: "Property Sales", value: 30713 },
        { label: "Revenue Backlog", value: 41344 }
      ]
    };

    res.status(200).json({ ok:true, usedOCR:false, text, analysis });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
}
