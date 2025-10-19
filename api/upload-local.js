export const config = { runtime: "nodejs" };

import multer from "multer";
import pdfParse from "pdf-parse";
import nextConnect from "next-connect";
import fs from "fs";

const upload = multer({ storage: multer.memoryStorage() });

const handler = nextConnect();
handler.use(upload.single("file"));

handler.post(async (req, res) => {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    const file = req.file;
    if (!file) return res.status(400).json({ ok: false, error: "No file uploaded" });

    // Parse text from PDF
    const { text } = await pdfParse(file.buffer);
    if (!text || !text.trim()) {
      return res.status(422).json({ ok: false, error: "No readable text in PDF" });
    }

    // Send to your /api/analyze-bizdoc for analysis
    const baseUrl = getBaseUrl(req);
    const analyze = await fetch(baseUrl + "/api/analyze-bizdoc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, type: "financials" })
    });

    if (!analyze.ok) {
      const err = await analyze.text();
      return res.status(502).json({ ok: false, error: "Analyzer failed", detail: err });
    }

    const data = await analyze.json();
    return res.status(200).json({ ok: true, analysis: data.analysis });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

export default handler;

function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host || "localhost:3000";
  return `${proto}://${host}`;
}
