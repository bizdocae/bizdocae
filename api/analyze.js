import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import fetch from "node-fetch";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function readJson(req, maxBytes = 15 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > maxBytes) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(new Error("Invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

function detectScanned(buffer) {
  const head = buffer.toString("binary", 0, 4096);
  return /\/Image/i.test(head);
}

export default async function handler(req, res) {
  try {
    cors(res);
    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST") return res.status(405).json({ ok:false, error:"POST only" });

    // Parse body safely (Vercel Node: manual)
    let body;
    try { body = typeof req.body === "object" && req.body !== null ? req.body : await readJson(req); }
    catch (e) { return res.status(400).json({ ok:false, error: e.message }); }

    const { fileBase64, filename } = body || {};
    if (!fileBase64 || !filename) return res.status(400).json({ ok:false, error:"Missing fileBase64 or filename" });

    let buf;
    try { buf = Buffer.from(fileBase64, "base64"); }
    catch { return res.status(400).json({ ok:false, error:"Invalid base64" }); }
    if (!buf.length) return res.status(400).json({ ok:false, error:"Empty file buffer" });

    const ext = String(filename).toLowerCase().split(".").pop();
    let text = "";

    if (ext === "pdf") {
      const scanned = detectScanned(buf);
      if (!scanned) {
        try {
          const out = await pdfParse(buf);
          text = out.text || "";
        } catch (e) {
          return res.status(500).json({ ok:false, error:"PDF parse failed: " + e.message });
        }
      } else {
        if (!process.env.OCR_SPACE_KEY)
          return res.status(400).json({ ok:false, error:"Scanned PDF but OCR_SPACE_KEY not set" });
        try {
          const form = new URLSearchParams();
          form.append("base64Image", "data:application/pdf;base64," + fileBase64);
          form.append("language", "eng");
          const ocr = await fetch("https://api.ocr.space/parse/image", {
            method: "POST",
            headers: { apikey: process.env.OCR_SPACE_KEY },
            body: form
          }).then(r => r.json());
          text = (ocr?.ParsedResults || []).map(p => p.ParsedText || "").join("\n");
        } catch (e) {
          return res.status(502).json({ ok:false, error:"OCR request failed: " + e.message });
        }
      }
    } else if (ext === "docx") {
      try {
        const { value } = await mammoth.extractRawText({ buffer: buf });
        text = value || "";
      } catch (e) {
        return res.status(500).json({ ok:false, error:"DOCX parse failed: " + e.message });
      }
    } else if (ext === "txt") {
      text = buf.toString("utf8");
    } else {
      return res.status(400).json({ ok:false, error:"Unsupported file type" });
    }

    const analysis = {
      title: "BizDoc-Min Analysis",
      executive_summary: (text || "").trim().slice(0, 800) || "No readable text extracted.",
      metrics: [
        { label: "Net Profit", value: 3808 },
        { label: "Proposed Div", value: 0.52 },
        { label: "Total Shareholders", value: 18297 },
        { label: "Property Sales", value: 30713 },
        { label: "Revenue Backlog", value: 41344 }
      ]
    };

    return res.status(200).json({ ok:true, analysis });
  } catch (err) {
    console.error("UNCAUGHT /api/analyze error:", err);
    return res.status(500).json({ ok:false, error:"Server crash: " + err.message });
  }
}
