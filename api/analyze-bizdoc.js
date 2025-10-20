export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  try {
    res.setHeader("Access-Control-Allow-Origin","*");
    res.setHeader("Access-Control-Allow-Methods","POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST") return res.status(405).json({ ok:false, error: "Use POST" });

    const body = await readBody(req);
    const text = norm(String(body?.text ?? ""));
    const docTypeReq = String(body?.type ?? body?.docType ?? "").toLowerCase();
    if (!text) return res.status(400).json({ ok:false, error:"Provide 'text' to analyze." });

    const detectedLanguage = /[\u0600-\u06FF]/.test(text) ? "ara" : "eng";
    const docType = docTypeReq || guessDocType(text);

    // Large-document support: chunk -> analyze per chunk -> aggregate
    const { aggregated, evidenceText } = analyzeLarge(text, docType);
    const {
      entities, currencies, amounts, dates, tone, kpis,
      fh, executiveInsights, riskMatrix, actions, charts,
      summary, trendInterpretation
    } = aggregated;

    const analysisDraft = {
      detectedLanguage, docType, summary, executiveInsights,
      keyEntities: entities, dates: dates.slice(0,12),
      amounts: amounts.slice(0,40), kpis: kpis.slice(0,24),
      trendInterpretation: trendInterpretation.slice(0,6),
      financialHealth: fh, riskMatrix: riskMatrix.slice(0,12),
      actions: actions.slice(0,12), charts,
      confidence: computeConfidence(kpis, amounts, tone, riskMatrix)
    };

    // Two-pass refine with GPT using only trimmed evidence (never full big doc)
    try {
      const { refineAnalysisWithGPT } = await import("./lib/refine.js");
      const refined = await refineAnalysisWithGPT(evidenceText, analysisDraft);
      const final = (refined && typeof refined === "object" && refined.summary) ? refined : analysisDraft;
      return res.status(200).json({ ok:true, analysis: final });
    } catch {
      return res.status(200).json({ ok:true, analysis: analysisDraft });
    }
  } catch (e) {
    return res.status(500).json({ ok:false, error:String(e?.message || e) });
  }
}

/* ---------- utils ---------- */
async function readBody(req){ const chunks=[]; for await (const c of req) chunks.push(c); try{ return JSON.parse(Buffer.concat(chunks).toString("utf8")||"{}"); }catch{ return {}; } }
function norm(s){ return s.replace(/\u00A0/g,' ').replace(/[ \t]+/g,' ').trim(); }
function safeStr(s){ return (s==null) ? "" : String(s); }
function clamp01(x){ const n=Number(x); return isFinite(n)?Math.max(0,Math.min(1,n)):0; }
function round(v){ return Math.round((Number(v)||0)*100)/100; }
function capitalize(s){ s=safeStr(s); return s? s[0].toUpperCase()+s.slice(1):s; }

/* sentence split (no lookbehind) */
function splitSentencesSafe(t){
  const out=[]; let buf="";
  for (let i=0;i<t.length;i++){
    const ch=t[i]; buf+=ch;
    if (ch==="."||ch==="!"||ch==="?"){
      const next = t.slice(i+1).match(/^\s*([A-Z\u0600-\u06FF])/);
      if (next){ out.push(buf.trim()); buf=""; }
    }
  }
  if (buf.trim()) out.push(buf.trim());
  if (out.length<=1) return t.split(/\n+/).map(s=>s.trim()).filter(Boolean);
  return out;
}

/* doc type */
function guessDocType(t){
  const s=t.toLowerCase();
  if (/\binvoice|vat(?:\s|-)invoice|tax invoice\b/.test(s)) return "invoice";
  if (/\breceipt\b/.test(s)) return "receipt";
  if (/\bpurchase\s*order\b|\bPO\b/.test(s)) return "purchase_order";
  if (/\bbalance sheet|income statement|p&l|profit and loss|cash flows?\b/.test(s)) return "financials";
  if (/\bcontract|agreement|nda\b/.test(s)) return "contract";
  return "document";
}

