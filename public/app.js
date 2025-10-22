(async function () {
  const btn = document.getElementById("analyzeBtn") || document.querySelector("button");
  const fileInput = document.querySelector('input[type="file"]');
  const statusEl = document.getElementById("status") || document.querySelector("#statusBox");
  const setStatus=(t,e=false)=>{ if(statusEl){ statusEl.textContent=t; statusEl.style.color=e?"#b00020":"#0b5"; } };

  btn.onclick = async () => {
    try{
      setStatus("Analyzing…");
      const file = fileInput?.files?.[0];

      let res;
      if (file) {
        // ✅ Send multipart/form-data if a file was chosen
        const fd = new FormData();
        fd.append("file", file, file.name);
        fd.append("wantText", "true");
        res = await fetch("/api/analyze", { method:"POST", body: fd });
      } else {
        // Fallback: small JSON body if no file
        res = await fetch("/api/analyze", {
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({
            filename: "hello.txt",
            mimetype: "text/plain",
            base64: btoa("Hello BizDoc"),
            wantText: true
          })
        });
      }

      if (!res.ok) {
        const msg = await res.text().catch(()=>res.statusText);
        throw new Error(`Analyze failed: ${res.status} ${msg}`);
      }

      const data = await res.json();
      const ai = data?.analysis || {};

      // Extract key fields for PDF
      const title = ai.title || "BizDoc Analysis";
      const exec  = ai.executive_summary || ai.summary || "No executive summary.";
      const kf = Array.isArray(ai.key_findings) ? ai.key_findings : [];
      const bullets = kf.slice(0,10).map(k=>({label:k.label||k.name||"Item", value:k.detail||k.value||""}));

      await window.generateClientPDF({
        title,
        text: exec,
        highlights: bullets,
        appendixText: JSON.stringify(ai).slice(0,3000) // visible proof analysis came from backend
      });

      setStatus("✓ Downloaded PDF with ChatGPT analysis.");
    }catch(e){
      console.error(e);
      setStatus(`✗ ${e.message}`, true);
    }
  };
})();
