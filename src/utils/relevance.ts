export type Relevance = "high" | "medium" | "low";

export function getRelevance(confidence: number): Relevance {
  if (confidence > 0.7) return "high";
  if (confidence >= 0.4) return "medium";
  return "low";
}