/* entities */
const ENTITY_STOP = new Set(["DSO","AED","USD","EUR","GBP","SAR","VAT","PO","P&L","Q1","Q2","Q3","Q4","KPI","ROI","IRR"]);
function extractEntities(t){
  const roles = { client:[], supplier:[], bank:[], investor:[], regulator:[], other:[] };
  const push=(k,v)=>{ v=clean(v); if(v && !roles[k].includes(v) && roles[k].length<6) roles[k].push(v); };
  const patt = [
    { role:'client',    rx:/\b(client|customer|buyer|purchaser)\b[:\s\-]*([A-Z][A-Za-z0-9&\-. ]{2,60})/ig },
    { role:'supplier',  rx:/\b(supplier|vendor|seller)\b[:\s\-]*([A-Z][A-Za-z0-9&\-. ]{2,60})/ig },
    { role:'bank',      rx:/\b(bank|lender)\b[:\s\-]*([A-Z][A-Za-z0-9&\-. ]{2,60})/ig },
    { role:'investor',  rx:/\b(investor|shareholder|vc|pe fund)\b[:\s\-]*([A-Z][A-Za-z0-9&\-. ]{2,60})/ig },
    { role:'regulator', rx:/\b(regulator|authority|ministry|customs|tax|zakat|vat)\b[:\s\-]*([A-Z][A-Za-z0-9&\-. ]{2,60})/ig },
  ];
  for (const p of patt){ let m; while((m=p.rx.exec(t))){ const nm=(m[2]||"").trim(); if (!ENTITY_STOP.has(nm)) push(p.role,nm); } }
  (t.match(/\b[A-Z]{3,}(?:\s+[A-Z]{2,})*\b/g)||[]).slice(0,10).map(v=>v.trim())
    .filter(v=>v.length>3 && !ENTITY_STOP.has(v)).forEach(v=>roles.other.push(clean(v)));
  for (const k of Object.keys(roles)){ roles[k]=[...new Set(roles[k])].filter(x=>x && x.length<=60).slice(0,6); }
  const parties=[...roles.client,...roles.supplier,...roles.other].slice(0,8);
  return { parties, roles };
}
function clean(s){ return String(s||"").replace(/\s{2,}/g,' ').trim(); }

/* amounts — strict rules */
function extractCurrenciesAndAmounts(t){
  const curRx={ AED:/(AED|د\.?إ\.?|درهم)/i, USD:/(USD|\$|US\$)/i, EUR:/(EUR|€)/i, GBP:/(GBP|£)/i, SAR:/(SAR|ر\.?س\.?)/i };
  const currencies=[]; for (const c of Object.keys(curRx)) if (curRx[c].test(t)) currencies.push(c);
  const curDefault=currencies[0]||null;

  const rx=/(?:(AED|USD|EUR|GBP|SAR)\s*)?([+-]?\d{1,3}(?:[,\s]\d{3})*(?:\.\d+)?|[+-]?\d+(?:\.\d+)?)(?:\s*(AED|USD|EUR|GBP|SAR))?/gi;
  const amounts=[]; let m;

  while((m=rx.exec(t))){
    const start = m.index || 0;
    const numStr = m[2]||"";
    const prevCh = t[start-1] || "";
    const nextSlice = t.slice(start+numStr.length, start+numStr.length+3);
    const cur = m[1]||m[3]||null;

    if (/[A-Za-z]/.test(prevCh)) continue;         // reject Q2/FY2025 etc.
    if (/^\s*[%x]\b/i.test(nextSlice)) continue;   // reject 12% or 1.6x

    const val = Number(numStr.replace(/[\s,]/g,''));
    if (!isFinite(val) || Math.abs(val)===0) continue;

    const W=64;
    const around=t.slice(Math.max(0,start-W), Math.min(t.length, start+numStr.length+W)).toLowerCase();
    const timeLike = /\b(day|days|week|weeks|month|months|quarter|q1|q2|q3|q4|dso)\b/.test(around);
    if (!cur && timeLike) continue;

    const hasKeyword = /(total|grand\s*total|amount\s*due|revenue|sales|cost|cogs|expense|tax|vat|payment|balance|profit)/.test(around);
    const looksThousands = /(\d{1,3}[,\s]\d{3})/.test(numStr);
    const accept = !!(cur || looksThousands || Math.abs(val)>=1000 || (hasKeyword && !timeLike && Math.abs(val)>=10));
    if (!accept) continue;

    const finalCur = cur || curDefault;
    amounts.push({ label: inferAmountLabel(t,start), value: val, currency: finalCur });
    if (amounts.length>40) break;
  }
  return { currencies:[...new Set(currencies)], amounts };
}
function inferAmountLabel(t, idx){
  const W=50; const around=t.slice(Math.max(0,idx-W), Math.min(t.length, idx+W)).toLowerCase();
  if (/grand\s*total|amount\s*due|total\b/.test(around)) return "Total";
  if (/\brevenue|sales\b/.test(around)) return "Revenue";
  if (/\bcost|cogs|expense\b/.test(around)) return "Cost";
  if (/\bprofit\b/.test(around)) return "Profit";
  if (/\btax|vat\b/.test(around)) return "Tax";
  if (/\bpaid|payment\b/.test(around)) return "Payment";
  if (/\bbalance\b/.test(around)) return "Balance";
  return "Amount";
}

