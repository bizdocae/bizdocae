#!/usr/bin/env bash
set -euo pipefail
APP="${APP:-https://bizdocae.vercel.app}"
npx -y vercel@latest logs "$APP"
