/**
 * Two-pass refinement with OpenAI.
 * Pass 1: ensure full structured JSON from raw text (if draft missing parts).
 * Pass 2: critique+correct our draft (money-only charts, growth%, margin phrasing, DSO not money, etc.)
 * Falls back to draft on any error. Hard 18s total budget.
 */
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Simple, defensive wrapper with timeout
async function openaiChatJSON(messages, { model="gpt-4o-mini", timeoutMs=9000 } = {}) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages
      }),
      signal: ac.signal
    });
    if (!r.ok) throw new Error(`OpenAI HTTP ${r.status}`);
    const data = await r.json();
    const txt = data?.choices?.[0]?.message?.content || "{}";
    return JSON.parse(txt);
  } finally {
    clearTimeout(t);
  }
}

// Strict schema note we expect the LLM to honor
const schemaNote = `
Return strict JSON with:
{
  "detectedLanguage": "eng|ara|...",
  "docType": "invoice|financials|contract|document|purchase_order|receipt",
  "summary": "one or two crisp sentences",
  "executiveInsights": [ "bullet", ... ],
  "keyEntities": {
    "parties": [ ... ],
    "roles": { "client":[], "supplier":[], "bank":[], "investor":[], "regulator":[], "other":[] }
  },
  "dates": [ ... ],
  "amounts": [ { "label":"Total|Revenue|Cost|Profit|Tax|Payment|Balance|Amount", "value": number, "currency":"AED|USD|..." } ],
  "kpis": [ { "label":"Revenue Growth %|Margin %|Liquidity Ratio|DSO (days)|Total|Revenue|Cost", "value": number, "unit":"%|x|d|AED|USD|..." } ],
  "trendInterpretation": [ ... ],
  "financialHealth": {
    "profitabilityScore": 0-5, "liquidityScore": 0-5, "concentrationRiskScore": 0-5,
    "anomalyFlags": [ ... ],
    "rationale": "short sentence"
  },
  "riskMatrix": [ {"risk":"...", "severity":"low|medium|high", "evidence":"...", "mitigation":"..."} ],
  "actions": [ {"priority":1|2|3, "action":"...", "owner":"...", "dueDays":7} ],
  "charts": { "bars":[{"label":"...", "value":number}], "lines":[{"x":"Mon|Jan|...","y":number}], "pie":[{"label":"AED|USD|Revenue|Cost|Profit","value":number}] },
  "confidence": number
}
Rules:
- Do NOT include small incidental numbers (quarters, days, ratios like 1.6x) in amounts.
- Money-only in bars/pie. DSO and ratios never treated as money.
- Include growth % if text implies "grew/increased/rose/up 12%".
- Prefer concise, executive English (no hype, no fluff).
- Never invent currencies or entities; if unsure, omit.
`;

/** Pass 1: Ensure a full analysis exists from raw text (if needed) */
async function pass1EnsureFromRaw(text) {
  const sys = "You are a financial document analyst. Be precise, conservative, and structured.";
  const user = `
Text:
"""${text}"""

Task: Produce a full analysis JSON per the schema below. If a field is not inferable, omit it.
${schemaNote}
`;
  return openaiChatJSON([{ role:"system", content: sys }, { role:"user", content: user }]);
}

/** Pass 2: Critique & refine our draft */
async function pass2RefineDraft(text, draft) {
  const sys = "You are a senior financial reviewer. Tighten accuracy, fix misclassifications, and polish language.";
  const user = `
Text:
"""${text}"""

Draft Analysis:
${JSON.stringify(draft)}

Task:
- Correct misclassified amounts (exclude quarters/days/ratios).
- Recover missing growth%/margin if directly stated.
- Normalize KPI labels/units and sort: Growth %, Margin %, Liquidity Ratio, DSO, Total, Revenue, Cost.
- Keep charts money-only; ensure pie groups by currency if amounts present.
- Keep summary crisp and executive.
Return strict JSON only, schema below.
${schemaNote}
`;
  return openaiChatJSON([{ role:"system", content: sys }, { role:"user", content: user }]);
}

/**
 * Main entry: given text and a draft (our rule-based output),
 * produce a refined JSON, with robust fallbacks.
 */
export async function refineAnalysisWithGPT(text, draft) {
  // Budget ~18s: pass2 first (uses our draft); if it fails, try pass1; if that fails, return draft.
  try {
    const refined = await pass2RefineDraft(text, draft);
    // basic sanity
    if (refined && typeof refined === "object" && refined.summary) return refined;
  } catch {}
  try {
    const fromRaw = await pass1EnsureFromRaw(text);
    if (fromRaw && typeof fromRaw === "object" && fromRaw.summary) return fromRaw;
  } catch {}
  return draft;
}
