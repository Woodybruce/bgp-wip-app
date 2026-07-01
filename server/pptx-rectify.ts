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
