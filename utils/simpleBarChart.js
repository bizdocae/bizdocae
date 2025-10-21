export function drawBarChart(pdfPage, { x=40, y=160, w=520, h=180, labels=[], values=[] }, font, fontSize=10) {
  const max = Math.max(...values, 1);
  const barGap = 12;
  const barCount = values.length;
  const barWidth = Math.max(20, Math.floor((w - (barGap*(barCount+1))) / Math.max(barCount,1)));

  // Axes
  pdfPage.drawLine({ start: {x, y}, end: {x, y+h}, thickness: 1, color: { r:0, g:0, b:0 } });
  pdfPage.drawLine({ start: {x, y}, end: {x+w, y}, thickness: 1, color: { r:0, g:0, b:0 } });

  // Bars
  let cx = x + barGap;
  for (let i=0;i<barCount;i++) {
    const v = values[i];
    const bh = Math.round((v/max) * (h - 20));
    pdfPage.drawRectangle({
      x: cx, y: y,
      width: barWidth, height: bh,
      borderColor: { r:0, g:0, b:0 },
      borderWidth: 1,
      color: { r:0.16, g:0.34, b:0.78 } // solid blue fill, no shadows
    });
    // Label
    pdfPage.drawText((labels[i]||"").slice(0,12), {
      x: cx, y: y - (fontSize+2),
      size: fontSize, font, color: { r:0, g:0, b:0 }
    });
    cx += barWidth + barGap;
  }
}
