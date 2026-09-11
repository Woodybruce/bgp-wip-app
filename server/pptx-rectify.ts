// OOXML requires every table row to have exactly the same number of cells as
// the header/column count. pptxgenjs emits whatever it's given, so a short or
// long row (common when the rows come from an LLM) makes the .pptx invalid →
// PowerPoint "found a problem with content → Repair", which strips the slide
// (the blue-screen bug). Pad short rows with blanks, drop any overflow.
export function rectifyRows(rows: any[][], ncol: number, blank: any = {}): any[][] {
  return rows.map((r) => {
    const row = Array.isArray(r) ? r.slice(0, ncol) : [];
    while (row.length < ncol) row.push({ text: "", options: { ...blank } });
    return row;
  });
}

// pptxgenjs emits two OOXML schema violations that make PowerPoint demand a
// "repair" (verified with Microsoft's OpenXmlValidator against real output):
//  1. presentation.xml children come out as sldMasterIdLst, sldIdLst,
//     notesMasterIdLst — but CT_Presentation requires notesMasterIdLst BEFORE
//     sldIdLst. This one is in EVERY pptxgenjs file.
//  2. In a multi-run paragraph (runs joined with breakLine:false), pptxgenjs
//     writes an <a:pPr> before every run; pPr is only legal as the paragraph's
//     first child.
// Run every generated .pptx buffer through this before saving/sending.
export async function fixPptxSchemaViolations(pptx: Buffer): Promise<Buffer> {
  try {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(pptx);
    const presPath = "ppt/presentation.xml";
    let pres = await zip.file(presPath)?.async("string");
    if (pres) {
      const m = pres.match(/<p:notesMasterIdLst>[\s\S]*?<\/p:notesMasterIdLst>/);
      if (m && pres.indexOf(m[0]) > pres.indexOf("<p:sldIdLst")) {
        pres = pres.replace(m[0], "").replace("<p:sldIdLst", `${m[0]}<p:sldIdLst`);
        zip.file(presPath, pres);
      }
    }
    for (const name of Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
      const xml = await zip.file(name)!.async("string");
      const fixed = xml.replace(/<a:p>([\s\S]*?)<\/a:p>/g, (_whole, inner: string) =>
        `<a:p>${inner.replace(/<a:pPr(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/a:pPr>)/g, (pp, off: number) => (off === 0 ? pp : ""))}</a:p>`);
      if (fixed !== xml) zip.file(name, fixed);
    }
    return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  } catch {
    return pptx; // never fail generation over schema polish
  }
}
