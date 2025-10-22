const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595.28, 841.89]); // A4
    const font = await pdf.embedFont(StandardFonts.Helvetica); // ASCII-safe
    page.drawText('BizDoc pdf-lib smoke OK', { x: 56, y: 800, size: 18, font, color: rgb(0,0,0) });
    const bytes = await pdf.save();
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition','attachment; filename="smoke-lib.pdf"');
    return res.status(200).send(Buffer.from(bytes));
  } catch (e) {
    console.error('SMOKE_LIB_ERR:', e && e.stack ? e.stack : e);
    res.setHeader('Content-Type','text/plain; charset=utf-8');
    return res.status(500).send('SMOKE_LIB_ERR:\n' + (e && e.stack ? e.stack : e));
  }
};

// Force Node runtime (CommonJS file)
module.exports.config = { runtime: 'nodejs20.x' };
