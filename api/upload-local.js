import formidable from "formidable";
import fs from "fs";
import path from "path";

export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")
    return res.status(405).json({ ok: false, error: "Use POST" });

  try {
    const form = formidable({ multiples: false });
    const [fields, files] = await form.parse(req);
    const file = files.file?.[0];
    if (!file) return res.status(400).json({ ok: false, error: "Missing file" });

    const filePath = file.filepath || file.path;
    const buffer = fs.readFileSync(filePath);

    const text = await extractTextWithPdfJs(buffer);
    if (!text?.trim()) {
      return res
        .status(422)
        .json({ ok: false, error: "No text found in PDF (likely scanned)" });
    }

    return res.json({
      ok: true,
      bytes: buffer.length,
      preview: text.slice(0, 500),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      ok: false,
      error: "PDF text extraction failed",
      detail: err.message,
    });
  }
}

function getPdfJs() {
  try {
    return require("pdfjs-dist/legacy/build/pdf.js");
  } catch {
    throw new Error("Dependency load failed (pdfjs-dist missing)");
  }
}

async function extractTextWithPdfJs(buffer) {
  const pdfjsLib = getPdfJs();

  // Convert to Uint8Array (important for Lambda / Vercel runtime)
  const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const loadingTask = pdfjsLib.getDocument({
    data,
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
    const txt = await page.getTextContent();
    text += txt.items.map((t) => t.str).join(" ") + "\n";
  }
  return text;
}
