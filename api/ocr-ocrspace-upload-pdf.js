// /api/ocr-ocrspace-upload-pdf.js
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Use POST" });

  try {
    const { fileB64, filename = "ocr.pdf", mime = "application/octet-stream", language = "auto", hideText = true } = await readBody(req);
    if (!fileB64) return res.status(400).json({ ok: false, error: "Missing 'fileB64'" });

    const apikey = process.env.OCRSPACE_API_KEY || "helloworld";
    const bin = Buffer.from(fileB64, "base64");
    const blob = new Blob([bin], { type: mime });

    const form = new FormData();
    form.set("file", blob, filename || "upload.bin");
    form.set("language", language);
    form.set("isCreateSearchablePdf", "true");
    form.set("isSearchablePdfHideTextLayer", String(!!hideText));
    form.set("OCREngine", "2");

    const ocrResp = await fetch("https://api.ocr.space/parse/image", { method: "POST", headers: { apikey }, body: form });
    const data = await ocrResp.json().catch(() => null);
    const pdfUrl = data?.SearchablePDFURL || data?.SearchablePdfURL;

    if (!ocrResp.ok || !data || data.IsErroredOnProcessing || !pdfUrl) {
      return res.status(400).json({ ok: false, error: firstError(data) || "OCR failed", raw: data });
    }

    const pdfResp = await fetch(pdfUrl);
    if (!pdfResp.ok) return res.status(502).json({ ok: false, error: "PDF fetch failed" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilename(filename || 'ocr')}"`);
    const buf = Buffer.from(await pdfResp.arrayBuffer());
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
function safeFilename(name){ return String(name).replace(/[^a-z0-9_.-]+/gi,'_').replace(/\.pdf$/i,'') + '.pdf'; }
function firstError(d){
  if (!d) return null;
  if (Array.isArray(d.ErrorMessage) && d.ErrorMessage[0]) return String(d.ErrorMessage[0]);
  if (typeof d.ErrorMessage === "string") return d.ErrorMessage;
  if (typeof d.ErrorDetails === "string") return d.ErrorDetails;
  return null;
}
async function readBody(req){
  const chunks=[]; for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}
