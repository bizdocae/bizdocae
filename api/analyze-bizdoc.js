// Executive-grade English analyzer (safe build): no lookbehind, no exotic regex.
// Produces narrative summary, KPIs, risks, actions, and chart-ready data.
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

    // --- Detections ---
    const detectedLanguage = /[\u0600-\u06FF]/.test(text) ? "ara" : "eng";
    const docType = docTypeReq || guessDocType(text);
    const sentences = splitSentencesSafe(text);

    // Entities
    const entities = extractEntities(text);

    // Money & currencies
    const { currencies, amounts } = extractCurrenciesAndAmounts(text);

    // Dates
    const dates = extractDates(text);

    // Sentiment
    const tone = scoreSentiment(text);

    // KPIs
    const kpis = buildKpis(text, amounts, currencies);
    deriveFinancialsFromAmounts(kpis, amounts);

    // Health
    const fh = scoreFinancialHealth(text, kpis, tone, entities);

    // Insights, Risks, Actions
    const executiveInsights = buildInsights(kpis, tone, fh, entities);
    const riskMatrix = buildRisks(text, fh, sentences);
    const actions = buildActions(text, fh, kpis, riskMatrix);

    // Charts
    const charts = buildCharts(amounts, kpis);

    // Summary + trend
    const summary = buildSummary(docType, entities, kpis, fh, tone);
    const trendInterpretation = interpretTrend(kpis, tone);

    const analysis = {
      detectedLanguage,
      docType,
      summary,
      executiveInsights,
      keyEntities: entities,
      dates: dates.slice(0,8),
      amounts: amounts.slice(0,16),
      kpis,
      trendInterpretation,
      financialHealth: fh,
      riskMatrix,
      actions,
      charts,
      confidence: computeConfidence(kpis, amounts, tone, riskMatrix)
    };

    return res.status(200).json({ ok:true, analysis });
  } catch (e) {
    return res.status(500).json({ ok:false, error:String(e?.message || e) });
  }
}

/* ---------------- utilities ---------------- */
async function readBody(req){ const chunks=[]; for await (const c of req) chunks.push(c); try{ return JSON.parse(Buffer.concat(chunks).toString("utf8")||"{}"); }catch{ return {}; } }
function norm(s){ return s.replace(/\u00A0/g,' ').replace(/[ \t]+/g,' ').trim(); }
function safeStr(s){ return (s==null) ? "" : String(s); }
function clamp01(x){ const n=Number(x); return isFinite(n)?Math.max(0,Math.min(1,n)):0; }
function pct(n){ return isFinite(n)?Math.round(n*100)+"%":"-"; }
function round(v){ return Math.round((Number(v)||0)*100)/100; }
function fmt(n){ const v=Number(n); return isFinite(v)?new Intl.NumberFormat("en-US",{maximumFractionDigits:2}).format(v):"-"; }
function capitalize(s){ s=safeStr(s); return s? s[0].toUpperCase()+s.slice(1):s; }

/* ----- SAFE sentence split (no lookbehind) ----- */
function splitSentencesSafe(t){
  // Split on ".", "!" or "?" followed by whitespace+capital/Arabic, but without lookbehind.
  const out=[]; let buf="";
  for (let i=0;i<t.length;i++){
    const ch=t[i]; buf+=ch;
    if (ch==="."||ch==="!"||ch==="?"){
      // peek ahead to decide boundary
      const j=i+1; const next=t.slice(j).match(/^\s*([A-Z\u0600-\u06FF])/);
      if (next){ out.push(buf.trim()); buf=""; }
    }
  }
  if (buf.trim()) out.push(buf.trim());
  // Fallback if too few sentences
  if (out.length<=1) return t.split(/\n+/).map(s=>s.trim()).filter(Boolean);
  return out;
}

/* ----- Doc type ----- */
function guessDocType(t){
  const s=t.toLowerCase();
  if (/\binvoice|vat(?:\s|-)invoice|tax invoice\b/.test(s)) return "invoice";
  if (/\breceipt\b/.test(s)) return "receipt";
  if (/\bpurchase\s*order\b|\bPO\b/.test(s)) return "purchase_order";
  if (/\bbalance sheet|income statement|p&l|profit and loss|cash flows?\b/.test(s)) return "financials";
  if (/\bcontract|agreement|nda\b/.test(s)) return "contract";
  return "document";
}

