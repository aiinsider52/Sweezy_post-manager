export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface UsageRecord extends TokenUsage {
  model: string;
  estimatedCostUsd: number;
  kind: "text" | "image";
}

/** Approximate public list prices — good enough for admin /stats. */
const TEXT_RATES: Record<string, { inPerM: number; outPerM: number }> = {
  "gpt-4.1-mini": { inPerM: 0.4, outPerM: 1.6 },
  "gpt-4.1": { inPerM: 2, outPerM: 8 },
  "gpt-4o-mini": { inPerM: 0.15, outPerM: 0.6 },
  "gpt-4o": { inPerM: 2.5, outPerM: 10 }
};

const IMAGE_COST: Record<string, number> = {
  "gpt-image-1": 0.08
};

export function estimateTextCostUsd(model: string, usage: TokenUsage): number {
  const rates = TEXT_RATES[model] ?? { inPerM: 0.5, outPerM: 2 };
  return (usage.promptTokens / 1_000_000) * rates.inPerM + (usage.completionTokens / 1_000_000) * rates.outPerM;
}

export function estimateImageCostUsd(model: string): number {
  return IMAGE_COST[model] ?? 0.08;
}

export function usageFromCompletion(
  model: string,
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null | undefined
): UsageRecord {
  const promptTokens = usage?.prompt_tokens ?? 0;
  const completionTokens = usage?.completion_tokens ?? 0;
  const totalTokens = usage?.total_tokens ?? promptTokens + completionTokens;
  const record: TokenUsage = { promptTokens, completionTokens, totalTokens };
  return {
    ...record,
    model,
    kind: "text",
    estimatedCostUsd: estimateTextCostUsd(model, record)
  };
}

export function imageUsageRecord(model: string): UsageRecord {
  return {
    model,
    kind: "image",
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: estimateImageCostUsd(model)
  };
}
