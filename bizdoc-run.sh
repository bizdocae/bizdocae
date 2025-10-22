#!/bin/bash

# 1. Define filename and endpoints
FILEPATH="./yourfile.pdf"                      # Change this to your local file path
FILENAME=$(basename "$FILEPATH")
ENCODED_FILE="/tmp/encoded_$FILENAME.b64"
PAYLOAD="/tmp/payload.json"
ANALYZE_ENDPOINT="https://bizdoc-min.vercel.app/api/analyze"
DOWNLOAD_ENDPOINT="https://bizdoc-min.vercel.app/api/download"

# 2. Encode file to base64
base64 "$FILEPATH" > "$ENCODED_FILE"

# 3. Create JSON payload
node -e '
  const fs = require("fs");
  const b64 = fs.readFileSync("'$ENCODED_FILE'", "utf8").trim();
  const payload = {
    fileBase64: b64,
    filename: "'$FILENAME'"
  };
  fs.writeFileSync("'$PAYLOAD'", JSON.stringify(payload, null, 2));
'

# 4. Send to /api/analyze and check status
echo "Analyzing document..."
curl -s -H "Content-Type: application/json" --data-binary @"$PAYLOAD" "$ANALYZE_ENDPOINT" | jq .

# 5. Download final PDF
echo "Downloading generated PDF..."
curl -L "$DOWNLOAD_ENDPOINT" -o "./BizDoc_Analysis_Report.pdf"

echo "✅ Done: Saved to BizDoc_Analysis_Report.pdf"
