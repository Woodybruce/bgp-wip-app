// Keep public-facing editorial copy consistent with the BGP rebrand, including
// older news and case studies supplied by the dashboard.
// Contact addresses and external destinations are managed separately.
export const brandCopy = (text: string): string =>
  text.replace(/\bBruce\s+Gillingham\s+(?:&\s+)?Pollard\b/gi, "BGP");
