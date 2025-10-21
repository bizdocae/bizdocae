import formidable from "formidable";

export const config = { api: { bodyParser: false } };

function json(res, status, obj) {
  try { res.setHeader("Content-Type","application/json; charset=utf-8"); } catch {}
  res.status(status).end(JSON.stringify(obj));
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return json(res, 405, { ok:false, error:"Use POST" });

  try {
    const form = formidable({ multiples:false, maxFileSize: 15 * 1024 * 1024 });
    const [fields, files] = await form.parse(req);
    const f = files.file?.[0];
    if (!f) return json(res, 400, { ok:false, error:"Missing file (field 'file')." });

    const lang = String(fields.language || "auto");
    const wantText = String(fields.wantText || "true") === "true";
    const wantSearchablePdf = String(fields.wantSearchablePdf || "false") === "true";

    const key = process.env.OCR_SPACE_KEY || process.env.OCRSPACE_API_KEY || "";
    if (!key) {
      return json(res, 500, { ok:false, error:"Missing OCR_SPACE_KEY env var on Vercel." });
    }

    // Build multipart to OCR.space
    const fd = new FormData();
    fd.append("language", lang);
    fd.append("OCREngine", "2");
    fd.append("isOverlayRequired", "false");
    fd.append("isCreateSearchablePdf", wantSearchablePdf ? "true" : "false");
    fd.append("scale", "true");
    fd.append("file", new Blob([await fs.promises.readFile(f.filepath || f.path)], { type:"application/pdf" }), f.originalFilename || "upload.pdf");

    const resp = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      headers: { apikey: key },
      body: fd
    });

    const raw = await resp.json().catch(()=> ({}));
    if (!resp.ok) {
      return json(res, resp.status, { ok:false, error:`OCR upstream ${resp.status}`, raw: raw || null });
    }

    const parsed = Array.isArray(raw?.ParsedResults) ? raw.ParsedResults.map(p => p?.ParsedText || "").join("\n").trim() : "";
    if (!parsed && !wantSearchablePdf) {
      return json(res, 200, { ok:true, text:"", raw });
    }

    // Build a PDF URL if OCR.space returned one
    const pdfUrl = raw?.SearchablePDFURL || null;

    const out = { ok:true, text: wantText ? parsed : "", pdfUrl, raw };
    return json(res, 200, out);
  } catch (e) {
    return json(res, 500, { ok:false, error:"OCR proxy error", detail:String(e?.message||e).slice(0,300) });
  }
}

import fs from "fs";
