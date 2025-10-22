module.exports = (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(204).end();

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).end(JSON.stringify({
      ok: true,
      service: 'BizDoc-Min API',
      status: 'Healthy',
      timestamp: new Date().toISOString(),
      endpoints: {
        analyze: '/api/analyze',
        download: 'client-side-pdf',
        ok: '/api/ok'
      }
    }));
  } catch (err) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(500).end(JSON.stringify({ ok: false, error: String(err && err.message || err) }));
  }
};
