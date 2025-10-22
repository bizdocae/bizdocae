const fs=require('fs'),path=require('path');
module.exports=async(req,res)=>{
  const p1=path.join(process.cwd(),'fonts/NotoSans-Regular.ttf');
  const p2=path.join(process.cwd(),'fonts/NotoSansArabic.ttf');
  const ok1=fs.existsSync(p1), ok2=fs.existsSync(p2);
  const s1=ok1?fs.statSync(p1).size:0, s2=ok2?fs.statSync(p2).size:0;
  res.setHeader('Content-Type','application/json');
  res.status(200).send(JSON.stringify({cwd:process.cwd(),fonts:{regular:{path:p1,exists:ok1,size:s1},arabic:{path:p2,exists:ok2,size:s2}}}));
};
