import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/* ---------- utils ---------- */
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
function readJson(req, maxBytes = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = "", size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > maxBytes) { reject(Object.assign(new Error("Request too large"), { status: 413 })); req.destroy(); }
      else data += chunk;
    });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(Object.assign(new Error("Invalid JSON body"), { status: 400 })); } });
    req.on("error", e => reject(Object.assign(e, { status: 400 })));
  });
}

/* ---------- pagination + text helpers ---------- */
function addPage(pdf, fonts) {
  const page = pdf.addPage([595.28, 841.89]); // A4
  return { page, cy: 780, left: 54, right: 541, fonts, pdf };
}
function needSpace(s, lines = 1, lh = 16) { return s.cy - lines * lh < 64; }
function ensureSpace(s, lines, lh = 16) { if (needSpace(s, lines, lh)) { const np = addPage(s.pdf, s.fonts); Object.assign(s, np); } }
function measure(text, font, size) { return font.widthOfTextAtSize(text, size); }
function wrapLines(text, width, font, size) {
  const words = String(text ?? "").split(/\s+/);
  const out=[]; let line="";
  for (const w of words) { const t=line?line+" "+w:w; if (measure(t,font,size)>width){ if(line) out.push(line); line=w;} else {line=t;} }
  if (line) out.push(line); return out;
}
function drawParagraph(s, text, { size=12, color=rgb(0,0,0), lh=16 }={}) {
  const w = s.right - s.left;
  const lines = wrapLines(String(text ?? "—"), w, s.fonts.reg, size);
  ensureSpace(s, lines.length, lh);
  s.page.setFont(s.fonts.reg); s.page.setFontSize(size); s.page.setFontColor(color);
  for (const ln of lines) { s.page.drawText(ln, { x:s.left, y:s.cy }); s.cy -= lh; }
  s.cy -= 4;
}
function sectionTitle(s, text, { size=14 }={}) {
  ensureSpace(s,2,18);
  s.page.setFont(s.fonts.bold); s.page.setFontSize(size); s.page.setFontColor(rgb(0.1,0.1,0.1));
  s.page.drawText(String(text), { x:s.left, y:s.cy }); s.cy -= 20;
}
function drawBullets(s, arr, { size=12, lh=16 }={}) {
  const items = Array.isArray(arr) ? arr : (arr ? [String(arr)] : []);
  for (const it of items) {
    const w = s.right - (s.left + 14);
    const lines = wrapLines(String(it ?? ""), w, s.fonts.reg, size);
    ensureSpace(s, lines.length, lh);
    s.page.setFont(s.fonts.reg); s.page.setFontSize(size); s.page.setFontColor(rgb(0,0,0));
    s.page.drawText("•", { x:s.left, y:s.cy });
    let y = s.cy;
    for (const l of lines) { s.page.drawText(l, { x:s.left+14, y }); y -= lh; }
    s.cy = y - 2;
  }
}
function drawTable(s, rows, { size=12, lh=16 }={}) {
  const list = Array.isArray(rows) ? rows : [];
  const safe = list.map(r => ({
    label: r && typeof r === "object" ? (r.label ?? "") : String(r ?? ""),
    current: r && typeof r === "object" ? (r.current ?? r.value ?? "") : "",
    prior: r && typeof r === "object" ? (r.prior ?? "") : "",
    yoy: r && typeof r === "object" ? (r.yoy ?? "") : ""
  }));

  const headers = ["Metric","Current","Prior","YoY"];
  const widths = [220,110,110,90];

  ensureSpace(s,2,lh);
  s.page.setFont(s.fonts.bold); s.page.setFontSize(size);
  let cx = s.left; headers.forEach((h,i)=>{ s.page.drawText(h,{x:cx,y:s.cy}); cx+=widths[i]; });
  s.cy -= lh*0.9;

  s.page.setFont(s.fonts.reg); s.page.setFontSize(size);
  for (const r of safe) {
    ensureSpace(s,1,lh);
    let cx2 = s.left;
    [r.label, r.current, r.prior, String(r.yoy ?? "")].forEach((c,i)=>{ s.page.drawText(String(c),{x:cx2,y:s.cy}); cx2+=widths[i]; });
    s.cy -= lh;
  }
  s.cy -= 4;
}

/* ---------- fallback: always return a PDF even on errors ---------- */
async function errorPdf(message, details) {
  const pdf = await PDFDocument.create();
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const s = { pdf, fonts:{reg, bold}, ...addPage(pdf, {reg, bold}) };

  s.page.setFont(bold); s.page.setFontSize(18);
  s.page.drawText("BizDoc Report (Fallback)", { x:s.left, y:s.cy }); s.cy -= 26;
  sectionTitle(s, "Renderer Error:");
  drawParagraph(s, String(message || "Unknown error"));
  sectionTitle(s, "Payload Keys:");
  const keys = Object.keys(details || {});
  drawBullets(s, keys.length ? keys : ["<no keys>"]);
  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

/* ---------- main handler ---------- */
export default async function handler(req, res) {
  try {
    cors(res);
    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST") return res.status(405).json({ ok:false, error:"POST only" });

    const body = typeof req.body === "object" && req.body !== null ? req.body : await readJson(req);
    const analysis = body?.analysis || {};

    // unify schemas
    const title = String(analysis.title || "Business Analysis");
    const sec = analysis.sections || {};
    const executiveSummary = sec.executive_summary ?? analysis.executive_summary ?? "";
    const kpiTable = (Array.isArray(sec.kpi_table) ? sec.kpi_table : null) ?? (Array.isArray(analysis.metrics) ? analysis.metrics : []) ?? [];
    const analysisPoints = Array.isArray(sec.analysis_points) ? sec.analysis_points : [];
    const conclusion = sec.conclusion ?? "";
    const recommendations = sec.recommendations ?? "";

    try {
      // build pdf
      const pdf = await PDFDocument.create();
      const fonts = { reg: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
      const s = { pdf, fonts, ...addPage(pdf, fonts) };

      // Title
      s.page.setFont(fonts.bold); s.page.setFontSize(22); s.page.setFontColor(rgb(0,0,0));
      s.page.drawText(title, { x:s.left, y:s.cy }); s.cy -= 28;

      // Sections
      sectionTitle(s, "Executive Summary:"); drawParagraph(s, executiveSummary);
      sectionTitle(s, "KPI Snapshot:");      drawTable(s, kpiTable);
      if ((analysisPoints || []).length) { sectionTitle(s, "Key Insights:"); drawBullets(s, analysisPoints); }
      if (conclusion) { sectionTitle(s, "Conclusion:"); drawParagraph(s, conclusion); }
      if (recommendations) { sectionTitle(s, "Recommendations:"); drawParagraph(s, recommendations); }

      const bytes = await pdf.save();
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'attachment; filename="BizDoc_Report.pdf"');
      res.setHeader("Content-Length", String(bytes.length));
      return res.status(200).end(Buffer.from(bytes));
    } catch (inner) {
      // fallback PDF (never returns JSON on error)
      const buf = await errorPdf(inner?.message || inner, analysis);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'attachment; filename="BizDoc_Report.pdf"');
      res.setHeader("Content-Length", String(buf.length));
      return res.status(200).end(buf);
    }
  } catch (err) {
    // only JSON if we failed before attempting a PDF
    console.error("UNCAUGHT /api/pdf error:", err);
    return res.status(500).json({ ok:false, error:"PDF generation failed: " + (err?.message || err) });
  }
}
