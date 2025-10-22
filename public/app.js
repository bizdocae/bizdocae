(async function () {
  const btn = document.getElementById("analyzeBtn") || document.querySelector("button");
  const fileInput = document.querySelector('input[type="file"]');
  const statusBox = document.getElementById("status") || document.querySelector("#statusBox");
  const setStatus=(t,e=false)=>{ if(statusBox){ statusBox.textContent=t; statusBox.style.color=e?"#b00020":"#0b5"; } };

  async function readFileAsBase64(file){
    const buf=await file.arrayBuffer(); let s=""; const b=new Uint8Array(buf);
    for(let i=0;i<b.byteLength;i++) s+=String.fromCharCode(b[i]);
    return btoa(s);
  }

  btn.onclick = async () => {
    try{
      setStatus("Analyzing…");
      const f = fileInput?.files?.[0];
      const payload = {
        filename: f ? f.name : "document.txt",
        mimetype: f ? (f.type || "application/octet-stream") : "text/plain",
        base64: f ? await readFileAsBase64(f) : btoa("No file uploaded."),
        wantText: true
      };

      // 1) ChatGPT analysis on server
      const res = await fetch("/api/analyze", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify(payload)
      });
      if(!res.ok) throw new Error(`Analyze failed: ${res.status} ${await res.text()}`);

      const data = await res.json();
      const ai = data?.analysis || {};

      // 2) Extract fields for PDF (proof it’s ChatGPT content)
      const title = ai.title || "BizDoc Analysis";
      const exec  = ai.executive_summary || ai.summary || "No executive summary.";
      const kf = Array.isArray(ai.key_findings) ? ai.key_findings : [];
      const bullets = kf.slice(0,10).map(k=>({label:k.label||k.name||"Item", value:k.detail||k.value||""}));

      const fh = ai.financialHealth || {};
      const scores = [];
      if (fh.profitabilityScore!=null) scores.push({label:"Profitability", value:String(fh.profitabilityScore)});
      if (fh.liquidityScore!=null)     scores.push({label:"Liquidity",     value:String(fh.liquidityScore)});
      if (fh.concentrationRiskScore!=null) scores.push({label:"Concentration Risk", value:String(fh.concentrationRiskScore)});

      await window.generateClientPDF({
        title,
        text: exec,
        highlights: [...scores, ...bullets],
        appendixText: JSON.stringify(ai).slice(0,4000)
      });

      setStatus("✓ Downloaded PDF with ChatGPT analysis.");
    }catch(e){
      console.error(e); setStatus(`✗ ${e.message}`, true);
    }
  };
})();