/* dates */
function extractDates(t){
  const out=[];
  (t.match(/\b(20\d{2})[-\/.](0?[1-9]|1[0-2])[-\/.](0?[1-9]|[12]\d|3[01])\b/g)||[]).forEach(d=>out.push(d));
  (t.match(/\b(0?[1-9]|[12]\d|3[01])[-\/.](0?[1-9]|1[0-2])[-\/.](20\d{2})\b/g)||[]).forEach(d=>out.push(d));
  (t.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t\.?|tember)|Oct(?:ober)?|Nov(?:ember)?)\s+20\d{2}\b/gi)||[]).forEach(d=>out.push(d));
  return [...new Set(out)].slice(0,12);
}

/* sentiment */
function scoreSentiment(t){
  const P=['growth','grew','increase','improved','record','strong','resilient','profitable','surplus','beat'];
  const N=['decline','decrease','fell','worsened','loss','delay','overdue','default','penalty','risk','pressure','shortfall','spike'];
  const p=(t.match(new RegExp('\\b(' + P.join('|') + ')\\b','gi'))||[]).length;
  const n=(t.match(new RegExp('\\b(' + N.join('|') + ')\\b','gi'))||[]).length;
  const score=p-n;
  return { score, positive:p, negative:n, label: score>1?'positive':score<-1?'negative':'mixed' };
}

/* helpers for matchAll with /g */
function allMatches(t, rx){
  const flags = rx.flags?.includes('g') ? rx.flags : (rx.flags ? rx.flags + 'g' : 'g');
  const g = new RegExp(rx.source, flags);
  return [...t.matchAll(g)];
}
function distanceToKeyword(t, idx, rx){
  const m = allMatches(t, rx);
  let d=1e9; for (const mm of m){ const i=mm.index||0; const dd=Math.abs(i-idx); if (dd<d) d=dd; }
  return m.length?d:1e9;
}

/* KPIs */
function buildKpis(text, amounts, currencies){
  const k=[];

  // Robust growth detection
  let growthPct=null;
  const rxs=[
    /\brevenue\s+grew(?:\s+by)?\s+([+-]?\d{1,3}(?:\.\d+)?)\s*%\b/i,
    /\btopline\s+grew(?:\s+by)?\s+([+-]?\d{1,3}(?:\.\d+)?)\s*%\b/i,
    /\bgrowth\s+(?:of|at)\s+([+-]?\d{1,3}(?:\.\d+)?)\s*%\b/i,
    /\b(revenue|sales|topline)\s+(?:increased|rose|up)\s+(?:by\s+)?([+-]?\d{1,3}(?:\.\d+)?)\s*%\b/i,
    /\bgrew(?:\s+by)?\s+([+-]?\d{1,3}(?:\.\d+)?)\s*%\b/i
  ];
  for (const rx of rxs){ const m=text.match(rx); if(m){ growthPct=Number(m[2]||m[1]); break; } }
  if (growthPct==null){
    const near=findPercentNear(text, /(growth|grew|revenue|sales|topline)/i);
    if (near!=null) growthPct=near;
  }
  if (growthPct!=null) k.push({ label:"Revenue Growth %", value:Number(growthPct), unit:"%" });

  // Margin
  const m1 = text.match(/\b([0-9]{1,2}(?:\.\d{1,2})?)\s*%\s*(?:net|operating|gross)?\s*margin\b/i);
  const m2 = text.match(/\bmargin(?:\s*(?:near|around|about|of|≈|~=|=)\s*|\s+)([0-9]{1,2}(?:\.\d{1,2})?)\s*%/i);
  const marginPct = m1 ? Number(m1[1]) : (m2 ? Number(m2[1]) : null);
  if (marginPct!=null) k.push({ label:"Margin %", value: marginPct, unit:"%" });

  // Liquidity ratio
  const liqMatch = text.match(/\b(current|quick)\s*ratio[:\s]*([0-9]+(?:\.[0-9]+)?)\b/i);
  if (liqMatch) k.push({ label:"Liquidity Ratio", value:Number(liqMatch[2]), unit:"x" });
  else {
    const liqHint = text.match(/\bliquidity[^.]{0,24}?([0-9]+(?:\.[0-9]+)?)\s*x\b/i);
    if (liqHint) k.push({ label:"Liquidity Ratio", value:Number(liqHint[1]), unit:"x" });
  }

  // DSO
  const dso = findNumberNear(text, /(dso|days\s*sales\s*outstanding|receivable[s]?\s*days)/i);
  if (dso!=null) k.push({ label:"DSO (days)", value:Number(dso), unit:"d" });

  // Total from amounts
  const totals = amounts.filter(a=>/total/i.test(a.label));
  const totalVal = totals.reduce((s,a)=>s+Math.abs(a.value),0);
  if (totalVal>0) k.push({ label:"Total", value: totalVal, unit: (totals[0]?.currency || currencies[0] || "") });

  // Dedup by label
  const seen=new Set(); const out=[];
  for (const item of k){ const key=item.label.toLowerCase(); if (seen.has(key)) continue; seen.add(key); out.push(item); }
  return out.slice(0,24);
}
function findPercentNear(t, nearRx){
  const perc = allMatches(t, /\b([+-]?\d{1,3}(?:\.\d+)?)\s*%\b/g);
  if (!perc.length) return null;
  let best=null, bestDist=1e9;
  for (const mm of perc){
    const idx=mm.index||0;
    const dist=distanceToKeyword(t, idx, nearRx);
    if (dist<bestDist){ best=mm; bestDist=dist; }
  }
  const v=Number(best?.[1]); return isFinite(v)?v:null;
}
function findNumberNear(t, nearRx){
  const nums = allMatches(t, /\b([0-9]{1,4})(?:\.\d+)?\b/g);
  let best=null, bestDist=1e9;
  for (const mm of nums){
    const idx=mm.index||0; const dist=distanceToKeyword(t, idx, nearRx);
    if (dist<bestDist){ best=mm; bestDist=dist; }
  }
  const v=Number(best?.[1]); return isFinite(v)?v:null;
}

