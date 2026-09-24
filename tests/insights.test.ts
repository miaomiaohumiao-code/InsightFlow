import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  AnalysisResult,
  Evidence,
  Finding,
  Insight,
  Checkpoint,
} from "../src/types/analysis";
import {
  conditionalVisibility,
  insightMetrics,
  readSelection,
  selectionKey,
  sortInsights,
} from "../src/lib/insights/view";
import {
  latestAnalysis,
  latestCompletedAnalysis,
  saveAnalysis,
} from "../src/lib/storage/analysis";
import { createCheckpoint } from "../src/lib/analysis/runner";
import { createSnapshot } from "../src/lib/analysis/snapshot";
import { createProject } from "../src/types/project";
import { preparePreview } from "../src/lib/voc/prepare";

// Synthetic UI data only; no model calls and no fabricated production report.
function fixture(): AnalysisResult {
  const no = {
    status: "not_applicable" as const,
    score: null,
    eligibleGroupCount: 0,
    supportingGroupCount: 0,
    reasonZh: "无可比来源",
  };
  const evidence: Evidence = {
    supportingVocIds: ["v"],
    contradictingVocIds: [],
    sourceIds: ["s"],
    representativeQuotes: [],
    strength: {
      level: "High",
      ruleVersion: "evidence-v1",
      mentionFrequency: {
        supportingVocCount: 1,
        contradictingVocCount: 0,
        scopeVocCount: 10,
        supportRate: 0.1,
      },
      crossPlatformConsistency: no,
      timeConsistency: no,
      sentimentConsistency: no,
      reasonZh: "测试证据",
    },
  };
  const finding: Finding = {
    id: "topic",
    titleZh: "佩戴舒适",
    summaryZh: "测试摘要",
    scopeGroupIds: [],
    evidence,
    limitationsZh: [],
  };
  const insight: Insight = {
    id: "i1",
    titleZh: "舒适需求",
    userNeedFindingId: null,
    painPointFindingId: null,
    purchaseDriverFindingIds: [],
    purchaseBarrierFindingIds: [],
    evidence,
    marketingImplicationZh: "测试建议",
    marketingPriority: { level: "Low", reasonZh: "待验证" },
    limitationsZh: [],
    targetSegment: null,
  };
  return {
    schemaVersion: "1.0.0",
    language: "zh-CN",
    snapshotId: "snapshot",
    runId: "run",
    inputHash: "hash",
    createdAt: "2026-09-15T00:00:00Z",
    promptVersion: "test",
    modelVersion: "test",
    sources: [
      {
        sourceId: "s",
        platformId: "p1",
        platformLabel: "平台一",
        brandId: "b1",
        brandType: "own",
        brandLabel: "自有品牌",
        periodId: null,
        periodStart: null,
        periodEnd: null,
        region: null,
        productTopic: "耳机",
      },
    ],
    groups: [],
    coverage: {
      status: "complete",
      includedVocCount: 10,
      analyzedVocCount: 10,
      failedVocIds: [],
      excludedDuplicateVocIds: [],
      unresolvedBoundaryVocCount: 0,
    },
    overall: {
      topTopics: [finding],
      sentiment: {
        summaryZh: "测试统计",
        evidence,
        unit: "voc_record",
        analyzedVocCount: 10,
        counts: { positive: 5, neutral: 1, negative: 2, mixed: 1, unknown: 1 },
      },
      painPoints: [],
      userNeeds: [],
      purchaseDrivers: [],
      purchaseBarriers: [],
    },
    conditional: {
      platformDifferences: {
        status: "not_applicable",
        reasonZh: "单平台",
        items: [],
      },
      timeDifferences: {
        status: "not_applicable",
        reasonZh: "日期未知",
        items: [],
      },
      brandComparison: {
        status: "ready",
        reasonZh: "测试",
        ownBrandStrengths: [],
        ownBrandWeaknesses: [],
        competitorStrengths: [],
        commonPainPoints: [],
        opportunityGaps: [{ ...finding, id: "gap" }],
      },
    },
    insightCards: [
      insight,
      {
        ...insight,
        id: "i2",
        evidence: {
          ...evidence,
          strength: { ...evidence.strength, level: "Low" },
        },
        marketingPriority: { level: "High", reasonZh: "测试优先级" },
      },
    ],
    limitationsZh: [],
  };
}
test("overview counts insights and opportunity gaps without counting topics as insights", () => {
  assert.deepEqual(insightMetrics(fixture()), {
    voc: 10,
    topics: 1,
    highEvidence: 1,
    opportunities: 0,
  });
});
test("conditional modules use included sources, ignore unknown periods, and show competitor-only empty comparison", () => {
  const r = fixture();
  assert.deepEqual(conditionalVisibility(r), {
    platforms: false,
    periods: false,
    brands: false,
  });
  r.sources.push({
    ...r.sources[0],
    sourceId: "s2",
    brandType: "competitor",
    brandId: "b2",
    platformId: "p2",
    periodId: "date1",
  });
  assert.deepEqual(conditionalVisibility(r), {
    platforms: true,
    periods: false,
    brands: true,
  });
  r.sources[0].periodId = "date2";
  assert.equal(conditionalVisibility(r).periods, true);
  r.sources = r.sources.slice(1);
  assert.equal(conditionalVisibility(r).brands, true);
});
test("evidence and priority sort independently with stable ties and no mutation", () => {
  const r = fixture();
  r.insightCards.push({ ...r.insightCards[0], id: "i3" });
  assert.deepEqual(
    sortInsights(r.insightCards, "evidence").map((x) => x.id),
    ["i1", "i3", "i2"],
  );
  assert.deepEqual(
    sortInsights(r.insightCards, "priority").map((x) => x.id),
    ["i2", "i1", "i3"],
  );
  assert.deepEqual(
    r.insightCards.map((x) => x.id),
    ["i1", "i2", "i3"],
  );
});
test("selection restores valid unique IDs only and is isolated by project, run and snapshot", () => {
  const r = fixture();
  assert.deepEqual(readSelection("{broken", r.insightCards), {
    selectedIds: [],
    sort: "original",
  });
  assert.deepEqual(
    readSelection(
      JSON.stringify({
        selectedIds: ["i2", "gone", "i2", 12, "i1"],
        sort: "priority",
      }),
      r.insightCards,
    ),
    { selectedIds: ["i2", "i1"], sort: "priority" },
  );
  assert.notEqual(
    selectionKey("p", r),
    selectionKey("p", { ...r, runId: "new" }),
  );
  assert.notEqual(
    selectionKey("p", r),
    selectionKey("p", { ...r, inputHash: "new" }),
  );
  assert.notEqual(selectionKey("p", r), selectionKey("other", r));
});
test("a newer failed or partial run does not hide the latest complete report", async () => {
  const p = createProject();
  p.name = "结果选择测试";
  p.ownBrandName = "自有品牌";
  p.sources[0] = {
    ...p.sources[0],
    platform: "平台",
    product: "耳机",
    rawText: "1. 佩戴很舒服。",
  };
  p.preview = preparePreview(p.sources);
  p.preview.confirmedAt = "yes";
  const snapshot = await createSnapshot(p);
  const done: Checkpoint = {
    ...createCheckpoint(snapshot, "test"),
    status: "complete",
    result: fixture(),
    updatedAt: "2026-09-10T00:00:00Z",
  };
  await saveAnalysis(done);
  await saveAnalysis({
    ...createCheckpoint(snapshot, "test"),
    status: "failed",
    updatedAt: "2026-09-12T00:00:00Z",
  });
  await saveAnalysis({
    ...createCheckpoint(snapshot, "test"),
    status: "complete",
    result: {
      ...fixture(),
      coverage: { ...fixture().coverage, status: "partial" },
    },
    updatedAt: "2026-09-13T00:00:00Z",
  });
  assert.notEqual((await latestAnalysis(p.id))!.id, done.id);
  assert.equal((await latestCompletedAnalysis(p.id))!.id, done.id);
  assert.equal(await latestCompletedAnalysis("missing-project"), undefined);
});
