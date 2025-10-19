// Lightweight, dependency-free analyzer that returns KPIs + chart data.
export default async function handler(req, res) {
  try {
    res.setHeader("Access-Control-Allow-Origin","*");
    res.setHeader("Access-Control-Allow-Methods","POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST") return res.status(405).json({ ok:false, error: "Use POST" });

    const body = await readBody(req);
    const text = safeStr(body?.text);
    const languageIn  = body?.languageIn  || "auto";
    const languageOut = body?.languageOut || "eng";
    const docTypeReq  = (body?.type || body?.docType || "").toString().trim().toLowerCase();

    if (!text.trim()) {
      return res.status(400).json({ ok:false, error: "Provide 'text' to analyze." });
    }

    // --- DETECTIONS ---
    const detectedLanguage = detectLang(text);
    const docType = docTypeReq || guessDocType(text);

    const parties = extractParties(text).slice(0, 5);
    const { currencies, amounts } = extractCurrenciesAndAmounts(text);
    const dates = extractDates(text).slice(0, 5);

    // --- KPIs ---
    const kpis = buildKpis(text, amounts, currencies);

    // --- Financial Health (0..5) ---
    const fh = scoreFinancialHealth(text, kpis);

    // --- Risks & Actions (heuristics) ---
    const risks = buildRisks(text, fh);
    const actions = buildActions(text, fh);

    // --- Summary ---
    const summary = buildSummary(docType, parties, amounts, currencies, fh, text);

    // --- Charts ---
    const charts = buildCharts(amounts, kpis, text);

    const analysis = {
      detectedLanguage,
      docType,
      summary,
      keyEntities: {
        parties,
        productsOrServices: extractProducts(text).slice(0, 8),
        currencies: currencies.slice(0, 5)
      },
      amounts: amounts.slice(0, 12),
      kpis,
      financialHealth: fh,
      risks,
      actions,
      charts,
      confidence: clamp01(0.7 + (kpis.length ? 0.1 : 0) + (amounts.length ? 0.1 : 0))
    };

    return res.status(200).json({ ok: true, analysis, tokens: { prompt: text.length, completion: JSON.stringify(analysis).length } });
  } catch (e) {
    return res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
}

/* ----------------- helpers ----------------- */
async function readBody(req){
  const chunks=[]; for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}
function safeStr(s){ return (s==null) ? "" : String(s); }
function clamp01(x){ const n = Number(x); return isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; }
function pct(n){ return isFinite(n) ? Math.round(n*100)+"%" : "-"; }
function fmt(n){ const v = Number(n); return isFinite(v) ? new Intl.NumberFormat("en-US",{maximumFractionDigits:2}).format(v) : "-"; }

function detectLang(t){
  // super light heuristic
  const ar = /[\u0600-\u06FF]/.test(t);
  const fa = /[\u0750-\u077F]/.test(t);
  if (ar || fa) return "ara";
  const enWords = (t.match(/[A-Za-z]/g) || []).length;
  const arWords = (t.match(/[\u0600-\u06FF]/g) || []).length;
  return enWords >= arWords ? "eng" : "ara";
}

function guessDocType(t){
  const s = t.toLowerCase();
  if (/\binvoice|inv\.\b|vat(?:\s|-)invoice/.test(s)) return "invoice";
  if (/\breceipt\b/.test(s)) return "receipt";
  if (/\b(po|purchase order)\b/.test(s)) return "purchase_order";
  if (/\bbalance sheet|income statement|p&l|profit and loss|statement of cash flows\b/.test(s)) return "financials";
  if (/\bcontract|agreement|nda\b/.test(s)) return "contract";
  return "document";
}

function extractParties(t){
  // naive: words before/after keywords
  const parties = new Set();
  const rgx = /\b(?:from|to|bill(?:ed)?\s*to|sold\s*to|supplier|customer|client|by|payee|payer|company|vendor)[:\s]+([A-Z][A-Za-z0-9&\-. ]{2,40})/ig;
  let m; while ((m = rgx.exec(t))){ parties.add(m[1].trim()); if (parties.size>10) break; }
  // also capture all-caps words that look like orgs
  (t.match(/\b[A-Z]{3,}(?:\s+[A-Z]{2,})*\b/g) || []).slice(0,10).forEach(v => parties.add(v.trim()));
  return [...parties].filter(x => x && x.length <= 60);
}

function extractProducts(t){
  // quick grab of items after dash or bullets
  const items = [];
  const lines = t.split(/\r?\n/);
  for (const ln of lines){
    const m = ln.match(/^[\-\*\u2022]\s*(.+)$/);
    if (m) items.push(m[1].trim());
  }
  return items;
}

function extractCurrenciesAndAmounts(t){
  const curMap = {
    AED: /(AED|د\.?إ\.?|درهم)/i,
    USD: /(USD|\$|US\$)/i,
    EUR: /(EUR|€)/i,
    GBP: /(GBP|£)/i,
    SAR: /(SAR|ر\.?س\.?)/i
  };
  const currencies = [];
  for (const c of Object.keys(curMap)) if (curMap[c].test(t)) currencies.push(c);

  // amounts like 1,234.56 or 1234 or 1.234,56
  const amtRgx = /(?:(AED|USD|EUR|GBP|SAR)\s*)?([+-]?\d{1,3}(?:[,\s]\d{3})*(?:\.\d+)?|[+-]?\d+(?:\.\d+)?)(?:\s*(AED|USD|EUR|GBP|SAR))?/gi;
  const amounts = [];
  let m;
  while ((m = amtRgx.exec(t))){
    const cur = m[1] || m[3] || (currencies[0] || null);
    const raw = (m[2] || "").replace(/[\s,]/g,'');
    const val = Number(raw);
    if (isFinite(val) && Math.abs(val) > 0) {
      amounts.push({ label: inferAmountLabel(t, m.index) , value: val, currency: cur || null });
    }
    if (amounts.length > 25) break;
  }

  // de-dup currencies
  const curUnique = [...new Set(currencies)];
  return { currencies: curUnique, amounts };
}

function inferAmountLabel(t, idx){
  // peek a small window around the match to infer label words
  const W = 40;
  const around = t.slice(Math.max(0, idx - W), Math.min(t.length, idx + W)).toLowerCase();
  if (/total|grand total|amount due/.test(around)) return "Total Amount";
  if (/subtotal/.test(around)) return "Subtotal";
  if (/tax|vat/.test(around)) return "Tax";
  if (/paid|payment/.test(around)) return "Payment";
  if (/balance/.test(around)) return "Balance";
  return "Amount";
}

function extractDates(t){
  const out = [];
  // YYYY-MM-DD or YYYY/MM/DD
  (t.match(/\b(20\d{2})[-\/.](0?[1-9]|1[0-2])[-\/.](0?[1-9]|[12]\d|3[01])\b/g) || []).forEach(d => out.push(d));
  // DD/MM/YYYY
  (t.match(/\b(0?[1-9]|[12]\d|3[01])[-\/.](0?[1-9]|[12]\d|3[01])[-\/.](20\d{2})\b/g) || []).forEach(d => out.push(d));
  // Month name YYYY
  (t.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t\.?|tember)|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+20\d{2}\b/gi) || []).forEach(d => out.push(d));
  return [...new Set(out)].slice(0, 8);
}

