const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { title = 'BizDoc Report', text = '', highlights = [] } = body;

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica); // ASCII-safe
    const page = pdf.addPage([595.28, 841.89]);
    const m = 56; const { width, height } = page.getSize();

    // Title
    page.drawText(String(title).replace(/\r\n/g,'\n'), {
      x: m, y: height - m - 20, size: 22, font, color: rgb(0,0,0)
    });

    // Highlights
    let y = height - m - 60;
    for (const h of (highlights || []).slice(0, 12)) {
      page.drawText(`• ${h.label}: ${h.value}`, { x: m, y, size: 11, font, color: rgb(0,0,0) });
      y -= 18;
    }

    // Body (simple wrap)
    const wrap = (t, sz, x, y0, maxW) => {
      const words = String(t || '').split(/\s+/); let line = '', y = y0, lh = sz * 1.5;
      for (const w of words) {
        const c = line ? line + ' ' + w : w;
        if (font.widthOfTextAtSize(c, sz) > maxW) {
          if (line) page.drawText(line, { x, y, size: sz, font, color: rgb(0,0,0) });
          y -= lh; line = w;
        } else line = c;
      }
      if (line) page.drawText(line, { x, y, size: sz, font, color: rgb(0,0,0) });
    };
    wrap(String(text).replace(/\r\n/g,'\n'), 11, m, y-10, width - m*2);

    const bytes = await pdf.save();
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition','attachment; filename="BizDoc_Report.pdf"');
    return res.status(200).send(Buffer.from(bytes));
  } catch (e) {
    console.error('PDF_MIN_ERR:', e && e.stack ? e.stack : e);
    res.setHeader('Content-Type','text/plain; charset=utf-8');
    return res.status(500).send('PDF_MIN_ERR:\n' + (e && e.stack ? e.stack : e));
  }
};

module.exports.config = { runtime: 'nodejs20.x' };
