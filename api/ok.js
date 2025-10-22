export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();

  const info = {
    ok: true,
    service: "BizDoc-Min API",
    status: "Healthy",
    timestamp: new Date().toISOString(),
    endpoints: {
      analyze: "/api/analyze",
      download: "/api/pdf",
      ok: "/api/ok"
    }
  };

  res.status(200).json(info);
}
