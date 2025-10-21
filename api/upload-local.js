export const config = { runtime: "nodejs", api: { bodyParser: false } };

// Load deps in a way that works in both ESM and CJS projects on Vercel
async function getDeps() {
  const multerMod = await import("multer");
  const pdfParseMod = await import("pdf-parse");
  const multer = multerMod.default || multerMod;
  const pdfParse = pdfParseMod.default || pdfParseMod;
  return { multer, pdfParse };
}

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function isMultipart(req) {
  const ct = req.headers["content-type"] || "";
  return ct.startsWith("multipart/form-data");
}

// Promisified Multer (created after we import the module)
function makeRunMulter(multer) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  });

  return (req, res) =>
    new Promise((resolve, reject) => {
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

export default async function handler(req, res) {
  // CORS / preflight
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Use POST" });

  try {
    if (!isMultipart(req)) {
      return json(res, 400, { ok: false, error: "Content-Type must be multipart/form-data; use field name 'file'." });
    }

    const { multer, pdfParse } = await getDeps();
    const runMulter = makeRunMulter(multer);

    await runMulter(req, res);
    const file = req.file;
    if (!file) return json(res, 400, { ok: false, error: "No file uploaded (field must be 'file')." });

    if (file.mimetype !== "application/pdf") {
      return json(res, 415, { ok: false, error: `Unsupported type: ${file.mimetype}. PDF only.` });
    }

    // Extract text (PDF must contain a text layer)
    const parsed = await pdfParse(file.buffer).catch(() => ({ text: "" }));
    const text = (parsed.text || "").trim();
    if (!text) return json(res, 422, { ok: false, error: "No readable text in PDF (needs OCR)." });

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
      return json(res, 502, { ok: false, error: `Analyzer failed HTTP ${ar.status}`, detail: msg.slice(0, 400) });
    }

    const data = await ar.json().catch(() => ({}));
    return json(res, 200, { ok: true, analysis: data.analysis });
  } catch (e) {
    const sc = e?.statusCode || 500;
    return json(res, sc, { ok: false, error: String(e?.message || e) });
  }
}
