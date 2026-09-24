import test from "node:test";
import assert from "node:assert/strict";
import {
  competitors,
  opportunityEligible,
  prepareBrandReport,
  qualifyGap,
  type QualifiedGap,
} from "../src/lib/analysis/brand";
import { insightMetrics, readSelection } from "../src/lib/insights/view";
import {
  targetsFrom,
  checkDraft,
  reconcileOpportunityEvidence,
  validateTask,
} from "../src/lib/analysis/validation";
import { assertSchema } from "../src/lib/analysis/schemas";
import { assemble } from "../src/lib/analysis/assemble";
import { createCheckpoint } from "../src/lib/analysis/runner";
import type {
  AnalysisResult,
  AnalysisDraft,
  Evidence,
  Packet,
  SourceSnapshot,
} from "../src/types/analysis";

const source = (id: string, own = false): SourceSnapshot => ({
  sourceId: id,
  platformId: "platform:test",
  platformLabel: "测试平台",
  brandId: `brand:${own ? "own" : "competitor"}:${id}`,
  brandType: own ? "own" : "competitor",
  brandLabel: id,
  periodId: null,
  periodStart: null,
  periodEnd: null,
  region: null,
  productTopic: "耳机",
});
const sources = [
  source("own", true),
  source("competitor-a"),
  source("competitor-b"),
];
const packet = (id: string, positive: boolean): Packet => ({
  vocId: id,
  parentId: id,
  sourceId: id,
  sentiment: positive ? "positive" : "negative",
  aspects: [
    {
      category: "pain_point",
      labelZh: "佩戴舒适",
      assertionZh: positive ? "长时间佩戴舒适" : "长时间佩戴疼痛",
      polarity: positive ? "positive" : "negative",
      quoteIds: [`q:${id}`],
    },
  ],
  quotes: [
    {
      quoteId: `q:${id}`,
      vocId: id,
      sourceId: id,
      start: 0,
      end: 2,
      originalText: positive ? "舒适" : "疼痛",
      translationZh: null,
    },
  ],
});
const packets = [
  packet("own", true),
  packet("competitor-a", false),
  packet("competitor-b", false),
];
const no = {
  status: "insufficient_data" as const,
  score: null,
  eligibleGroupCount: 0,
  supportingGroupCount: 0,
  reasonZh: "测试样本不足",
};
function gap(): QualifiedGap {
  const evidence: Evidence = {
    supportingVocIds: ["own", "competitor-a"],
    contradictingVocIds: [],
    sourceIds: ["own", "competitor-a"],
    representativeQuotes: packets.slice(0, 2).flatMap((p) => p.quotes),
    strength: {
      level: "Low",
      ruleVersion: "evidence-v1",
      mentionFrequency: {
        supportingVocCount: 2,
        contradictingVocCount: 0,
        scopeVocCount: 3,
        supportRate: 2 / 3,
      },
      crossPlatformConsistency: no,
      timeConsistency: no,
      sentimentConsistency: no,
      reasonZh: "组合机会待验证",
    },
  };
  return {
    id: "gap",
    titleZh: "长时间舒适的承接机会",
    summaryZh: "竞品佩戴疼痛，自有品牌已有舒适体验线索",
    scopeGroupIds: [],
    evidence,
    limitationsZh: [],
    qualification: {
      competitorBrandIds: [sources[1].brandId],
      needZh: "长时间佩戴舒适",
      unmetNeedEvidence: {
        supportingQuoteIds: ["q:competitor-a"],
        contradictingQuoteIds: [],
      },
      ownBrandFitEvidence: {
        supportingQuoteIds: ["q:own"],
        contradictingQuoteIds: [],
      },
      ownBrandFitZh: "自有品牌用户报告佩戴舒适",
      fitStatus: "potential",
      boundaryZh: "适配个体差异及产品能力仍需验证",
    },
  };
}
function report(): AnalysisResult {
  const g = gap();
  return {
    schemaVersion: "1.0.0",
    language: "zh-CN",
    runId: "test",
    inputHash: "test",
    snapshotId: "test",
    createdAt: new Date().toISOString(),
    promptVersion: "test",
    modelVersion: "test",
    sources,
    groups: [],
    coverage: {
      status: "complete",
      includedVocCount: 3,
      analyzedVocCount: 3,
      failedVocIds: [],
      excludedDuplicateVocIds: [],
      unresolvedBoundaryVocCount: 0,
    },
    overall: {
      topTopics: [],
      userNeeds: [],
      painPoints: [],
      purchaseDrivers: [],
      purchaseBarriers: [],
      sentiment: {
        unit: "voc_record",
        analyzedVocCount: 3,
        summaryZh: "测试",
        counts: { positive: 1, negative: 2, neutral: 0, mixed: 0, unknown: 0 },
        evidence: g.evidence,
      },
    },
    conditional: {
      platformDifferences: {
        status: "not_applicable",
        reasonZh: "单平台",
        items: [],
      },
      timeDifferences: {
        status: "not_applicable",
        reasonZh: "时间未知",
        items: [],
      },
      brandComparison: {
        status: "ready",
        reasonZh: "测试",
        ownBrandStrengths: [],
        ownBrandWeaknesses: [],
        competitorStrengths: [],
        commonPainPoints: [],
        opportunityGaps: [g],
      },
    },
    insightCards: [],
    limitationsZh: [],
  };
}
test("机会必须同时具备竞品未满足证据与自有品牌正向线索", () => {
  assert.ok(qualifyGap(gap(), sources, packets));
  const missing = gap();
  delete missing.qualification;
  assert.equal(opportunityEligible(missing, sources), false);
  const noOwn = gap();
  noOwn.qualification!.ownBrandFitEvidence.supportingQuoteIds = [];
  assert.equal(opportunityEligible(noOwn, sources), false);
  const swapped = gap();
  swapped.qualification!.ownBrandFitEvidence.supportingQuoteIds = [
    "q:competitor-a",
  ];
  assert.equal(opportunityEligible(swapped, sources), false);
  assert.equal(
    qualifyGap(gap(), sources, [packet("own", false), packets[1]]),
    undefined,
  );
  assert.equal(
    qualifyGap(gap(), sources, [packets[0], packet("competitor-a", true)]),
    undefined,
  );
});
test("多个竞品不可互相借证据或把无证据品牌算作机会", () => {
  const g = gap();
  g.qualification!.competitorBrandIds.push(sources[2].brandId);
  assert.equal(opportunityEligible(g, sources), false);
  const r = report();
  const a = {
    ...gap(),
    id: "a",
    evidence: { ...gap().evidence, sourceIds: ["competitor-a"] },
  };
  const mixed = {
    ...a,
    id: "mixed",
    evidence: { ...a.evidence, sourceIds: ["competitor-a", "competitor-b"] },
  };
  r.conditional.brandComparison.competitorStrengths = [a, mixed];
  assert.deepEqual(
    competitors(r).map((b) => [b.label, b.strengths.length]),
    [
      ["competitor-a", 1],
      ["competitor-b", 0],
    ],
  );
});
test("合格机会自动形成可选择的 Insight，旧机会不再计数且不修改原报告", () => {
  const r = report(),
    next = prepareBrandReport(r);
  assert.equal(r.insightCards.length, 0);
  assertSchema("result", next);
  assert.equal(next.insightCards.length, 1);
  assert.equal(next.insightCards[0].originOpportunityId, "gap");
  assert.equal(prepareBrandReport(next).insightCards.length, 1);
  assert.equal(insightMetrics(next).opportunities, 1);
  assert.equal(
    readSelection(
      JSON.stringify({
        selectedIds: [next.insightCards[0].id],
        sort: "original",
      }),
      next.insightCards,
    ).selectedIds.length,
    1,
  );
  assert.match(
    next.insightCards[0].marketingImplicationZh,
    /竞品 competitor-a/,
  );
  delete r.conditional.brandComparison.opportunityGaps[0].qualification;
  const legacy = prepareBrandReport(r);
  assert.equal(legacy.conditional.brandComparison.opportunityGaps.length, 0);
  assert.equal(insightMetrics(legacy).opportunities, 0);
  assert.match(legacy.limitationsZh.join(""), /双边证据/);
});

