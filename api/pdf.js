const { PDFDocument, rgb } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");
const fs = require("fs");
const path = require("path");

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function normalizeText(s = "") {
  return String(s).replace(/\r\n/g, "\n");
}

async function readFont(rel) {
  const p = path.join(process.cwd(), rel);
  return fs.readFileSync(p);
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { title = "BizDoc Report", text = "", arabicText = "", highlights = [] } = body;

    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    const noto = await pdfDoc.embedFont(readFont("fonts/NotoSans-Regular.ttf"), { subset: true });
    let arabicFont = noto;
    try { arabicFont = await pdfDoc.embedFont(readFont("fonts/NotoSansArabic.ttf"), { subset: true }); } catch {}

    const page = pdfDoc.addPage([595.28, 841.89]); // A4
    const margin = 56;
    const { width, height } = page.getSize();

    page.drawText(normalizeText(title), { x: margin, y: height - margin - 20, size: 22, font: noto, color: rgb(0,0,0) });

    let y = height - margin - 60;
    const sz = 11;
    for (const h of (highlights || []).slice(0, 12)) {
      const line = `• ${h.label}: ${h.value}`;
      page.drawText(normalizeText(line), { x: margin, y, size: sz, font: noto, color: rgb(0,0,0) });
      y -= 18;
    }

    y -= 10;
    wrap(page, normalizeText(text), noto, sz, margin, y, width - margin * 2);

    if (arabicText) {
      const p2 = pdfDoc.addPage([595.28, 841.89]);
      p2.drawText("التحليل:", { x: margin, y: p2.getSize().height - margin - 20, size: 16, font: arabicFont, color: rgb(0,0,0) });
      wrap(p2, normalizeText(arabicText), arabicFont, 12, margin, p2.getSize().height - margin - 60, p2.getSize().width - margin * 2);
    }

    const bytes = await pdfDoc.save();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="BizDoc_Report.pdf"');
    return res.status(200).send(Buffer.from(bytes));
  } catch (e) {
    return res.status(500).json({ ok: false, error: `PDF generation failed: ${e.message}` });
  }
};

function wrap(page, text, font, size, x, startY, maxWidth) {
  const words = String(text || "").split(/\s+/);
  let line = "";
  let y = startY;
  const lh = size * 1.5;
  for (const w of words) {
    const candidate = line ? line + " " + w : w;
    const wpx = font.widthOfTextAtSize(candidate, size);
    if (wpx > maxWidth) {
      if (line) page.drawText(line, { x, y, size, font, color: rgb(0,0,0) });
      y -= lh; line = w;
    } else line = candidate;
  }
  if (line) page.drawText(line, { x, y, size, font, color: rgb(0,0,0) });
}