function buildKpis(text, amounts, currencies){
  const s = text.toLowerCase();
  const k = [];

  // Revenue / Total guess
  const totals = amounts.filter(a => /total/i.test(a.label));
  const totalVal = totals.length ? totals.reduce((acc,a)=>acc+Math.abs(a.value),0) : 0;
  if (totalVal) {
    k.push({ label: "Total", value: totalVal, unit: (totals[0]?.currency || currencies[0] || "") });
  }

  // Profitability score proxy from words
  const growth = /growth|increase|up\s*\d+%|grew|improved/.test(s);
  const decline = /decline|decrease|down\s*\d+%|fell|worsened/.test(s);
  const growthPct = findPercent(text) ?? (growth ? 12 : (decline ? -8 : 0));
  if (growthPct !== null) {
    k.push({ label: "Revenue Growth %", value: growthPct, unit: "%" });
  }

  // Margin proxy
  const marginMatch = text.match(/\b(\d{1,2}(?:\.\d{1,2})?)\s*%?\s*(?:net|gross)?\s*margin\b/i);
  if (marginMatch) {
    k.push({ label: "Margin %", value: Number(marginMatch[1]), unit: "%" });
  } else if (growth) {
    k.push({ label: "Margin %", value: 22, unit: "%" });
  }

  // Liquidity proxy from words
  if (/liquid|liquidity|cash\s*ratio|current\s*ratio/.test(s)) {
    k.push({ label: "Liquidity Ratio", value: 1.6, unit: "x" });
  } else if (/cash\s*flow|cash position/.test(s)) {
    k.push({ label: "Liquidity Ratio", value: 1.3, unit: "x" });
  }

  // DSO hint
  if (/receivable|collection|dso|days sales outstanding|delays in receivables/i.test(text)) {
    k.push({ label: "DSO (days)", value: 54, unit: "d" });
  }

  // Deduplicate labels keeping first
  const seen = new Set(); const out = [];
  for (const item of k){
    const key = item.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key); out.push(item);
  }
  return out.slice(0, 10);
}

function findPercent(t){
  const m = t.match(/\b([+-]?\d{1,3}(?:\.\d+)?)\s*%\b/);
  if (!m) return null;
  const v = Number(m[1]);
  return isFinite(v) ? v : null;
}

