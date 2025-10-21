import fs from "fs";
import pdfParse from "pdf-parse";

export async function isScannedPdf(bufferOrPath) {
  let dataBuffer;
  if (Buffer.isBuffer(bufferOrPath)) {
    dataBuffer = bufferOrPath;
  } else if (typeof bufferOrPath === "string") {
    dataBuffer = fs.readFileSync(bufferOrPath);
  } else {
    throw new Error("isScannedPdf expects a Buffer or file path");
  }
  try {
    const res = await pdfParse(dataBuffer);
    const text = (res.text || "").replace(/\s+/g, "");
    // If almost no textual glyphs, it's likely scanned.
    return text.length < 20;
  } catch {
    // If parsing fails, be conservative and treat as scanned.
    return true;
  }
}
