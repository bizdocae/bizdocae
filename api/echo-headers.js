import { cors, isOptions } from "./_utils/cors.js";

export default async function handler(req, res) {
  // Apply shared headers
  cors(res);

  // Add a probe header so we can see if *any* custom header gets through
  res.setHeader("X-Security-Probe", "present");

  if (isOptions(req)) return res.status(204).end();

  // Echo back the headers Node believes it's sending
  // (Note: this is the server-side "outgoing" view, the client may still see different values if the edge overwrites)
  const out = {
    "access-control-allow-origin": res.getHeader("Access-Control-Allow-Origin"),
    "access-control-allow-methods": res.getHeader("Access-Control-Allow-Methods"),
    "access-control-allow-headers": res.getHeader("Access-Control-Allow-Headers"),
    "x-content-type-options": res.getHeader("X-Content-Type-Options"),
    "referrer-policy": res.getHeader("Referrer-Policy"),
    "x-frame-options": res.getHeader("X-Frame-Options"),
    "x-robots-tag": res.getHeader("X-Robots-Tag"),
    "x-security-probe": res.getHeader("X-Security-Probe")
  };

  res.status(200).json({ ok: true, sent: out, ts: new Date().toISOString() });
}
