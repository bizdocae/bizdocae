#!/usr/bin/env bash
set -euo pipefail
npx -y vercel@latest pull --yes
npx -y vercel@latest --prod --yes | tee /tmp/deploy.out
URL=$(grep -Eo 'https://[a-zA-Z0-9._-]+\.vercel\.app' /tmp/deploy.out | tail -1 || true)
echo "✅ Production: ${URL:-unknown}"
