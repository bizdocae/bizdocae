/**
 * Secure pdf.js v5 text extraction (no eval)
 */
export async function extractPdfSecure(buffer) {
  const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
  const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const loadingTask = pdfjs.getDocument({
    data: uint8,
    useWorkerFetch: false,
    isEvalSupported: false,
    isOffscreenCanvasSupported: false
  });

  const pdf = await loadingTask.promise;
  let text = "";
  const maxPages = Math.min(pdf.numPages, 20);
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false
    });
    if (content?.items?.length) {
      text += content.items.map(it => it.str || "").join(" ") + "\n";
    }
  }
  return text.trim();
}
