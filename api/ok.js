export const config = { runtime: 'edge' };

export default function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'Content-Type, Authorization'
      }
    });
  }

  const body = JSON.stringify({
    ok: true,
    service: 'BizDoc-Min API',
    status: 'Healthy',
    timestamp: new Date().toISOString(),
    endpoints: {
      analyze: '/api/analyze',
      download: 'client-side-pdf',
      ok: '/api/ok'
    }
  });

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=0, must-revalidate',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'Content-Type, Authorization'
    }
  });
}
