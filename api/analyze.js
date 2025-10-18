export const config = { runtime: "nodejs" };
import OpenAI from "openai";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization");
}

const SYSTEM = `You are BizDoc, a concise business analyst. 
Return strictly valid JSON with keys:
- executive_summary (string, <= 150 words)
- key_findings (array of {label, detail})
- risks (array of {label, detail})
- recommendations (string, <= 120 words)
- charts (array of {title, items:[{label, value}]}) with at least one chart when possible.
Do not include markdown.`;

function safeParseJSON(s) {
  try { return JSON.parse(s); } catch { return null; }
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"Method not allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ ok:false, error:"Missing OPENAI_API_KEY" });
    }
    const { title="BizDoc Analysis", body="", instruction="" } = req.body || {};
    const text = String(body||"").slice(0, 60000); // safety cap

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const userPrompt =
`Title: ${title}

Instruction (optional): ${instruction || "N/A"}

Document text (truncated if long):
---
${text}
--- 

Return only JSON.`;

    // You can switch models later; this one is fast & cheap
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt }
      ]
    });

    const content = resp.choices?.[0]?.message?.content || "{}";
    const analysis = safeParseJSON(content) || {};

    return res.status(200).json({ ok:true, analysis });
  } catch (e) {
    return res.status(500).json({ ok:false, error:String(e?.message||e) });
  }
}
