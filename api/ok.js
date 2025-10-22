module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  res.status(200).json({
    ok: true,
    service: "BizDoc-Min API",
    status: "Healthy",
    timestamp: new Date().toISOString(),
    endpoints: {
      analyze: "/api/analyze",
      download: "client-side-pdf",
      ok: "/api/ok"
    }
  });
};
