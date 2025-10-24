export function cors(res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // Security headers
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  // Optional: tighten content security if you serve HTML from APIs
  // res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none';");
}
export function isOptions(req) { return req.method === "OPTIONS"; }
