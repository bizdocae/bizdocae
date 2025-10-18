// api/analyze.js — robust: PDF or TXT, NO OCR, clear JSON errors, OpenAI fallback

export const config = { api: { bodyParser: false } };

function send(res, s, b) { res.statusCode=s; res.setHeader("Content-Type","application/json; charset=utf-8"); res.end(JSON.stringify(b)); }
const toBase = (name="analysis") => (name.split("/").pop() || "analysis").replace(/\.[^.]+$/,"") || "analysis";

function sysPrompt(){ return ["You are BizDoc, a senior business analyst.","Given raw document text, produce a precise, client-ready analysis.","Be specific; use numbers when available."].join(" "); }
function userPrompt(text, instruction=""){
  const t = text.length > 70000 ? text.slice(0,70000) + "\n[TRUNCATED]" : text;
  return `
Analyze this document text.

${instruction ? `User instruction: ${instruction}\n` : ""}

Return ONLY valid JSON with:
{
  "title":"Short, specific title",
  "executive_summary":"4-7 crisp bullets as a single string",
  "key_findings":[{"label":"...","detail":"..."}],
  "metrics":[{"name":"Revenue","value":0,"unit":"AED"}],
  "risks":[{"risk":"...","mitigation":"..."}],
  "recommendations":["...","...","..."],
  "charts":[{"type":"bar","title":"KPI Snapshot","x":["A","B","C"],"series":[{"name":"KPI","data":[10,20,15]}]}]
}

TEXT:
"""${t}"""`.trim();
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { ok:false, error:"Use POST multipart/form-data with a 'file' field." });

  let tmpPath;
  try {
    const [formidableMod, fs, OpenAIMod] = await Promise.all([
      import("formidable"),
      import("node:fs"),
      import("openai"),
    ]);
    const formidable = formidableMod.default || formidableMod;
    const OpenAI = OpenAIMod.default || OpenAIMod;

    let pdfParse = null;
    try { const m = await import("pdf-parse"); pdfParse = m.default || m; } catch { pdfParse = null; }

    const form = formidable({ multiples:false, keepExtensions:true, uploadDir:"/tmp", maxFileSize: 25*1024*1024 });
    const { fields, file } = await new Promise((resolve,reject)=>{
      form.parse(req,(err,fields,files)=>{ if(err) return reject(err);
        const f = files.file || files.upload || files.document; if(!f) return reject(new Error("No file field named 'file'.")); resolve({ fields, file: Array.isArray(f)?f[0]:f });
      });
    });

    tmpPath = file.filepath || file.path;
    const original = file.originalFilename || file.newFilename || "upload";
    const mime = (file.mimetype || "").toLowerCase();
    const buf = await (await import("node:fs")).promises.readFile(tmpPath);

    let text = "";
    if (mime.includes("pdf") || original.toLowerCase().endsWith(".pdf")) {
      if (!pdfParse) return send(res, 500, { ok:false, error:"PDF support unavailable (pdf-parse failed to load)" });
      try { const out = await pdfParse(buf); text = (out.text || "").trim(); }
      catch (e) { return send(res, 500, { ok:false, error:"Failed to parse PDF", detail:String(e?.message||e) }); }
      if (!text || text.replace(/\s+/g,"").length < 30) {
        return send(res, 200, { ok:true, filenameBase: toBase(original), note:"PDF seems scanned (no embedded text). OCR is disabled. Use a text-based PDF.", analysis:null, charts:[], meta:{ mimetype:mime, size:file.size||buf.length, sourceFile:original } });
      }
    } else if (mime.startsWith("text/") || original.toLowerCase().endsWith(".txt")) {
      text = buf.toString("utf8").trim();
      if (!text) return send(res, 400, { ok:false, error:"TXT file was empty." });
    } else {
      return send(res, 400, { ok:false, error:"Unsupported file. Upload a text-based PDF or a TXT file." });
    }

    const instruction = (fields.instruction && String(fields.instruction)) || "";
    if (!process.env.OPENAI_API_KEY) {
      return send(res, 200, { ok:true, filenameBase: toBase(original), analysis:{
        title:"Demo Analysis (no OPENAI_API_KEY)",
        executive_summary:"• Using fallback data so your pipeline works.\n• Add OPENAI_API_KEY in Vercel to enable real analysis.",
        key_findings:[{label:"File",detail:original}], metrics:[], risks:[], recommendations:["Set OPENAI_API_KEY in Vercel → Settings → Environment Variables"]
      }, charts:[{type:"bar",title:"KPI Snapshot",x:["A","B","C"],series:[{name:"KPI",data:[10,20,15]}]}], meta:{ mimetype:mime, size:file.size||buf.length, sourceFile:original } });
    }

    try {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const resp = await client.chat.completions.create({
        model: "gpt-4o-mini", temperature: 0.2,
        messages: [{ role:"system", content: sysPrompt() }, { role:"user", content: userPrompt(text, instruction) }],
        response_format: { type:"json_object" },
      });
      let parsed; try { parsed = JSON.parse(resp.choices?.[0]?.message?.content || "{}"); } catch { parsed = {}; }

      return send(res, 200, { ok:true, filenameBase: toBase(original),
        analysis:{ title: parsed.title||"Analysis", executive_summary: parsed.executive_summary||"", key_findings: parsed.key_findings||[], metrics: parsed.metrics||[], risks: parsed.risks||[], recommendations: parsed.recommendations||[] },
        charts: Array.isArray(parsed.charts)?parsed.charts:[],
        meta:{ model: resp.model, tokens: resp.usage, mimetype:mime, size:file.size||buf.length, sourceFile:original }
      });
    } catch(e) {
      return send(res, 200, { ok:true, filenameBase: toBase(original),
        analysis:{ title:"Fallback Analysis (OpenAI error)", executive_summary:`• OpenAI call failed: ${String(e?.message||e)}\n• Returning dummy data so download still works.`, key_findings:[{label:"File",detail:original}], metrics:[], risks:[], recommendations:["Check OpenAI org/quota/region; retry later"] },
        charts:[{type:"bar",title:"KPI Snapshot",x:["A","B","C"],series:[{name:"KPI",data:[10,20,15]}]}]
      });
    }
  } catch (err) {
    return send(res, 500, { ok:false, error:"Analyze failed (outer)", detail:String(err?.message||err) });
  } finally {
    try { if (tmpPath) { const fs = await import("node:fs"); await fs.promises.unlink(tmpPath).catch(()=>{});} } catch {}
  }
}