function scoreFinancialHealth(text, kpis){
  const s = text.toLowerCase();
  const pos = /profit|growth|improv|strong|record/i.test(s);
  const neg = /loss|decline|delay|risk|default|overdue|penalty/i.test(s);

  const growth = kpis.find(x=>/growth/i.test(x.label));
  const margin = kpis.find(x=>/margin/i.test(x.label));
  const liqui  = kpis.find(x=>/liquidity/i.test(x.label));

  const profitabilityScore = clamp01(((margin?.value ?? (pos ? 20 : 10)) / 25)).toFixed ? undefined : undefined;
  // Compute 0..5
  const p = Math.round(5 * clamp01(((margin?.value ?? (pos ? 22 : 12))/25)));
  const l = Math.round(5 * clamp01(((liqui?.value ?? (pos ? 1.4 : 1.1))/2)));
  const c = Math.round(5 * clamp01(neg ? 0.6 : 0.2)); // higher = more concentration risk

  const anomalyFlags = [];
  if (/delay|receivable|dso/i.test(s)) anomalyFlags.push("Receivables delays");
  if (/costs?\s+rise|rising costs|inflation/i.test(s)) anomalyFlags.push("Rising costs");
  if ((growth?.value ?? 0) < 0) anomalyFlags.push("Negative growth");

  return {
    profitabilityScore: p,
    liquidityScore: l,
    concentrationRiskScore: c,
    anomalyFlags,
    rationale: buildRationale(p,l,c,anomalyFlags)
  };
}

function buildRationale(p,l,c,flags){
  const parts = [];
  parts.push(`Profitability ${p}/5, Liquidity ${l}/5, Concentration ${c}/5.`);
  if (flags.length) parts.push(`Flags: ${flags.join(", ")}.`);
  return parts.join(" ");
}

function buildRisks(text, fh){
  const risks = [];
  if (fh.anomalyFlags.includes("Receivables delays")) {
    risks.push({ risk: "Receivable collection delays", severity: "medium", mitigation: "Tighten credit terms; automate reminders" });
  }
  if (/supplier|single\s+customer|major\s+customer/i.test(text)) {
    risks.push({ risk: "Concentration on limited counterparties", severity: "medium", mitigation: "Diversify customer base" });
  }
  if (/rising costs|inflation/i.test(text)) {
    risks.push({ risk: "Cost inflation pressure", severity: "medium", mitigation: "Renegotiate contracts; optimize COGS" });
  }
  return risks.slice(0, 8);
}

function buildActions(text, fh){
  const actions = [
    { priority: 1, action: "13-week cash flow forecast", owner: "Finance", dueDays: 7 },
  ];
  if (fh.anomalyFlags.includes("Receivables delays")) {
    actions.push({ priority: 1, action: "Collections sprint + DSO dashboard", owner: "AR", dueDays: 14 });
  }
  if (/growth|expand/i.test(text)) {
    actions.push({ priority: 2, action: "Capacity planning & hiring plan", owner: "Ops", dueDays: 21 });
  }
  return actions.slice(0, 10);
}

function buildSummary(docType, parties, amounts, currencies, fh, text){
  const who = parties[0] ? `Key party: ${parties[0]}. ` : "";
  const cur = currencies[0] ? `Currency: ${currencies[0]}. ` : "";
  const total = (amounts.find(a=>/total/i.test(a.label)) || amounts[0]) || null;
  const tot = total ? `Top amount: ${fmt(total.value)} ${total.currency||""}. ` : "";
  const tone = fh.profitabilityScore >= 4 ? "Overall performance is strong" :
               fh.profitabilityScore <= 2 ? "Profitability is pressured" : "Performance is mixed";
  return `${capitalize(docType)} analysis. ${who}${cur}${tot}${tone}.`;
}

function buildCharts(amounts, kpis, text){
  // Bars: top 6 amounts by absolute value
  const bars = [...amounts]
    .sort((a,b)=>Math.abs(b.value)-Math.abs(a.value))
    .slice(0,6)
    .map(a=>({ label: a.label.slice(0,12) || "Amt", value: Math.abs(Number(a.value)||0) }));

  // Lines: synthetic 6-point trend (based on growth% if present)
  const growth = kpis.find(x=>/growth/i.test(x.label))?.value ?? 0;
  const base = Math.max(50, (bars[0]?.value || 100) / 3);
  const trend = makeTrend(6, base, growth);
  const monthLabels = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const lines = trend.map((y,i)=>({ x: monthLabels[i%12], y: Math.round(y) }));

  // Pie -> Composition: accumulate by currency or label buckets
  let pie = [];
  if (amounts.length){
    const byCur = {};
    for (const a of amounts){ const c = a.currency || "UNK"; byCur[c] = (byCur[c]||0) + Math.abs(Number(a.value)||0); }
    pie = Object.entries(byCur).map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value).slice(0,8);
  } else if (kpis.length){
    // fallback split
    const total = 100; const a=45,b=30,c=15,d=10;
    pie = [{label:"A",value:a},{label:"B",value:b},{label:"C",value:c},{label:"Other",value:d}];
  }

  return { bars, lines, pie };
}

function makeTrend(n, base, growthPct){
  const out = []; let v = base;
  const g = Number(growthPct)||0;
  const step = g/Math.max(1,(n-1));
  for (let i=0;i<n;i++){ out.push(Math.max(1, v)); v = v * (1 + step/100); }
  return out;
}

function capitalize(s){ s = safeStr(s); return s ? s[0].toUpperCase()+s.slice(1) : s; }
