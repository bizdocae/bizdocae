const multer = require("multer");
const pdfParse = require("pdf-parse");

// Export Vercel route config (CommonJS-safe)
const config = { runtime: "nodejs", api: { bodyParser: false } };
module.exports.config = config;

// Multer: 10 MB cap, in-memory
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Promisify Multer
function runMulter(req, res) {
  return new Promise((resolve, reject) => {
    upload.single("file")(req, res, (err) => {
      if (err && err.code === "LIMIT_FILE_SIZE") {
        const e = new Error("File too large. Max 10MB.");
        e.statusCode = 413;
        return reject(e);
      }
      return err ? reject(err) : resolve();
    });
  });
}

async function handler(req, res) {
  // CORS / preflight
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Use POST" });

  try {
    await runMulter(req, res);
    const file = req.file;
    if (!file) return res.status(400).json({ ok: false, error: "No file uploaded (field must be 'file')" });
    if (file.mimetype !== "application/pdf") {
      return res.status(415).json({ ok: false, error: `Unsupported type: ${file.mimetype}. PDF only.` });
    }

    // Extract text (PDF must contain text layer; OCR not included here)
    const parsed = await pdfParse(file.buffer).catch(() => ({ text: "" }));
    const text = (parsed.text || "").trim();
    if (!text) return res.status(422).json({ ok: false, error: "No readable text in PDF (needs OCR)." });

    // Call analyzer
    const proto = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host || "localhost:3000";
    const baseUrl = `${proto}://${host}`;

    const ar = await fetch(baseUrl + "/api/analyze-bizdoc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, type: "document" }),
    });

    if (!ar.ok) {
      const msg = await ar.text().catch(() => "");
      return res.status(502).json({ ok: false, error: `Analyzer failed HTTP ${ar.status}`, detail: msg.slice(0, 400) });
    }

    const data = await ar.json().catch(() => ({}));
    return res.status(200).json({ ok: true, analysis: data.analysis });
  } catch (e) {
    const sc = e && e.statusCode ? e.statusCode : 500;
    return res.status(sc).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
}

module.exports = handler;
module.exports.config = config;
