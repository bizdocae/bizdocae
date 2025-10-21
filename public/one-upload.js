// Progress helpers
function setStage(t){ const el=document.getElementById('progressText'); if(el) el.textContent=t; }
function setPct(p){ const f=document.getElementById('progressFill'); if(f) f.style.width=Math.max(0,Math.min(100,Math.round(p)))+'%'; }

// Prefer refined report, fallback to basic
async function downloadPdfFromAnalysis(analysis){
  let resp = await fetch('/api/report-bizdoc-pdf-refined', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ analysis })
  });
  if (!resp.ok) {
    resp = await fetch('/api/report-bizdoc-pdf', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ analysis })
    });
  }
  if (!resp.ok) {
    const txt = await resp.text().catch(()=> '');
    throw new Error('PDF generation failed: ' + txt.slice(0,300));
  }
  const len = Number(resp.headers.get('content-length')||0);
  if (resp.body && len){
    const reader = resp.body.getReader(); let rec=0; const parts=[];
    while(true){
      const {done, value} = await reader.read(); if (done) break;
      parts.push(value); rec += value.length;
      const pct = 85 + (rec/len)*15; setPct(pct); setStage(`Generating PDF… ${Math.round((rec/len)*100)}%`);
    }
    return new Blob(parts, { type:'application/pdf' });
  }
  return await resp.blob();
}

async function oneButtonFlow(file){
  const out = document.getElementById('oneUploadOutput');
  const btn = document.getElementById('oneUploadBtn');
  if (!file) return alert('Pick a PDF first');
  if (file.type !== 'application/pdf') return alert('Please select a PDF');

  try{
    btn && (btn.disabled = true);
    setPct(0); setStage('Uploading…');

    // Upload & analyze with progress
    const analysis = await new Promise((resolve, reject)=>{
      const fd = new FormData(); fd.append('file', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST','/api/upload-local');
      xhr.upload.onprogress = (e)=>{
        if (e.lengthComputable){
          const pct = (e.loaded/e.total)*70;
          setPct(pct); setStage(`Uploading… ${Math.round((e.loaded/e.total)*100)}%`);
        }
      };
      xhr.onerror = ()=> reject(new Error('Network error during upload'));
      xhr.onload = ()=>{
        try{
          const j = JSON.parse(xhr.responseText || '{}');
          if (xhr.status>=200 && xhr.status<300 && j.ok){
            setPct(80); setStage('Analyzing…');
            resolve(j.analysis);
          } else {
            reject(new Error(j.error || `Upload/Analyze failed HTTP ${xhr.status}`));
          }
        }catch{ reject(new Error('Invalid JSON from server')); }
      };
      xhr.send(fd);
    });

    if (out) out.value = JSON.stringify(analysis, null, 2);

    setStage('Generating PDF…'); setPct(85);
    const blob = await downloadPdfFromAnalysis(analysis);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'bizdoc_report.pdf';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    setPct(100); setStage('Done');
  }catch(e){
    console.error(e);
    setPct(0); setStage('Error');
    alert(e.message || String(e));
  }finally{
    btn && (btn.disabled = false);
  }
}

document.addEventListener('DOMContentLoaded', ()=>{
  const input = document.getElementById('oneUploadInput');
  const btn = document.getElementById('oneUploadBtn');
  if (!input || !btn) return;
  btn.addEventListener('click', ()=> oneButtonFlow(input.files?.[0]));
});