/* ----- Entities w/ roles ----- */
function extractEntities(t){
  const roles = { client:[], supplier:[], bank:[], investor:[], regulator:[], other:[] };
  const push=(k,v)=>{ v=cleanName(v); if(v && !roles[k].includes(v) && roles[k].length<6) roles[k].push(v); };
  const patt = [
    { role:'client',    rx:/\b(client|customer|buyer|purchaser)\b[:\s\-]*([A-Z][A-Za-z0-9&\-. ]{2,60})/ig },
    { role:'supplier',  rx:/\b(supplier|vendor|seller)\b[:\s\-]*([A-Z][A-Za-z0-9&\-. ]{2,60})/ig },
    { role:'bank',      rx:/\b(bank|lender)\b[:\s\-]*([A-Z][A-Za-z0-9&\-. ]{2,60})/ig },
    { role:'investor',  rx:/\b(investor|shareholder|vc|pe fund)\b[:\s\-]*([A-Z][A-Za-z0-9&\-. ]{2,60})/ig },
    { role:'regulator', rx:/\b(regulator|authority|ministry|customs|tax|zakat|vat)\b[:\s\-]*([A-Z][A-Za-z0-9&\-. ]{2,60})/ig },
  ];
  for (const p of patt){ let m; while((m=p.rx.exec(t))){ push(p.role,m[2]||""); } }
  (t.match(/\b[A-Z]{3,}(?:\s+[A-Z]{2,})*\b/g)||[]).slice(0,10).forEach(v=>roles.other.push(cleanName(v)));
  for (const k of Object.keys(roles)){ roles[k]=[...new Set(roles[k])].filter(x=>x && x.length<=60).slice(0,6); }
  const parties=[...roles.client,...roles.supplier,...roles.other].slice(0,8);
  return { parties, roles };
}
function cleanName(s){ return String(s||"").replace(/\s{2,}/g,' ').trim(); }

/* ----- Money & currencies ----- */
function extractCurrenciesAndAmounts(t){
  const curRx={ AED:/(AED|د\.?إ\.?|درهم)/i, USD:/(USD|\$|US\$)/i, EUR:/(EUR|€)/i, GBP:/(GBP|£)/i, SAR:/(SAR|ر\.?س\.?)/i };
  const currencies=[]; for (const c of Object.keys(curRx)) if (curRx[c].test(t)) currencies.push(c);
  const curDefault=currencies[0]||null;
  const rx=/(?:(AED|USD|EUR|GBP|SAR)\s*)?([+-]?\d{1,3}(?:[,\s]\d{3})*(?:\.\d+)?|[+-]?\d+(?:\.\d+)?)(?:\s*(AED|USD|EUR|GBP|SAR))?/gi;
  const amounts=[]; let m;
  while((m=rx.exec(t))){
    const cur=m[1]||m[3]||curDefault;
    const val=Number((m[2]||"").replace(/[\s,]/g,''));
    if (isFinite(val) && Math.abs(val)>0){
      amounts.push({ label: inferAmountLabel(t,m.index), value: val, currency: cur||null });
      if (amounts.length>40) break;
    }
  }
  return { currencies:[...new Set(currencies)], amounts };
}
function inferAmountLabel(t, idx){
  const W=48; const around=t.slice(Math.max(0,idx-W), Math.min(t.length, idx+W)).toLowerCase();
  if (/grand\s*total|amount\s*due|total\b/.test(around)) return "Total";
  if (/\brevenue|sales\b/.test(around)) return "Revenue";
  if (/\bcost|cogs|expense\b/.test(around)) return "Cost";
  if (/\bprofit\b/.test(around)) return "Profit";
  if (/\btax|vat\b/.test(around)) return "Tax";
  if (/\bpaid|payment\b/.test(around)) return "Payment";
  if (/\bbalance\b/.test(around)) return "Balance";
  return "Amount";
}

/* ----- Dates ----- */
function extractDates(t){
  const out=[];
  (t.match(/\b(20\d{2})[-\/.](0?[1-9]|1[0-2])[-\/.](0?[1-9]|[12]\d|3[01])\b/g)||[]).forEach(d=>out.push(d));
  (t.match(/\b(0?[1-9]|[12]\d|3[01])[-\/.](0?[1-9]|1[0-2])[-\/.](20\d{2})\b/g)||[]).forEach(d=>out.push(d));
  (t.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t\.?|tember)|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+20\d{2}\b/gi)||[]).forEach(d=>out.push(d));
  return [...new Set(out)].slice(0,12);
}

/* ----- Sentiment ----- */
function scoreSentiment(t){
  const P=['growth','grew','increase','improved','record','strong','resilient','profitable','surplus','beat'];
  const N=['decline','decrease','fell','worsened','loss','delay','overdue','default','penalty','risk','pressure','shortfall','spike'];
  const p=countWords(t,P), n=countWords(t,N); const score=p-n;
  return { score, positive:p, negative:n, label: score>1?'positive':score<-1?'negative':'mixed' };
}
function countWords(t,arr){ const rx=new RegExp('\\b(' + arr.join('|') + ')\\b','gi'); return (t.match(rx)||[]).length; }

