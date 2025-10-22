import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/* ---------- utils ---------- */
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
function readJson(req, maxBytes = 2 * 1024 * 1024) {
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

/* ---------- layout helpers (with pagination) ---------- */
function addPage(pdf, fonts) {
  const page = pdf.addPage([595.28, 841.89]); // A4
  return { page, cy: 780, left: 54, right: 541, fonts };
}
function needSpace(state, lines = 1, lineHeight = 16) {
  return state.cy - lines * lineHeight < 64;
}
function ensureSpace(state, lines, lineHeight = 16) {
  if (needSpace(state, lines, lineHeight)) {
    const { pdf, fonts } = state;
    const np = addPage(pdf, fonts);
    state.page = np.page; state.cy = np.cy; state.left = np.left; state.right = np.right;
  }
}
function measure(text, font, size) {
  return font.widthOfTextAtSize(text, size);
}
function wrapLines(text, width, font, size) {
  const words = String(text || "").split(/\s+/);
  const out = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (measure(test, font, size) > width) { if (line) out.push(line); line = w; }
    else { line = test; }
  }
  if (line) out.push(line);
  return out;
}
function drawParagraph(state, text, { size = 12, color = rgb(0,0,0), lh = 16 } = {}) {
  const { page, left, right, fonts } = state;
  const width = right - left;
  const lines = wrapLines(String(text || "—"), width, fonts.reg, size);
  ensureSpace(state, lines.length, lh);
  page.setFont(fonts.reg); page.setFontSize(size); page.setFontColor(color);
  for (const line of lines) {
    page.drawText(line, { x: left, y: state.cy });
    state.cy -= lh;
  }
  state.cy -= 4;
}
function sectionTitle(state, text, { size = 14 } = {}) {
  const { page, left, fonts } = state;
  ensureSpace(state, 2, 18);
  page.setFont(fonts.bold); page.setFontSize(size); page.setFontColor(rgb(0.1,0.1,0.1));
  page.drawText(text, { x: left, y: state.cy });
  state.cy -= 20;
}
function drawBullets(state, items, { size = 12, lh = 16 } = {}) {
  const arr = Array.isArray(items) ? items : (typeof items === "string" ? [items] : []);
  for (const it of arr) {
    const line = String(it ?? "");
    const { page, left, right, fonts } = state;
    const width = right - (left + 14);
    const lines = wrapLines(line, width, fonts.reg, size);
    ensureSpace(state, lines.length, lh);
    page.setFont(fonts.reg); page.setFontSize(size); page.setFontColor(rgb(0,0,0));
    page.drawText("•", { x: left, y: state.cy });
    let y = state.cy;
    for (const l of lines) {
      page.drawText(l, { x: left + 14, y });
      y -= lh;
    }
    state.cy = y - 2;
  }
}
function drawTable(state, rows, { size = 12, lh = 16 } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const safeRows = list.map(r => ({
    label: r?.label ?? "",
    current: r?.current ?? r?.value ?? "",
    prior: r?.prior ?? "",
    yoy: (r?.yoy ?? "") + ""
  }));

  const headers = ["Metric", "Current", "Prior", "YoY"];
  const widths = [220, 110, 110, 90];

  const { page, left, fonts } = state;
  ensureSpace(state, 2, lh);
  page.setFont(fonts.bold); page.setFontSize(size);
  let cx = left;
  headers.forEach((h,i)=>{ page.drawText(h, { x: cx, y: state.cy }); cx += widths[i]; });
  state.cy -= lh * 0.9;

  page.setFont(fonts.reg); page.setFontSize(size);
  for (const r of safeRows) {
    ensureSpace(state, 1, lh);
    let cx2 = left;
    [r.label, r.current, r.prior, r.yoy].forEach((c,i)=>{
      page.drawText(String(c ?? ""), { x: cx2, y: state.cy }); cx2 += widths[i];
    });
    state.cy -= lh;
  }
  state.cy -= 4;
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

    // build pdf
    const pdf = await PDFDocument.create();
    const fonts = {
      reg: await pdf.embedFont(StandardFonts.Helvetica),
      bold: await pdf.embedFont(StandardFonts.HelveticaBold)
    };
    const state = { pdf, fonts, ...addPage(pdf, fonts) };

    // Title
    state.page.setFont(fonts.bold); state.page.setFontSize(22); state.page.setFontColor(rgb(0,0,0));
    state.page.drawText(title, { x: state.left, y: state.cy }); state.cy -= 28;

    // Sections
    sectionTitle(state, "Executive Summary:");
    drawParagraph(state, executiveSummary);

    sectionTitle(state, "KPI Snapshot:");
    drawTable(state, kpiTable);

    if ((analysisPoints || []).length) {
      sectionTitle(state, "Key Insights:");
      drawBullets(state, analysisPoints);
    }

    if (conclusion) {
      sectionTitle(state, "Conclusion:");
      drawParagraph(state, conclusion);
    }

    if (recommendations) {
      sectionTitle(state, "Recommendations:");
      drawParagraph(state, recommendations);
    }

    const bytes = await pdf.save();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="BizDoc_Report.pdf"');
    res.setHeader("Content-Length", String(bytes.length));
    return res.status(200).end(Buffer.from(bytes));
  } catch (err) {
    console.error("UNCAUGHT /api/download error:", err);
    return res.status(500).json({ ok:false, error:"PDF generation failed: " + (err?.message || err) });
  }
}
