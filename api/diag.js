export default function handler(req,res){
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.status(200).end(JSON.stringify({
    ok: true,
    node: process.versions.node,
    hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY)
  }));
}
