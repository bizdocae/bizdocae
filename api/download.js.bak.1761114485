import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function readJson(req, maxBytes = 1 * 1024 * 1024) { // analysis payload is small
  return new Promise((resolve, reject) => {
    let size = 0, data = "";
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error("Request body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(Object.assign(new Error("Invalid JSON body"), { status: 400 })); }
    });
    req.on("error", (e) => reject(Object.assign(e, { status: 400 })));
  });
}

export default async function handler(req, res) {
  try {
    cors(res);
    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST") return res.status(405).json({ ok:false, error:"POST only" });

    let body;
    try { body = typeof req.body === "object" && req.body !== null ? req.body : await readJson(req); }
    catch (e) { return res.status(e.status || 400).json({ ok:false, error: e.message }); }

    const { analysis } = body || {};
    if (!analysis) return res.status(400).json({ ok:false, error:"Missing analysis data" });

    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595.28, 841.89]); // A4
    const { width: W, height: H } = page.getSize();
    const black = rgb(0,0,0);

    page.drawRectangle({ x:0, y:0, width:W, height:H, color: rgb(1,1,1) });
    page.drawText(analysis.title || "Report", { x: 40, y: H-60, size: 20, font, color: black });

    let y = H - 100;
    page.drawText("Executive Summary:", { x: 40, y, size: 12, font, color: black });
    y -= 16;

    const wrap = (t, max = 95) => {
      const words = (t || "").split(/\s+/);
      let line = "", lines = [];
      for (const w of words) {
        const test = (line + " " + w).trim();
        if (test.length > max) { lines.push(line); line = w; } else { line = test; }
      }
      if (line) lines.push(line);
      return lines;
    };

    for (const ln of wrap(analysis.executive_summary || "", 95)) {
      page.drawText(ln, { x: 40, y, size: 10, font, color: black });
      y -= 12;
    }

    y -= 18;
    page.drawText("KPI Snapshot:", { x: 40, y, size: 12, font, color: black });
    y -= 14;
    for (const m of (analysis.metrics || [])) {
      page.drawText(`• ${m.label}: ${m.value}`, { x: 50, y, size: 10, font, color: black });
      y -= 12;
    }

    const pdfBytes = await doc.save();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="report.pdf"');
    res.status(200).send(Buffer.from(pdfBytes));
  } catch (e) {
    console.error("UNCAUGHT /api/download error:", e);
    res.status(500).json({ ok:false, error:"PDF generation failed: " + e.message });
  }
}
