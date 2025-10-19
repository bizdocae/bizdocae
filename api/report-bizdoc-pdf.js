import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"Use POST" });

  try {
    const body = await readBody(req);
    const analysis = body?.analysis;
    const brand = body?.brand || { title: "BizDoc Analysis Report", company: "BizDoc", locale: "eng" };
    if (!analysis || typeof analysis !== "object") {
      return res.status(400).json({ ok:false, error:"Missing 'analysis' JSON" });
    }

    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595.28, 841.89]); // A4
    const { width } = page.getSize();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    let y = 800;
    const left = 48;
    const right = width - 48;

    // Header
    drawText(page, bold, 18, left, y, brand.title); y -= 10;
    drawLine(page, left, y, right, y); y -= 24;

    // Summary block
    drawLabelValue(page, bold, font, left, y, (analysis.docType || "document").toUpperCase(), analysis.summary || "-", 14); y -= 36;

    // Scores
    const fh = analysis.financialHealth || {};
    drawText(page, bold, 12, left, y, "Scores"); y -= 16;
    drawBullets(page, font, 11, left, y, [
      `Profitability: ${num(fh.profitabilityScore)}/5`,
      `Liquidity: ${num(fh.liquidityScore)}/5`,
      `Concentration Risk: ${num(fh.concentrationRiskScore)}/5`
    ]); y -= 60;

    // Amounts
    const amounts = Array.isArray(analysis.amounts) ? analysis.amounts.slice(0,6) : [];
    if (amounts.length) {
      drawText(page, bold, 12, left, y, "Key Amounts"); y -= 16;
      for (const a of amounts) {
        const line = `${a.label || "Amount"}: ${a.value ?? "-"} ${a.currency || ""}`.trim();
        y = drawWrap(page, font, 11, left, y, right-left, line) - 6;
      }
      y -= 6;
    }

    // Risks
    const risks = Array.isArray(analysis.risks) ? analysis.risks.slice(0,6) : [];
    drawText(page, bold, 12, left, y, "Risks"); y -= 16;
    if (risks.length) {
      for (const r of risks) {
        const line = `• [${(r.severity||"").toUpperCase()}] ${r.risk || "-"} — ${r.mitigation || ""}`;
        y = drawWrap(page, font, 11, left, y, right-left, line) - 4;
      }
    } else {
      y = drawWrap(page, font, 11, left, y, right-left, "No major risks identified.") - 4;
    }
    y -= 6;

    // Actions
    const actions = Array.isArray(analysis.actions) ? analysis.actions.slice(0,6) : [];
    drawText(page, bold, 12, left, y, "Actions"); y -= 16;
    if (actions.length) {
      for (const a of actions) {
        const line = `• [P${a.priority ?? "-"}] ${a.action || "-"} ${a.owner ? " | Owner: "+a.owner : ""}${a.dueDays ? " | Due: "+a.dueDays+"d" : ""}`;
        y = drawWrap(page, font, 11, left, y, right-left, line) - 4;
      }
    } else {
      y = drawWrap(page, font, 11, left, y, right-left, "No immediate actions suggested.") - 4;
    }

    // Footer
    drawLine(page, left, 60, right, 60);
    drawText(page, font, 10, left, 46, `${brand.company || "BizDoc"} • Confidence: ${pct(analysis.confidence)}`);
    drawText(page, font, 10, right-160, 46, new Date().toISOString().slice(0,10));

    const bytes = await pdf.save();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="bizdoc_report.pdf"');
    return res.status(200).send(Buffer.from(bytes));
  } catch (e) {
    return res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
}

function num(n){ return (typeof n === "number") ? n.toFixed(1) : "-"; }
function pct(n){ return (typeof n === "number") ? Math.round(n*100)+"%" : "-"; }

function drawText(page, font, size, x, y, text, color=rgb(0,0,0)) {
  page.drawText(String(text||""), { x, y, size, font, color });
}
function drawLine(page, x1, y1, x2, y2, color=rgb(0.8,0.8,0.8)) {
  page.drawLine({ start: {x:x1,y:y1}, end: {x:x2,y:y2}, thickness: 1, color });
}
function drawLabelValue(page, bold, font, x, y, label, value, size=12) {
  drawText(page, bold, size, x, y, label);
  drawText(page, font, size, x, y-18, String(value||""));
}
function drawWrap(page, font, size, x, y, width, text) {
  const words = String(text||"").split(/\s+/);
  let line = "", cursor = y;
  for (const w of words) {
    const t = (line ? line+" " : "") + w;
    const tw = font.widthOfTextAtSize(t, size);
    if (tw > width) {
      page.drawText(line, { x, y: cursor, size, font });
      cursor -= size + 4;
      line = w;
    } else line = t;
  }
  if (line) { page.drawText(line, { x, y: cursor, size, font }); cursor -= size + 4; }
  return cursor;
}
async function readBody(req){
  const chunks=[]; for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")||"{}"); } catch { return {}; }
}
