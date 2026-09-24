import type {
  AnalysisDraft,
  BatchExtraction,
  Chunk,
  Packet,
  Quote,
  Task,
  TaskValue,
  EvidenceAssignment,
  Target,
} from "@/types/analysis";
import { assertChinese, assertSchema } from "./schemas";

export function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function sameIds(
  expected: string[],
  actual: string[],
  context = "返回记录",
) {
  ensure(
    new Set(actual).size === actual.length &&
      [...expected].sort().join("\0") === [...actual].sort().join("\0"),
    `${context} ID 缺失、重复或越界。缺失：${expected.filter((id) => !actual.includes(id)).join(", ")}；重复：${[...new Set(actual.filter((id, i) => actual.indexOf(id) !== i))].join(", ")}；越界：${actual.filter((id) => !expected.includes(id)).join(", ")}`,
  );
}
export function packetsFrom(batch: BatchExtraction, chunks: Chunk[]): Packet[] {
  sameIds(
    chunks.map((c) => c.id),
    batch.records.map((r) => r.vocId),
  );
  return batch.records.map((r) => {
    const chunk = chunks.find((c) => c.id === r.vocId)!;
    ensure(
      r.status === "analyzed" || !!r.reasonZh,
      "未能分析的记录必须说明原因。",
    );
    const quotes: Quote[] = [];
    const aspects = r.aspects.map((a) => {
      ensure(a.quotes.length > 0, "提取的主题缺少原文证据。");
      const quoteIds = a.quotes.map((q) => {
        const at = chunk.original.indexOf(q.originalText);
        ensure(
          q.originalText.trim() &&
            at >= 0 &&
            chunk.original.indexOf(q.originalText, at + 1) < 0,
          "引文不是唯一连续原文，请扩大上下文后逐字摘录。",
        );
        const quoteId = `q:${chunk.id}:${at}:${q.originalText.length}`;
        if (!quotes.some((q) => q.quoteId === quoteId))
          quotes.push({
            quoteId,
            vocId: chunk.parentId,
            sourceId: chunk.sourceId,
            start: chunk.start + at,
            end: chunk.start + at + q.originalText.length,
            originalText: q.originalText,
            translationZh: q.translationZh,
          });
        return quoteId;
      });
      if (a.category === "user_need")
        ensure(!demographic.test(a.labelZh), "需求标签不能包含人口属性。");
      return {
        category: a.category,
        labelZh: a.labelZh,
        assertionZh: a.assertionZh,
        polarity: a.polarity,
        quoteIds,
      };
    });
    return {
      vocId: r.vocId,
      parentId: chunk.parentId,
      sourceId: chunk.sourceId,
      sentiment: r.status === "analyzed" ? r.sentiment : "unknown",
      aspects,
      quotes,
    };
  });
}
const demographic =
  /年龄|性别|职业|收入|男性|女性|男人|女人|男生|女生|学生|白领|上班族|宝妈|老人|老年|年轻|中年|\d+\s*岁|高薪|低薪|大学生|程序员|医生|教师|退休|富裕|贫困|[男女]性用户/u;

