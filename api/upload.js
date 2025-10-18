export const config = { api: { bodyParser: false }, runtime: "nodejs" };
import formidable from "formidable";
import fs from "fs/promises";
import path from "path";
import mammoth from "mammoth";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"Method not allowed" });

  const form = formidable({ multiples: false, maxFileSize: 20 * 1024 * 1024 }); // 20MB
  form.parse(req, async (err, fields, files) => {
    try {
      if (err) return res.status(400).json({ ok:false, error:String(err?.message||err) });
      const file = files.file || files.upload || Object.values(files)[0];
      if (!file) return res.status(400).json({ ok:false, error:"No file uploaded" });

      const filepath = Array.isArray(file) ? file[0].filepath : file.filepath;
      const origName = Array.isArray(file) ? file[0].originalFilename : file.originalFilename;
      const ext = String(path.extname(origName || "").toLowerCase());

      let extracted = "";
      if (ext === ".txt") {
        extracted = await fs.readFile(filepath, "utf-8");
      } else if (ext === ".docx") {
        const buf = await fs.readFile(filepath);
        const out = await mammoth.extractRawText({ buffer: buf });
        extracted = out.value || "";
      } else if (ext === ".pdf") {
        // No OCR here; just acknowledge. You can integrate CloudConvert/Tesseract later.
        extracted = "[PDF uploaded; OCR not enabled in this minimal upload handler]";
      } else {
        extracted = "[Unsupported type, treating as binary]";
      }

      // Example: return a payload your frontend can pass to /api/download-get
      return res.status(200).json({
        ok: true,
        filename: (fields.filename || "bizdoc").toString(),
        title: (fields.title || "BizDoc Analysis").toString(),
        body: extracted.slice(0, 12000) // safety cap
      });
    } catch (e) {
      return res.status(500).json({ ok:false, error:String(e?.message||e) });
    }
  });
}
