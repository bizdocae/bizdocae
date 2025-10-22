/**
 * Very small report engine to produce professional, structured English
 * without depending on an LLM. If OPENAI_API_KEY is set, we polish via GPT.
 */

const hasLLM = !!process.env.OPENAI_API_KEY;

// Compact number like 11.54B, 307M, etc.
export function fmtCompact(n, currency = "AED") {
  if (typeof n !== "number" || !isFinite(n)) return n;
  const fmt = new Intl.NumberFormat("en", { notation: "compact", compactDisplay: "short", maximumFractionDigits: 2 });
  return currency ? `${currency} ${fmt.format(n)}` : fmt.format(n);
}

// Percent with 0-1 or 0-100 input
export function fmtPct(p) {
  if (p == null || !isFinite(p)) return p;
  if (Math.abs(p) <= 1) return `${(p*100).toFixed(1)}%`;
  return `${(p).toFixed(1)}%`;
}

// Direction arrow ▲ / ▼ / ▶
export function dirArrow(delta) {
  if (delta > 0) return "▲";
  if (delta < 0) return "▼";
  return "▶";
}

// Build a clean KPI table from metrics [{label, value}] and optional priorMetrics map {label: prevValue}
export function buildKpiRows(metrics = [], prior = {}) {
  return metrics.map(m => {
    const prev = prior[m.label];
    let yoy = "";
    let arrow = "";
    if (typeof m.value === "number" && typeof prev === "number" && prev !== 0) {
      const ch = (m.value - prev) / prev;
      yoy = fmtPct(ch);
      arrow = dirArrow(ch);
    }
    return {
      label: m.label,
      value: typeof m.value === "number" ? m.pretty ?? fmtCompact(m.value) : String(m.value),
      prev: typeof prev === "number" ? fmtCompact(prev) : (prev ?? ""),
      change: yoy ? `${arrow} ${yoy}` : ""
    };
  });
}

// Simple, formal executive summary from extracted text + KPIs
export function draftExecutiveSummary(company = "The company", year = "", bullets = []) {
  const headline = `${company} delivered a disciplined performance${year ? " in " + year : ""}, maintaining profitability and liquidity while executing on its development pipeline.`;
  const drivers = bullets.length ? ` Key highlights include: ${bullets.join("; ")}.` : "";
  return (headline + drivers).trim();
}

// Turn a flat metrics list into concise analysis bullets
export function analysisBulletsFromMetrics(rows = []) {
  return rows.map(r => {
    const left = r.label;
    const right = r.value;
    const change = r.change ? ` (${r.change} YoY)` : "";
    return `• ${left}: ${right}${change}`;
  });
}

// Rule-based conclusion + recommendation
export function concludeAndRecommend(rows = []) {
  // Find a couple of common fields if present
  const findN = (name) => rows.find(r => r.label.toLowerCase().includes(name));
  const rev = findN("revenue");
  const profit = findN("profit");
  const backlog = rows.find(r => r.label.toLowerCase().includes("backlog"));
  const margin = rows.find(r => r.label.toLowerCase().includes("margin"));

  // derive directions
  const up = (r) => r?.change?.includes("▲");
  const down = (r) => r?.change?.includes("▼");

  let conclusion;
  if (up(rev) && up(profit)) {
    conclusion = "Overall performance was robust, with expansion in both top line and bottom line indicating healthy demand and effective execution.";
  } else if (up(rev) && down(profit)) {
    conclusion = "Revenue growth was offset by margin pressure, pointing to rising input costs or mix shift; tighter cost discipline will be important.";
  } else if (down(rev) && up(profit)) {
    conclusion = "Profitability improved despite revenue softness, reflecting operational efficiency and a focus on higher-margin projects.";
  } else if (down(rev) && down(profit)) {
    conclusion = "Both revenue and profit declined year-over-year, highlighting a challenging backdrop and the need for targeted corrective actions.";
  } else {
    conclusion = "The portfolio remains resilient, supported by disciplined execution and a stable financial position.";
  }

  const recs = [];
  if (margin && up(margin)) recs.push("sustain efficiency initiatives to preserve margin quality");
  if (backlog) recs.push("convert the existing backlog on schedule to underpin forward revenue");
  if (down(rev)) recs.push("prioritize launches and sales velocity in core sub-markets");
  if (!recs.length) recs.push("maintain balanced capital allocation and prudent risk management");

  const recommendation = `Looking ahead, management should ${recs.join(", ")}.`;
  return { conclusion, recommendation };
}

// Optional: polish text via GPT if available (non-fatal if not)
export async function maybePolish(text) {
  if (!hasLLM) return text;
  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const { choices } = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a financial analyst. Rewrite the user text in concise, formal business English." },
        { role: "user", content: text }
      ],
      temperature: 0.3,
      max_tokens: 300
    });
    return choices?.[0]?.message?.content?.trim() || text;
  } catch {
    return text;
  }
}