export function referencedQuotes(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, v]) =>
    key === "supportingQuoteIds" || key === "contradictingQuoteIds"
      ? (v as string[])
      : Array.isArray(v)
        ? v.flatMap(referencedQuotes)
        : referencedQuotes(v),
  );
}
export function checkDraft(
  draft: AnalysisDraft,
  allowedQuotes: Set<string>,
  sourceGroups: string[],
) {
  const findings = [
    ...draft.overall.topTopics,
    ...draft.overall.painPoints,
    ...draft.overall.userNeeds,
    ...draft.overall.purchaseDrivers,
    ...draft.overall.purchaseBarriers,
    ...draft.conditional.brandComparison.ownBrandStrengths,
    ...draft.conditional.brandComparison.ownBrandWeaknesses,
    ...draft.conditional.brandComparison.competitorStrengths,
    ...draft.conditional.brandComparison.commonPainPoints,
    ...draft.conditional.brandComparison.opportunityGaps,
  ];
  const ids = [
    ...findings.map((f) => f.id),
    ...draft.insightCards.map((i) => i.id),
    ...draft.conditional.platformDifferences.items.map((i) => i.id),
    ...draft.conditional.timeDifferences.items.map((i) => i.id),
  ];
  ensure(new Set(ids).size === ids.length, "结论 ID 必须唯一。");
  ensure(
    ids.length <= 60,
    "报告结论超过预算，请合并相近主题并控制在 60 项以内。",
  );
  for (const q of referencedQuotes(draft))
    ensure(allowedQuotes.has(q), "报告引用了未登记的引文 ID。");
  for (const f of findings) {
    ensure(f.evidence.supportingQuoteIds.length, "结论缺少支持证据。");
    ensure(
      f.scopeGroupIds.every((id) => sourceGroups.includes(id)),
      "结论范围引用未知来源组。",
    );
  }
  for (const need of draft.overall.userNeeds)
    ensure(!demographic.test(need.titleZh), "需求型人群不得包含人口属性。");
  for (const i of draft.insightCards) {
    ensure(i.evidence.supportingQuoteIds.length, "Insight 缺少支持证据。");
    ensure(
      i.targetSegmentNeedId === i.userNeedFindingId,
      "人群只能引用该 Insight 的需求。",
    );
    ensure(
      i.userNeedFindingId === null ||
        draft.overall.userNeeds.some((n) => n.id === i.userNeedFindingId),
      "Insight 需求引用无效。",
    );
    ensure(
      i.painPointFindingId === null ||
        draft.overall.painPoints.some((n) => n.id === i.painPointFindingId),
      "Insight 痛点引用无效。",
    );
    ensure(
      i.purchaseDriverFindingIds.every((id) =>
        draft.overall.purchaseDrivers.some((n) => n.id === id),
      ),
      "购买驱动引用无效。",
    );
    ensure(
      i.purchaseBarrierFindingIds.every((id) =>
        draft.overall.purchaseBarriers.some((n) => n.id === id),
      ),
      "购买障碍引用无效。",
    );
  }
  for (const section of [
    draft.conditional.platformDifferences,
    draft.conditional.timeDifferences,
  ]) {
    ensure(
      section.status === "ready"
        ? section.items.length > 0
        : section.items.length === 0 && !!section.reasonZh,
      "比较模块状态与内容不一致。",
    );
    for (const item of section.items) {
      ensure(
        draft.overall.topTopics.some((t) => t.id === item.topicFindingId),
        "比较未关联有效主题。",
      );
      ensure(
        item.groups.length >= 2 &&
          new Set(item.groups.map((g) => g.groupId)).size ===
            item.groups.length,
        "比较必须包含至少两个不同来源组。",
      );
      ensure(
        item.groups.every(
          (g) =>
            sourceGroups.includes(g.groupId) &&
            g.evidence.supportingQuoteIds.length > 0,
        ),
        "比较来源组或证据无效。",
      );
    }
  }
  const brand = draft.conditional.brandComparison;
  for (const strength of brand.competitorStrengths) {
    ensure(
      strength.scopeGroupIds.length === 1 &&
        strength.scopeGroupIds[0].startsWith("brand:competitor:"),
      "每条竞品优势必须只归属一个竞品品牌组。",
    );
  }
  for (const gap of brand.opportunityGaps) {
    const q = gap.qualification;
    ensure(!!q && !demographic.test(q.needZh), "机会需求不得假设人口属性。");
    ensure(
      q.competitorBrandIds.length > 0 &&
        q.competitorBrandIds.every((id) => sourceGroups.includes(id)),
      "机会竞品引用无效。",
    );
    ensure(
      q.unmetNeedEvidence.supportingQuoteIds.length > 0 &&
        q.ownBrandFitEvidence.supportingQuoteIds.length > 0,
      "机会必须有竞品未满足需求及自有承接证据。",
    );
    ensure(
      [
        ...q.unmetNeedEvidence.supportingQuoteIds,
        ...q.ownBrandFitEvidence.supportingQuoteIds,
      ].every((id) => gap.evidence.supportingQuoteIds.includes(id)),
      `机会 ${gap.id} 的双边支持证据必须纳入主证据。`,
    );
    ensure(
      [
        ...q.unmetNeedEvidence.contradictingQuoteIds,
        ...q.ownBrandFitEvidence.contradictingQuoteIds,
      ].every((id) => gap.evidence.contradictingQuoteIds.includes(id)),
      `机会 ${gap.id} 的双边反例必须纳入主证据。`,
    );
  }
  const brandItems = [
    ...brand.ownBrandStrengths,
    ...brand.ownBrandWeaknesses,
    ...brand.competitorStrengths,
    ...brand.commonPainPoints,
    ...brand.opportunityGaps,
  ];
  ensure(
    brand.status === "ready"
      ? brandItems.length > 0
      : brandItems.length === 0 && !!brand.reasonZh,
    "品牌模块状态与内容不一致。",
  );
}
export function constrainAssignmentScope(
  task: Task,
  data: TaskValue,
): TaskValue {
  if (task.kind !== "assign") return data;
  assertSchema("assign", data);
  const result = structuredClone(data) as { results: EvidenceAssignment[] };
  for (const candidate of result.results) {
    const target = task.input.targets.find(
      (t) => t.id === candidate.candidateId,
    );
    for (const assignment of candidate.assignments) {
      const packet = task.input.packets.find(
        (p) => p.vocId === assignment.vocId,
      );
      if (target && packet && !target.sourceIds.includes(packet.sourceId)) {
        assignment.stance = "not_mentioned";
        assignment.quoteIds = [];
        assignment.aspectSentiment = "unknown";
      }
    }
  }
  return result;
}
export function validateTask(task: Task, data: TaskValue) {
  assertSchema(task.kind, data);
  assertChinese(data);
  if (task.kind === "extract") {
    const value = data as BatchExtraction;
    ensure(
      value.snapshotId === task.input.snapshotId &&
        value.batchId === task.input.batchId,
      "抽取快照或批次不匹配。",
    );
    packetsFrom(value, task.input.records);
  } else if (task.kind === "aggregate") {
    const draft = data as AnalysisDraft;
    ensure(draft.snapshotId === task.input.snapshotId, "聚合快照不匹配。");
    checkDraft(
      draft,
      new Set([
        ...task.input.packets.flatMap((p) => p.quotes.map((q) => q.quoteId)),
        ...referencedQuotes(task.input.previous),
      ]),
      task.input.groups.map((g) => g.groupId),
    );
  } else {
    const output = data as { results: EvidenceAssignment[] };
    sameIds(
      task.input.targets.map((t) => t.id),
      output.results.map((r) => r.candidateId),
      "证据结论",
    );
    for (const r of output.results) {
      ensure(
        r.snapshotId === task.input.snapshotId &&
          r.batchId === task.input.batchId,
        "证据核验批次不匹配。",
      );
      sameIds(
        task.input.packets.map((p) => p.vocId),
        r.assignments.map((a) => a.vocId),
        `结论 ${r.candidateId} 的评论`,
      );
      const target = task.input.targets.find((t) => t.id === r.candidateId)!;
      for (const a of r.assignments) {
        const p = task.input.packets.find((p) => p.vocId === a.vocId)!;
        ensure(
          a.quoteIds.every((id) => p.quotes.some((q) => q.quoteId === id)),
          "证据跨评论或引用不存在。",
        );
        if (a.stance === "supports" || a.stance === "contradicts") {
          ensure(
            a.quoteIds.length && target.sourceIds.includes(p.sourceId),
            "支持或反例缺证据，或不在结论范围内。",
          );
        }
      }
    }
  }
}

