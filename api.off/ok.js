export const config = { runtime: "nodejs22.x" };
export default function handler(req, res) {
  res.status(200).json({ ok: true, runtime: "nodejs22.x" });
}
