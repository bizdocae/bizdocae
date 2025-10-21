function json(res, status, obj) {
  try { res.setHeader('Content-Type','application/json; charset=utf-8'); } catch {}
  res.statusCode = status;
  res.end(JSON.stringify(obj));
}
function isMultipart(req) {
  const ct = (req.headers && req.headers['content-type']) || '';
  return /^multipart\/form-data/i.test(ct);
}
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { ok:false, error:'Use POST' });
  if (!isMultipart(req)) return json(res, 400, { ok:false, error:"Content-Type must be multipart/form-data; use field 'file'." });

  let multer, pdfParse;
  try { multer = require('multer'); pdfParse = require('pdf-parse'); }
  catch (e) { return json(res, 500, { ok:false, error:'Dependency load failed', detail:String(e?.message||e) }); }

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10*1024*1024 }});
  await new Promise((resolve, reject)=> upload.single('file')(req, res, err=>{
    if (err){ if (err.code==='LIMIT_FILE_SIZE'){ err.statusCode=413; err.message='File too large. Max 10MB.'; } return reject(err); }
    resolve();
  })).catch(e=> json(res, e?.statusCode||500, { ok:false, error:String(e?.message||e) }));
  if (res.writableEnded) return;

  const file = req.file;
  if (!file) return json(res, 400, { ok:false, error:"No file uploaded (field must be 'file')." });
  if (file.mimetype !== 'application/pdf') return json(res, 415, { ok:false, error:`Unsupported type: ${file.mimetype}. PDF only.` });

  let text = '';
  try { const parsed = await pdfParse(file.buffer); text = (parsed?.text||'').trim(); } catch {}
  if (!text) return json(res, 422, { ok:false, error:'No readable text in PDF (needs OCR).' });

  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host  = req.headers.host || 'localhost:3000';
  const base  = `${proto}://${host}`;

  let ar;
  try {
    ar = await fetch(base + '/api/analyze-bizdoc', {
      method:'POST', headers:{ 'Content-Type':'application/json' },
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
