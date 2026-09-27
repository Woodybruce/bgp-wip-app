// Stored descriptions sometimes carry an appended research note tagged
// "[Propel Aug 2026] …" — show it as its own paragraph with the source in
// plain words, not a raw tag mid-sentence (Woody, 2026-09-27).
export function aboutText(description: string | null | undefined): string {
  return String(description || "")
    .replace(/\s*\[([A-Z][\w&.' -]{1,30}?)\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{4})\]\s*/g, "\n\n$1, $2: ")
    .trim();
}
