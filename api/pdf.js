const fs=require('fs'); const path=require('path');

async function loadPdfLib(){
  try { return require('pdf-lib'); } catch(e1){
    const m = await import('pdf-lib'); return m;
  }
}
async function loadFontkit(){
  try { return require('@pdf-lib/fontkit'); } catch(e1){
    const m = await import('@pdf-lib/fontkit'); return m.default||m;
  }
}

const norm = s => String(s||'').replace(/\r\n/g,'\n');
const readFont = rel => fs.readFileSync(path.join(process.cwd(), rel));
function wrap(page,text,font,size,x,y0,maxW, rgb){
  const words=String(text||'').split(/\s+/); let line='', y=y0, lh=size*1.5;
  for(const w of words){
    const cand=line?line+' '+w:w;
    if(font.widthOfTextAtSize(cand,size)>maxW){ if(line) page.drawText(line,{x,y,size,font,color:rgb(0,0,0)}); y-=lh; line=w; }
    else line=cand;
  }
  if(line) page.drawText(line,{x,y,size,font,color:rgb(0,0,0)});
}

module.exports=async (req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  if(req.method==='OPTIONS') return res.status(204).end();

  try{
    const body= typeof req.body==='string' ? JSON.parse(req.body) : (req.body||{});
    const { title='BizDoc Report', text='', arabicText='', highlights=[] } = body;

    const { PDFDocument, rgb } = await loadPdfLib();
    const fontkit = await loadFontkit();

    // Create doc + register fontkit
    const pdf=await PDFDocument.create();
    pdf.registerFontkit(fontkit);

    // Ensure fonts exist (throw clear error if not)
    const pRegular = 'fonts/NotoSans-Regular.ttf';
    const pArabic  = 'fonts/NotoSansArabic.ttf';
    if (!fs.existsSync(path.join(process.cwd(), pRegular))) {
      throw new Error(`Missing font: ${pRegular}`);
    }
    const noto = await pdf.embedFont(readFont(pRegular), { subset:true });
    let arabic = noto;
    if (fs.existsSync(path.join(process.cwd(), pArabic))) {
      try { arabic = await pdf.embedFont(readFont(pArabic), { subset:true }); } catch {}
    }

    // Page 1
    const page=pdf.addPage([595.28,841.89]); const m=56; const {width,height}=page.getSize();
    page.drawText(norm(title),{x:m,y:height-m-20,size:22,font:noto,color:rgb(0,0,0)});
    let y=height-m-60;
    for(const h of (highlights||[]).slice(0,12)){
      page.drawText(`• ${h.label}: ${h.value}`,{x:m,y,size:11,font:noto,color:rgb(0,0,0)}); y-=18;
    }
    y-=10; wrap(page, norm(text), noto, 11, m, y, width-m*2, rgb);

    // Page 2 (Arabic) – simple block (for perfect shaping use a shaper upstream)
    if (arabicText){
      const p2=pdf.addPage([595.28,841.89]);
      p2.drawText('التحليل:',{x:m,y:p2.getSize().height-m-20,size:16,font:arabic,color:rgb(0,0,0)});
      wrap(p2, norm(arabicText), arabic, 12, m, p2.getSize().height-m-60, p2.getSize().width-m*2, rgb);
    }

    const bytes = await pdf.save();
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition','attachment; filename="BizDoc_Report.pdf"');
    return res.status(200).send(Buffer.from(bytes));
  }catch(e){
    // Emit stack to Vercel logs and return plaintext for quick diagnosis
    console.error('PDF_ERR:', e && e.stack ? e.stack : e);
    res.setHeader('Content-Type','text/plain; charset=utf-8');
    return res.status(500).send(`PDF generation failed:\n${e && e.stack ? e.stack : e}`);
  }
};
