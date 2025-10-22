async function generateClientPDF(payload) {
  const { title = "BizDoc Report", text = "", highlights = [] } = payload || {};

  // Ensure pdf-lib + fontkit (loaded via CDN in index.html)
  if (!window.PDFLib || !window.fontkit) throw new Error("PDF libs not loaded");
  const { PDFDocument, rgb } = window.PDFLib;

  // Load Unicode font bytes (Noto Sans)
  const fontBytes = await fetch("/fonts/NotoSans-Regular.ttf").then(r => r.arrayBuffer());

  // Build PDF
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(window.fontkit);
  const font = await pdfDoc.embedFont(fontBytes, { subset: true });

  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const m = 56;
  const { width, height } = page.getSize();

  const norm = (s) => String(s || "").replace(/\r\n/g, "\n");

  // Title
  page.drawText(norm(title), { x: m, y: height - m - 20, size: 22, font, color: rgb(0,0,0) });

  // Highlights
  let y = height - m - 60;
  const sz = 11;
  for (const h of (highlights || []).slice(0, 12)) {
    page.drawText(`• ${h.label}: ${h.value}`, { x: m, y, size: sz, font, color: rgb(0,0,0) });
    y -= 18;
  }

  // Wrap text
  const wrap = (t, size, x, startY, maxW) => {
    const words = String(t || "").split(/\s+/);
    let line = "", y = startY, lh = size * 1.5;
    for (const w of words) {
      const candidate = line ? line + " " + w : w;
      if (font.widthOfTextAtSize(candidate, size) > maxW) {
        if (line) page.drawText(line, { x, y, size, font, color: rgb(0,0,0) });
        y -= lh;
        line = w;
      } else {
        line = candidate;
      }
    }
    if (line) page.drawText(line, { x, y, size, font, color: rgb(0,0,0) });
  };

  wrap(norm(text), 11, m, y - 10, width - m * 2);

  const bytes = await pdfDoc.save();
  const blob = new Blob([bytes], { type: "application/pdf" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "BizDoc_Report.pdf";
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(a.href);
  a.remove();
}
window.generateClientPDF = generateClientPDF;
