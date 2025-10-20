// /api/ocr-ocrspace.js
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Use POST" });
    return;
  }

  try {
    const { url, wantText = true, wantSearchablePdf = true, language = "auto" } = await readBody(req);
    if (!url) return res.status(400).json({ ok: false, error: "Missing 'url'" });

    const apikey = process.env.OCRSPACE_API_KEY || "helloworld"; // demo key works for tiny samples
    const form = new FormData();
    form.set("url", url);                           // OCR by remote URL
    form.set("language", language);                 // "ara", "eng", or "auto" (Engine 2)
    form.set("isOverlayRequired", String(wantText)); 
    form.set("isCreateSearchablePdf", String(wantSearchablePdf));
    form.set("isSearchablePdfHideTextLayer", "true"); // hide text layer if you prefer
    form.set("OCREngine", "2");                     // Engine 2 supports auto language + strong mixed text

    const resp = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      headers: { apikey },                          // send key in header
      body: form,
    });

    const data = await resp.json();

    if (!resp.ok || data?.IsErroredOnProcessing) {
      return res.status(400).json({
        ok: false,
        error: data?.ErrorMessage || data?.ErrorDetails || `OCR.space error`,
        raw: data,
      });
    }

    const parsed = (data.ParsedResults || [])[0] || {};
    const text = parsed.ParsedText || "";
    const pdfUrl = data.SearchablePDFURL || data.SearchablePdfURL || null; // API field casing varies in docs

    res.status(200).json({
      ok: true,
      engine: 2,
      languageUsed: data?.OCRExitCode ? language : language, // passthrough
      text: wantText ? text : undefined,
      pdfUrl: wantSearchablePdf ? pdfUrl : undefined,
      raw: { OCRExitCode: data?.OCRExitCode, ProcessingTimeInMilliseconds: data?.ProcessingTimeInMilliseconds },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
}

// Small helper to read JSON body safely
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8") || "{}";
  try { return JSON.parse(raw); } catch { return {}; }
}
