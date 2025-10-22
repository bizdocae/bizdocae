(async function () {
  const btn = document.getElementById("analyzeBtn") || document.querySelector("button");
  const fileInput = document.querySelector('input[type="file"]');
  const statusBox = document.getElementById("status") || document.querySelector("#statusBox");

  function setStatus(html, isError=false) {
    if (!statusBox) return;
    statusBox.innerHTML = html;
    statusBox.style.color = isError ? "#b00020" : "#0b5";
  }

  async function readFileAsBase64(file) {
    const buf = await file.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  btn.onclick = async () => {
    try {
      setStatus("Analyzing…");
      const f = fileInput && fileInput.files && fileInput.files[0];
      const payload = {
        filename: f ? f.name : "document.txt",
        mimetype: f ? (f.type || "application/octet-stream") : "text/plain",
        base64: f ? await readFileAsBase64(f) : btoa("No file uploaded."),
        wantText: true
      };

      // 1) Run ChatGPT analysis on the server
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`Analyze failed: ${res.status} ${await res.text()}`);

      const data = await res.json();
      const ai = data?.analysis || {};

      // 2) Extract rich fields for the PDF
      const title = ai.title || "BizDoc Analysis";
      const exec  = ai.executive_summary || ai.summary || "No executive summary.";
      const kfArr = Array.isArray(ai.key_findings) ? ai.key_findings : [];
      const bullets = kfArr.slice(0, 10).map(k => ({
        label: k.label || k.name || "Item",
        value: k.detail || k.value || ""
      }));

      // Optional scores (if present)
      const fh = ai.financialHealth || {};
      const scores = [];
      if (fh.profitabilityScore != null) scores.push({label:"Profitability", value:String(fh.profitabilityScore)});
      if (fh.liquidityScore != null)     scores.push({label:"Liquidity",     value:String(fh.liquidityScore)});
      if (fh.concentrationRiskScore!=null) scores.push({label:"Concentration Risk", value:String(fh.concentrationRiskScore)});

      const appendixText = JSON.stringify(ai).slice(0, 4000); // short JSON appendix

      // 3) Build + download the PDF client-side
      await window.generateClientPDF({
        title,
        text: exec,
        highlights: [...scores, ...bullets],
        appendixText
      });

      // 4) Show a clear confirmation of what went into the PDF
      setStatus("✓ Downloaded PDF with ChatGPT analysis (title, summary, key findings).");
      console.log("AI analysis included in PDF:", { title, exec, bulletsCount: bullets.length, scores });
    } catch (e) {
      console.error(e);
      setStatus(`✗ ${e.message}`, true);
    }
  };
})();
