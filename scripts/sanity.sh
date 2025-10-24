#!/usr/bin/env bash
set -euo pipefail
APP="${APP:-https://bizdocae.vercel.app}"
ok(){ [ "$1" -eq 200 ] || { echo "❌ $2 -> $1"; exit 1; }; }
HC=$(curl -sS -o /tmp/ok.json -w "%{http_code}" "$APP/api/ok"); ok "$HC" "/api/ok"
VC=$(curl -sS -o /tmp/version.json -w "%{http_code}" "$APP/api/version"); ok "$VC" "/api/version"
PC=$(curl -sS -D /tmp/pdf.h -o /tmp/out.pdf -w "%{http_code}" "$APP/api/pdf"); ok "$PC" "/api/pdf"
DC=$(curl -sS -D /tmp/docx.h -o /tmp/out.docx -w "%{http_code}" "$APP/api/docx"); ok "$DC" "/api/docx"
AC=$(curl -sS -H "Content-Type: application/json" -d '{"text":"Quick sanity test"}' -D /tmp/analyze.h -o /tmp/analyze.json -w "%{http_code}" "$APP/api/analyze"); ok "$AC" "/api/analyze"
grep -qi 'application/pdf' /tmp/pdf.h && head -c5 /tmp/out.pdf | grep -q '^%PDF-' || { echo "❌ PDF"; exit 1; }
grep -qi 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' /tmp/docx.h || { echo "❌ DOCX CT"; exit 1; }
jq -e '.ok==true' /tmp/ok.json >/dev/null && jq -e '.ok==true' /tmp/analyze.json >/dev/null || { echo "❌ ok flags"; exit 1; }
echo "✅ SANITY: ALL GREEN"