test("历史对比说明不得编造共同品牌不存在", () => {
  const r = report();
  r.sources[0].platformId = "platform:a";
  r.sources[1].platformId = "platform:b";
  r.conditional.platformDifferences = {
    status: "insufficient_data",
    reasonZh: "同一品牌未在多个平台出现",
    items: [],
  };
  const safe = prepareBrandReport(r);
  assert.match(
    safe.conditional.platformDifferences.reasonZh!,
    /尚未形成通过核验/,
  );
  assert.doesNotMatch(
    safe.conditional.platformDifferences.reasonZh!,
    /同一品牌未在/,
  );
  assert.equal(
    r.conditional.platformDifferences.reasonZh,
    "同一品牌未在多个平台出现",
  );
});
test("跨品牌摘要隐藏未经核验的品牌归属，保留原文且不修改存档", () => {
  const r = report();
  const finding = gap();
  finding.summaryZh = "competitor-a 用户希望购买前了解尺寸，同时佩戴舒适";
  r.overall.painPoints = [finding];
  r.limitationsZh = ["平台与时间比较缺少同一品牌跨渠道或跨期证据"];
  const safe = prepareBrandReport(r);
  assert.doesNotMatch(safe.overall.painPoints[0].summaryZh, /competitor-a/);
  assert.deepEqual(safe.overall.painPoints[0].evidence, finding.evidence);
  assert.match(r.overall.painPoints[0].summaryZh, /competitor-a/);
  assert.doesNotMatch(safe.limitationsZh.join(""), /缺少同一品牌/);
  assert.deepEqual(prepareBrandReport(safe), safe);
  finding.evidence.sourceIds = ["competitor-a"];
  assert.equal(
    prepareBrandReport(r).overall.painPoints[0].summaryZh,
    finding.summaryZh,
  );
});
test("新草案对两侧分别生成范围受限的证据核验任务", () => {
  const g = gap(),
    q = g.qualification!;
  const draft: AnalysisDraft = {
    schemaVersion: "1.0.0",
    language: "zh-CN",
    snapshotId: "s",
    overall: {
      topTopics: [],
      userNeeds: [],
      painPoints: [],
      purchaseDrivers: [],
      purchaseBarriers: [],
      sentiment: {
        summaryZh: null,
        evidence: { supportingQuoteIds: [], contradictingQuoteIds: [] },
      },
    },
    conditional: {
      platformDifferences: {
        status: "not_applicable",
        reasonZh: "单平台",
        items: [],
      },
      timeDifferences: {
        status: "not_applicable",
        reasonZh: "未知时间",
        items: [],
      },
      brandComparison: {
        status: "ready",
        reasonZh: "双边证据",
        ownBrandStrengths: [],
        ownBrandWeaknesses: [],
        competitorStrengths: [],
        commonPainPoints: [],
        opportunityGaps: [
          {
            ...g,
            qualification: q,
            evidence: {
              supportingQuoteIds: ["q:own", "q:competitor-a"],
              contradictingQuoteIds: [],
            },
          },
        ],
      },
    },
    insightCards: [],
    limitationsZh: [],
  };
  assertSchema("aggregate", draft);
  // Five references on each side used to exceed the main list's five-item cap.
  const repairInput = structuredClone(draft);
  const repairGap = repairInput.conditional.brandComparison.opportunityGaps[0];
  const ownIds = Array.from({ length: 5 }, (_, i) => `own-${i}`);
  const competitorIds = Array.from({ length: 5 }, (_, i) => `competitor-${i}`);
  repairGap.qualification.ownBrandFitEvidence.supportingQuoteIds = ownIds;
  repairGap.qualification.unmetNeedEvidence.supportingQuoteIds = competitorIds;
  repairGap.qualification.unmetNeedEvidence.contradictingQuoteIds = ["counter"];
  repairGap.evidence = {
    supportingQuoteIds: [ownIds[0]],
    contradictingQuoteIds: [],
  };
  const repairTask = {
    kind: "aggregate" as const,
    input: {
      snapshotId: draft.snapshotId,
      goal: "验证需求",
      sources,
      groups: sources.map((s) => ({
        groupId: s.brandId,
        dimension: "brand" as const,
        labelZh: "品牌",
        sourceIds: [s.sourceId],
      })),
      packets: [
        {
          ...packets[0],
          quotes: [...ownIds, ...competitorIds, "counter"].map((quoteId) => ({
            ...packets[0].quotes[0],
            quoteId,
          })),
        },
      ],
      previous: null,
    },
  };
  const repaired = reconcileOpportunityEvidence(
    repairTask,
    repairInput,
  ) as AnalysisDraft;
  assert.equal(
    repaired.conditional.brandComparison.opportunityGaps[0].evidence
      .supportingQuoteIds.length,
    10,
  );
  assert.deepEqual(
    repaired.conditional.brandComparison.opportunityGaps[0].evidence
      .contradictingQuoteIds,
    ["counter"],
  );
  assert.equal(
    repairGap.evidence.supportingQuoteIds.length,
    1,
    "input is immutable",
  );
  validateTask(repairTask, repaired);
  assert.deepEqual(
    reconcileOpportunityEvidence(repairTask, repaired),
    repaired,
  );
  repairGap.evidence.supportingQuoteIds.push("invented");
  assert.throws(
    () => reconcileOpportunityEvidence(repairTask, repairInput),
    /未登记/,
  );
  repairGap.evidence.supportingQuoteIds.pop();
  repairGap.qualification.ownBrandFitEvidence.supportingQuoteIds = [];
  assert.throws(
    () =>
      validateTask(
        repairTask,
        reconcileOpportunityEvidence(repairTask, repairInput),
      ),
    /承接证据/,
  );
  checkDraft(
    draft,
    new Set(["q:own", "q:competitor-a"]),
    sources.map((s) => s.brandId),
  );
  const targets = targetsFrom(
    draft,
    sources.map((s) => ({ groupId: s.brandId, sourceIds: [s.sourceId] })),
    sources.map((s) => s.sourceId),
  );
  assert.deepEqual(targets.find((t) => t.id === "gap:unmet")?.sourceIds, [
    "competitor-a",
  ]);
  assert.deepEqual(targets.find((t) => t.id === "gap:fit")?.sourceIds, ["own"]);
  const checkpoint = createCheckpoint(
    {
      id: "s",
      hash: "h",
      projectId: "p",
      goal: "验证舒适需求",
      sources,
      groups: sources.map((s) => ({
        groupId: s.brandId,
        dimension: "brand" as const,
        labelZh: "品牌",
        sourceIds: [s.sourceId],
      })),
      chunks: packets.map((p) => ({
        id: p.vocId,
        parentId: p.parentId,
        sourceId: p.sourceId,
        original: p.quotes[0].originalText,
        start: 0,
        end: 2,
        flags: [],
      })),
      includedVocIds: packets.map((p) => p.parentId),
      excludedDuplicateVocIds: [],
      unresolvedBoundaryVocCount: 0,
    },
    "test",
  );
  const assignments = targets.map((t) => ({
    schemaVersion: "1.0.0" as const,
    snapshotId: "s",
    batchId: "test",
    candidateId: t.id,
    assignments: packets.map((p) => ({
      vocId: p.vocId,
      stance: t.sourceIds.includes(p.sourceId)
        ? ("supports" as const)
        : ("not_mentioned" as const),
      quoteIds: t.sourceIds.includes(p.sourceId)
        ? p.quotes.map((q) => q.quoteId)
        : [],
      aspectSentiment: p.sentiment as "positive" | "negative",
    })),
  }));
  const assembled = assemble(checkpoint, draft, packets, assignments);
  assert.equal(assembled.conditional.brandComparison.opportunityGaps.length, 1);
  assert.equal(assembled.insightCards[0].originOpportunityId, "gap");
  const missingFit = structuredClone(assignments);
  missingFit
    .find((a) => a.candidateId === "gap:fit")!
    .assignments.forEach((a) => {
      a.stance = "not_mentioned";
      a.quoteIds = [];
    });
  assert.equal(
    assemble(checkpoint, draft, packets, missingFit).conditional.brandComparison
      .opportunityGaps.length,
    0,
  );
});
