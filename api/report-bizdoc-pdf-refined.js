// Orchestrator: always refine first, then render the PDF with the existing generator.
// No changes to your working /api/report-bizdoc-pdf.
export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  try {
    res.setHeader("Access-Control-Allow-Origin","*");
    res.setHeader("Access-Control-Allow-Methods","POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST") return res.status(405).json({ ok:false, error:"Use POST" });

    const body = await readBody(req);
    // Accept either {text,type} OR {analysis} OR both.
    const text = typeof body?.text === "string" ? body.text : "";
    const type = typeof body?.type === "string" ? body.type : (body?.docType || "");
    const givenAnalysis = body?.analysis && typeof body.analysis === "object" ? body.analysis : null;

    const wantsRefine = body?.refine !== false; // default true
    const baseUrl = getBaseUrl(req);

    let analysis = null;

    if (wantsRefine && text) {
      // Ask our analyzer to refine (it already runs two-pass).
      const r = await fetch(baseUrl + "/api/analyze-bizdoc", {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ text, type, refine: true })
      });
      if (!r.ok) {
        // Fallback: use any given analysis or fail cleanly
        if (!givenAnalysis) {
          const errTxt = await r.text().catch(()=> "");
          return res.status(502).json({ ok:false, error:"Analyzer failed", detail: `HTTP ${r.status}`, body: errTxt.slice(0,400) });
        }
      } else {
        const json = await r.json().catch(()=> ({}));
        if (json?.ok && json?.analysis) analysis = json.analysis;
      }
    }

    if (!analysis) {
      // If we didn’t run analyzer (no text), or it failed, use provided analysis.
      if (givenAnalysis) {
        analysis = givenAnalysis;
      } else if (text) {
        // As a last resort, try analyzer without refine param
        const r2 = await fetch(baseUrl + "/api/analyze-bizdoc", {
          method: "POST",
          headers: { "Content-Type":"application/json" },
          body: JSON.stringify({ text, type })
        });
        if (!r2.ok) {
          const errTxt = await r2.text().catch(()=> "");
          return res.status(502).json({ ok:false, error:"Analyzer failed (fallback)", detail: `HTTP ${r2.status}`, body: errTxt.slice(0,400) });
        }
        const json2 = await r2.json().catch(()=> ({}));
        if (json2?.ok && json2?.analysis) analysis = json2.analysis;
      }
    }

    if (!analysis) {
      return res.status(400).json({ ok:false, error:"Provide either 'text' (preferred) or 'analysis'." });
    }

    // Now call the existing PDF generator with the refined analysis.
    const pdfResp = await fetch(baseUrl + "/api/report-bizdoc-pdf", {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ analysis })
    });

    if (!pdfResp.ok) {
      const errTxt = await pdfResp.text().catch(()=> "");
      return res.status(502).json({ ok:false, error:"PDF generator failed", detail:`HTTP ${pdfResp.status}`, body: errTxt.slice(0,400) });
    }

    // Stream the PDF through with proper headers.
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
  // Prefer absolute; fall back to vercel/app host header.
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host || "localhost:3000";
  return `${proto}://${host}`;
}
async function readBody(req){
  const chunks=[]; for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")||"{}"); } catch { return {}; }
}