/* ----- KPIs & derivations ----- */
function buildKpis(text, amounts, currencies){
  const k=[];

  const growthPct = findPercentNear(text, /(growth|revenue|sales)/i);
  if (growthPct!=null) k.push({ label:"Revenue Growth %", value: Number(growthPct), unit:"%" });

  const marginMatch = text.match(/\b(\d{1,2}(?:\.\d{1,2})?)\s*%?\s*(?:net|operating|gross)?\s*margin\b/i);
  if (marginMatch) k.push({ label:"Margin %", value:Number(marginMatch[1]), unit:"%" });

  const liqMatch = text.match(/\b(current|quick)\s*ratio[:\s]*([0-9]+(?:\.[0-9]+)?)\b/i);
  if (liqMatch) k.push({ label:"Liquidity Ratio", value:Number(liqMatch[2]), unit:"x" });

  const dso = findNumberNear(text, /(dso|days\s*sales\s*outstanding|receivable[s]?\s*days)/i);
  if (dso!=null) k.push({ label:"DSO (days)", value:Number(dso), unit:"d" });

  const totals = amounts.filter(a=>/total/i.test(a.label));
  const totalVal = totals.reduce((s,a)=>s+Math.abs(a.value),0);
  if (totalVal>0) k.push({ label:"Total", value: totalVal, unit: (totals[0]?.currency || currencies[0] || "") });

  // Dedup by label
  const seen=new Set(); const out=[];
  for (const item of k){ const key=item.label.toLowerCase(); if (seen.has(key)) continue; seen.add(key); out.push(item); }
  return out.slice(0,16);
}
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
function findPercentNear(t, nearRx){
  const m=[...t.matchAll(/\b([+-]?\d{1,3}(?:\.\d+)?)\s*%\b/g)];
  if (!m.length) return null;
  let best=null, bestDist=1e9;
  for (const mm of m){
    const idx=mm.index||0;
    const dist=distanceToKeyword(t, idx, nearRx);
    if (dist<bestDist){ best=mm; bestDist=dist; }
  }
  const v=Number(best?.[1]); return isFinite(v)?v:null;
}
function findNumberNear(t, nearRx){
  const nums=[...t.matchAll(/\b([0-9]{1,4})(?:\.\d+)?\b/g)];
  let best=null, bestDist=1e9;
  for (const mm of nums){
    const idx=mm.index||0; const dist=distanceToKeyword(t, idx, nearRx);
    if (dist<bestDist){ best=mm; bestDist=dist; }
  }
  const v=Number(best?.[1]); return isFinite(v)?v:null;
}
function distanceToKeyword(t, idx, rx){
  let d=1e9; const M=[...t.matchAll(rx)];
  for (const m of M){ const i=m.index||0; const dd=Math.abs(i-idx); if (dd<d) d=dd; }
  return M.length?d:1e9;
}

/* ----- Health, Insights, Risks, Actions ----- */
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

  return risks.slice(0,8);
}
function buildActions(text, fh, kpis, risks){
  const out=[ { priority:1, action:"13-week cash flow forecast", owner:"Finance", dueDays:7 } ];
  if (fh.anomalyFlags.includes("Elevated DSO"))
    out.push({ priority:1, action:"Collections sprint + DSO dashboard", owner:"AR", dueDays:14 });
  if (risks.some(r=>/Cost inflation/.test(r.risk)))
    out.push({ priority:2, action:"COGS & pricing review", owner:"CFO", dueDays:14 });
  if (fh.concentrationRiskScore>=4)
    out.push({ priority:2, action:"Customer diversification plan", owner:"Sales", dueDays:30 });
  // dedupe
  const seen=new Set(); const ded=[]; for (const a of out){ const k=a.action.toLowerCase(); if (seen.has(k)) continue; seen.add(k); ded.push(a); }
  return ded.slice(0,10);
}

/* ----- Charts ----- */
function buildCharts(amounts, kpis){
  const bars=[...amounts].sort((a,b)=>Math.abs(b.value)-Math.abs(a.value)).slice(0,6)
    .map(a=>({ label:(a.label||"Amt").slice(0,12), value:Math.abs(Number(a.value)||0) }));

  const growth=kpis.find(k=>/growth/i.test(k.label))?.value ?? 0;
  const base=Math.max(50,(bars[0]?.value||120)/3);
  const lines=makeTrend(6,base,growth).map((y,i)=>({ x:MONTHS[i%12], y:Math.round(y) }));

  let pie=[];
  if (amounts.length){
    const byCur={}; for (const a of amounts){ const c=a.currency||"UNK"; byCur[c]=(byCur[c]||0)+Math.abs(Number(a.value)||0); }
    pie=Object.entries(byCur).map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value).slice(0,8);
  } else {
    const rev=kpis.find(k=>k.label==='Revenue')?.value||45;
    const cost=kpis.find(k=>k.label==='Cost')?.value||30;
    const prof=Math.max(0,(kpis.find(k=>/Margin/.test(k.label))?.value||25));
    pie=[{label:"Revenue",value:rev},{label:"Cost",value:cost},{label:"Profit",value:prof}];
  }
  return { bars, lines, pie };
}
function makeTrend(n, base, gPct){ const out=[]; let v=base; const step=(Number(gPct)||0)/Math.max(1,(n-1)); for(let i=0;i<n;i++){ out.push(Math.max(1,v)); v=v*(1+step/100); } return out; }
const MONTHS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/* ----- Summary & Confidence ----- */
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
