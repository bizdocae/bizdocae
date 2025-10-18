export const config = { runtime: "nodejs" };
import OpenAI from "openai";
import { z } from "zod";

// ---------- ENV & client ----------
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const MAX_CHUNK_CHARS = 9000;  // ~3k tokens budget per map call
const OVERLAP_CHARS    = 800;  // sliding overlap to keep context
const MAX_FINDINGS     = 7;    // cap for clarity
const MAX_RISKS        = 5;

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---------- Schema ----------
const ItemSchema = z.object({
  label: z.string().min(1).max(120),
  detail: z.string().min(1).max(600)
});

const ChartPointSchema = z.object({
  label: z.string().min(1).max(40),
  value: z.number().finite()
});

const ChartSchema = z.object({
  title: z.string().min(1).max(120),
  // allow "bar"|"pie"|"line"|"chartjs" (when config present)
  type: z.enum(["bar","pie","line","chartjs"]).optional(),
  items: z.array(ChartPointSchema).optional(),
  config: z.any().optional(),
  width: z.number().optional(),
  height: z.number().optional()
});

const AnalysisSchema = z.object({
  executive_summary: z.string().min(1).max(1200),
  key_findings: z.array(ItemSchema).max(20),
  risks: z.array(ItemSchema).max(20).optional().default([]),
  recommendations: z.string().min(1).max(900),
  charts: z.array(ChartSchema).max(8).optional().default([])
});

// ---------- Helpers ----------
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization");
}

function chunkText(str, max = MAX_CHUNK_CHARS, overlap = OVERLAP_CHARS) {
  const s = String(str || "");
  if (s.length <= max) return [s];
  const out = [];
  let i = 0;
  while (i < s.length) {
    out.push(s.slice(i, i + max));
    if (i + max >= s.length) break;
    i += max - overlap;
  }
  return out;
}

function detectArabic(s) {
  // crude heuristic good enough for tone selection
  return /[\u0600-\u06FF]/.test(s);
}

function keepTop(items=[], cap=5) {
  return (items || []).slice(0, cap);
}

function dedupeByLabel(items=[]) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const k = (it.label || "").trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

function addChartsIfMissing(analysis) {
  if (!analysis || (analysis.charts && analysis.charts.length)) return analysis;
  // heuristic: build a bar chart from numbers we can spot in findings
  const guess = [];
  for (const f of analysis.key_findings || []) {
    const m = f.detail.match(/(-?\d+(\.\d+)?)%?/);
    if (m) guess.push({ label: f.label.slice(0,12), value: parseFloat(m[1]) });
    if (guess.length >= 5) break;
  }
  if (guess.length >= 2) {
    analysis.charts = [
      { title: "Key Metrics (Auto)", type: "bar", items: guess }
    ];
  }
  return analysis;
}

async function callOpenAIJSON(messages, temperature=0.2) {
  const resp = await client.chat.completions.create({
    model: MODEL,
    temperature,
    response_format: { type: "json_object" },
    messages
  });
  const content = resp.choices?.[0]?.message?.content || "{}";
  try { return JSON.parse(content); } catch { return {}; }
}

// ---------- Prompts ----------
function systemPrompt(isArabic, depth=1) {
  const common = `You are BizDoc, a concise business analyst. Return STRICT JSON ONLY with:
- executive_summary (<= 150 words, non-redundant, decision-focused)
- key_findings (array of {label, detail})
- risks (array of {label, detail})
- recommendations (<= 120 words, actionable, prioritized)
- charts (array). Each chart is one of:
  * {title, type: "bar"|"pie"|"line", items:[{label, value}]}
  * OR {title, type: "chartjs", config: <Chart.js config object>}
Guidelines:
- Avoid boilerplate and repetition.
- Merge duplicate ideas.
- Prefer numeric specifics (%, counts, AED) when present.
- No markdown, NO text outside JSON.`;

  const ar = `# تعليمات موجزة
أنت BizDoc محلل أعمال. أرجِع JSON فقط مع الحقول المذكورة أعلاه. 
حافظ على اختصار موجز واضح وقيّم المخاطر والتوصيات بدقة.`;

  const depthHint = depth > 1 ? `\nDepth mode ${depth}: reason carefully, compress results.` : "";
  return isArabic ? `${common}\n${ar}${depthHint}` : `${common}${depthHint}`;
}