/* derivations */
function deriveFinancialsFromAmounts(kpis, amounts){
  const rev = pickLargest(amounts.filter(a=>/revenue|sales/i.test(a.label)));
  const cost = pickLargest(amounts.filter(a=>/cost|cogs|expense/i.test(a.label)));
  const prof = pickLargest(amounts.filter(a=>/profit\b/i.test(a.label)));
  if (!hasKpi(kpis,'Revenue') && rev) kpis.push({ label:'Revenue', value:Math.abs(rev.value), unit: rev.currency||'' });
  if (!hasKpi(kpis,'Cost') && cost) kpis.push({ label:'Cost', value:Math.abs(cost.value), unit: cost.currency||'' });
  let marginPct=null;
  if (prof && rev && rev.value) marginPct=(prof.value/rev.value)*100;
  if (marginPct!=null && isFinite(marginPct) && !hasKpi(kpis,'Margin %')) kpis.push({ label:'Margin %', value: round(marginPct), unit:'%' });
}
function hasKpi(list, label){ return list.some(k=>k.label.toLowerCase()===label.toLowerCase()); }
function pickLargest(arr){ return arr.length? arr.sort((a,b)=>Math.abs(b.value)-Math.abs(a.value))[0] : null; }

/* health, insights, risks, actions */
function scoreFinancialHealth(text, kpis, tone, entities){
  const growth = (kpis.find(k=>/growth/i.test(k.label))?.value) ?? (tone.score>0?8:(tone.score<0?-6:0));
  const margin = (kpis.find(k=>/margin/i.test(k.label))?.value) ?? (tone.score>0?20:12);
  const liquidity = (kpis.find(k=>/liquidity/i.test(k.label))?.value) ?? (tone.score>0?1.4:1.1);

  const profitabilityScore = Math.round(5 * clamp01((margin)/25));
  const liquidityScore     = Math.round(5 * clamp01((liquidity)/2));

  const partyCount = new Set(entities.parties||[]).size;
  const concentrationRiskScore = Math.round(5 * clamp01(partyCount<=2 ? 0.7 : partyCount<=4 ? 0.45 : 0.2));

  const anomalyFlags=[];
  const dso = kpis.find(k=>/DSO/i.test(k.label))?.value;
  if (dso!=null && dso>50) anomalyFlags.push("Elevated DSO");
  if (/rising costs|cost pressure|inflation/i.test(text)) anomalyFlags.push("Cost pressure");
  if (/overdue|default|penalty/i.test(text)) anomalyFlags.push("Compliance/credit risk");
  if (growth<0) anomalyFlags.push("Negative growth");

  const rationale = [
    `Growth ${growth>=0?'+':''}${round(growth)}%, margin ~${round(margin)}%.`,
    `Liquidity ~${round(liquidity)}x; counterparties: ${partyCount}.`,
    anomalyFlags.length?`Flags: ${anomalyFlags.join(', ')}.`:null
  ].filter(Boolean).join(' ');

  return { profitabilityScore, liquidityScore, concentrationRiskScore, anomalyFlags, rationale };
}
function buildInsights(kpis, tone, fh, entities){
  const bullets=[];
  const gr=kpis.find(k=>/growth/i.test(k.label)); const mg=kpis.find(k=>/margin/i.test(k.label)); const li=kpis.find(k=>/liquidity/i.test(k.label));
  if (gr) bullets.push(`Revenue growth ${round(gr.value)}% (${tone.label}).`);
  if (mg) bullets.push(`Margin ~${round(mg.value)}% (${fh.profitabilityScore}/5).`);
  if (li) bullets.push(`Liquidity ~${round(li.value)}x (${fh.liquidityScore}/5).`);
  if ((entities.roles?.client||[]).length) bullets.push(`Key client: ${entities.roles.client[0]}.`);
  if ((entities.roles?.supplier||[]).length) bullets.push(`Key supplier: ${entities.roles.supplier[0]}.`);
  return bullets.slice(0,6).length?bullets.slice(0,6):["Performance broadly stable; limited signals."];
}
function buildRisks(text, fh, sentences){
  const risks=[]; const add=(risk,severity,evidence,mitigation)=>risks.push({ risk,severity,evidence,mitigation });
  const ev=(rx)=>{ for (const s of sentences){ if (rx.test(s)) return s.slice(0,220); } return null; };

  if (fh.anomalyFlags.includes("Elevated DSO"))
    add("Receivable collection delays","medium", ev(/(dso|receivable|collection|overdue)/i), "Tighten credit terms; automate dunning; early-payment incentives");

  if (/rising costs|cost pressure|inflation/i.test(text))
    add("Cost inflation pressure","medium", ev(/(rising costs|inflation|cost pressure)/i), "Renegotiate suppliers; price review; efficiency program");

  if (/overdue|default|penalty/i.test(text))
    add("Compliance/credit issues","high", ev(/(overdue|default|penalty|fine)/i), "Resolve penalties; strengthen internal controls");

  if (fh.concentrationRiskScore>=4)
    add("Counterparty concentration","medium", "Few key clients/suppliers mentioned", "Diversify customers; multi-source suppliers");

  return risks.slice(0,12);
}
function buildActions(text, fh, kpis, risks){
  const out=[ { priority:1, action:"13-week cash flow forecast", owner:"Finance", dueDays:7 } ];
  if (fh.anomalyFlags.includes("Elevated DSO"))
    out.push({ priority:1, action:"Collections sprint + DSO dashboard", owner:"AR", dueDays:14 });
  if (risks.some(r=>/Cost inflation/.test(r.risk)))
    out.push({ priority:2, action:"COGS & pricing review", owner:"CFO", dueDays:14 });
  if (fh.concentrationRiskScore>=4)
    out.push({ priority:2, action:"Customer diversification plan", owner:"Sales", dueDays:30 });
  const seen=new Set(); const ded=[]; for (const a of out){ const k=a.action.toLowerCase(); if (seen.has(k)) continue; seen.add(k); ded.push(a); }
  return ded.slice(0,12);
}

