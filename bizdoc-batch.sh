#!/usr/bin/env bash
set -euo pipefail

# ---------- CONFIG ----------
ANALYZE_ENDPOINT="https://bizdoc-min.vercel.app/api/analyze"
DOWNLOAD_ENDPOINT="https://bizdoc-min.vercel.app/api/download"
UPLOAD_DIR="./uploads"
OUT_DIR="./out"
# server-side limit ~4MB raw; keep client check aligned:
MAX_BYTES=$((4*1024*1024))     # 4 MB
# Set FORCE_OCR=1 to force OCR on PDFs
FORCE_OCR="${FORCE_OCR:-0}"

# ---------- PREP ----------
mkdir -p "$UPLOAD_DIR" "$OUT_DIR"

echo "=== Sanity: /api/ok ==="
curl -s "$ANALYZE_ENDPOINT/../ok" | jq || { echo "Health check failed"; exit 1; }
echo

echo "=== Sanity: /api/analyze GET (should be 405 JSON) ==="
curl -s -i "$ANALYZE_ENDPOINT" | head -n 6
echo

# Node one-liner to get base64 (safe across OS; no line-wrap)
b64() {
  node -e 'const fs=require("fs"); const f=process.argv[1]; process.stdout.write(fs.readFileSync(f).toString("base64"));' "$1"
}

# Size check
filesize() { stat --format=%s "$1" 2>/dev/null || stat -f%z "$1"; }

process_file() {
  local fpath="$1"
  local fname="$(basename "$fpath")"
  local ext="${fname##*.}"
  local stem="${fname%.*}"

  # size guard
  local sz
  sz=$(filesize "$fpath")
  if [ "$sz" -gt "$MAX_BYTES" ]; then
    echo "⚠️  Skipping '$fname' (${sz} bytes > ${MAX_BYTES}). Use Blob/URL path for large files."
    return 0
  fi

  echo "→ Processing: $fname  (size: $sz bytes)"
  local b64data
  b64data="$(b64 "$fpath")"

  # Build analyze payload (add forceOCR only for PDFs & if flag set)
  if [[ "${ext,,}" == "pdf" && "$FORCE_OCR" == "1" ]]; then
    node -e '
      const fs=require("fs");
      const [b64,fname]=process.argv.slice(2);
      const payload={ fileBase64:b64, filename: fname, forceOCR: true };
      fs.writeFileSync("/tmp/payload.json", JSON.stringify(payload));
    ' "$b64data" "$fname"
    echo "   • Using forceOCR:true for PDF"
  else
    node -e '
      const fs=require("fs");
      const [b64,fname]=process.argv.slice(2);
      const payload={ fileBase64:b64, filename: fname };
      fs.writeFileSync("/tmp/payload.json", JSON.stringify(payload));
    ' "$b64data" "$fname"
  fi

  echo "   • Analyzing..."
  local analyze_json
  analyze_json="$(curl -s -H "Content-Type: application/json" --data-binary @/tmp/payload.json "$ANALYZE_ENDPOINT")"

  # Validate JSON and ok:true
  echo "$analyze_json" | jq . >/dev/null 2>&1 || { echo "❌ Analyze did not return JSON. Raw:"; echo "$analyze_json"; return 1; }
  local ok
  ok="$(echo "$analyze_json" | jq -r '.ok')"
  if [[ "$ok" != "true" ]]; then
    echo "❌ Analyze error:"; echo "$analyze_json" | jq .
    return 1
  fi

  # Extract analysis object and post to /api/download
  echo "   • Generating PDF..."
  echo "$analyze_json" | jq '{analysis:.analysis}' > /tmp/download_payload.json

  local outpdf="${OUT_DIR}/${stem}_Report.pdf"
  curl -s -X POST -H "Content-Type: application/json" --data-binary @/tmp/download_payload.json "$DOWNLOAD_ENDPOINT" -o "$outpdf"

  # Sanity: check it's a PDF
  if file "$outpdf" | grep -qi 'PDF'; then
    echo "✅ Saved: $outpdf"
  else
    echo "❌ Output not a PDF. File info:"
    file "$outpdf" || true
    return 1
  fi
}

echo "=== Batch start (FORCE_OCR=$FORCE_OCR, limit=${MAX_BYTES}B) ==="
shopt -s nullglob nocaseglob
matched=0
for f in "$UPLOAD_DIR"/*.pdf "$UPLOAD_DIR"/*.docx "$UPLOAD_DIR"/*.txt; do
  matched=1
  process_file "$f" || echo "   ↳ Skipped due to error."
  echo
done
shopt -u nullglob nocaseglob

if [ "$matched" -eq 0 ]; then
  echo "No files found in $UPLOAD_DIR. Drop .pdf/.docx/.txt there and rerun."
else
  echo "=== Batch complete. See ./${OUT_DIR} ==="
fi
