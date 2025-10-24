import { cors, isOptions } from "./_utils/cors.js";

export default async function handler(req, res) {
  cors(res);
  if (isOptions(req)) return res.status(204).end();

  res.status(200).json({
    ok: true,
    service: "BizDocAE API",
    status: "Healthy",
    timestamp: new Date().toISOString(),
    endpoints: {
      analyze: "/api/analyze",
      download: "client-side-pdf",
      ok: "/api/ok",
      version: "/api/version",
      pdf: "/api/pdf",
      docx: "/api/docx"
    }
  });
}