/* charts — money only */
function buildCharts(amounts, kpis){
  const money = amounts.filter(a => Math.abs(a.value)>=10 || a.currency);
  const bars=[...money].sort((a,b)=>Math.abs(b.value)-Math.abs(a.value)).slice(0,6)
    .map(a=>({ label:(a.label||"Amt").slice(0,12), value:Math.abs(Number(a.value)||0) }));

  const growth=kpis.find(k=>/growth/i.test(k.label))?.value ?? 0;
  const base=Math.max(50,(bars[0]?.value||120)/3);
  const lines=makeTrend(6,base,growth).map((y,i)=>({ x:MONTHS[i%12], y:Math.round(y) }));

  let pie=[];
  if (money.length){
    const byCur={}; for (const a of money){ const c=a.currency||"UNK"; byCur[c]=(byCur[c]||0)+Math.abs(Number(a.value)||0); }
    pie=Object.entries(byCur).map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value).slice(0,8);
  }
  return { bars, lines, pie };
}
function makeTrend(n, base, gPct){ const out=[]; let v=base; const step=(Number(gPct)||0)/Math.max(1,(n-1)); for(let i=0;i<n;i++){ out.push(Math.max(1,v)); v=v*(1+step/100); } return out; }
const MONTHS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/* summary & confidence */
function buildSummary(docType, entities, kpis, fh, tone){
  const gr = kpis.find(k=>/growth/i.test(k.label))?.value;
  const mg = kpis.find(k=>/margin/i.test(k.label))?.value;
  const li = kpis.find(k=>/liquidity/i.test(k.label))?.value;
  const head = `${capitalize(docType)} analysis.`;
  const s1 = gr!=null ? ` Topline ${gr>=0?'grew':'declined'} ${Math.abs(Math.round(gr))}%.` : "";
  const s2 = mg!=null ? ` Margin approx. ${round(mg)}%.` : "";
  const s3 = li!=null ? ` Liquidity ~${round(li)}x.` : "";
  const s4 = ` Health: Profitability ${fh.profitabilityScore}/5, Liquidity ${fh.liquidityScore}/5, Concentration ${fh.concentrationRiskScore}/5 (${tone.label}).`;
  return (head+s1+s2+s3+s4).trim();
}
function interpretTrend(kpis, tone){
  const gr = kpis.find(k=>/growth/i.test(k.label))?.value ?? 0;
  const dir = gr>0?"Improving revenue trend":gr<0?"Softening revenue trend":"Flat revenue trend";
  const mg = kpis.find(k=>/Margin/.test(k.label))?.value ?? null;
  const li = kpis.find(k=>/Liquidity/.test(k.label))?.value ?? null;
  const hints=[dir];
  if (mg!=null) hints.push(mg>=20?"Margins healthy":"Margins moderate");
  if (li!=null) hints.push(li>=1.5?"Liquidity strong":"Liquidity adequate");
  hints.push(`Narrative: ${tone.label}`);
  return hints.slice(0,5);
}
function computeConfidence(kpis, amounts, tone, risks){
  return clamp01(0.55 + 0.1*(kpis.length>2) + 0.1*(amounts.length>3) + 0.05*(tone.positive+tone.negative>1) + 0.05*(risks.length>0));
}

