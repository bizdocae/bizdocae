import { cors, isOptions } from "./_utils/cors.js";
export default async function handler(req, res) {
  cors(res);
  if (isOptions(req)) return res.status(204).end();
  res.status(200).json({ ok: true, provider: "generic-ocr", note: "stub" });
}
