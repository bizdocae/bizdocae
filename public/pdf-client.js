async function generateClientPDF(payload) {
  const { title = "BizDoc Report", text = "", highlights = [], appendixText = "" } = payload || {};
  if (!window.PDFLib || !window.fontkit) throw new Error("PDF libs not loaded");
  const { PDFDocument, rgb } = window.PDFLib;

  const fontBytes = await fetch("/fonts/NotoSans-Regular.ttf").then(r => r.arrayBuffer());
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(window.fontkit);
  const font = await pdfDoc.embedFont(fontBytes, { subset: true });

  const A4 = [595.28, 841.89], m = 56;
  const page = pdfDoc.addPage(A4);
  const { width, height } = page.getSize();
  const norm = (s) => String(s || "").replace(/\r\n/g, "\n");

  // Title
  page.drawText(norm(title), { x: m, y: height - m - 20, size: 22, font, color: rgb(0,0,0) });

  // Highlights
  let y = height - m - 60;
  const sz = 11;
  for (const h of (highlights || []).slice(0, 15)) {
    const line = `• ${h.label}: ${h.value}`;
    page.drawText(line, { x: m, y, size: sz, font, color: rgb(0,0,0) });
    y -= 18;
  }

  // Body wrap
  y -= 10;
  const wrap = (text, size, x, startY, maxW) => {
    const words = String(text || "").split(/\s+/);
    let line = "", y = startY, lh = size * 1.5;
    for (const w of words) {
      const candidate = line ? line + " " + w : w;
      if (font.widthOfTextAtSize(candidate, size) > maxW) {
        if (line) page.drawText(line, { x, y, size, font, color: rgb(0,0,0) });
        y -= lh; line = w;
      } else line = candidate;
    }
    if (line) page.drawText(line, { x, y, size, font, color: rgb(0,0,0) });
  };
  wrap(norm(text), 11, m, y, width - m * 2);

  // Appendix: short AI JSON (for verification)
  if (appendixText) {
    const p2 = pdfDoc.addPage(A4);
    p2.drawText("Appendix: AI JSON (truncated)", { x: m, y: p2.getSize().height - m - 20, size: 14, font, color: rgb(0,0,0) });
    const words = String(appendixText).split(/\s+/);
    let line = "", y2 = p2.getSize().height - m - 60, lh = 10 * 1.5;
    for (const w of words) {
      const cand = line ? line + " " + w : w;
      if (font.widthOfTextAtSize(cand, 10) > (p2.getSize().width - m * 2)) {
        if (line) p2.drawText(line, { x: m, y: y2, size: 10, font, color: rgb(0,0,0) });
        y2 -= lh; line = w;
        if (y2 < 80) break; // keep appendix short
      } else line = cand;
    }
    if (line && y2 >= 80) p2.drawText(line, { x: m, y: y2, size: 10, font, color: rgb(0,0,0) });
  }

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
