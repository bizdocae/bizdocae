const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function openaiChatJSON(messages, { model="gpt-4o-mini", timeoutMs=9000 } = {}) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, temperature: 0.2, response_format: { type: "json_object" }, messages }),
      signal: ac.signal
    });
    if (!r.ok) throw new Error(`OpenAI HTTP ${r.status}`);
    const data = await r.json();
    const txt = data?.choices?.[0]?.message?.content || "{}";
    return JSON.parse(txt);
  } finally { clearTimeout(t); }
}

const schemaNote = `
Return strict JSON with keys:
detectedLanguage, docType, summary, executiveInsights,
keyEntities { parties, roles { client, supplier, bank, investor, regulator, other } },
dates, amounts[{label,value,currency}], kpis[{label,value,unit}],
trendInterpretation, financialHealth { profitabilityScore, liquidityScore, concentrationRiskScore, anomalyFlags, rationale },
riskMatrix[{risk,severity,evidence,mitigation}], actions[{priority,action,owner,dueDays}],
charts { bars[{label,value}], lines[{x,y}], pie[{label,value}] }, confidence.
Rules: Money-only in bars/pie. Don’t treat quarters/days/ratios as money.
Recover growth “grew/increased/rose/up 12%” if present. Keep concise, executive English. Never invent data.
`;

async function pass1EnsureFromRaw(text) {
  const sys = "You are a financial document analyst. Be precise, conservative, and structured.";
  const user = `Text:\n"""${text}"""\nTask: Produce full analysis JSON. If unsure, omit. ${schemaNote}`;
  return openaiChatJSON([{ role:"system", content: sys }, { role:"user", content: user }]);
}
async function pass2RefineDraft(text, draft) {
  const sys = "You are a senior financial reviewer. Tighten accuracy, fix misclassifications, polish language.";
  const user = `Text:\n"""${text}"""\n\nDraft Analysis:\n${JSON.stringify(draft)}\n\nTask: Correct amounts (exclude quarters/days/ratios), recover growth/margin if stated, normalize KPIs, money-only charts, concise summary. Return strict JSON.\n${schemaNote}`;
  return openaiChatJSON([{ role:"system", content: sys }, { role:"user", content: user }]);
}

export async function refineAnalysisWithGPT(text, draft) {
  try {
    const refined = await pass2RefineDraft(text, draft);
    if (refined && typeof refined === "object" && refined.summary) return refined;
  } catch {}
  try {
    const fromRaw = await pass1EnsureFromRaw(text);
    if (fromRaw && typeof fromRaw === "object" && fromRaw.summary) return fromRaw;
  } catch {}
  return draft;
}
