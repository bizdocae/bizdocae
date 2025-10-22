const { PDFDocument, rgb } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");
const fs = require("fs"); const path = require("path");
const readFont = rel => fs.readFileSync(path.join(process.cwd(), rel));
const norm = s => String(s||"").replace(/\r\n/g,"\n");
const wrap = (page,text,font,size,x,y0,maxW) => {const w=String(text||"").split(/\s+/);let l="",y=y0,lh=size*1.5;
  for(const t of w){const c=l?l+" "+t:t; if(font.widthOfTextAtSize(c,size)>maxW){if(l)page.drawText(l,{x,y,size,font,color:rgb(0,0,0)}); y-=lh; l=t;}else l=c;}
  if(l) page.drawText(l,{x,y,size,font,color:rgb(0,0,0)});
};
module.exports = async (req,res)=>{res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization");
  if(req.method==="OPTIONS") return res.status(204).end();
  try{
    const body = typeof req.body==="string"?JSON.parse(req.body):(req.body||{});
    const { title="BizDoc Report", text="", arabicText="", highlights=[] } = body;
    const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
    const noto = await pdf.embedFont(readFont("fonts/NotoSans-Regular.ttf"), {subset:true});
    let arabic = noto; try{ arabic = await pdf.embedFont(readFont("fonts/NotoSansArabic.ttf"), {subset:true}); }catch{}
    const page = pdf.addPage([595.28,841.89]); const m=56; const {width,height}=page.getSize();
    page.drawText(norm(title),{x:m,y:height-m-20,size:22,font:noto,color:rgb(0,0,0)});
    let y=height-m-60; for(const h of (highlights||[]).slice(0,12)){page.drawText(`• ${h.label}: ${h.value}`,{x:m,y,size:11,font:noto,color:rgb(0,0,0)}); y-=18;}
    y-=10; wrap(page,norm(text),noto,11,m,y,width-m*2);
    if(arabicText){ const p2=pdf.addPage([595.28,841.89]);
      p2.drawText("التحليل:",{x:m,y:p2.getSize().height-m-20,size:16,font:arabic,color:rgb(0,0,0)});
      wrap(p2,norm(arabicText),arabic,12,m,p2.getSize().height-m-60,p2.getSize().width-m*2);
    }
    const bytes = await pdf.save();
    res.setHeader("Content-Type","application/pdf");
    res.setHeader("Content-Disposition",'attachment; filename="BizDoc_Report.pdf"');
    return res.status(200).send(Buffer.from(bytes));
  }catch(e){ return res.status(500).json({ok:false,error:`PDF generation failed: ${e.message}`}); }
};
