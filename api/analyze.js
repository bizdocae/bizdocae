/**
 * BizDoc-Min — ChatGPT-only analyzer with secure pdf.js v5 extraction.
 * - PDF text: pdfjs-dist v5 (no eval) + OCR fallback
 * - Analysis: OpenAI (JSON schema) → consumed by /api/pdf
 */

import OpenAI from "openai";
import { extractPdfSecure } from "../lib/pdf-extract.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
function readJson(req, maxBytes = 5.5 * 1024 * 1024) {
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
function detectScanned(buffer) {
  const head = buffer.toString("binary", 0, 8192);
  return (head.match(/\/Image/g) || []).length >= 2;
}
async function extractWithOCR(fileBase64) {
  const form = new URLSearchParams();
  form.append("base64Image", "data:application/pdf;base64," + fileBase64);
  form.append("language", "eng");
  const r = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    headers: { apikey: process.env.OCR_SPACE_KEY },
    body: form
  });
  const j = await r.json();
  return (j?.ParsedResults || []).map(p => p.ParsedText || "").join("\n");
}

export default async function handler(req, res) {
  try {
    cors(res);
    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST") return res.status(405).json({ ok:false, error:"POST only" });

    const body = typeof req.body === "object" && req.body !== null ? req.body : await readJson(req);
    const { fileBase64, filename, forceOCR } = body || {};
    if (!fileBase64 || !filename) return res.status(400).json({ ok:false, error:"Missing fileBase64 or filename" });

    // size pre-check (~raw bytes)
    const approxBytes = Math.floor((fileBase64.length * 3) / 4);
    const MAX_BYTES = 4 * 1024 * 1024;
    if (approxBytes > MAX_BYTES) {
      return res.status(413).json({ ok:false, error:`Payload too large (~${(approxBytes/1024/1024).toFixed(2)} MB). Max ~${(MAX_BYTES/1024/1024)} MB.` });
    }

    const buf = Buffer.from(fileBase64, "base64");
    const ext = String(filename).toLowerCase().split(".").pop();
    let text = "";

    if (ext === "pdf") {
      const scanned = detectScanned(buf);
      if (forceOCR === true || scanned) {
        if (!process.env.OCR_SPACE_KEY) return res.status(400).json({ ok:false, error:"OCR required but OCR_SPACE_KEY not set" });
        text = await extractWithOCR(fileBase64);
      } else {
        try {
          text = await extractPdfSecure(buf);
          if (!text.trim() && process.env.OCR_SPACE_KEY) text = await extractWithOCR(fileBase64);
        } catch (e) {
          if (process.env.OCR_SPACE_KEY) {
            try { text = await extractWithOCR(fileBase64); }
            catch (ocrErr) { return res.status(502).json({ ok:false, error:"OCR fallback failed: " + (ocrErr?.message || ocrErr) }); }
          } else {
            return res.status(500).json({ ok:false, error:"PDF text extraction failed: " + (e?.message || e) });
          }
        }
      }
    } else if (ext === "docx") {
      const { default: mammoth } = await import("mammoth");
      const out = await mammoth.extractRawText({ buffer: buf });
      text = out?.value || "";
    } else if (ext === "txt") {
      text = buf.toString("utf8");
    } else {
      return res.status(400).json({ ok:false, error:"Unsupported file type" });
    }

    // ---- ChatGPT-only analysis ----
    if (!process.env.OPENAI_API_KEY) return res.status(400).json({ ok:false, error:"OPENAI_API_KEY not set. Please add it to Vercel env." });
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const MAX_CHARS = 16000;
    const sample = (text || "").replace(/\s+/g, " ").slice(0, MAX_CHARS);

    const system = [
      "You are a senior equity analyst.",
      "Write in concise, formal business English.",
      "Return strict JSON only (no prose).",
      "Focus on clarity, trends, and implications. No fluff."
    ].join(" ");

    const schema = {
      title: "Business Analysis",
      sections: {
        executive_summary: "<120-180 words, board-ready>",
        kpi_table: [
          { label: "Metric", current: "string or number with unit", prior: "optional", yoy: "optional ▲/▼ ±%" }
        ],
        analysis_points: ["bullet point 1", "bullet point 2", "..."],
        conclusion: "2-3 sentences",
        recommendations: "1-2 sentences of next steps"
      }
    };

    let llmJSON;
    try {
      const resp = await client.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: [
            "Analyze the following company document content and return JSON matching this shape:",
            JSON.stringify(schema, null, 2),
            "",
            "Document Content (truncated):",
            sample
          ].join("\n") }
        ]
      });
      const raw = resp?.choices?.[0]?.message?.content || "{}";
      llmJSON = JSON.parse(raw);
    } catch (e) {
      return res.status(502).json({ ok:false, error: "OpenAI analysis failed: " + (e?.message || e) });
    }

    const analysis = {
      title: llmJSON?.title || "Business Analysis",
      sections: {
        executive_summary: llmJSON?.sections?.executive_summary || "",
        kpi_table: Array.isArray(llmJSON?.sections?.kpi_table) ? llmJSON.sections.kpi_table : [],
        analysis_points: Array.isArray(llmJSON?.sections?.analysis_points) ? llmJSON.sections.analysis_points : [],
        conclusion: llmJSON?.sections?.conclusion || "",
        recommendations: llmJSON?.sections?.recommendations || "",
        source_excerpt: sample.slice(0, 800)
      }
    };

    return res.status(200).json({ ok:true, analysis });
  } catch (err) {
    console.error("UNCAUGHT /api/analyze error:", err);
    return res.status(500).json({ ok:false, error:"Server crash: " + err.message });
  }
}
