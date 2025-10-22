/**
 * /api/analyze
 * - Manual JSON body parsing with 8MB cap (≈6MB raw file)
 * - Lazy import of pdfjs (avoids cold-start crashes on GET)
 * - Buffer -> Uint8Array conversion for pdfjs
 * - OCR fallback if pdfjs fails or PDF is scanned
 * - Always returns JSON
 */

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function readJson(req, maxBytes = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = "", size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error("Request too large"), { status: 413 }));
        req.destroy();
      } else data += chunk;
    });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(Object.assign(new Error("Invalid JSON body"), { status: 400 })); }
    });
    req.on("error", e => reject(Object.assign(e, { status: 400 })));
  });
}

function detectScanned(buffer) {
  const head = buffer.toString("binary", 0, 8192);
  return (head.match(/\/Image/g) || []).length >= 2;
}

async function extractPdfSecure(buffer) {
  // Secure pdf.js v5 extraction (no eval)
  const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
  const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const loadingTask = pdfjs.getDocument({
    data: uint8,
    useWorkerFetch: false,
    isEvalSupported: false,
    isOffscreenCanvasSupported: false,
  });

  const pdf = await loadingTask.promise;
  let text = "";
  const maxPages = Math.min(pdf.numPages, 20);

  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false,
    });
    if (content?.items?.length) {
      text += content.items.map((it) => it.str || "").join(" ") + "\n";
    }
  }

  return text.trim();
}
async function extractPdfSecure(buffer) {
  // Secure pdf.js v5 extraction (no eval)
  const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
  const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const loadingTask = pdfjs.getDocument({
    data: uint8,
    useWorkerFetch: false,
    isEvalSupported: false,
    isOffscreenCanvasSupported: false,
  });

  const pdf = await loadingTask.promise;
  let text = "";
  const maxPages = Math.min(pdf.numPages, 20);

  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false,
    });
    if (content?.items?.length) {
      text += content.items.map((it) => it.str || "").join(" ") + "\n";
    }
  }

  return text.trim();
}
async function extractPdfSecure(buffer) {
  // Secure pdf.js v5 extraction (no eval)
  const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
  const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const loadingTask = pdfjs.getDocument({
    data: uint8,
    useWorkerFetch: false,
    isEvalSupported: false,
    isOffscreenCanvasSupported: false,
  });

  const pdf = await loadingTask.promise;
  let text = "";
  const maxPages = Math.min(pdf.numPages, 20);

  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false,
    });
    if (content?.items?.length) {
      text += content.items.map((it) => it.str || "").join(" ") + "\n";
    }
  }

  return text.trim();
}
async function extractPdfSecure(buffer) {
  // Secure pdf.js v5 extraction (no eval)
  const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
  const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const loadingTask = pdfjs.getDocument({
    data: uint8,
    useWorkerFetch: false,
    isEvalSupported: false,
    isOffscreenCanvasSupported: false,
  });

  const pdf = await loadingTask.promise;
  let text = "";
  const maxPages = Math.min(pdf.numPages, 20);

  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false,
    });
    if (content?.items?.length) {
      text += content.items.map((it) => it.str || "").join(" ") + "\n";
    }
  }

  return text.trim();
}
async function extractPdfSecure(buffer) {
  // Secure pdf.js v5 extraction (no eval)
  const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
  const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const loadingTask = pdfjs.getDocument({
    data: uint8,
    useWorkerFetch: false,
    isEvalSupported: false,
    isOffscreenCanvasSupported: false,
  });

  const pdf = await loadingTask.promise;
  let text = "";
  const maxPages = Math.min(pdf.numPages, 20);

  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false,
    });
    if (content?.items?.length) {
      text += content.items.map((it) => it.str || "").join(" ") + "\n";
    }
  }

  return text.trim();
}
async function extractPdfSecure(buffer) {
  // Secure pdf.js v5 extraction (no eval)
  const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
  const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const loadingTask = pdfjs.getDocument({
    data: uint8,
    useWorkerFetch: false,
    isEvalSupported: false,
    isOffscreenCanvasSupported: false,
  });

  const pdf = await loadingTask.promise;
  let text = "";
  const maxPages = Math.min(pdf.numPages, 20);

  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false,
    });
    if (content?.items?.length) {
      text += content.items.map((it) => it.str || "").join(" ") + "\n";
    }
  }

  return text.trim();
}
async function extractPdfSecure(buffer) {
  // Secure pdf.js v5 extraction (no eval)
  const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
  const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const loadingTask = pdfjs.getDocument({
    data: uint8,
    useWorkerFetch: false,
    isEvalSupported: false,
    isOffscreenCanvasSupported: false,
  });

  const pdf = await loadingTask.promise;
  let text = "";
  const maxPages = Math.min(pdf.numPages, 20);

  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false,
    });
    if (content?.items?.length) {
      text += content.items.map((it) => it.str || "").join(" ") + "\n";
    }
  }

  return text.trim();
}
async function extractPdfSecure(buffer) {
  // Secure pdf.js v5 extraction (no eval)
  const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
  const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const loadingTask = pdfjs.getDocument({
    data: uint8,
    useWorkerFetch: false,
    isEvalSupported: false,
    isOffscreenCanvasSupported: false,
  });

  const pdf = await loadingTask.promise;
  let text = "";
  const maxPages = Math.min(pdf.numPages, 20);

  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false,
    });
    if (content?.items?.length) {
      text += content.items.map((it) => it.str || "").join(" ") + "\n";
    }
  }

  return text.trim();
}
async function extractPdfSecure(buffer) {
  // Secure pdf.js v5 extraction (no eval)
  const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
  const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const loadingTask = pdfjs.getDocument({
    data: uint8,
    useWorkerFetch: false,
    isEvalSupported: false,
    isOffscreenCanvasSupported: false,
  });

  const pdf = await loadingTask.promise;
  let text = "";
  const maxPages = Math.min(pdf.numPages, 20);

  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false,
    });
    if (content?.items?.length) {
      text += content.items.map((it) => it.str || "").join(" ") + "\n";
    }
  }

  return text.trim();
}
async function extractPdfSecure(buffer) {
  // Secure pdf.js v5 extraction (no eval)
  const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
  const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const loadingTask = pdfjs.getDocument({
    data: uint8,
    useWorkerFetch: false,
    isEvalSupported: false,
    isOffscreenCanvasSupported: false,
  });

  const pdf = await loadingTask.promise;
  let text = "";
  const maxPages = Math.min(pdf.numPages, 20);

  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false,
    });
    if (content?.items?.length) {
      text += content.items.map((it) => it.str || "").join(" ") + "\n";
    }
  }

  return text.trim();
}
async function extractPdfSecure(buffer) {
  // Secure pdf.js v5 extraction (no eval)
  const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
  const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const loadingTask = pdfjs.getDocument({
    data: uint8,
    useWorkerFetch: false,
    isEvalSupported: false,
    isOffscreenCanvasSupported: false,
  });

  const pdf = await loadingTask.promise;
  let text = "";
  const maxPages = Math.min(pdf.numPages, 20);

  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false,
    });
    if (content?.items?.length) {
      text += content.items.map((it) => it.str || "").join(" ") + "\n";
    }
  }

  return text.trim();
}
async function extractPdfSecure(buffer) {
  // Secure pdf.js v5 extraction (no eval)
  const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
  const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const loadingTask = pdfjs.getDocument({
    data: uint8,
    useWorkerFetch: false,
    isEvalSupported: false,
    isOffscreenCanvasSupported: false,
  });

  const pdf = await loadingTask.promise;
  let text = "";
  const maxPages = Math.min(pdf.numPages, 20);

  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false,
    });
    if (content?.items?.length) {
      text += content.items.map((it) => it.str || "").join(" ") + "\n";
    }
  }

  return text.trim();
}
}