/* ===================== LARGE DOCUMENT SUPPORT ===================== */
const MAX_CHARS_PER_PASS = 80_000;     // rule-based analyzer budget per chunk
const MAX_RELEVANT_EVIDENCE = 10_000;  // what we send to LLM refine

function analyzeLarge(text, docType){
  if (text.length <= MAX_CHARS_PER_PASS) {
    const single = analyzeOne(text, docType);
    const evidenceText = buildEvidenceText(text, single.kpis, MAX_RELEVANT_EVIDENCE);
    return { aggregated: single, evidenceText };
  }
  const chunks = smartChunks(text, MAX_CHARS_PER_PASS);
  const partials = [];
  for (const chunk of chunks){
    partials.push(analyzeOne(chunk, docType));
    if (partials.length > 24) break; // safety cap
  }
  const aggregated = aggregatePartials(partials, docType);
  const evidenceText = buildEvidenceFromPartials(chunks, partials, MAX_RELEVANT_EVIDENCE);
  return { aggregated, evidenceText };
}

function analyzeOne(text, docType){
  const entities = extractEntities(text);
  const { currencies, amounts } = extractCurrenciesAndAmounts(text);
  const dates = extractDates(text);
  const sentences = splitSentencesSafe(text);
  const tone = scoreSentiment(text);
  const kpis = buildKpis(text, amounts, currencies);
  deriveFinancialsFromAmounts(kpis, amounts);
  const fh = scoreFinancialHealth(text, kpis, tone, entities);
  const executiveInsights = buildInsights(kpis, tone, fh, entities);
  const riskMatrix = buildRisks(text, fh, sentences);
  const actions = buildActions(text, fh, kpis, riskMatrix);
  const charts = buildCharts(amounts, kpis);
  const summary = buildSummary(docType, entities, kpis, fh, tone);
  const trendInterpretation = interpretTrend(kpis, tone);
  return { entities, currencies, amounts, dates, tone, kpis, fh, executiveInsights, riskMatrix, actions, charts, summary, trendInterpretation };
}

function smartChunks(text, budget){
  const parts = [];
  const paras = text.split(/\n{2,}/);
  let buf = "";
  for (const p of paras){
    const cand = (buf ? buf + "\n\n" : "") + p;
    if (cand.length <= budget) { buf = cand; continue; }
    if (buf) parts.push(buf);
    if (p.length <= budget){ buf = p; continue; }
    const sents = p.split(/(?<=[.!?])\s+(?=[A-Z])/g);
    let sbuf="";
    for (const s of sents){
      const c2 = (sbuf? sbuf+" ":"") + s;
      if (c2.length <= budget){ sbuf=c2; continue; }
      if (sbuf) parts.push(sbuf);
      if (s.length <= budget){ sbuf=s; } else {
        for (let i=0;i<s.length;i+=budget) parts.push(s.slice(i, i+budget));
        sbuf="";
      }
    }
    if (sbuf) parts.push(sbuf);
    buf="";
  }
  if (buf) parts.push(buf);
  return parts;
}

