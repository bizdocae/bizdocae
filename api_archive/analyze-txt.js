// api/analyze-txt.js — TXT only, ESM, no pdf-parse/mammoth (fixed OpenAI import)

export const config = { api: { bodyParser: false } };

function send(res, s, b){ res.statusCode=s; res.setHeader("Content-Type","application/json; charset=utf-8"); res.end(JSON.stringify(b)); }

export default async function handler(req,res){
  if(req.method!=="POST") return send(res,405,{ok:false,error:"POST txt only"});
  let tmpPath;
  try{
    // ✅ Correct, non-shadowing imports
    const OpenAI_mod = await import("openai");
    const OpenAI = OpenAI_mod.default || OpenAI_mod;
    const fs = await import("node:fs");
    const formidable_mod = await import("formidable");
    const formidable = formidable_mod.default || formidable_mod;

    const form = formidable({ multiples:false, keepExtensions:true, uploadDir:"/tmp", maxFileSize: 5*1024*1024 });
    const { fields, file } = await new Promise((resolve,reject)=>{
      form.parse(req,(err,fields,files)=>{ if(err) return reject(err);
        const f = files.file || files.upload || files.document; if(!f) return reject(new Error("No file"));
        resolve({ fields, file: Array.isArray(f)?f[0]:f });
      });
    });

    tmpPath = file.filepath||file.path;
    const buffer = await fs.promises.readFile(tmpPath);
    const text = buffer.toString("utf8").trim();

    if(!process.env.OPENAI_API_KEY) return send(res,500,{ok:false,error:"Missing OPENAI_API_KEY"});

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const prompt = `Analyze this TXT for BizDoc:\n\n${text}\n\nReturn ONLY JSON with title, executive_summary (bullets), key_findings[], metrics[], risks[], recommendations[], charts[] (one bar).`;
    const r = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [{role:"system",content:"You are BizDoc, a senior business analyst."},{role:"user",content:prompt}],
      response_format: { type: "json_object" },
    });

    let parsed; try{ parsed = JSON.parse(r.choices?.[0]?.message?.content || "{}"); }catch{ parsed = {}; }
    return send(res,200,{ ok:true, filenameBase:(file.originalFilename||"txt"), analysis:{
      title: parsed.title||"Analysis",
      executive_summary: parsed.executive_summary||"",
      key_findings: parsed.key_findings||[],
      metrics: parsed.metrics||[],
      risks: parsed.risks||[],
      recommendations: parsed.recommendations||[],
    }, charts: Array.isArray(parsed.charts)?parsed.charts:[] });
  }catch(e){
    return send(res,500,{ok:false,error:"analyze-txt failed",detail:String(e?.message||e)});
  }finally{
    try{ if(tmpPath){ const fs = await import("node:fs"); await fs.promises.unlink(tmpPath).catch(()=>{});} }catch{}
  }
}
