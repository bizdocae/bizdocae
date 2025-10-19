// /api/ocr-ocrspace-pdf.js
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Use POST" });

  const { url, language = "auto", hideText = true } = await readBody(req);
  if (!url) return res.status(400).json({ ok: false, error: "Missing 'url'" });

  const apikey = process.env.OCRSPACE_API_KEY || "helloworld";

  const form = new FormData();
  form.set("url", url);
  form.set("language", language);
  form.set("isCreateSearchablePdf", "true");
  form.set("isSearchablePdfHideTextLayer", String(!!hideText));
  form.set("OCREngine", "2");

  const ocrResp = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    headers: { apikey },
    body: form
  });

  let data;
  try {
    data = await ocrResp.json();
  } catch {
    return res.status(502).json({ ok: false, error: "OCR.space returned non-JSON" });
  }

  const pdfUrl = data?.SearchablePDFURL || data?.SearchablePdfURL;
  if (!ocrResp.ok || data?.IsErroredOnProcessing || !pdfUrl) {
    return res.status(400).json({ ok: false, error: data?.ErrorMessage || "OCR failed", raw: data });
  }

  const pdfResp = await fetch(pdfUrl);
  if (!pdfResp.ok) return res.status(502).json({ ok: false, error: "PDF fetch failed" });

  const buf = Buffer.from(await pdfResp.arrayBuffer());
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'attachment; filename="ocr.pdf"');
  res.status(200).send(buf);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}
