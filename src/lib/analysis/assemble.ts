import type {
  AnalysisDraft,
  AnalysisResult,
  Checkpoint,
  Consistency,
  Evidence,
  EvidenceAssignment,
  EvidenceStrength,
  Finding,
  FindingDraft,
  Packet,
  SentimentCounts,
  Snapshot,
  Target,
  ComparisonSectionDraft,
  ComparisonSection,
} from "@/types/analysis";
import { ensure, checkDraft, targetsFrom } from "./validation";
import { assertChinese, assertSchema } from "./schemas";
import { qualifyGap, prepareBrandReport } from "./brand";

const unique = <T>(xs: T[]) => [...new Set(xs)];
function comparable(
  snapshot: Snapshot,
  ids: string[],
  dimension: "platform" | "period",
) {
  const sources = snapshot.sources.filter((s) => ids.includes(s.sourceId));
  const strata = sources.map((s) =>
    dimension === "platform"
      ? `${s.brandId}|${s.productTopic}|${s.periodId}|${s.region}`
      : `${s.platformId}|${s.brandId}|${s.productTopic}|${s.region}`,
  );
  if (new Set(strata).size > 1) return false;
  if (dimension === "period") {
    const periods = unique(sources.map((s) => s.periodId));
    if (periods.includes(null)) return false;
    const ranges = periods
      .map((id) => sources.find((s) => s.periodId === id)!)
      .sort((a, b) => a.periodStart!.localeCompare(b.periodStart!));
    if (
      ranges.some((r, i) => i > 0 && r.periodStart! <= ranges[i - 1].periodEnd!)
    )
      return false;
  }
  return true;
}
export function normalizeConditional(
  input: AnalysisDraft,
  snapshot: Snapshot,
): AnalysisDraft {
  const draft = structuredClone(input);
  for (const [key, dimension] of [
    ["platformDifferences", "platform"],
    ["timeDifferences", "period"],
  ] as const) {
    const groups = snapshot.groups.filter((g) => g.dimension === dimension);
    const section = draft.conditional[key];
    if (groups.length < 2) {
      draft.conditional[key] = {
        status: "not_applicable",
        reasonZh:
          dimension === "platform"
            ? "当前只有一个有效平台。"
            : "不足两个已知时间范围，不能推断时间差异。",
        items: [],
      };
    } else {
      section.items = section.items.filter(
        (item) =>
          item.groups.every((g) =>
            groups.some((x) => x.groupId === g.groupId),
          ) &&
          comparable(
            snapshot,
            unique(
              item.groups.flatMap(
                (g) => groups.find((x) => x.groupId === g.groupId)!.sourceIds,
              ),
            ),
            dimension,
          ),
      );
      if (!section.items.length && section.status === "ready") {
        section.status = "insufficient_data";
        section.reasonZh =
          "样本的品牌、产品、地区或时间不具可比性，不能形成可靠差异结论。";
      }
      if (section.status === "not_applicable") {
        section.status = "insufficient_data";
        section.reasonZh = "虽存在多个来源组，但没有足够可比证据。";
      }
      if (section.status !== "ready") {
        section.reasonZh = `当前有 ${groups.length} 个${dimension === "platform" ? "平台" : "已知时间段"}，尚未形成通过核验的差异结论。需补充可比样本并控制品牌、平台、时间、产品与地区差异；这不代表不存在共同品牌或真实差异。`;
      }
    }
  }
  if (
    !snapshot.sources.some((s) => s.brandType === "own") ||
    !snapshot.sources.some((s) => s.brandType === "competitor")
  ) {
    draft.conditional.brandComparison = {
      status: "not_applicable",
      reasonZh: "需要同时包含自有品牌与竞品评论。",
      ownBrandStrengths: [],
      ownBrandWeaknesses: [],
      competitorStrengths: [],
      commonPainPoints: [],
      opportunityGaps: [],
    };
  }
  const ownSourceIds = new Set(
    snapshot.sources
      .filter((s) => s.brandType === "own")
      .map((s) => s.sourceId),
  );
  const ownGroupIds = snapshot.groups
    .filter(
      (g) =>
        g.dimension === "brand" &&
        g.sourceIds.some((id) => ownSourceIds.has(id)),
    )
    .map((g) => g.groupId);
  for (const finding of [
    ...draft.conditional.brandComparison.ownBrandStrengths,
    ...draft.conditional.brandComparison.ownBrandWeaknesses,
  ]) {
    finding.scopeGroupIds = ownGroupIds;
  }
  return draft;
}
function unavailable(
  status: Consistency["status"],
  reasonZh: string,
): Consistency {
  return {
    status,
    score: null,
    eligibleGroupCount: 0,
    supportingGroupCount: 0,
    reasonZh,
  };
}
function groupConsistency(
  snapshot: Snapshot,
  target: Target,
  dimension: "platform" | "period",
  support: string[],
  contradict: string[],
): Consistency {
  const groups = snapshot.groups.filter(
    (g) =>
      g.dimension === dimension &&
      g.sourceIds.some((id) => target.sourceIds.includes(id)),
  );
  if (groups.length < 2)
    return unavailable("not_applicable", "本结论范围不足两个有效组。");
  if (!comparable(snapshot, target.sourceIds, dimension))
    return unavailable(
      "insufficient_data",
      "来源存在混杂、未知日期或重叠时间，暂不计算一致性。",
    );
  const eligible = groups
    .map((g) => {
      const ids = unique(
        snapshot.chunks
          .filter(
            (c) =>
              g.sourceIds.includes(c.sourceId) &&
              target.sourceIds.includes(c.sourceId),
          )
          .map((c) => c.parentId),
      );
      return {
        n: ids.length,
        u: ids.filter((id) => support.includes(id)).length,
        c: ids.filter((id) => contradict.includes(id)).length,
      };
    })
    .filter((g) => g.n >= 10);
  if (eligible.length < 2)
    return unavailable(
      "insufficient_data",
      "不足两个各含至少 10 条记录的可比组。",
    );
  const supportingGroupCount = eligible.filter(
    (g) => g.u >= 3 && g.u > g.c,
  ).length;
  return {
    status: "measured",
    score: supportingGroupCount / eligible.length,
    eligibleGroupCount: eligible.length,
    supportingGroupCount,
    reasonZh: `${eligible.length} 个可比组中，${supportingGroupCount} 个组有至少 3 条同方向支持且支持多于反例。`,
  };
}
type Row = EvidenceAssignment["assignments"][number];
export function evidenceFor(
  target: Target,
  snapshot: Snapshot,
  packets: Packet[],
  assignments: EvidenceAssignment[],
  requested: string[] = [],
): Evidence {
  const rows = assignments
    .filter((a) => a.candidateId === target.id)
    .flatMap((a) => a.assignments);
  sameCoverage(rows, packets);
  const parent = new Map(packets.map((p) => [p.vocId, p.parentId]));
  const source = new Map(packets.map((p) => [p.vocId, p.sourceId]));
  const relevant = rows.filter((r) =>
    target.sourceIds.includes(source.get(r.vocId)!),
  );
  const support = unique(
    relevant
      .filter((r) => r.stance === "supports")
      .map((r) => parent.get(r.vocId)!),
  );
  const contradict = unique(
    relevant
      .filter((r) => r.stance === "contradicts")
      .map((r) => parent.get(r.vocId)!),
  );
  const qMap = new Map(
    packets.flatMap((p) => p.quotes).map((q) => [q.quoteId, q]),
  );
  const supportQ = unique(
    relevant.filter((r) => r.stance === "supports").flatMap((r) => r.quoteIds),
  );
  const contraQ = unique(
    relevant
      .filter((r) => r.stance === "contradicts")
      .flatMap((r) => r.quoteIds),
  );
  const validIds = [...supportQ, ...contraQ];
  const quoteIds = unique([
    ...requested.filter((id) => supportQ.includes(id)),
    ...supportQ,
  ]).slice(0, contraQ.length ? 4 : 5);
  if (contraQ.length) quoteIds.push(contraQ[0]);
  ensure(
    validIds.every((id) => qMap.has(id)),
    "证据台账包含未登记引文。",
  );
  const scopeVocCount = unique(
    packets
      .filter((p) => target.sourceIds.includes(p.sourceId))
      .map((p) => p.parentId),
  ).length;
  const crossPlatformConsistency = groupConsistency(
    snapshot,
    target,
    "platform",
    support,
    contradict,
  );
  const timeConsistency = groupConsistency(
    snapshot,
    target,
    "period",
    support,
    contradict,
  );
  let sentimentConsistency = unavailable(
    "not_applicable",
    "此结论不要求同方向情感。",
  );
  if (target.sentimentApplicable) {
    const byParent = new Map<string, Set<string>>();
    for (const r of relevant.filter(
      (r) => r.stance === "supports" || r.stance === "contradicts",
    )) {
      const id = parent.get(r.vocId)!;
      const values = byParent.get(id) ?? new Set<string>();
      values.add(r.aspectSentiment);
      byParent.set(id, values);
    }
    const clear = [...byParent.values()]
      .filter((v) => v.size === 1 && !v.has("mixed") && !v.has("unknown"))
      .map((v) => [...v][0]);
    if (clear.length >= 5 && clear.length / Math.max(byParent.size, 1) >= 0.7) {
      const dominant = Math.max(
        ...["positive", "neutral", "negative"].map(
          (s) => clear.filter((v) => v === s).length,
        ),
      );
      sentimentConsistency = {
        status: "measured",
        score: dominant / clear.length,
        eligibleGroupCount: clear.length,
        supportingGroupCount: dominant,
        reasonZh: `以相关方面的明确情感记录为单位，${clear.length} 条中主导情感为 ${dominant} 条；混合与未知未计入分母。`,
      };
    } else
      sentimentConsistency = unavailable(
        "insufficient_data",
        "明确情感不足 5 条或覆盖低于 70%。",
      );
  }
  const dimensions = [
    crossPlatformConsistency,
    timeConsistency,
    sentimentConsistency,
  ].filter((c) => c.status === "measured");
  const f = support.length >= 10 ? 1 : support.length >= 3 ? 0.5 : 0;
  const score =
    (0.4 * f + dimensions.reduce((n, c) => n + 0.2 * c.score!, 0)) /
    (0.4 + 0.2 * dimensions.length);
  const risky = snapshot.chunks.some(
    (c) =>
      support.includes(c.parentId) &&
      c.flags.some((f) => ["duplicate", "boundary", "long"].includes(f)),
  );
  const level =
    score >= 0.8 &&
    support.length >= 10 &&
    scopeVocCount >= 50 &&
    dimensions.length >= 2 &&
    !risky
      ? "High"
      : score >= 0.5 && support.length >= 3
        ? "Medium"
        : "Low";
  const strength: EvidenceStrength = {
    level,
    ruleVersion: "evidence-v1",
    mentionFrequency: {
      supportingVocCount: support.length,
      contradictingVocCount: contradict.length,
      scopeVocCount,
      supportRate: scopeVocCount ? support.length / scopeVocCount : null,
    },
    crossPlatformConsistency,
    timeConsistency,
    sentimentConsistency,
    reasonZh: `在 ${scopeVocCount} 条范围内记录中有 ${support.length} 条支持、${contradict.length} 条反例；${dimensions.length} 个一致性维度可测。${risky ? "存在重复或边界风险，等级最高为中。" : "等级表示样本内证据，不是统计置信度。"}`,
  };
  return {
    supportingVocIds: support,
    contradictingVocIds: contradict,
    sourceIds: unique(validIds.map((id) => qMap.get(id)!.sourceId)),
    representativeQuotes: quoteIds.map((id) => qMap.get(id)!),
    strength,
  };
}
function sameCoverage(rows: Row[], packets: Packet[]) {
  ensure(
    rows.length === packets.length &&
      new Set(rows.map((r) => r.vocId)).size === rows.length &&
      rows.every((r) => packets.some((p) => p.vocId === r.vocId)),
    "证据核验未覆盖完整输入，不能发布全局统计。",
  );
}
function sentimentCounts(
  snapshot: Snapshot,
  packets: Packet[],
): SentimentCounts {
  const counts: SentimentCounts = {
    positive: 0,
    neutral: 0,
    negative: 0,
    mixed: 0,
    unknown: 0,
  };
  for (const id of snapshot.includedVocIds) {
    const values = new Set(
      packets.filter((p) => p.parentId === id).map((p) => p.sentiment),
    );
    const label =
      values.has("mixed") || (values.has("positive") && values.has("negative"))
        ? "mixed"
        : values.has("unknown")
          ? "unknown"
          : values.has("positive")
            ? "positive"
            : values.has("negative")
              ? "negative"
              : "neutral";
    counts[label]++;
  }
  return counts;
}
export function assemble(
  checkpoint: Checkpoint,
  rawDraft: AnalysisDraft,
  packets: Packet[],
  assignments: EvidenceAssignment[],
): AnalysisResult {
  const snapshot = checkpoint.snapshot;
  ensure(
    packets.length === snapshot.chunks.length &&
      new Set(packets.map((p) => p.vocId)).size === snapshot.chunks.length &&
      snapshot.chunks.every((c) => packets.some((p) => p.vocId === c.id)),
    "抽取未覆盖全部评论。",
  );
  const draft = normalizeConditional(rawDraft, snapshot);
  checkDraft(
    draft,
    new Set(packets.flatMap((p) => p.quotes.map((q) => q.quoteId))),
    snapshot.groups.map((g) => g.groupId),
  );
  const targets = targetsFrom(
    draft,
    snapshot.groups,
    snapshot.sources.map((s) => s.sourceId),
  );
  const evidence = new Map(
    targets.map((t) => [t.id, evidenceFor(t, snapshot, packets, assignments)]),
  );
  for (const gap of draft.conditional.brandComparison.opportunityGaps) {
    const unmet = evidence.get(`${gap.id}:unmet`),
      fit = evidence.get(`${gap.id}:fit`);
    if (
      !unmet ||
      !fit ||
      !unmet.supportingVocIds.length ||
      !fit.supportingVocIds.length
    )
      continue;
    const supportingVocIds = unique([
      ...unmet.supportingVocIds,
      ...fit.supportingVocIds,
    ]);
    const contradictingVocIds = unique([
      ...unmet.contradictingVocIds,
      ...fit.contradictingVocIds,
    ]);
    evidence.set(gap.id, {
      supportingVocIds,
      contradictingVocIds,
      sourceIds: unique([...unmet.sourceIds, ...fit.sourceIds]),
      representativeQuotes: unique([
        ...unmet.representativeQuotes,
        ...fit.representativeQuotes,
      ]),
      strength: {
        ...unmet.strength,
        level: "Low",
        mentionFrequency: {
          supportingVocCount: supportingVocIds.length,
          contradictingVocCount: contradictingVocIds.length,
          scopeVocCount: snapshot.includedVocIds.length,
          supportRate: supportingVocIds.length / snapshot.includedVocIds.length,
        },
        crossPlatformConsistency: unavailable(
          "insufficient_data",
          "双边承接关系未经过独立跨平台验证。",
        ),
        timeConsistency: unavailable(
          "insufficient_data",
          "双边承接关系未经过时间验证。",
        ),
        sentimentConsistency: unavailable(
          "not_applicable",
          "机会组合竞品负面体验与自有正面体验，不以同向情绪衡量。",
        ),
        reasonZh:
          "竞品需求与自有品牌承接分别经过评论核验；组合机会仍为低强度、待验证假设。",
      },
    });
  }
  const decorate = (f: FindingDraft): Finding => ({
    ...f,
    evidence: evidence.get(f.id)!,
  });
  const supported = (xs: FindingDraft[]) =>
    xs.map(decorate).filter((f) => f.evidence.supportingVocIds.length > 0);
  const overall = {
    topTopics: supported(draft.overall.topTopics).sort(
      (a, b) =>
        b.evidence.supportingVocIds.length -
          a.evidence.supportingVocIds.length || a.id.localeCompare(b.id),
    ),
    painPoints: supported(draft.overall.painPoints),
    userNeeds: supported(draft.overall.userNeeds),
    purchaseDrivers: supported(draft.overall.purchaseDrivers),
    purchaseBarriers: supported(draft.overall.purchaseBarriers),
  };
  const counts = sentimentCounts(snapshot, packets);
  const quotes = unique(packets.flatMap((p) => p.quotes));
  const noScore = unavailable(
    "not_applicable",
    "总体情感为逐条分类汇总，不作单一结论证据评级。",
  );
  const sentimentEvidence: Evidence = {
    supportingVocIds: [],
    contradictingVocIds: [],
    sourceIds: [],
    representativeQuotes: [],
    strength: {
      level: "Low",
      ruleVersion: "evidence-v1",
      mentionFrequency: {
        supportingVocCount: 0,
        contradictingVocCount: 0,
        scopeVocCount: snapshot.includedVocIds.length,
        supportRate: 0,
      },
      crossPlatformConsistency: noScore,
      timeConsistency: noScore,
      sentimentConsistency: noScore,
      reasonZh: "该字段不承载独立事实断言，使用下方逐条情感计数。",
    },
  };
  // Overall sentiment prose is deterministic; no unchecked model-level summary assertion.
  const sentiment = {
    summaryZh: `本次 ${snapshot.includedVocIds.length} 条评论中：正面 ${counts.positive} 条、中立 ${counts.neutral} 条、负面 ${counts.negative} 条、混合 ${counts.mixed} 条、无法判断 ${counts.unknown} 条。`,
    evidence: sentimentEvidence,
    unit: "voc_record" as const,
    analyzedVocCount: snapshot.includedVocIds.length,
    counts,
  };
  const roleFor = (e: Evidence) =>
    unique(
      e.supportingVocIds.flatMap((id) =>
        snapshot.chunks
          .filter((c) => c.parentId === id)
          .map(
            (c) =>
              snapshot.sources.find((s) => s.sourceId === c.sourceId)!
                .brandType,
          ),
      ),
    );
  const b = draft.conditional.brandComparison;
  const brandComparison = {
    ...b,
    ownBrandStrengths: supported(b.ownBrandStrengths).filter((f) =>
      roleFor(f.evidence).every((r) => r === "own"),
    ),
    ownBrandWeaknesses: supported(b.ownBrandWeaknesses).filter((f) =>
      roleFor(f.evidence).every((r) => r === "own"),
    ),
    competitorStrengths: supported(b.competitorStrengths).filter(
      (f) =>
        roleFor(f.evidence).every((r) => r === "competitor") &&
        new Set(
          snapshot.sources
            .filter((s) => f.evidence.sourceIds.includes(s.sourceId))
            .map((s) => s.brandId),
        ).size === 1,
    ),
    commonPainPoints: supported(b.commonPainPoints).filter(
      (f) => roleFor(f.evidence).length === 2,
    ),
    opportunityGaps: b.opportunityGaps
      .filter(
        (f) =>
          evidence.get(`${f.id}:unmet`)?.supportingVocIds.length &&
          evidence.get(`${f.id}:fit`)?.supportingVocIds.length,
      )
      .map((f) =>
        qualifyGap(
          { ...decorate(f), qualification: f.qualification },
          snapshot.sources,
          packets,
        ),
      )
      .filter((f): f is NonNullable<typeof f> => !!f)
      .map((f) => ({
        ...f,
        summaryZh: `待验证机会假设：${f.summaryZh}`,
        limitationsZh: [
          ...f.limitationsZh,
          "仅针对当前样本中的未满足需求，不代表已证实的市场空白。",
        ],
      })),
  };
  if (
    brandComparison.status === "ready" &&
    ![
      ...brandComparison.ownBrandStrengths,
      ...brandComparison.ownBrandWeaknesses,
      ...brandComparison.competitorStrengths,
      ...brandComparison.commonPainPoints,
      ...brandComparison.opportunityGaps,
    ].length
  ) {
    brandComparison.status = "no_supported_finding";
    brandComparison.reasonZh = "逐条证据核验后未保留可支持的品牌结论。";
  }
  const comparisons = (section: ComparisonSectionDraft): ComparisonSection => {
    const items = section.items
      .filter((i) => overall.topTopics.some((t) => t.id === i.topicFindingId))
      .map((i) => ({
        ...i,
        groups: i.groups.map((g) => ({
          ...g,
          evidence: evidence.get(`${i.id}|${g.groupId}`)!,
        })),
      }))
      .filter((i) =>
        i.groups.every((g) => g.evidence.supportingVocIds.length > 0),
      );
    return section.status === "ready" && !items.length
      ? {
          status: "no_supported_finding",
          reasonZh: "逐条核验后不足以支持组间差异。",
          items: [],
        }
      : { ...section, items };
  };
  const insightCards = draft.insightCards
    .filter((i) => evidence.get(i.id)?.supportingVocIds.length)
    .map((i) => {
      const e = evidence.get(i.id)!;
      const need = overall.userNeeds.find((n) => n.id === i.userNeedFindingId);
      const { targetSegmentNeedId: _needId, ...rest } = i;
      void _needId;
      return {
        ...rest,
        userNeedFindingId: need?.id ?? null,
        painPointFindingId: overall.painPoints.some(
          (f) => f.id === i.painPointFindingId,
        )
          ? i.painPointFindingId
          : null,
        purchaseDriverFindingIds: i.purchaseDriverFindingIds.filter((id) =>
          overall.purchaseDrivers.some((f) => f.id === id),
        ),
        purchaseBarrierFindingIds: i.purchaseBarrierFindingIds.filter((id) =>
          overall.purchaseBarriers.some((f) => f.id === id),
        ),
        evidence: e,
        marketingImplicationZh: `建议作为待验证行动：${i.marketingImplicationZh}`,
        marketingPriority:
          (e.strength.level === "Low" ||
            (!need &&
              !i.painPointFindingId &&
              !i.purchaseDriverFindingIds.length &&
              !i.purchaseBarrierFindingIds.length)) &&
          i.marketingPriority.level === "High"
            ? {
                level: "Medium" as const,
                reasonZh: `证据偏少，先补充验证。${i.marketingPriority.reasonZh}`,
              }
            : i.marketingPriority,
        targetSegment: need
          ? {
              type: "need_based" as const,
              needFindingId: need.id,
              labelZh: `关注「${need.titleZh}」的人群`,
            }
          : null,
      };
    });
  const result: AnalysisResult = {
    schemaVersion: "1.0.0",
    language: "zh-CN",
    snapshotId: snapshot.id,
    runId: checkpoint.id,
    inputHash: snapshot.hash,
    createdAt: new Date().toISOString(),
    promptVersion: checkpoint.promptVersion,
    modelVersion: checkpoint.model,
    sources: snapshot.sources,
    groups: snapshot.groups,
    coverage: {
      status: "complete",
      includedVocCount: snapshot.includedVocIds.length,
      analyzedVocCount: snapshot.includedVocIds.length,
      failedVocIds: [],
      excludedDuplicateVocIds: snapshot.excludedDuplicateVocIds,
      unresolvedBoundaryVocCount: snapshot.unresolvedBoundaryVocCount,
    },
    overall: { ...overall, sentiment },
    conditional: {
      platformDifferences: comparisons(draft.conditional.platformDifferences),
      timeDifferences: comparisons(draft.conditional.timeDifferences),
      brandComparison,
    },
    insightCards,
    limitationsZh: unique([
      ...draft.limitationsZh,
      "这是当前粘贴样本的用户表达，不是独立用户统计、产品实测或总体市场结论。",
      "语义归类和译文由模型生成，可能误判；原文匹配不等于语义绝对正确。",
      ...(snapshot.includedVocIds.length < 50
        ? ["样本少于 50 条，仅供方向性参考。"]
        : []),
      ...(snapshot.unresolvedBoundaryVocCount
        ? ["存在未核对的拆分边界，统计单元可能不同于真实评论条数。"]
        : []),
      ...(snapshot.chunks.some((c) => c.flags.includes("duplicate"))
        ? ["用户纳入了疑似重复记录，可能放大提及频率。"]
        : []),
    ]),
  };
  assertSchema("result", result);
  assertChinese(result);
  for (const q of quotes) {
    const c = snapshot.chunks.find(
      (c) =>
        c.parentId === q.vocId &&
        c.sourceId === q.sourceId &&
        q.start >= c.start &&
        q.end <= c.end,
    );
    ensure(
      c &&
        c.original.slice(q.start - c.start, q.end - c.start) === q.originalText,
      "最终结果引文与原文不一致。",
    );
  }
  const qualified = prepareBrandReport(result);
  assertSchema("result", qualified);
  return qualified;
}
