import { cors, isOptions } from "./_utils/cors.js";
import { tokenize, wordFreq, basicStats, naiveSentiment } from "./_utils/util.js";

export default async function handler(req, res) {
  cors(res);
  if (isOptions(req)) return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"Use POST" });

  try {
    const body = typeof req.body === "object" ? req.body : JSON.parse(req.body||"{}");
    const text = body.text ?? "";
    const numbers = Array.isArray(body.numbers) ? body.numbers : [];

    const tokens = tokenize(text);
    const wordsTop = wordFreq(tokens);
    const stats = basicStats(numbers);
    const sentiment = naiveSentiment(text);

    const analysis = {
      title: body.title || "BizDocAE Analysis",
      meta: { timestamp: new Date().toISOString() },
      text: { length: text.length, words: tokens.length, topWords: wordsTop, sentiment },
      numbers: { stats, series: numbers.slice(0,50) }
    };

    res.status(200).json({ ok:true, analysis });
  } catch (e) {
    res.status(400).json({ ok:false, error:String(e) });
  }
}
