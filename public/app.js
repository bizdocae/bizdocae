(async function () {
  const btn = document.getElementById("analyzeBtn") || document.querySelector("button");
  const fileInput = document.querySelector('input[type="file"]');
  const status = (msg, err=false) => {
    const el = document.getElementById("status") || document.querySelector("#statusBox");
    if (el) { el.textContent = msg; el.style.color = err ? "#b00020" : "#0b5"; }
  };
  async function toB64(f){ const b=new Uint8Array(await f.arrayBuffer()); let s=""; for(let i=0;i<b.length;i++) s+=String.fromCharCode(b[i]); return btoa(s); }

  btn.onclick = async () => {
    try {
      status("Analyzing…");
      const f = fileInput?.files?.[0];
      const body = {
        filename: f ? f.name : "document.txt",
        mimetype: f ? (f.type || "application/octet-stream") : "text/plain",
        base64: f ? await toB64(f) : btoa("No file uploaded."),
        wantText: true
      };

      // ChatGPT analysis on your backend
      const r = await fetch("/api/analyze", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`Analyze failed: ${r.status} ${await r.text()}`);
      const data = await r.json();
      const ai = data?.analysis || {};

      // Extract visible content
      const title = ai.title || "BizDoc Analysis";
      const exec  = ai.executive_summary || ai.summary || "No executive summary.";
      const kf = Array.isArray(ai.key_findings) ? ai.key_findings : [];
      const bullets = kf.slice(0,10).map(k=>({label:k.label||k.name||"Item", value:k.detail||k.value||""}));

      // Build PDF in the browser (no server PDF call)
      await window.generateClientPDF({
        title, text: exec, highlights: bullets,
        appendixText: JSON.stringify(ai).slice(0,3000)
      });

      status("✓ Downloaded PDF with ChatGPT analysis.");
    } catch (e) {
      console.error(e);
      status(`✗ ${e.message}`, true);
    }
  };
})();