// Only reconcile redundant lists; never invent, truncate or remove evidence.
export function reconcileOpportunityEvidence(
  task: Task,
  data: TaskValue,
): TaskValue {
  if (task.kind !== "aggregate") return data;
  assertSchema("aggregate", data);
  const draft = structuredClone(data) as AnalysisDraft;
  const allowed = new Set([
    ...task.input.packets.flatMap((p) => p.quotes.map((q) => q.quoteId)),
    ...referencedQuotes(task.input.previous),
  ]);
  for (const id of referencedQuotes(draft))
    ensure(allowed.has(id), `报告引用了未登记的引文 ID：${id}`);
  for (const gap of draft.conditional.brandComparison.opportunityGaps) {
    for (const key of [
      "supportingQuoteIds",
      "contradictingQuoteIds",
    ] as const) {
      gap.evidence[key] = [
        ...new Set([
          ...gap.evidence[key],
          ...gap.qualification.unmetNeedEvidence[key],
          ...gap.qualification.ownBrandFitEvidence[key],
        ]),
      ];
      ensure(
        gap.evidence[key].length <= 15,
        `机会 ${gap.id} 的 ${key} 合并后超过 15 条，请压缩双边及主证据中的重复或次要引用，同时保留两侧支持与重要反例。`,
      );
    }
  }
  return draft;
}
export function targetsFrom(
  draft: AnalysisDraft,
  groups: Array<{ groupId: string; sourceIds: string[] }>,
  allSourceIds: string[],
): Target[] {
  const targets: Target[] = [];
  const scope = (ids: string[]) =>
    ids.length
      ? [
          ...new Set(
            groups
              .filter((g) => ids.includes(g.groupId))
              .flatMap((g) => g.sourceIds),
          ),
        ]
      : allSourceIds;
  const allFindings = [
    ...draft.overall.topTopics,
    ...draft.overall.painPoints,
    ...draft.overall.userNeeds,
    ...draft.overall.purchaseDrivers,
    ...draft.overall.purchaseBarriers,
    ...draft.conditional.brandComparison.ownBrandStrengths,
    ...draft.conditional.brandComparison.ownBrandWeaknesses,
    ...draft.conditional.brandComparison.competitorStrengths,
    ...draft.conditional.brandComparison.commonPainPoints,
    ...draft.conditional.brandComparison.opportunityGaps,
  ];
  for (const f of allFindings)
    targets.push({
      id: f.id,
      textZh: `${f.titleZh}：${f.summaryZh}`,
      sourceIds: scope(f.scopeGroupIds),
      sentimentApplicable: !draft.overall.userNeeds.some((n) => n.id === f.id),
    });
  for (const gap of draft.conditional.brandComparison.opportunityGaps) {
    const q = gap.qualification;
    if (!q) continue;
    targets.push({
      id: `${gap.id}:unmet`,
      textZh: `竞品用户明确表达未满足需求或负面体验：${q.needZh}`,
      sourceIds: scope(q.competitorBrandIds),
      sentimentApplicable: true,
    });
    targets.push({
      id: `${gap.id}:fit`,
      textZh: `自有品牌的实际正面体验为承接需求提供线索：${q.ownBrandFitZh}`,
      sourceIds: scope(
        groups
          .filter((g) => g.groupId.startsWith("brand:own:"))
          .map((g) => g.groupId),
      ),
      sentimentApplicable: true,
    });
  }
  for (const i of draft.insightCards)
    targets.push({
      id: i.id,
      textZh: i.titleZh,
      sourceIds: allSourceIds,
      sentimentApplicable: false,
    });
  for (const section of [
    draft.conditional.platformDifferences,
    draft.conditional.timeDifferences,
  ])
    for (const item of section.items)
      for (const g of item.groups)
        targets.push({
          id: `${item.id}|${g.groupId}`,
          textZh: g.observationZh,
          sourceIds: scope([g.groupId]),
          sentimentApplicable: true,
        });
  ensure(
    new Set(targets.map((t) => t.id)).size === targets.length,
    "证据核验目标 ID 冲突。",
  );
  return targets;
}
