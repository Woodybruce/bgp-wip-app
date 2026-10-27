type InvestmentRequirement = {
  id: string;
  name?: string | null;
  ownName?: boolean;
  use_types?: unknown;
  requirement_types?: unknown;
  size_range?: unknown;
  requirement_locations?: unknown;
  locations?: unknown;
  comments?: unknown;
};

function recordedText(value: unknown): string {
  if (Array.isArray(value)) {
    return [...new Set(value.map(recordedText).filter(Boolean))].join(", ");
  }
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || text === "[]" || text === "{}") return "";
  if (text.startsWith("[")) {
    try { const parsed = JSON.parse(text); if (Array.isArray(parsed)) return recordedText(parsed); } catch { /* Plain recorded text. */ }
  }
  return text;
}

export function landlordInvestmentRequirementSummary(requirement: InvestmentRequirement) {
  const fields = [
    ["Use", recordedText(requirement.use_types)],
    ["Type", recordedText(requirement.requirement_types)],
    ["Size", recordedText(requirement.size_range)],
    ["Locations", recordedText(requirement.requirement_locations) || recordedText(requirement.locations)],
  ];
  const missing = fields.filter(([, value]) => !value).map(([label]) => label.toLowerCase());
  const notes = recordedText(requirement.comments);
  const excerpt = notes.length > 240 ? `${notes.slice(0, 240).replace(/\s+\S*$/, "")}…` : notes;
  return {
    title: !requirement.ownName && recordedText(requirement.name) || "Investment requirement",
    summary: fields.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`).join(" · "),
    missing: missing.length ? `Fields not recorded: ${missing.join(", ")}.` : "",
    notes,
    excerpt,
    href: `/requirements?type=investment&requirementId=${encodeURIComponent(requirement.id)}`,
  };
}
