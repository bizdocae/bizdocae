export function tokenize(text="") {
  return String(text).toLowerCase().match(/[a-z0-9\u0600-\u06FF]+/gi) || [];
}
export function wordFreq(tokens) {
  const m = new Map();
  for (const t of tokens) m.set(t, (m.get(t)||0)+1);
  return [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);
}
export function basicStats(arr=[]) {
  const nums = (arr||[]).map(Number).filter(n=>Number.isFinite(n));
  const n = nums.length;
  if (!n) return { n:0 };
  const sum = nums.reduce((a,b)=>a+b,0);
  const mean = sum/n;
  const sorted=[...nums].sort((a,b)=>a-b);
  const p = q=>sorted[Math.floor((q*(n-1)))];
  const min=sorted[0], max=sorted[n-1], p50=p(0.5), p90=p(0.9);
  const variance = nums.reduce((a,b)=>a+(b-mean)**2,0)/n;
  const stdev = Math.sqrt(variance);
  return { n, min, p50, p90, max, sum, mean, stdev };
}
export function naiveSentiment(text="") {
  const pos=["good","great","excellent","strong","profit","growth","تحسن","قوي"];
  const neg=["bad","poor","weak","loss","decline","انخفاض","ضعيف","خسارة"];
  const t = text.toLowerCase();
  let score=0;
  for (const w of pos) if (t.includes(w)) score++;
  for (const w of neg) if (t.includes(w)) score--;
  return { score, label: score>0?"positive":score<0?"negative":"neutral" };
}
