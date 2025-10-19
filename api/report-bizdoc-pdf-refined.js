// Orchestrator: refine before download, with an optional second refine ("double-check").
// - Accepts: { text, type, refine?, double?, analysis?, debug? }
//   * refine (default true): run analyzer that already does draft+refine
//   * double (default true): run an extra refine pass right before PDF
//   * debug (optional): if true, return JSON instead of PDF for QA
export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  try {
    res.setHeader("Access-Control-Allow-Origin","*");
    res.setHeader("Access-Control-Allow-Methods","POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST") return res.status(405).json({ ok:false, error:"Use POST" });

    const body = await readBody(req);
    const text = typeof body?.text === "string" ? body.text : "";
    const type = typeof body?.type === "string" ? body.type : (body?.docType || "");
    const givenAnalysis = body?.analysis && typeof body.analysis === "object" ? body.analysis : null;

    const wantsRefine = body?.refine !== false;     // default true
    const wantsDouble = body?.double !== false;     // default true
    const wantDebug   = !!body?.debug;              // default false
    const baseUrl = getBaseUrl(req);

    let analysis = null;

    // 1) Pre-analysis: call analyze endpoint (it already draft+refines)
    if (wantsRefine && text) {
      const r = await fetch(baseUrl + "/api/analyze-bizdoc", {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ text, type, refine: true })
      }).catch(()=>null);

      if (r && r.ok) {
        const json = await r.json().catch(()=> ({}));
        if (json?.ok && json?.analysis) analysis = json.analysis;
      }
    }

    // 2) If no text or analyzer failed, fallback to provided analysis or try analyzer once
    if (!analysis) {
      if (givenAnalysis) {
        analysis = givenAnalysis;
      } else if (text) {
        const r2 = await fetch(baseUrl + "/api/analyze-bizdoc", {
          method: "POST",
          headers: { "Content-Type":"application/json" },
          body: JSON.stringify({ text, type })
        }).catch(()=>null);
        if (!r2 || !r2.ok) {
          const errTxt = r2 ? (await r2.text().catch(()=> "")) : "No response";
          return res.status(502).json({ ok:false, error:"Analyzer failed", detail: r2 ? `HTTP ${r2.status}` : "network error", body: errTxt.slice(0,400) });
        }
        const json2 = await r2.json().catch(()=> ({}));
        if (json2?.ok && json2?.analysis) analysis = json2.analysis;
      } else {
        return res.status(400).json({ ok:false, error:"Provide either 'text' (preferred) or 'analysis'." });
      }
    }

    // 3) Post-analysis: do a second refine (double-check) just before PDF
    let finalAnalysis = analysis;
    if (wantsDouble) {
      try {
        const { refineAnalysisWithGPT } = await import("./lib/refine.js");
        const refinedAgain = await refineAnalysisWithGPT(text || "", finalAnalysis);
        if (refinedAgain && typeof refinedAgain === "object" && refinedAgain.summary) {
          finalAnalysis = refinedAgain;
        }
      } catch {
        // swallow, keep finalAnalysis as-is
      }
    }

    // 4) Debug mode: return the post-refined JSON instead of a PDF
    if (wantDebug) {
      return res.status(200).json({ ok:true, analysis: finalAnalysis, note:"debug mode - not a PDF" });
    }

    // 5) Render the PDF with your existing generator
    const pdfResp = await fetch(baseUrl + "/api/report-bizdoc-pdf", {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ analysis: finalAnalysis })
    });

    if (!pdfResp.ok) {
      const errTxt = await pdfResp.text().catch(()=> "");
      return res.status(502).json({ ok:false, error:"PDF generator failed", detail:`HTTP ${pdfResp.status}`, body: errTxt.slice(0,400) });
    }

    const buf = Buffer.from(await pdfResp.arrayBuffer());
    res.setHeader("Content-Type","application/pdf");
    res.setHeader("Content-Disposition",'attachment; filename="bizdoc_report.pdf"');
    res.setHeader("Cache-Control","public, max-age=0, must-revalidate");
    return res.status(200).end(buf);

  } catch (e) {
    return res.status(500).json({ ok:false, error:String(e?.message || e) });
  }
}

function getBaseUrl(req){
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host || "localhost:3000";
  return `${proto}://${host}`;
}
async function readBody(req){
  const chunks=[]; for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")||"{}"); } catch { return {}; }
}
