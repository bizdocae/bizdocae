// api/ok.js (ESM)
export default function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(200).end(JSON.stringify({ ok: true, runtime: "nodejs" }));
}
