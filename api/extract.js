// api/extract.js
export const config = { runtime: "nodejs" };

import fs from "fs";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import multiparty from "multiparty";
import path from "path";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Use POST (multipart/form-data)" });
    }

    const { fields, files } = await parseForm(req);
    const file = (files.file && files.file[0]) || null;
    if (!file) return res.status(400).json({ ok: false, error: "No file uploaded (field name: file)" });

    // Enforce a safe size (Vercel Serverless typical body limit ~4.5MB)
    const stat = fs.statSync(file.path);
    if (stat.size > 4.5 * 1024 * 1024) {
      return res.status(413).json({ ok: false, error: "File too large (max ~4.5MB on this plan)" });
    }

    const filename = file.originalFilename || "upload";
    const ext = path.extname(filename).toLowerCase();
    const mime = (file.headers?.["content-type"] || "").toLowerCase();

    const buf = fs.readFileSync(file.path);
    let text = "";
    let meta = {};

    if (ext === ".pdf" || mime.includes("pdf")) {
      const data = await pdfParse(buf);
      text = (data.text || "").trim();
      meta = { type: "pdf", pages: data.numpages || undefined };
    } else if (ext === ".docx" || mime.includes("officedocument.wordprocessingml.document")) {
      const data = await mammoth.extractRawText({ buffer: buf });
      text = (data.value || "").trim();
      meta = { type: "docx" };
    } else if (ext === ".txt" || mime.startsWith("text/")) {
      text = buf.toString("utf8").trim();
      meta = { type: "txt" };
    } else {
      return res.status(415).json({ ok: false, error: "Unsupported file type. Use PDF, DOCX, or TXT." });
    }

    if (!text || text.length < 5) {
      return res.status(422).json({ ok: false, error: "Could not extract readable text from the file." });
    }

    return res.status(200).json({ ok: true, meta, text, chars: text.length });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e?.message || "extract error" });
  }
}

function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = new multiparty.Form({ maxFilesSize: 5 * 1024 * 1024 }); // 5MB soft ceiling
    form.parse(req, (err, fields, files) => (err ? reject(err) : resolve({ fields, files })));
  });
}
