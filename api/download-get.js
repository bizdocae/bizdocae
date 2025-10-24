import { cors, isOptions } from "./_utils/cors.js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import JSZip from "jszip";

function asTxt(res, text, filename = "analysis.txt") {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.status(200).send(String(text ?? ""));
}

async function asPdf(res, text, filename = "BizDoc_Report.pdf") {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let y = 800;

  page.drawText("BizDocAE — Analysis", { x: 40, y, size: 16, font, color: rgb(0,0,0) });
  y -= 30;

  const lines = String(text || "PDF OK").split(/\r?\n/);
  for (const line of lines) {
    page.drawText(line.slice(0, 100), { x: 40, y, size: 12, font });
    y -= 16; if (y < 40) break;
  }

  const bytes = await pdf.save();
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.status(200).send(Buffer.from(bytes));
}

async function asDocx(res, text, filename = "BizDoc_Report.docx") {
  const safe = String(text || "DOCX OK").replace(/&/g,"&amp;").replace(/</g,"&lt;");
  const zip = new JSZip();

  zip.file("[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>
     <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
       <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
       <Default Extension="xml" ContentType="application/xml"/>
       <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
     </Types>`.replace(/\n\s+/g,"")
  );

  zip.folder("_rels").file(".rels",
    `<?xml version="1.0" encoding="UTF-8"?>
     <Relationships xmlns="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
       <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
     </Relationships>`.replace(/\n\s+/g,"")
  );

  zip.folder("word").file("document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
     <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
       <w:body>
         <w:p><w:r><w:t>BizDocAE — Analysis</w:t></w:r></w:p>
         <w:p><w:r><w:t>${safe}</w:t></w:r></w:p>
       </w:body>
     </w:document>`.replace(/\n\s+/g,"")
  );

  const buf = await zip.generateAsync({ type: "nodebuffer" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.status(200).send(buf);
}

export default async function handler(req, res) {
  cors(res);
  if (isOptions(req)) return res.status(204).end();

  const { type = "txt", text = "" } = req.query || {};
  try {
    if (type === "pdf")  return await asPdf(res, text);
    if (type === "docx") return await asDocx(res, text);
    return asTxt(res, text);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
}
