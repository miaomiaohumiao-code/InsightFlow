import type { AnalysisResult, Insight, Level } from "@/types/analysis";
import { opportunityEligible } from "@/lib/analysis/brand";

export type InsightSort = "original" | "evidence" | "priority";
export type InsightSelection = { selectedIds: string[]; sort: InsightSort };
export const levelLabel: Record<Level, string> = {
  High: "高",
  Medium: "中",
  Low: "低",
};
const rank: Record<Level, number> = { High: 3, Medium: 2, Low: 1 };

export function insightMetrics(result: AnalysisResult) {
  return {
    voc: result.coverage.includedVocCount,
    topics: result.overall.topTopics.length,
    highEvidence: result.insightCards.filter(
      (i) => i.evidence.strength.level === "High",
    ).length,
    opportunities: result.conditional.brandComparison.opportunityGaps.filter(
      (g) => opportunityEligible(g, result.sources),
    ).length,
  };
}
export function conditionalVisibility(result: AnalysisResult) {
  return {
    platforms: new Set(result.sources.map((s) => s.platformId)).size > 1,
    periods:
      new Set(result.sources.map((s) => s.periodId).filter(Boolean)).size > 1,
    brands: result.sources.some((s) => s.brandType === "competitor"),
  };
}
export function sortInsights(
  insights: Insight[],
  sort: InsightSort,
): Insight[] {
  return insights
    .map((insight, index) => ({ insight, index }))
    .sort((a, b) => {
      const score = (i: Insight) =>
        sort === "evidence"
          ? rank[i.evidence.strength.level]
          : sort === "priority"
            ? rank[i.marketingPriority.level]
            : 0;
      return score(b.insight) - score(a.insight) || a.index - b.index;
    })
    .map((x) => x.insight);
}
export function selectionKey(projectId: string, result: AnalysisResult) {
  return `insightflow:selection:${projectId}:${result.runId}:${result.inputHash}`;
}
export function readSelection(
  raw: string | null,
  insights: Insight[],
): InsightSelection {
  const empty: InsightSelection = { selectedIds: [], sort: "original" };
  if (!raw) return empty;
  try {
    const data = JSON.parse(raw);
    const ids = new Set(insights.map((i) => i.id));
    return {
      selectedIds: Array.isArray(data?.selectedIds)
        ? ([
            ...new Set(
              data.selectedIds.filter(
                (id: unknown): id is string =>
                  typeof id === "string" && ids.has(id),
              ),
            ),
          ] as string[])
        : [],
      sort: ["original", "evidence", "priority"].includes(data?.sort)
        ? data.sort
        : "original",
    };
  } catch {
    return empty;
  }
}
export function percent(value: number | null) {
  return value === null ? "暂无比例" : `${Math.round(value * 100)}%`;
}