function mapUserPrompt(title, text, instruction) {
  return `TITLE: ${title}
INSTRUCTION (optional): ${instruction || "N/A"}
DOCUMENT CHUNK:
---
${text}
---
Return ONLY JSON for this CHUNK (partial analysis ok).`;
}

function reduceUserPrompt(title, instruction, partialsJSON) {
  return `TITLE: ${title}
INSTRUCTION (optional): ${instruction || "N/A"}

You are given PARTIAL ANALYSES in JSON array form:
---
${partialsJSON}
---
FUSE these into ONE high-quality final JSON that follows the schema.
- Merge duplicates.
- Cap findings to ${MAX_FINDINGS}, risks to ${MAX_RISKS}.
- Ensure at least one chart if possible.
Return ONLY JSON.`;
}

// ---------- Handler ----------
export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"Method not allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ ok:false, error:"Missing OPENAI_API_KEY" });
    }

    const {
      title = "BizDoc Analysis",
      body = "",
      instruction = "",
      depth = 1,                 // 1..3 map-reduce effort (3 is slowest/best)
      prefer_chartjs = false,    // if true, ask model to return Chart.js config instead of simple points
      max_words_summary = 150,
      max_words_reco = 120
    } = req.body || {};

    const text = String(body || "");
    const isArabic = detectArabic(text) || detectArabic(String(instruction));

    // --- Chunking (map stage) ---
    const chunks = chunkText(text);
    const mapAnalyses = [];
    const sys = systemPrompt(isArabic, depth) + (prefer_chartjs ? `
Note: Prefer "chartjs" chart type with valid Chart.js "config" when useful.` : "");

    for (let i = 0; i < chunks.length; i++) {
      const messages = [
        { role: "system", content: sys },
        { role: "user", content: mapUserPrompt(title, chunks[i], instruction) }
      ];
      // small retry for robustness
      let partial = await callOpenAIJSON(messages, 0.2);
      if (!partial || !partial.executive_summary) {
        partial = await callOpenAIJSON(messages, 0.0);
      }
      mapAnalyses.push(partial || {});
      if (depth <= 1) break; // in shallow mode, stop after first chunk
    }

    // --- Reduce stage (if multiple or deep mode) ---
    let merged;
    if (mapAnalyses.length > 1 || depth > 1) {
      const partialsJSON = JSON.stringify(mapAnalyses);
      const messages = [
        { role: "system", content: sys },
        { role: "user", content: reduceUserPrompt(title, instruction, partialsJSON) }
      ];
      merged = await callOpenAIJSON(messages, 0.1);
    } else {
      merged = mapAnalyses[0] || {};
    }

    // --- Post-process ---
    // Validate + normalize
    let parsed;
    try {
      parsed = AnalysisSchema.parse(merged);
    } catch {
      // attempt a repair pass: keep fields we recognize
      parsed = {
        executive_summary: String(merged?.executive_summary || "").slice(0, 1200) || "Summary unavailable.",
        key_findings: Array.isArray(merged?.key_findings) ? merged.key_findings : [],
        risks: Array.isArray(merged?.risks) ? merged.risks : [],
        recommendations: String(merged?.recommendations || "").slice(0, 900) || "Recommendations unavailable.",
        charts: Array.isArray(merged?.charts) ? merged.charts : []
      };
      // hard-validate after repair
      parsed = AnalysisSchema.parse(parsed);
    }

    // enforce caps + dedupe
    parsed.key_findings = keepTop(dedupeByLabel(parsed.key_findings), MAX_FINDINGS);
    parsed.risks        = keepTop(dedupeByLabel(parsed.risks), MAX_RISKS);

    // ensure at least one chart
    parsed = addChartsIfMissing(parsed);

    // language hinting for summary/reco lengths
    if (max_words_summary > 0) {
      parsed.executive_summary = parsed.executive_summary.split(/\s+/).slice(0, max_words_summary).join(" ");
    }
    if (max_words_reco > 0) {
      parsed.recommendations = parsed.recommendations.split(/\s+/).slice(0, max_words_reco).join(" ");
    }

    return res.status(200).json({ ok:true, analysis: parsed, meta: {
      chunks: chunks.length, depth, model: MODEL, lang: isArabic ? "ar" : "en"
    }});
  } catch (e) {
    return res.status(500).json({ ok:false, error:String(e?.message||e) });
  }
}
