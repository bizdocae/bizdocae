import formidable from "formidable";
import fs from "fs";

export const config = { api: { bodyParser: false } };

// ---- helpers ----
function json(res, status, obj) {
  try { res.setHeader("Content-Type","application/json; charset=utf-8"); } catch {}
  res.status(status).end(JSON.stringify(obj));
}

function toUint8(buffer) {
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function getPdfJs() {
  // Node-safe legacy build of pdf.js (must be installed: pdfjs-dist@^3.11.174)
  // Using CJS require under the hood keeps it Lambda-friendly.
  const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
  try { pdfjsLib.GlobalWorkerOptions.workerSrc = null; } catch {}
  return pdfjsLib;
}

async function extractTextWithPdfJs(fileBuffer) {
  const pdfjsLib = getPdfJs();
  const loadingTask = pdfjsLib.getDocument({
    data: toUint8(fileBuffer),
    isEvalSupported: false,
    disableFontFace: true,
    useWorkerFetch: false,
    disableRange: true,
    disableStream: true,
  });
  const pdf = await loadingTask.promise;

  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    text += tc.items.map(it => it?.str ?? "").join(" ") + "\n";
    page.cleanup && page.cleanup();
  }
  pdf.cleanup && pdf.cleanup();
  return text.trim();
}

function isLowText(s) {
  if (!s) return true;
  const len = s.length;
  if (len < 200) return true;
  const ascii = s.replace(/[^\x20-\x7E]/g, "").length;
  return (ascii / len) < 0.5; // lots of non-ascii often means scanned
}

async function ocrFallback(baseUrl, fileBuffer, filename="upload.pdf") {
  // Use your existing OCR route: /api/ocr-ocrspace-upload-pdf
  // Build multipart payload in Node 20 (Blob/FormData are global)
  const fd = new FormData();
  fd.append("file", new Blob([fileBuffer], { type: "application/pdf" }), filename);
  fd.append("wantText", "true");
  fd.append("wantSearchablePdf", "false");
  fd.append("language", "auto");

  const r = await fetch(baseUrl + "/api/ocr-ocrspace-upload-pdf", {
    method: "POST",
    body: fd
  });

  if (!r.ok) {
    const body = await r.text().catch(()=> "");
    throw new Error(`OCR route failed HTTP ${r.status}: ${body.slice(0,300)}`);
  }
  const j = await r.json().catch(()=> ({}));
  if (!j.ok || !j.text) throw new Error(`OCR returned no text`);
  return j.text;
}

// ---- main handler ----
export default async function handler(req, res) {
  // CORS / preflight
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return json(res, 405, { ok:false, error:"Use POST" });

  try {
    // Parse multipart
    const form = formidable({
      multiples: false,
      maxFileSize: 10 * 1024 * 1024, // 10 MB
      filter: part => part.mimetype === "application/pdf" || part.name === "file"
    });

    const [fields, files] = await form.parse(req);
    const up = files.file?.[0];
    if (!up) return json(res, 400, { ok:false, error:"Missing file (field name must be 'file')." });

    const filePath = up.filepath || up.path;
    const buffer = fs.readFileSync(filePath);

    // Step 1: try text extraction with pdf.js
    let text = "";
    let source = "pdfjs";
    try {
      text = await extractTextWithPdfJs(buffer);
    } catch (e) {
      // pdf.js failed, treat as no text; go OCR below
      text = "";
    }

    // Step 2: OCR fallback if low/no text
    const proto = req.headers["x-forwarded-proto"] || "https";
    const host  = req.headers.host || "localhost:3000";
    const base  = `${proto}://${host}`;

    if (isLowText(text)) {
      try {
        const ocrText = await ocrFallback(base, buffer, up.originalFilename || "upload.pdf");
        if (ocrText && ocrText.trim().length > 0) {
          text = ocrText.trim();
          source = "ocr";
        }
      } catch (e) {
        // If OCR fails AND pdfjs had no text, return 422 to hint OCR needed
        if (!text) return json(res, 422, { ok:false, error:"No readable text in PDF (OCR failed).", detail:String(e?.message||e).slice(0,300) });
        // else proceed with whatever text we have
      }
    }

    if (!text || !text.trim()) {
      return json(res, 422, { ok:false, error:"No readable text in PDF.", hint:"Try a clearer scan or enable OCR." });
    }

    // Step 3: Analyze
    const ar = await fetch(base + "/api/analyze-bizdoc", {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ text, type: "document" })
    });

    if (!ar.ok) {
      const body = await ar.text().catch(()=> "");
      return json(res, 502, { ok:false, error:`Analyzer failed HTTP ${ar.status}`, detail:body.slice(0,400) });
    }

    const data = await ar.json().catch(()=> ({}));
    return json(res, 200, { ok:true, source, analysis: data.analysis });

  } catch (err) {
    return json(res, 500, { ok:false, error:"Upload handler error", detail:String(err?.message||err).slice(0,400) });
  }
}
