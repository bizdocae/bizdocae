import formidable from "formidable";
import fs from "fs";

export const config = { api: { bodyParser: false } };

function json(res, status, obj) {
  try { res.setHeader("Content-Type","application/json; charset=utf-8"); } catch {}
  res.status(status).end(JSON.stringify(obj));
}

function toUint8(buffer) {
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function getPdfJs() {
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
    disableStream: true
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

// Heuristic: treat as "low text" only if < 8 tokens.
// (This prefers pdf.js if there's *any* meaningful text.)
function isLowText(s) {
  if (!s) return true;
  const tokens = s.trim().split(/\s+/).filter(Boolean);
  return tokens.length < 8;
}

async function ocrFallback(baseUrl, fileBuffer, filename, language) {
  const fd = new FormData();
  fd.append("file", new Blob([fileBuffer], { type: "application/pdf" }), filename);
  fd.append("wantText", "true");
  fd.append("wantSearchablePdf", "true"); // return PDF URL when OCR provides it
  fd.append("language", language || "auto");

  const r = await fetch(baseUrl + "/api/ocr-ocrspace-upload-pdf", { method: "POST", body: fd });
  const rawTxt = await r.text();
  let j = {};
  try { j = JSON.parse(rawTxt); } catch { /* leave {} */ }

  if (!r.ok || !j.ok) {
    const msg = (j && (j.error || j.detail)) ? `: ${j.error || j.detail}` : "";
    throw new Error(`OCR failed HTTP ${r.status}${msg}`);
  }
  return { text: j.text || "", pdfUrl: j.pdfUrl || null };
}

export default async function handler(req, res) {
  // CORS / preflight
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return json(res, 405, { ok:false, error:"Use POST" });

  try {
    const form = formidable({
      multiples: false,
      maxFileSize: 10 * 1024 * 1024,
      filter: p => p.name === "file" || p.name === "lang" || p.name === "language" || p.name === "force"
    });
    const [fields, files] = await form.parse(req);
    const up = files.file?.[0];
    if (!up) return json(res, 400, { ok:false, error:"Missing file (field name must be 'file')." });

    const language = (fields.lang?.[0] || fields.language?.[0] || "auto").toString().trim() || "auto";
    const forceOCR = ((fields.force?.[0] || "").toString().trim() === "1");

    const buffer = await fs.promises.readFile(up.filepath || up.path);

    // Step 1: pdf.js
    let source = "pdfjs";
    let text = "";
    let ocredPdfUrl = null;

    try { text = await extractTextWithPdfJs(buffer); } catch { text = ""; }

    const proto = req.headers["x-forwarded-proto"] || "https";
    const host  = req.headers.host || "localhost:3000";
    const base  = `${proto}://${host}`;

    // Step 2: OCR when forced or low text
    if (forceOCR || isLowText(text)) {
      try {
        const { text: otext, pdfUrl } = await ocrFallback(base, buffer, up.originalFilename || "upload.pdf", language);
        if (otext && otext.trim()) {
          text = otext.trim();
          ocredPdfUrl = pdfUrl || null;
          source = "ocr";
        } else if (!text) {
          return json(res, 422, { ok:false, error:"No readable text in PDF (OCR empty).", hint:"Try clearer scan or another language." });
        }
      } catch (e) {
        if (!text) return json(res, 422, { ok:false, error:"No readable text in PDF (OCR failed).", detail:String(e?.message||e) });
      }
    }

    if (!text?.trim()) {
      return json(res, 422, { ok:false, error:"No readable text in PDF.", hint:"Try clearer scan or choose a language for OCR." });
    }

    // Step 3: analyze
    const ar = await fetch(base + "/api/analyze-bizdoc", {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ text, type: "document" })
    });

    if (!ar.ok) {
      const body = await ar.text().catch(()=> "");
      return json(res, 502, { ok:false, error:`Analyzer failed HTTP ${ar.status}`, detail: body.slice(0,400) });
    }

    const data = await ar.json().catch(()=> ({}));
    return json(res, 200, { ok:true, source, ocredPdfUrl, analysis: data.analysis });
  } catch (err) {
    return json(res, 500, { ok:false, error:"Upload handler error", detail:String(err?.message||err).slice(0,400) });
  }
}
