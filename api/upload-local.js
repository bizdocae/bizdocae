function json(res, status, obj) {
  try { res.setHeader('Content-Type','application/json; charset=utf-8'); } catch {}
  res.statusCode = status;
  res.end(JSON.stringify(obj));
}
function isMultipart(req) {
  const ct = (req.headers && req.headers['content-type']) || '';
  return /^multipart\/form-data/i.test(ct);
}

// Node-safe text extractor using pdf.js legacy build via CommonJS
function getPdfJs() {
  // legacy build ships Node-friendly code
  const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
  // Avoid workers/eval in Lambda
  try { pdfjsLib.GlobalWorkerOptions.workerSrc = null; } catch {}
  return pdfjsLib;
}

async function extractTextWithPdfJs(buffer) {
  const pdfjsLib = getPdfJs();
  const loadingTask = pdfjsLib.getDocument({
    data: buffer,
    isEvalSupported: false,
    disableFontFace: true
  });
  const doc = await loadingTask.promise;
  let all = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    all += tc.items.map(it => (it && it.str) ? it.str : '').join(' ') + '\n';
    page.cleanup && page.cleanup();
  }
  doc.cleanup && doc.cleanup();
  return all.trim();
}

module.exports = async function handler(req, res) {
  // CORS / preflight
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { ok:false, error:'Use POST' });
  if (!isMultipart(req)) return json(res, 400, { ok:false, error:"Content-Type must be multipart/form-data; use field 'file'." });

  // Multer (CommonJS)
  let multer; try { multer = require('multer'); }
  catch (e) { return json(res, 500, { ok:false, error:'multer failed to load', detail:String(e?.message||e) }); }

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

  await new Promise((resolve, reject) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') { err.statusCode = 413; err.message = 'File too large. Max 10MB.'; }
        return reject(err);
      }
      resolve();
    });
  }).catch(e => json(res, e?.statusCode||500, { ok:false, error:String(e?.message||e) }));
  if (res.writableEnded) return;

  const file = req.file;
  if (!file) return json(res, 400, { ok:false, error:"No file uploaded (field must be 'file')." });
  if (file.mimetype !== 'application/pdf') return json(res, 415, { ok:false, error:`Unsupported type: ${file.mimetype}. PDF only.` });

  // Extract text using pdf.js (no DOM required)
  let text = '';
  try {
    text = await extractTextWithPdfJs(file.buffer);
  } catch (e) {
    return json(res, 500, { ok:false, error:'PDF text extraction failed', detail:String(e?.message||e).slice(0,300) });
  }
  if (!text) return json(res, 422, { ok:false, error:'No readable text in PDF (needs OCR).' });

  // Call analyzer
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host  = req.headers.host || 'localhost:3000';
  const base  = `${proto}://${host}`;

  let ar;
  try {
    ar = await fetch(base + '/api/analyze-bizdoc', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ text, type:'document' })
    });
  } catch (e) {
    return json(res, 502, { ok:false, error:'Analyzer fetch failed', detail:String(e?.message||e) });
  }

  if (!ar.ok) {
    const msg = await ar.text().catch(()=> '');
    return json(res, 502, { ok:false, error:`Analyzer failed HTTP ${ar.status}`, detail: msg.slice(0,400) });
  }

  let data = {}; try { data = await ar.json(); } catch {}
  return json(res, 200, { ok:true, analysis: data.analysis });
};
module.exports.config = { runtime:'nodejs', api:{ bodyParser:false } };
