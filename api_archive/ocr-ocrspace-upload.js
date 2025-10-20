// /api/ocr-ocrspace-upload.js
export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Use POST" });

  try {
    const { fileB64, filename = "upload", mime = "application/octet-stream", language = "auto", wantText = true, wantSearchablePdf = true } = await readBody(req);
    if (!fileB64) return res.status(400).json({ ok: false, error: "Missing 'fileB64'" });

    const apikey = process.env.OCRSPACE_API_KEY || "helloworld";
    const bin = Buffer.from(fileB64, "base64");
    const blob = new Blob([bin], { type: mime });

    const form = new FormData();
    form.set("file", blob, filename);
    form.set("language", language);
    form.set("isOverlayRequired", String(!!wantText));
    form.set("isCreateSearchablePdf", String(!!wantSearchablePdf));
    form.set("isSearchablePdfHideTextLayer", "true");
    form.set("OCREngine", "2");

    const resp = await fetch("https://api.ocr.space/parse/image", { method: "POST", headers: { apikey }, body: form });
    const data = await resp.json().catch(() => null);

    if (!resp.ok || !data || data.IsErroredOnProcessing) {
      return res.status(400).json({ ok: false, error: firstError(data) || `OCR failed (${resp.status})`, raw: data });
    }

    const parsed = (data.ParsedResults || [])[0] || {};
    const text = parsed.ParsedText || "";
    const pdfUrl = data.SearchablePDFURL || data.SearchablePdfURL || null;

    return res.status(200).json({
      ok: true,
      engine: 2,
      text: wantText ? text : undefined,
      pdfUrl: wantSearchablePdf ? pdfUrl : undefined,
      meta: { exit: data?.OCRExitCode, ms: data?.ProcessingTimeInMilliseconds }
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}

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