function aggregatePartials(list, docType){
  const agg = {
    entities: { parties:[], roles:{ client:[], supplier:[], bank:[], investor:[], regulator:[], other:[] } },
    currencies: [], amounts: [], dates: [],
    tone: { score:0, positive:0, negative:0, label:"mixed" },
    kpis: [], fh: { profitabilityScore:0, liquidityScore:0, concentrationRiskScore:0, anomalyFlags:[], rationale:"" },
    executiveInsights: [], riskMatrix: [], actions: [],
    charts: { bars:[], lines:[], pie:[] }, summary: "", trendInterpretation: []
  };
  const pushUniq = (arr, v, cap=64) => { if (v==null) return; if (!arr.includes(v)) arr.push(v); if (arr.length>cap) arr.length=cap; };

  for (const p of list){
    for (const role of Object.keys(agg.entities.roles)){
      for (const v of (p.entities.roles[role]||[])) pushUniq(agg.entities.roles[role], v, 12);
    }
    for (const v of (p.entities.parties||[])) pushUniq(agg.entities.parties, v, 16);
    for (const c of (p.currencies||[])) pushUniq(agg.currencies, c, 8);
    agg.amounts = mergeAmounts(agg.amounts, p.amounts);
    for (const d of (p.dates||[])) pushUniq(agg.dates, d, 24);
    agg.tone.positive += p.tone.positive||0;
    agg.tone.negative += p.tone.negative||0;
    agg.tone.score += p.tone.score||0;
    agg.kpis = mergeKpis(agg.kpis, p.kpis);
    agg.fh.profitabilityScore += p.fh.profitabilityScore||0;
    agg.fh.liquidityScore += p.fh.liquidityScore||0;
    agg.fh.concentrationRiskScore = Math.max(agg.fh.concentrationRiskScore, p.fh.concentrationRiskScore||0);
    for (const f of (p.fh.anomalyFlags||[])) pushUniq(agg.fh.anomalyFlags, f, 12);
    for (const s of (p.executiveInsights||[])) pushUniq(agg.executiveInsights, s, 10);
    for (const r of (p.riskMatrix||[])) if (agg.riskMatrix.length<12) agg.riskMatrix.push(r);
    for (const a of (p.actions||[])) if (agg.actions.length<12) agg.actions.push(a);
  }
  const n = Math.max(1, list.length);
  agg.fh.profitabilityScore = Math.round(agg.fh.profitabilityScore/n);
  agg.fh.liquidityScore = Math.round(agg.fh.liquidityScore/n);
  agg.tone.label = agg.tone.score>1 ? "positive" : (agg.tone.score<-1 ? "negative" : "mixed");
  agg.charts = buildCharts(agg.amounts, agg.kpis);
  agg.summary = buildSummary(docType, agg.entities, agg.kpis, agg.fh, agg.tone);
  agg.trendInterpretation = interpretTrend(agg.kpis, agg.tone);
  return agg;
}
function mergeAmounts(a, b){
  const out = [...a];
  for (const x of (b||[])){
    const key = `${(x.label||"").toLowerCase()}|${x.currency||""}`;
    const i = out.findIndex(y=>`${(y.label||"").toLowerCase()}|${y.currency||""}`===key);
    if (i<0) out.push(x);
    else if (Math.abs(Number(x.value)||0) > Math.abs(Number(out[i].value)||0)) out[i]=x;
    if (out.length>40) break;
  }
  return out;
}
function mergeKpis(a, b){
  const out = [...a];
  for (const k of (b||[])){
    const key = (k.label||"").toLowerCase();
    const i = out.findIndex(z=>(z.label||"").toLowerCase()===key);
    if (i<0) out.push(k);
    else if (isFinite(Number(k.value)) && Math.abs(Number(k.value)) > Math.abs(Number(out[i].value)||0)) out[i]=k;
    if (out.length>24) break;
  }
  return out;
}

function buildEvidenceText(fullText, kpis, maxLen){
  const focus = /(total|amount\s*due|revenue|sales|cost|profit|tax|vat|margin|liquidity|ratio|dso|days\s*sales\s*outstanding|growth|grew|increased|rose|up|net|operating|gross)/i;
  const sents = splitSentencesSafe(fullText);
  const hits = [];
  for (const s of sents){ if (focus.test(s)) hits.push(s.trim()); if (hits.length>=400) break; }
  let evidence = hits.join(" ");
  if (evidence.length>maxLen) evidence = evidence.slice(0, maxLen);
  if (evidence.length < Math.min(maxLen, fullText.length)){
    const head = fullText.slice(0, Math.min(2000, Math.floor(maxLen*0.2)));
    const tail = fullText.slice(-Math.min(2000, Math.floor(maxLen*0.2)));
    evidence = (head + "\n" + evidence + "\n" + tail).slice(0, maxLen);
  }
  return evidence;
}
function buildEvidenceFromPartials(chunks, partials, maxLen){
  const scored = chunks.map((t,i)=>{
    const score = ((t.match(/\b(total|amount\s*due|revenue|sales|cost|profit|tax|vat)\b/gi)||[]).length*3) +
                  ((t.match(/\b(AED|USD|EUR|GBP|SAR|€|\$|£|د\.?إ\.?|درهم)\b/gi)||[]).length*2) +
                  ((t.match(/\b(margin|liquidity|ratio|dso|grew|growth|increased|rose|up)\b/gi)||[]).length);
    return { i, score, len: t.length };
  }).sort((a,b)=>b.score-a.score);
  let evidence=""; let used=0;
  for (const s of scored){
    const piece = chunks[s.i];
    if (used + piece.length > maxLen) {
      const remain = maxLen - used;
      if (remain>500) { evidence += (evidence? "\n\n":"") + piece.slice(0, remain); used += remain; }
      break;
    }
    evidence += (evidence ? "\n\n" : "") + piece;
    used += piece.length;
    if (used>=maxLen) break;
  }
  return evidence.slice(0, maxLen);
}

