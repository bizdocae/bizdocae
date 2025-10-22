async function generateClientPDF(payload) {
  const { PDFDocument, rgb } = window.PDFLib;
  const fontBytes = await fetch("/fonts/NotoSans-Regular.ttf").then(r=>r.arrayBuffer());
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(window.fontkit);
  const font = await pdf.embedFont(fontBytes, { subset:true });

  const { title="BizDoc Analysis", text="", highlights=[], appendixText="" } = payload||{};
  const A4=[595.28,841.89], m=56;
  const page = pdf.addPage(A4);
  const {width,height}=page.getSize();
  const norm = s => String(s||"").replace(/\r\n/g,"\n");

  page.drawText(norm(title), { x:m, y:height-m-20, size:22, font, color:rgb(0,0,0) });

  let y=height-m-60;
  for (const h of (highlights||[]).slice(0,15)) {
    page.drawText(`• ${h.label}: ${h.value}`, { x:m, y, size:11, font, color:rgb(0,0,0) });
    y-=18;
  }

  const wrap=(t,sz,x,startY,maxW)=>{
    const words=String(t||"").split(/\s+/); let line="", y=startY, lh=sz*1.5;
    for(const w of words){ const c=line?line+" "+w:w;
      if(font.widthOfTextAtSize(c,sz)>maxW){ if(line) page.drawText(line,{x,y,size:sz,font,color:rgb(0,0,0)}); y-=lh; line=w; }
      else line=c;
    }
    if(line) page.drawText(line,{x,y,size:sz,font,color:rgb(0,0,0)});
  };
  wrap(norm(text), 11, m, y-10, width-m*2);

  if (appendixText) {
    const p2 = pdf.addPage(A4);
    p2.drawText("Appendix: AI JSON (truncated)", { x:m, y:p2.getSize().height-m-20, size:14, font, color:rgb(0,0,0) });
    const words=String(appendixText).split(/\s+/); let line="", y2=p2.getSize().height-m-60, lh=10*1.5;
    for(const w of words){ const c=line?line+" "+w:w;
      if(font.widthOfTextAtSize(c,10)>(p2.getSize().width-m*2)){ if(line) p2.drawText(line,{x:m,y:y2,size:10,font,color:rgb(0,0,0)}); y2-=lh; line=w; if(y2<80) break; }
      else line=c;
    }
    if(line && y2>=80) p2.drawText(line,{x:m,y:y2,size:10,font,color:rgb(0,0,0)});
  }

  const bytes = await pdf.save();
  const blob = new Blob([bytes], { type:"application/pdf" });
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="BizDoc_Report.pdf";
  document.body.appendChild(a); a.click();
  URL.revokeObjectURL(a.href); a.remove();
}
window.generateClientPDF = generateClientPDF;
