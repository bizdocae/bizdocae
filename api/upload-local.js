export const config = { runtime: "nodejs", api: { bodyParser: false } };

import multer from "multer";
import pdfParse from "pdf-parse";

const upload = multer({ storage: multer.memoryStorage() });

// Simple middleware wrapper for Multer in Next API routes
function runMulter(req, res) {
  return new Promise((resolve, reject) => {
    upload.single("file")(req, res, (err) => (err ? reject(err) : resolve()));
  });
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"Use POST" });

  try {
    await runMulter(req, res);
    const file = req.file;
    if (!file) return res.status(400).json({ ok:false, error:"No file uploaded (field name: 'file')" });

    // Parse text from PDF buffer
    const { text } = await pdfParse(file.buffer).catch(() => ({ text: "" }));
    if (!text || !text.trim()) {
      return res.status(422).json({ ok:false, error:"No readable text in PDF" });
    }

    const baseUrl = getBaseUrl(req);

    // Use your large-doc analyzer (already does draft+refine)
    const ar = await fetch(baseUrl + "/api/analyze-bizdoc", {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ text, type: "financials" })
    });

    if (!ar.ok) {
      const msg = await ar.text().catch(()=>"");
      return res.status(502).json({ ok:false, error:`Analyzer failed HTTP ${ar.status}`, detail: msg.slice(0,300) });
    }

    const data = await ar.json().catch(()=> ({}));
    return res.status(200).json({ ok:true, analysis: data.analysis });
  } catch (e) {
    return res.status(500).json({ ok:false, error:String(e?.message||e) });
  }
}

function getBaseUrl(req){
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host || "localhost:3000";
  return `${proto}://${host}`;
}
