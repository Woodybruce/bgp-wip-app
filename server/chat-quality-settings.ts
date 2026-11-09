/** Quality settings for interactive chat only; shared/background work is unchanged. */
export function chatQualitySettings(model: string): {
  effort: "medium" | "high";
  max_completion_tokens: number;
} {
  // Check the actual model, including dated snapshots, rather than a preference
  // label: OPENAI_ADVANCED_MODEL may be overridden to a different model family.
  const isAstra = /^gpt-\d+(?:\.\d+)?-astra(?:-|$)/i.test(model);
  return {
    effort: isAstra ? "high" : "medium",
    // Responses counts reasoning and visible output together. More headroom
    // avoids cutting off substantive answers after Astra spends time reasoning.
    max_completion_tokens: isAstra ? 32768 : 16384,
  };
}
