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

      // Build the JSON body in whichever shape the server accepts
      const name = f?.name || "document.txt";
      const mime = f?.type || "text/plain";
      const base64 = f ? await fileToBase64(f) : btoa("Hello BizDoc from UI");

      let body;
      switch ("A") {
        case "A":
          body = { filename: name, mimetype: mime, base64, wantText: true };
          break;
        case "B":
          body = { filename: name, mimetype: mime, text: "Uploaded file (text field used)", wantText: true };
          break;
        case "C":
          body = { filename: name, mimetype: mime, content: "Uploaded file (content field used)", wantText: true };
          break;
        case "D":
          body = { filename: name, mimetype: mime, data: "Uploaded file (data field used)", wantText: true };
          break;
        default:
          body = { text: "Hello BizDoc minimal" };
      }

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
