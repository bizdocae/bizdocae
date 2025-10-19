export const config = { runtime: "nodejs", api: { bodyParser: false } };

import multer from "multer";
import pdfParse from "pdf-parse";

// 10 MB cap
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function runMulter(req, res) {
  return new Promise((resolve, reject) => {
    upload.single("file")(req, res, (err) => {
      if (err && err.code === "LIMIT_FILE_SIZE") {
        const e = new Error("File too large. Max 10MB.");
        e.statusCode = 413; return reject(e);
      }
      return err ? reject(err) : resolve();
    });
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"Use POST" });

  try {
    await runMulter(req, res);
    const file = req.file;
    if (!file) return res.status(400).json({ ok:false, error:"No file uploaded (field name must be 'file')" });

    if (file.mimetype !== "application/pdf") {
      return res.status(415).json({ ok:false, error:`Unsupported type: ${file.mimetype}. Please upload a PDF.` });
    }

    const { text } = await pdfParse(file.buffer).catch(() => ({ text: "" }));
    if (!text || !text.trim()) {
      return res.status(422).json({ ok:false, error:"No readable text in PDF (no text layer/OCR needed)." });
    }

    const baseUrl = getBaseUrl(req);
    // Use your analyzer (already chunking + refine); return analysis JSON
    const ar = await fetch(baseUrl + "/api/analyze-bizdoc", {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ text, type: "document" }) // generic; analyzer will infer
    });

    if (!ar.ok) {
      const msg = await ar.text().catch(()=>"");
      return res.status(502).json({ ok:false, error:`Analyzer failed HTTP ${ar.status}`, detail: msg.slice(0,400) });
    }

    const data = await ar.json().catch(()=> ({}));
    return res.status(200).json({ ok:true, analysis: data.analysis });
  } catch (e) {
    const sc = e?.statusCode || 500;
    return res.status(sc).json({ ok:false, error:String(e?.message||e) });
  }
}

function getBaseUrl(req){
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host || "localhost:3000";
  return `${proto}://${host}`;
}
