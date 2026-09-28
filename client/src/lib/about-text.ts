// Stored descriptions sometimes carry an appended research note tagged
// "[Propel Aug 2026] …" — show it as its own paragraph with the source in
// plain words, not a raw tag mid-sentence (Woody, 2026-09-27).
// Record-keeping notes ChatBGP wrote into the description ("Created by
// ChatBGP cleanup 28 Sep 2026 - agent firm identified from email domain…",
// "Added via ChatBGP when logging …") are provenance, not About copy — ~90
// agent boards opened on that sentence.
const PROVENANCE_RE = /(?:^|(?<=[.!?]\s))(?:Created|Added|Auto-created)\s+(?:by|via)\s+ChatBGP\b[^.!?]*(?:[.!?]|$)\s*/gi;

export function aboutText(description: string | null | undefined): string {
  return String(description || "")
    .replace(PROVENANCE_RE, "")
    .replace(/\s*\[([A-Z][\w&.' -]{1,30}?)\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{4})\]\s*/g, "\n\n$1, $2: ")
    .trim();
}
