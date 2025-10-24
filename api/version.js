import { cors, isOptions } from "./_utils/cors.js";

export default async function handler(req, res) {
  cors(res);
  if (isOptions(req)) return res.status(204).end();

  const sha = process.env.VERCEL_GIT_COMMIT_SHA || "local";
  const ref = process.env.VERCEL_GIT_COMMIT_REF || "local";
  const env = process.env.VERCEL_ENV || "dev";

  res.status(200).json({
    ok: true,
    service: "BizDocAE API",
    env,
    git: { sha, ref },
    node: process.version,
    timestamp: new Date().toISOString()
  });
}
