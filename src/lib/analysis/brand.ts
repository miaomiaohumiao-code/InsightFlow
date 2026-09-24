import type {
  AnalysisResult,
  Finding,
  OpportunityQualification,
  SourceSnapshot,
  Quote,
  Insight,
  Packet,
} from "@/types/analysis";
export type QualifiedGap = Finding & {
  qualification?: OpportunityQualification;
};

export function opportunityEligible(
  gap: QualifiedGap,
  sources: SourceSnapshot[],
  quotes: Quote[] = gap.evidence.representativeQuotes,
): boolean {
  const q = gap.qualification;
  if (!q || !q.needZh.trim() || !q.ownBrandFitZh.trim() || !q.boundaryZh.trim())
    return false;
  if (
    new Set(sources.filter((s) => s.brandType === "own").map((s) => s.brandId))
      .size !== 1
  )
    return false;
  const competitorIds = new Set(
    sources.filter((s) => s.brandType === "competitor").map((s) => s.brandId),
  );
  if (
    !q.competitorBrandIds.length ||
    new Set(q.competitorBrandIds).size !== q.competitorBrandIds.length ||
    q.competitorBrandIds.some((id) => !competitorIds.has(id))
  )
    return false;
  const resolve = (id: string) => {
    const quote = quotes.find((v) => v.quoteId === id);
    const source = sources.find((s) => s.sourceId === quote?.sourceId);
    return { quote, source };
  };
  const unmet = q.unmetNeedEvidence.supportingQuoteIds.map(resolve),
    fit = q.ownBrandFitEvidence.supportingQuoteIds.map(resolve);
  const support = new Set(gap.evidence.supportingVocIds);
  if (!unmet.length || !fit.length) return false;
  if (
    unmet.some(
      ({ quote, source }) =>
        !quote ||
        !support.has(quote.vocId) ||
        source?.brandType !== "competitor" ||
        !q.competitorBrandIds.includes(source.brandId),
    )
  )
    return false;
  if (
    fit.some(
      ({ quote, source }) =>
        !quote || !support.has(quote.vocId) || source?.brandType !== "own",
    )
  )
    return false;
  if (
    q.competitorBrandIds.some(
      (id) => !unmet.some((v) => v.source?.brandId === id),
    )
  )
    return false;
  return true;
}
export function qualifyGap(
  gap: QualifiedGap,
  sources: SourceSnapshot[],
  packets: Packet[],
): QualifiedGap | undefined {
  const quotes = packets.flatMap((p) => p.quotes);
  if (!opportunityEligible(gap, sources, quotes)) return;
  const q = gap.qualification!;
  // A mention or general wish is insufficient: require an explicitly negative competitor aspect
  // and a positive own-brand experience, even when the transfer is only a potential fit.
  const polarity = (id: string, value: string) =>
    packets.some((p) =>
      p.aspects.some((a) => a.quoteIds.includes(id) && a.polarity === value),
    );
  if (
    q.unmetNeedEvidence.supportingQuoteIds.some(
      (id) => !polarity(id, "negative"),
    ) ||
    q.ownBrandFitEvidence.supportingQuoteIds.some(
      (id) => !polarity(id, "positive"),
    )
  )
    return;
  const ids = new Set([
    ...q.unmetNeedEvidence.supportingQuoteIds,
    ...q.unmetNeedEvidence.contradictingQuoteIds,
    ...q.ownBrandFitEvidence.supportingQuoteIds,
    ...q.ownBrandFitEvidence.contradictingQuoteIds,
  ]);
  return {
    ...gap,
    evidence: {
      ...gap.evidence,
      representativeQuotes: [
        ...new Map(
          [
            ...gap.evidence.representativeQuotes,
            ...quotes.filter((v) => ids.has(v.quoteId)),
          ].map((v) => [v.quoteId, v]),
        ).values(),
      ],
    },
  };
}
export function competitors(result: AnalysisResult) {
  return [
    ...new Map(
      result.sources
        .filter((s) => s.brandType === "competitor")
        .map((s) => [s.brandId, s]),
    ).values(),
  ].map((brand) => ({
    brandId: brand.brandId,
    label: brand.brandLabel,
    strengths: result.conditional.brandComparison.competitorStrengths.filter(
      (f) => {
        const sources = result.sources.filter((s) =>
          f.evidence.sourceIds.includes(s.sourceId),
        );
        return (
          sources.length > 0 &&
          sources.every((s) => s.brandId === brand.brandId)
        );
      },
    ),
  }));
}
export function prepareBrandReport(original: AnalysisResult): AnalysisResult {
  const result = structuredClone(original),
    brand = result.conditional.brandComparison;
  // A cross-brand finding cannot safely attribute its whole summary to one brand.
  // Keep the finding and source-labelled quotes, but withhold that free-text attribution.
  const labels = result.sources.map((s) => s.brandLabel.trim()).filter(Boolean);
  for (const findings of [
    result.overall.topTopics,
    result.overall.painPoints,
    result.overall.userNeeds,
    result.overall.purchaseDrivers,
    result.overall.purchaseBarriers,
  ]) {
    for (const finding of findings) {
      const mentioned = labels.filter((label) =>
        finding.summaryZh.toLowerCase().includes(label.toLowerCase()),
      );
      if (!mentioned.length) continue;
      const evidenceBrands = new Set(
        result.sources
          .filter((s) => finding.evidence.sourceIds.includes(s.sourceId))
          .map((s) => s.brandLabel),
      );
      if (
        evidenceBrands.size !== 1 ||
        mentioned.some((label) => !evidenceBrands.has(label))
      ) {
        finding.summaryZh = `该主题涉及不同来源的反馈。品牌归属请以“查看原文与依据”中每条评论标注的来源为准。`;
        finding.limitationsZh = [
          ...new Set([
            ...finding.limitationsZh,
            "原摘要含未经逐项核验的品牌归属，已隐藏该摘要；主题与原始证据保留，不能据此认定某一品牌具备全部反馈特征。",
          ]),
        ];
      }
    }
  }
  // Unsupported comparison explanations must not contradict source metadata elsewhere.
  result.limitationsZh = result.limitationsZh.map((text) =>
    /平台|跨渠道|跨期|时间比较/.test(text) && /缺少|不存在|没有|未在/.test(text)
      ? "平台与时间差异需使用可比样本进一步验证；当前来源的品牌、平台与时间可能互相影响，不能据此归因。"
      : text,
  );
  for (const [key, field, label] of [
    ["platformDifferences", "platformId", "平台"],
    ["timeDifferences", "periodId", "已知时间段"],
  ] as const) {
    const section = result.conditional[key];
    const count = new Set(result.sources.map((s) => s[field]).filter(Boolean))
      .size;
    if (section.status !== "ready" && count >= 2)
      section.reasonZh = `当前有 ${count} 个${label}，尚未形成通过核验的差异结论。需补充可比样本并控制品牌、平台、时间、产品与地区差异；这不代表不存在共同品牌或真实差异。`;
  }
  const rejected = brand.opportunityGaps.filter(
    (g) => !opportunityEligible(g, result.sources),
  );
  brand.opportunityGaps = brand.opportunityGaps.filter((g) =>
    opportunityEligible(g, result.sources),
  );
  if (rejected.length)
    result.limitationsZh = [
      ...new Set([
        ...result.limitationsZh,
        `${rejected.length} 条旧机会或候选缺少竞品未满足需求与自有品牌承接的双边证据，已从机会数量及转化入口中排除。请重新分析补齐证据链。`,
      ]),
    ];
  result.insightCards = result.insightCards.filter(
    (i) =>
      !i.originOpportunityId ||
      brand.opportunityGaps.some((g) => g.id === i.originOpportunityId),
  );
  for (const gap of brand.opportunityGaps) {
    if (result.insightCards.some((i) => i.originOpportunityId === gap.id))
      continue;
    const q = gap.qualification!;
    const names = q.competitorBrandIds
      .map(
        (id) => result.sources.find((s) => s.brandId === id)?.brandLabel ?? id,
      )
      .join("、");
    const insight: Insight = {
      id: `opportunity-insight:${gap.id}`,
      originOpportunityId: gap.id,
      titleZh: `机会洞察：${gap.titleZh}`,
      userNeedFindingId: null,
      painPointFindingId: null,
      purchaseDriverFindingIds: [],
      purchaseBarrierFindingIds: [],
      targetSegment: null,
      evidence: gap.evidence,
      marketingImplicationZh: `待验证营销机会。竞品 ${names} 用户需求：${q.needZh}。自有品牌${q.fitStatus === "observed" ? "存在相关体验证据" : "存在潜在承接线索"}：${q.ownBrandFitZh}。需验证：${q.boundaryZh}。不得将当前用户表达直接写成产品性能或竞争优势承诺。`,
      marketingPriority: {
        level: gap.evidence.strength.level === "Low" ? "Low" : "Medium",
        reasonZh:
          "机会有双边证据，但承接能力与可比性仍需验证，不自动列为最高优先级。",
      },
      limitationsZh: [
        ...gap.limitationsZh,
        q.boundaryZh,
        "来自 VOC 的能力线索不是产品实测证明；投放前核实。",
      ],
    };
    result.insightCards.push(insight);
  }
  return result;
}