async function extractWithOCR(fileBase64) {
  const form = new URLSearchParams();
  form.append("base64Image", "data:application/pdf;base64," + fileBase64);
  form.append("language", "eng");
  const r = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    headers: { apikey: process.env.OCR_SPACE_KEY },
    body: form
  });
  const j = await r.json();
  return (j?.ParsedResults || []).map(p => p.ParsedText || "").join("\n");
}

export default async function handler(req, res) {
  try {
    cors(res);
    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST") return res.status(405).json({ ok:false, error:"POST only" });

    const body = typeof req.body === "object" && req.body !== null ? req.body : await readJson(req);
    const { fileBase64, filename } = body || {};
    if (!fileBase64 || !filename) return res.status(400).json({ ok:false, error:"Missing fileBase64 or filename" });

    // Reject oversized payloads BEFORE Buffer allocation
    const approxBytes = Math.floor((fileBase64.length * 3) / 4);
    const MAX_BYTES = 6 * 1024 * 1024; // ~6MB raw file
    if (approxBytes > MAX_BYTES) {
      return res.status(413).json({
        ok:false,
        error:`Payload too large (~${(approxBytes/1024/1024).toFixed(2)} MB). Max ~${(MAX_BYTES/1024/1024)} MB.`
      });
    }

    const buf = Buffer.from(fileBase64, "base64");
    const ext = String(filename).toLowerCase().split(".").pop();
    let text = "";

    if (ext === "pdf") {
      const scanned = detectScanned(buf);
      if (scanned) {
        if (!process.env.OCR_SPACE_KEY)
          return res.status(400).json({ ok:false, error:"Scanned PDF but OCR_SPACE_KEY not set" });
        text = await extractWithOCR(fileBase64);
      } else {
        try {
          text = await extractPdfSecure(buf);
          if (!text.trim() && process.env.OCR_SPACE_KEY) {
            text = await extractWithOCR(fileBase64);
          }
        } catch (e) {
          if (process.env.OCR_SPACE_KEY) {
            try { text = await extractWithOCR(fileBase64); }
            catch (ocrErr) {
              return res.status(502).json({ ok:false, error:"OCR fallback failed: " + (ocrErr?.message || ocrErr) });
            }
          } else {
            return res.status(500).json({ ok:false, error:"PDF text extraction failed: " + (e?.message || e) });
          }
        }
      }
    } else if (ext === "docx") {
      const { default: mammoth } = await import("mammoth");
      const out = await mammoth.extractRawText({ buffer: buf });
      text = out?.value || "";
    } else if (ext === "txt") {
      text = buf.toString("utf8");
    } else {
      return res.status(400).json({ ok:false, error:"Unsupported file type" });
    }

    const analysis = {
      title: "BizDoc-Min Analysis",
      executive_summary: (text || "").slice(0, 800) || "No readable text extracted.",
      metrics: [
        { label: "Net Profit", value: 3808 },
        { label: "Proposed Div", value: 0.52 },
        { label: "Total Shareholders", value: 18297 },
        { label: "Property Sales", value: 30713 },
        { label: "Revenue Backlog", value: 41344 }
      ]
    };

    return res.status(200).json({ ok:true, analysis });
  } catch (err) {
    console.error("UNCAUGHT /api/analyze error:", err);
    return res.status(500).json({ ok:false, error:"Server crash: " + err.message });
  }
}
