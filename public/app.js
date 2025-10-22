(async function () {
  const btn = document.getElementById("analyzeBtn") || document.querySelector("button");
  const fileInput = document.querySelector('input[type="file"]');
  const statusEl = document.getElementById("status") || document.querySelector("#statusBox");
  const setStatus=(t,e=false)=>{ if(statusEl){ statusEl.textContent=t; statusEl.style.color=e?"#b00020":"#0b5"; } };

  async function fileToBase64(file){
    const buf = await file.arrayBuffer();
    let s = ""; const b = new Uint8Array(buf);
    for (let i = 0; i < b.byteLength; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }

  btn.onclick = async () => {
    try {
      setStatus("Analyzing…");
      const f = fileInput?.files?.[0];

      // Build JSON shape your backend requires:
      //   filename (string) + fileBase64 (string) [+ mimetype, wantText]
      const body = f
        ? {
            filename: f.name,
            fileBase64: await fileToBase64(f),
            mimetype: f.type || "application/octet-stream",
            wantText: true
          }
        : {
            filename: "hello.txt",
            fileBase64: btoa("Hello BizDoc (no file selected)"),
            mimetype: "text/plain",
            wantText: true
          };

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(`Analyze failed: ${res.status} ${await res.text()}`);

      const data = await res.json();
      const ai = data?.analysis || {};
      const title = ai.title || "BizDoc Analysis";
      const exec  = ai.executive_summary || ai.summary || "No executive summary.";
      const kf    = Array.isArray(ai.key_findings) ? ai.key_findings : [];
      const bullets = kf.slice(0,10).map(k=>({label:k.label||k.name||"Item", value:k.detail||k.value||""}));

      await window.generateClientPDF({
        title,
        text: exec,
        highlights: bullets,
        appendixText: JSON.stringify(ai).slice(0,3000)
      });

      setStatus("✓ Downloaded PDF with ChatGPT analysis.");
    } catch (e) {
      console.error(e);
      setStatus(`✗ ${e.message}`, true);
    }
  };
})();