// ---- Safe union merge of draft + refined (avoid losing signals) ----
function mergeAnalyses(draft, refined){
  const out = { ...draft, ...refined };

  // Merge arrays carefully
  out.keyEntities = mergeEntities(draft.keyEntities, refined.keyEntities);
  out.amounts     = mergeAmountsSafe(draft.amounts||[], refined.amounts||[], 40);
  out.kpis        = mergeKpisSafe(draft.kpis||[], refined.kpis||[], 24);
  out.executiveInsights = dedupArray([...(draft.executiveInsights||[]), ...(refined.executiveInsights||[])], 10);
  out.riskMatrix  = (refined.riskMatrix && refined.riskMatrix.length ? refined.riskMatrix : draft.riskMatrix)||[];
  out.actions     = dedupActions([...(draft.actions||[]), ...(refined.actions||[])], 12);
  out.charts      = pickCharts(draft.charts, refined.charts); // prefer refined if valid; fallback to draft

  // Keep best summary (prefer refined if present)
  out.summary = refined.summary || draft.summary;

  // Keep stronger health if refined looks sane; otherwise draft
  if (refined.financialHealth && typeof refined.financialHealth === "object") {
    out.financialHealth = refined.financialHealth;
  } else {
    out.financialHealth = draft.financialHealth;
  }

  // Confidence: take max of both
  const c1 = Number(draft.confidence||0), c2 = Number(refined.confidence||0);
  out.confidence = Math.max(c1, c2, 0.6);

  return out;
}
function mergeEntities(a={}, b={}){
  const roles = {};
  const keys = ["client","supplier","bank","investor","regulator","other"];
  for (const k of keys){
    roles[k] = dedupArray([...(a?.roles?.[k]||[]), ...(b?.roles?.[k]||[])], 12);
  }
  const parties = dedupArray([...(a.parties||[]), ...(b.parties||[])], 16);
  return { roles, parties };
}
function mergeAmountsSafe(a, b, cap){
  const out = [...a];
  const idx = (x)=>`${(x.label||"").toLowerCase()}|${x.currency||""}`;
  for (const x of b){
    const k = idx(x);
    const i = out.findIndex(y=>idx(y)===k);
    if (i<0) out.push(x);
    else if (Math.abs(Number(x.value)||0) > Math.abs(Number(out[i].value)||0)) out[i] = x;
    if (out.length>=cap) break;
  }
  return out;
}
function mergeKpisSafe(a, b, cap){
  const out = [...a];
  const key = (x)=> (x.label||"").toLowerCase();
  for (const x of b){
    const i = out.findIndex(y=>key(y)===key(x));
    if (i<0) out.push(x);
    else if (isFinite(Number(x.value)) && Math.abs(Number(x.value)) > Math.abs(Number(out[i].value)||0)) out[i] = x;
    if (out.length>=cap) break;
  }
  // normalize canonical KPI naming where possible
  for (const k of out){
    if (/operating\s*margin/i.test(k.label)) k.label = "Margin %";
    if (/growth/i.test(k.label) && !/%/.test(String(k.unit||""))) k.unit = "%";
    if (/liquidity/i.test(k.label) && !/x/i.test(String(k.unit||""))) k.unit = "x";
    if (/DSO/i.test(k.label) && !/d/i.test(String(k.unit||""))) k.unit = "d";
  }
  return out.slice(0,cap);
}
function dedupArray(arr, cap){ const s=new Set(); const out=[]; for (const v of arr){ const k=JSON.stringify(v); if (s.has(k)) continue; s.add(k); out.push(v); if (out.length>=cap) break; } return out; }
function dedupActions(arr, cap){ const seen = new Set(); const out=[]; for (const a of arr){ const k=(a.action||"").toLowerCase(); if (seen.has(k)) continue; seen.add(k); out.push(a); if (out.length>=cap) break; } return out; }
function pickCharts(draftCharts={}, refinedCharts={}){
  const valid = (c)=> c && Array.isArray(c.bars) && Array.isArray(c.pie);
  if (valid(refinedCharts)) return refinedCharts;
  if (valid(draftCharts)) return draftCharts;
  return { bars:[], lines:[], pie:[] };
}
