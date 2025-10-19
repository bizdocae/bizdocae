/**
 * POST /api/analyze-bizdoc
 * Body: { text: string, languageIn?: "auto"|"eng"|"ara", languageOut?: "eng"|"ara", docHints?: {...}, maxSections?: number }
 * Returns: { ok: true, analysis: {...}, tokens:{prompt:number, completion:number} } or { ok:false, error }
 */
export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok:false, error: "Use POST" });

  try {
    const { text, languageIn="auto", languageOut="eng", docHints = {}, maxSections = 8 } = await readBody(req);
    if (!text || String(text).trim().length < 5) {
      return res.status(400).json({ ok:false, error:"Missing or too-short 'text'" });
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) return res.status(500).json({ ok:false, error:"OPENAI_API_KEY not set" });

    const system = [
      "You are BizDoc, an enterprise-grade analyst for business documents.",
      "You ALWAYS return STRICT JSON matching the provided JSON schema.",
      "No markdown, no explanations—only JSON.",
      "When languageOut == 'ara', write narrative fields in professional Arabic; keep JSON keys in English.",
      "Be concise, numeric where possible, and justify scores with evidence from the text."
    ].join(" ");

    const schema = {
      type: "object",
      properties: {
        detectedLanguage: { type:"string", enum:["eng","ara","other"] },
        docType: { type:"string", enum:[
          "invoice","proposal","contract","report","financials","bank_statement",
          "marketing","hr","legal","other"
        ]},
        summary: { type:"string" },
        keyEntities: {
          type:"object",
          properties:{
            parties: { type:"array", items:{type:"string"} },
            productsOrServices: { type:"array", items:{type:"string"} },
            currencies: { type:"array", items:{type:"string"} }
          },
          required:["parties","productsOrServices","currencies"]
        },
        amounts: {
          type:"array",
          items:{ type:"object",
            properties:{ label:{type:"string"}, value:{type:"number"}, currency:{type:"string"} },
            required:["label","value"]
          }
        },
        kpis: {
          type:"array",
          items:{ type:"object",
            properties:{ name:{type:"string"}, value:{type:["number","string"]}, unit:{type:"string"} },
            required:["name","value"]
          }
        },
        financialHealth: {
          type:"object",
          properties:{
            profitabilityScore:{type:"number", minimum:0, maximum:5},
            liquidityScore:{type:"number", minimum:0, maximum:5},
            concentrationRiskScore:{type:"number", minimum:0, maximum:5},
            anomalyFlags:{ type:"array", items:{type:"string"} },
            rationale:{type:"string"}
          },
          required:["profitabilityScore","liquidityScore","concentrationRiskScore","anomalyFlags","rationale"]
        },
        risks: {
          type:"array",
          items:{ type:"object",
            properties:{
              risk:{type:"string"},
              severity:{type:"string", enum:["low","medium","high","critical"]},
              evidence:{type:"string"},
              mitigation:{type:"string"}
            },
            required:["risk","severity","evidence","mitigation"]
          }
        },
        actions: {
          type:"array",
          items:{ type:"object",
            properties:{
              priority:{type:"integer", minimum:1},
              action:{type:"string"},
              owner:{type:"string"},
              dueDays:{type:"integer"}
            },
            required:["priority","action"]
          }
        },
        charts: {
          type:"object",
          properties:{
            bars:{ type:"array", items:{type:"object", properties:{label:{type:"string"}, value:{type:"number"}}, required:["label","value"] } },
            lines:{ type:"array", items:{type:"object", properties:{x:{type:"string"}, y:{type:"number"}}, required:["x","y"] } },
            pie:{ type:"array", items:{type:"object", properties:{label:{type:"string"}, value:{type:"number"}}, required:["label","value"] } }
          },
          required:["bars","lines","pie"]
        },
        confidence: { type:"number", minimum:0, maximum:1 }
      },
      required:["detectedLanguage","docType","summary","keyEntities","amounts","kpis","financialHealth","risks","actions","charts","confidence"]
    };

    const userPrompt = buildPrompt({ text, languageIn, languageOut, docHints, maxSections, schema });

    // Use a capable model; adjust if you prefer a different one
    const model = process.env.BIZDOC_MODEL || "gpt-4o-mini";

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method:"POST",
      headers:{
        "Authorization":`Bearer ${OPENAI_API_KEY}`,
        "Content-Type":"application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role:"system", content: system },
          { role:"user", content: userPrompt }
        ]
      })
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(()=> "");
      return res.status(502).json({ ok:false, error:`OpenAI HTTP ${resp.status}: ${txt.slice(0,400)}` });
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || "{}";

    let parsed;
    try { parsed = JSON.parse(content); }
    catch { return res.status(500).json({ ok:false, error:"Model did not return valid JSON", raw: content }); }

    return res.status(200).json({
      ok:true,
      analysis: parsed,
      tokens:{
        prompt: data?.usage?.prompt_tokens ?? null,
        completion: data?.usage?.completion_tokens ?? null
      }
    });

  } catch (e) {
    return res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
}

function buildPrompt({ text, languageIn, languageOut, docHints, maxSections, schema }) {
  const hints = JSON.stringify(docHints || {});
  const schemaStr = JSON.stringify(schema);
  return [
    `languageIn=${languageIn}; languageOut=${languageOut}; maxSections=${maxSections}`,
    `docHints=${hints}`,
    "Analyze the following document text for business relevance. Follow this scoring rubric:",
    "- ProfitabilityScore: 0 (no evidence) to 5 (strong margins and growth).",
    "- LiquidityScore: 0 (cash stress) to 5 (ample liquidity).",
    "- ConcentrationRiskScore: 0 (diversified) to 5 (dangerously concentrated).",
    "If numeric data is missing, infer cautiously, state assumptions, and lower confidence.",
    "Return STRICT JSON ONLY that matches this JSON Schema exactly (keys in English):",
    schemaStr,
    "TEXT START",
    text.slice(0, 200000), // safety cap
    "TEXT END"
  ].join("\n");
}

async function readBody(req){
  const chunks=[]; for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}
