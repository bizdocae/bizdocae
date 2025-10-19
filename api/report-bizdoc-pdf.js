export default async function handler(req, res) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST") return res.status(405).json({ ok:false, error:"Use POST" });

    // Dynamic import avoids ESM/CJS mismatches on Vercel
    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");

    const body = await readBody(req);
    const analysis = body?.analysis;
    const brand = body?.brand || { title: "BizDoc Analysis Report", company: "BizDoc" };
    if (!analysis || typeof analysis !== "object") {
      return res.status(400).json({ ok:false, error:"Missing 'analysis' JSON" });
    }

    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595.28, 841.89]); // A4
    const { width } = page.getSize();

    // Standard fonts (note: Helvetica won't render Arabic glyphs; that’s a later upgrade)
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    let y = 800;
    const left = 48;
    const right = width - 48;

    // helpers
    const drawText = (fnt, size, x, yy, text, color=rgb(0,0,0)) =>
      page.drawText(String(text ?? ""), { x, y: yy, size, font: fnt, color });
    const drawDivider = (yy) => {
      // some pdf-lib versions lack drawLine; draw a thin rectangle instead
      page.drawRectangle({ x: left, y: yy-1, width: right-left, height: 0.6, color: rgb(0.8,0.8,0.8) });
    };
    const wrap = (fnt, size, x, yy, w, text) => {
      const words = String(text ?? "").split(/\s+/);
      let line = "", cursor = yy;
      for (const w1 of words) {
        const t = (line ? line + " " : "") + w1;
        const tw = fnt.widthOfTextAtSize(t, size);
        if (tw > w) {
          page.drawText(line, { x, y: cursor, size, font: fnt });
          cursor -= size + 4;
          line = w1;
        } else line = t;
      }
      if (line) { page.drawText(line, { x, y: cursor, size, font: fnt }); cursor -= size + 4; }
      return cursor;
    };

    // Header
    drawText(bold, 18, left, y, brand.title); y -= 12;
    drawDivider(y); y -= 24;

    // Summary & docType
    const docType = (analysis.docType || "document").toString().toUpperCase();
    drawText(bold, 14, left, y, docType); y -= 18;
    y = wrap(font, 12, left, y, right-left, analysis.summary || "-"); y -= 10;

    // Financial Health
    const fh = analysis.financialHealth || {};
    drawText(bold, 12, left, y, "Scores"); y -= 16;
    y = wrap(font, 11, left, y, right-left, `Profitability: ${num(fh.profitabilityScore)}/5`);
    y = wrap(font, 11, left, y, right-left, `Liquidity: ${num(fh.liquidityScore)}/5`);
    y = wrap(font, 11, left, y, right-left, `Concentration Risk: ${num(fh.concentrationRiskScore)}/5`);
    y -= 6;

    // Amounts
    const amounts = Array.isArray(analysis.amounts) ? analysis.amounts.slice(0,6) : [];
    if (amounts.length) {
      drawText(bold, 12, left, y, "Key Amounts"); y -= 16;
      for (const a of amounts) {
        const line = `${a?.label ?? "Amount"}: ${a?.value ?? "-"} ${a?.currency ?? ""}`.trim();
        y = wrap(font, 11, left, y, right-left, line) - 2;
      }
      y -= 6;
    }

    // Risks
    const risks = Array.isArray(analysis.risks) ? analysis.risks.slice(0,8) : [];
    drawText(bold, 12, left, y, "Risks"); y -= 16;
    if (risks.length) {
      for (const r of risks) {
        const line = `• [${String(r?.severity ?? "").toUpperCase()}] ${r?.risk ?? "-"} — ${r?.mitigation ?? ""}`;
        y = wrap(font, 11, left, y, right-left, line) - 2;
      }
    } else {
      y = wrap(font, 11, left, y, right-left, "No major risks identified.") - 2;
    }
    y -= 6;

    // Actions
    const actions = Array.isArray(analysis.actions) ? analysis.actions.slice(0,8) : [];
    drawText(bold, 12, left, y, "Actions"); y -= 16;
    if (actions.length) {
      for (const a of actions) {
        const line = `• [P${a?.priority ?? "-"}] ${a?.action ?? "-"}${a?.owner ? " | Owner: " + a.owner : ""}${a?.dueDays ? " | Due: " + a.dueDays + "d" : ""}`;
        y = wrap(font, 11, left, y, right-left, line) - 2;
      }
    } else {
      y = wrap(font, 11, left, y, right-left, "No immediate actions suggested.") - 2;
    }

    // Footer
    drawDivider(60);
    drawText(font, 10, left, 46, `${brand.company || "BizDoc"} • Confidence: ${pct(analysis.confidence)}`);
    drawText(font, 10, right-160, 46, new Date().toISOString().slice(0,10));

    const bytes = await pdf.save();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="bizdoc_report.pdf"');
    return res.status(200).send(Buffer.from(bytes));
  } catch (e) {
    return res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
}

function num(n){ return (typeof n === "number" && isFinite(n)) ? n.toFixed(1) : "-"; }
function pct(n){ return (typeof n === "number" && isFinite(n)) ? Math.round(n*100)+"%" : "-"; }

async function readBody(req){
  const chunks=[]; for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")||"{}"); } catch { return {}; }
}
