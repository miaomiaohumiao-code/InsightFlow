import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createProject, createSource } from "../src/types/project";
import { preparePreview } from "../src/lib/voc/prepare";
import {
  createSnapshot,
  DEFAULT_MODEL,
  batches,
} from "../src/lib/analysis/snapshot";
import {
  createCheckpoint,
  runAnalysis,
  blankUsage,
  TaskFailure,
} from "../src/lib/analysis/runner";
import { packetsFrom, validateTask } from "../src/lib/analysis/validation";
import { normalizeConditional } from "../src/lib/analysis/assemble";
import { assertSchema } from "../src/lib/analysis/schemas";
import { saveAnalysis, latestAnalysis } from "../src/lib/storage/analysis";
import { callOpenAI, AnalysisError } from "../src/lib/analysis/openai.server";
import type {
  Task,
  TaskReply,
  AnalysisDraft,
  BatchExtraction,
  Checkpoint,
} from "../src/types/analysis";

function project(count = 18) {
  const p = createProject();
  p.name = "管线测试";
  p.ownBrandName = "示例品牌";
  p.sources[0] = {
    ...p.sources[0],
    platform: "Reddit",
    product: "耳机",
    rawText: Array.from(
      { length: count },
      (_, i) =>
        `${i + 1}. Comfortable for long listening session ${i + 1}. 戴起来很舒适。`,
    ).join("\n"),
  };
  p.preview = preparePreview(p.sources);
  p.preview.confirmedAt = new Date().toISOString();
  return p;
}
// Explicitly synthetic model responses: only tests orchestration and validation, never a real AI result.
function mockValue(task: Task): TaskReply {
  const usage = {
    ...blankUsage(DEFAULT_MODEL),
    attempts: 1,
    inputTokens: 100,
    outputTokens: 50,
    estimatedCostUsd: 0.00012,
  };
  if (task.kind === "extract")
    return {
      usage,
      data: {
        schemaVersion: "1.0.0",
        snapshotId: task.input.snapshotId,
        batchId: task.input.batchId,
        records: task.input.records.map((r) => ({
          vocId: r.id,
          status: "analyzed",
          reasonZh: null,
          sentiment: "positive",
          aspects: [
            {
              category: "user_need",
              labelZh: "佩戴舒适度",
              assertionZh: "用户表达了对佩戴舒适度的需求。",
              polarity: "positive",
              quotes: [{ originalText: r.original, translationZh: null }],
            },
          ],
        })),
      },
    };
  if (task.kind === "aggregate") {
    const evidence = {
      supportingQuoteIds: task.input.packets
        .slice(0, 2)
        .flatMap((p) => p.quotes.map((q) => q.quoteId)),
      contradictingQuoteIds: [],
    };
    const f = {
      id: "topic:comfort",
      titleZh: "佩戴舒适度",
      summaryZh: "样本提到长时间佩戴舒适。",
      scopeGroupIds: [],
      evidence,
      limitationsZh: ["仅限测试样本。"],
    };
    const no = {
      status: "not_applicable" as const,
      reasonZh: "不满足比较条件。",
      items: [],
    };
    return {
      usage,
      data: {
        schemaVersion: "1.0.0",
        language: "zh-CN",
        snapshotId: task.input.snapshotId,
        overall: {
          topTopics: [f],
          sentiment: {
            summaryZh: null,
            evidence: { supportingQuoteIds: [], contradictingQuoteIds: [] },
          },
          painPoints: [],
          userNeeds: [{ ...f, id: "need:comfort" }],
          purchaseDrivers: [],
          purchaseBarriers: [],
        },
        conditional: {
          platformDifferences: no,
          timeDifferences: no,
          brandComparison: {
            status: "not_applicable",
            reasonZh: "无竞品。",
            ownBrandStrengths: [],
            ownBrandWeaknesses: [],
            competitorStrengths: [],
            commonPainPoints: [],
            opportunityGaps: [],
          },
        },
        insightCards: [
          {
            id: "insight:comfort",
            titleZh: "关注长时间佩戴体验",
            targetSegmentNeedId: "need:comfort",
            userNeedFindingId: "need:comfort",
            painPointFindingId: null,
            purchaseDriverFindingIds: [],
            purchaseBarrierFindingIds: [],
            evidence,
            marketingImplicationZh: "测试舒适度表达。",
            marketingPriority: { level: "High", reasonZh: "与研究目标相关。" },
            limitationsZh: [],
          },
        ],
        limitationsZh: ["合成响应仅用于测试程序。"],
      },
    };
  }
  return {
    usage,
    data: {
      results: task.input.targets.map((t) => ({
        schemaVersion: "1.0.0",
        snapshotId: task.input.snapshotId,
        batchId: task.input.batchId,
        candidateId: t.id,
        assignments: task.input.packets.map((p) => ({
          vocId: p.vocId,
          stance: "supports",
          quoteIds: p.quotes.map((q) => q.quoteId),
          aspectSentiment: "positive",
        })),
      })),
    },
  };
}

test("snapshot freezes original quote offsets, splits long records and honors unknown dates", async () => {
  const p = project(1);
  p.sources[0].rawText = "长时间佩戴也很舒适。😄".repeat(500);
  p.preview = preparePreview(p.sources);
  p.preview.confirmedAt = "confirmed";
  const s = await createSnapshot(p);
  assert.ok(s.chunks.length > 1);
  assert.equal(s.includedVocIds.length, 1);
  assert.equal(s.chunks.map((c) => c.original).join(""), p.sources[0].rawText);
  assert.ok(
    s.chunks.every(
      (c) => p.sources[0].rawText.slice(c.start, c.end) === c.original,
    ),
  );
  assert.equal(s.groups.filter((g) => g.dimension === "period").length, 0);
  const before = s.hash;
  p.sources[0].rawText = "changed";
  assert.equal(s.hash, before);
  await assert.rejects(createSnapshot(p), /预览与原文不一致/);
});
test("oversized individual payload cannot silently bypass batch budget", () => {
  assert.throws(() => batches(["x".repeat(200)], 100), /超过安全批次预算/);
  assert.equal(batches([1, 2, 3, 4], 100, 2).length, 2);
});
test("fabricated, ambiguous, wrong-source, missing-ID and non-Chinese extraction are rejected", async () => {
  const s = await createSnapshot(project(1));
  const task: Task = {
    kind: "extract",
    input: { snapshotId: s.id, batchId: "b", records: s.chunks },
  };
  const response = mockValue(task).data as BatchExtraction;
  response.records[0].aspects[0].quotes[0].originalText =
    "This quote does not exist.";
  assert.throws(() => validateTask(task, response), /引文/);
  response.records = [];
  assert.throws(() => validateTask(task, response), /ID/);
  const valid = mockValue(task).data as BatchExtraction;
  valid.records[0].aspects[0].labelZh = "Comfort";
  assert.throws(() => validateTask(task, valid), /中文/);
});
test("full multibatch pipeline resumes only failed work and survives IndexedDB reload", async () => {
  const s = await createSnapshot(project());
  let failed = false;
  const requests: string[] = [];
  const initial = createCheckpoint(s, DEFAULT_MODEL);
  const first = await runAnalysis(initial, {
    persist: saveAnalysis,
    request: async (task, key) => {
      requests.push(key);
      if (task.kind === "extract" && !failed) {
        failed = true;
        throw new TaskFailure("模拟单批网络失败", {
          ...blankUsage(DEFAULT_MODEL),
          attempts: 2,
          unmeteredAttempts: 2,
        });
      }
      return mockValue(task);
    },
  });
  assert.equal(first.status, "failed");
  assert.equal(Object.keys(first.replies).length, 1);
  const persisted = await latestAnalysis(s.projectId);
  assert.deepEqual(persisted, first);
  const alreadyDone = Object.keys(first.replies)[0];
  const secondCalls: string[] = [];
  const final = await runAnalysis(persisted!, {
    persist: saveAnalysis,
    request: async (task, key) => {
      secondCalls.push(key);
      return mockValue(task);
    },
  });
  assert.equal(final.status, "complete");
  assert.ok(!secondCalls.includes(alreadyDone));
  assert.equal(final.result?.overall.sentiment.counts.positive, 18);
  assert.equal(
    final.result?.overall.topTopics[0].evidence.strength.mentionFrequency
      .supportingVocCount,
    18,
  );
  assert.equal(
    final.result?.overall.topTopics[0].evidence.strength
      .crossPlatformConsistency.status,
    "not_applicable",
  );
  assert.equal(final.result?.insightCards[0].targetSegment?.type, "need_based");
  assertSchema("result", final.result);
  assert.equal(final.usage.attempts, 2 + Object.keys(final.replies).length);
  const saved = await latestAnalysis(s.projectId);
  assert.deepEqual(saved?.result, final.result);
});
test("cancellation keeps saved completed batches and does not publish partial counts", async () => {
  const initial = createCheckpoint(
    await createSnapshot(project()),
    DEFAULT_MODEL,
  );
  const controller = new AbortController();
  let saved: Checkpoint | undefined;
  const result = await runAnalysis(initial, {
    signal: controller.signal,
    persist: async (r) => {
      saved = r;
    },
    request: async (t) => {
      controller.abort();
      return mockValue(t);
    },
  });
  assert.equal(result.status, "paused");
  assert.equal(result.result, null);
  assert.equal(Object.keys(saved!.replies).length, 1);
});
test("unsupported demographic need labels are rejected", async () => {
  const s = await createSnapshot(project(1));
  const ext: Task = {
    kind: "extract",
    input: { snapshotId: s.id, batchId: "b", records: s.chunks },
  };
  const packets = packetsFrom(mockValue(ext).data as BatchExtraction, s.chunks);
  const task: Task = {
    kind: "aggregate",
    input: {
      snapshotId: s.id,
      goal: s.goal,
      sources: s.sources,
      groups: s.groups,
      packets,
      previous: null,
    },
  };
  const draft = mockValue(task).data as AnalysisDraft;
  draft.overall.userNeeds[0].titleZh = "高收入女性的佩戴需求";
  assert.throws(() => validateTask(task, draft), /人口属性/);
});
test("multi-platform and time modules cannot claim a comparison from confounded sources", async () => {
  const p = project(1);
  p.sources.push({
    ...createSource("competitor"),
    platform: "Best Buy",
    competitorName: "Other",
    product: "different",
    rawText: "Another original review.",
  });
  p.preview = preparePreview(p.sources);
  p.preview.confirmedAt = "confirmed";
  const s = await createSnapshot(p);
  const ext: Task = {
    kind: "extract",
    input: { snapshotId: s.id, batchId: "b", records: s.chunks },
  };
  const task: Task = {
    kind: "aggregate",
    input: {
      snapshotId: s.id,
      goal: s.goal,
      sources: s.sources,
      groups: s.groups,
      packets: packetsFrom(mockValue(ext).data as BatchExtraction, s.chunks),
      previous: null,
    },
  };
  const result = normalizeConditional(mockValue(task).data as AnalysisDraft, s);
  assert.equal(
    result.conditional.platformDifferences.status,
    "insufficient_data",
  );
  assert.equal(result.conditional.timeDifferences.status, "not_applicable");
});
test("OpenAI adapter retries 5xx and preserves usage for successful and unmetered calls", async () => {
  const s = await createSnapshot(project(1));
  const task: Task = {
    kind: "extract",
    input: { snapshotId: s.id, batchId: "b", records: s.chunks },
  };
  let calls = 0;
  const reply = await callOpenAI(task, {
    key: "test-not-a-real-key",
    model: DEFAULT_MODEL,
    sleep: async () => {},
    fetcher: async (url, init) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      const payload = JSON.parse(init!.body as string);
      assert.equal(payload.store, false);
      assert.equal(payload.text.format.strict, true);
      assert.equal(payload.tools, undefined);
      calls++;
      if (calls === 1) return new Response("failure", { status: 500 });
      return Response.json({
        status: "completed",
        usage: {
          input_tokens: 120,
          output_tokens: 60,
          input_tokens_details: { cached_tokens: 20 },
        },
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify(mockValue(task).data),
              },
            ],
          },
        ],
      });
    },
  });
  assert.equal(calls, 2);
  assert.equal(reply.usage.attempts, 2);
  assert.equal(reply.usage.inputTokens, 120);
  assert.equal(reply.usage.unmeteredAttempts, 1);
});
test("missing key, authentication failure, refusal and incomplete responses do not fake success", async () => {
  const s = await createSnapshot(project(1));
  const task: Task = {
    kind: "extract",
    input: { snapshotId: s.id, batchId: "b", records: s.chunks },
  };
  let calls = 0;
  await assert.rejects(
    callOpenAI(task, {
      key: "",
      model: DEFAULT_MODEL,
      fetcher: async () => {
        calls++;
        return new Response();
      },
    }),
    /未配置/,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    callOpenAI(task, {
      key: "test",
      model: DEFAULT_MODEL,
      fetcher: async () => {
        calls++;
        return new Response("DO-NOT-LEAK-SECRET", { status: 401 });
      },
    }),
    (error: unknown) =>
      error instanceof AnalysisError &&
      error.usage.attempts === 1 &&
      !error.message.includes("SECRET"),
  );
  for (const body of [
    { status: "completed", output: [{ content: [{ type: "refusal" }] }] },
    { status: "incomplete", output: [] },
  ])
    await assert.rejects(
      callOpenAI(task, {
        key: "test",
        model: DEFAULT_MODEL,
        fetcher: async () => Response.json(body),
      }),
      AnalysisError,
    );
});
test("unverified model results stop after three attempts without returning fabricated JSON", async () => {
  const s = await createSnapshot(project(1));
  const task: Task = {
    kind: "extract",
    input: { snapshotId: s.id, batchId: "b", records: s.chunks },
  };
  await assert.rejects(
    callOpenAI(task, {
      key: "test",
      model: DEFAULT_MODEL,
      sleep: async () => {},
      fetcher: async () =>
        Response.json({
          status: "completed",
          usage: { input_tokens: 1, output_tokens: 1 },
          output: [
            { content: [{ type: "output_text", text: '{"bogus":true}' }] },
          ],
        }),
    }),
    (error: unknown) =>
      error instanceof AnalysisError &&
      error.usage.attempts === 3 &&
      error.usage.outputTokens === 3,
  );
});

test("DeepSeek JSON transport, token mapping and schema correction", async () => {
  const s = await createSnapshot(project(1));
  const task: Task = {
    kind: "extract",
    input: { snapshotId: s.id, batchId: "ds", records: s.chunks },
  };
  let calls = 0;
  const result = await callOpenAI(task, {
    provider: "deepseek",
    model: "deepseek/deepseek-flash",
    key: "test-only",
    sleep: async () => {},
    fetcher: async (url, init) => {
      calls++;
      assert.equal(url, "https://api.deepseek.com/chat/completions");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "deepseek-flash");
      assert.deepEqual(body.response_format, { type: "json_object" });
      assert.deepEqual(body.thinking, { type: "disabled" });
      assert.equal(body.store, undefined);
      assert.match(body.messages[0].content, /JSON Schema/);
      if (calls === 2)
        assert.match(body.messages[0].content, /上次输出未通过校验/);
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify(calls === 1 ? {} : mockValue(task).data),
            },
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          prompt_cache_hit_tokens: 25,
        },
      });
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.usage.inputTokens, 200);
  assert.equal(result.usage.cachedInputTokens, 50);
  assert.equal(result.usage.outputTokens, 100);
  assert.equal(result.usage.estimatedCostUsd, null);
});

test("DeepSeek empty JSON retries; balance failure stops without repeated batches", async () => {
  const s = await createSnapshot(project(18));
  const task: Task = {
    kind: "extract",
    input: { snapshotId: s.id, batchId: "ds", records: s.chunks.slice(0, 1) },
  };
  let calls = 0;
  await assert.rejects(
    callOpenAI(task, {
      provider: "deepseek",
      model: "deepseek/deepseek-flash",
      key: "test-only",
      sleep: async () => {},
      fetcher: async (_url, init) => {
        calls++;
        if (calls > 1)
          assert.match(
            JSON.parse(String(init?.body)).messages[0].content,
            /上次响应无法解析为 JSON/,
          );
        return Response.json({
          choices: [{ finish_reason: "stop", message: { content: "" } }],
          usage: { prompt_tokens: 1, completion_tokens: 0 },
        });
      },
    }),
    /JSON/,
  );
  assert.equal(calls, 3);
  calls = 0;
  const final = await runAnalysis(
    createCheckpoint(s, "deepseek/deepseek-flash"),
    {
      persist: async () => {},
      request: async (t) => {
        try {
          return await callOpenAI(t, {
            provider: "deepseek",
            model: "deepseek/deepseek-flash",
            key: "test-only",
            fetcher: async () => {
              calls++;
              return Response.json(
                { error: { message: "private provider detail" } },
                { status: 402 },
              );
            },
          });
        } catch (e) {
          if (e instanceof AnalysisError)
            throw new TaskFailure(e.message, e.usage, !e.retryable);
          throw e;
        }
      },
    },
  );
  assert.equal(calls, 1);
  assert.equal(final.status, "failed");
  assert.match(final.error!, /余额不足/);
  assert.equal(final.error!.includes("private provider detail"), false);
  assert.equal(final.result, null);
});

test("provider selection uses separate credentials and checkpoint identities", async () => {
  const { serverProvider, serverModel, serverKey } =
    await import("../src/lib/analysis/provider.server");
  const names = [
    "AI_PROVIDER",
    "DEEPSEEK_API_KEY",
    "DEEPSEEK_MODEL",
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
  ];
  const original = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  try {
    process.env.AI_PROVIDER = "deepseek";
    process.env.DEEPSEEK_API_KEY = "local-test-ds";
    process.env.DEEPSEEK_MODEL = "deepseek-flash";
    process.env.OPENAI_API_KEY = "local-test-openai";
    process.env.OPENAI_MODEL = DEFAULT_MODEL;
    assert.equal(serverProvider(), "deepseek");
    assert.equal(serverKey(), "local-test-ds");
    const s = await createSnapshot(project(1));
    const ds = createCheckpoint(s, serverModel());
    process.env.AI_PROVIDER = "openai";
    assert.equal(serverKey(), "local-test-openai");
    const oa = createCheckpoint(s, serverModel());
    assert.notEqual(ds.model, oa.model);
    process.env.AI_PROVIDER = "typo";
    assert.throws(serverProvider, /AI_PROVIDER/);
  } finally {
    for (const n of names) {
      if (original[n] === undefined) delete process.env[n];
      else process.env[n] = original[n];
    }
  }
});

test("aggregation contract rejects runaway incremental arrays", async () => {
  const s = await createSnapshot(project(1));
  const extraction: Task = {
    kind: "extract",
    input: { snapshotId: s.id, batchId: "bound", records: s.chunks },
  };
  const packets = packetsFrom(
    mockValue(extraction).data as BatchExtraction,
    s.chunks,
  );
  const task: Task = {
    kind: "aggregate",
    input: {
      snapshotId: s.id,
      goal: s.goal,
      sources: s.sources,
      groups: s.groups,
      packets,
      previous: null,
    },
  };
  const value = mockValue(task).data as AnalysisDraft;
  const over = structuredClone(value);
  over.overall.topTopics = Array.from({ length: 5 }, (_, i) => ({
    ...value.overall.topTopics[0],
    id: `topic:${i}`,
  }));
  assert.throws(() => assertSchema("aggregate", over), /maxItems/);
  const quoteOver = structuredClone(value);
  quoteOver.overall.topTopics[0].evidence.supportingQuoteIds =
    Array(6).fill("q");
  assert.throws(() => assertSchema("aggregate", quoteOver), /maxItems/);
});

test("aggregation interleaves brands without dropping evidence or changing counts", async () => {
  const { balancePackets } = await import("../src/lib/analysis/runner");
  const s = await createSnapshot(project(1));
  s.sources = [
    { ...s.sources[0], sourceId: "own", brandId: "own-brand" },
    { ...s.sources[0], sourceId: "other", brandId: "other-brand" },
  ];
  const task: Task = {
    kind: "extract",
    input: { snapshotId: s.id, batchId: "balance", records: s.chunks },
  };
  const base = packetsFrom(
    mockValue(task).data as BatchExtraction,
    s.chunks,
  )[0];
  const input = ["own", "own", "own", "other", "other", "other"].map(
    (sourceId, i) => ({ ...base, sourceId, vocId: String(i) }),
  );
  const output = balancePackets(input, s);
  assert.deepEqual(
    output.map((x) => x.sourceId),
    ["own", "other", "own", "other", "own", "other"],
  );
  assert.deepEqual(
    output.map((x) => x.vocId).sort(),
    input.map((x) => x.vocId).sort(),
  );
});

test("own-brand findings cannot scan competitor evidence when model leaves scope empty", async () => {
  const s = await createSnapshot(project(1));
  s.sources.push({
    ...s.sources[0],
    sourceId: "competitor-source",
    brandType: "competitor",
    brandId: "competitor-brand",
  });
  s.groups.push({
    groupId: "brand:competitor-brand",
    dimension: "brand",
    labelZh: "竞品品牌",
    sourceIds: ["competitor-source"],
  });
  const extraction: Task = {
    kind: "extract",
    input: { snapshotId: s.id, batchId: "roles", records: s.chunks },
  };
  const packets = packetsFrom(
    mockValue(extraction).data as BatchExtraction,
    s.chunks,
  );
  const task: Task = {
    kind: "aggregate",
    input: {
      snapshotId: s.id,
      goal: s.goal,
      sources: s.sources,
      groups: s.groups,
      packets,
      previous: null,
    },
  };
  const draft = mockValue(task).data as AnalysisDraft;
  draft.conditional.brandComparison.status = "ready";
  draft.conditional.brandComparison.ownBrandStrengths = [
    { ...draft.overall.topTopics[0], id: "own:comfort", scopeGroupIds: [] },
  ];
  const normalized = normalizeConditional(draft, s);
  const { targetsFrom } = await import("../src/lib/analysis/validation");
  const target = targetsFrom(
    normalized,
    s.groups,
    s.sources.map((x) => x.sourceId),
  ).find((x) => x.id === "own:comfort")!;
  assert.deepEqual(target.sourceIds, [s.sources[0].sourceId]);
  assert.equal(target.sourceIds.includes("competitor-source"), false);
});

test("out-of-scope evidence is deterministically excluded while in-scope fabricated quotes still fail", async () => {
  const s = await createSnapshot(project(1));
  const extraction: Task = {
    kind: "extract",
    input: { snapshotId: s.id, batchId: "scope", records: s.chunks },
  };
  const packets = packetsFrom(
    mockValue(extraction).data as BatchExtraction,
    s.chunks,
  );
  const task: Task = {
    kind: "assign",
    input: {
      snapshotId: s.id,
      batchId: "scope",
      targets: [
        {
          id: "own:need",
          textZh: "自有品牌需求",
          sourceIds: ["other-source"],
          sentimentApplicable: false,
        },
      ],
      packets,
    },
  };
  const { constrainAssignmentScope } =
    await import("../src/lib/analysis/validation");
  const value = mockValue(task).data;
  const normalized = constrainAssignmentScope(task, value) as {
    results: import("../src/types/analysis").EvidenceAssignment[];
  };
  assert.equal(normalized.results[0].assignments[0].stance, "not_mentioned");
  assert.deepEqual(normalized.results[0].assignments[0].quoteIds, []);
  validateTask(task, normalized);
  task.input.targets[0].sourceIds = [packets[0].sourceId];
  normalized.results[0].assignments[0].stance = "supports";
  normalized.results[0].assignments[0].quoteIds = ["fabricated"];
  assert.throws(
    () => validateTask(task, constrainAssignmentScope(task, normalized)),
    /引用不存在/,
  );
});

test("priority extras are removed once without weakening required fields or evidence", async () => {
  const s = await createSnapshot(project(1));
  const extract: Task = {
    kind: "extract",
    input: { snapshotId: s.id, batchId: "x", records: s.chunks },
  };
  const packets = packetsFrom(
    mockValue(extract).data as BatchExtraction,
    s.chunks,
  );
  const task: Task = {
    kind: "aggregate",
    input: {
      snapshotId: s.id,
      goal: s.goal,
      sources: s.sources,
      groups: s.groups,
      packets,
      previous: null,
    },
  };
  const draft = mockValue(task).data as AnalysisDraft;
  Object.assign(draft.insightCards[0].marketingPriority, {
    score: 90,
    extra: "多余说明",
  });
  let calls = 0;
  const result = await callOpenAI(task, {
    provider: "deepseek",
    model: "deepseek/test",
    key: "test",
    sleep: async () => {},
    fetcher: async () => {
      calls++;
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(draft) },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(
    (result.data as AnalysisDraft).insightCards[0].marketingPriority,
    { level: "High", reasonZh: "与研究目标相关。" },
  );
  const { sanitizePriorityMetadata } =
    await import("../src/lib/analysis/schemas");
  const invalid = structuredClone(draft);
  Reflect.deleteProperty(invalid.insightCards[0].marketingPriority, "reasonZh");
  assert.throws(
    () =>
      validateTask(task, sanitizePriorityMetadata(invalid) as AnalysisDraft),
    /required/,
  );
  invalid.insightCards[0].marketingPriority = {
    level: "High",
    reasonZh: "中文原因",
  };
  invalid.insightCards[0].evidence.supportingQuoteIds = ["fabricated"];
  assert.throws(
    () =>
      validateTask(task, sanitizePriorityMetadata(invalid) as AnalysisDraft),
    /未登记/,
  );
});

test("progress excludes cached replies from abandoned branches", async () => {
  const state = createCheckpoint(
    await createSnapshot(project(1)),
    DEFAULT_MODEL,
  );
  state.replies.orphan = {
    data: {} as AnalysisDraft,
    usage: blankUsage(DEFAULT_MODEL),
  };
  state.completedTasks = 1;
  const done = await runAnalysis(state, {
    persist: async () => {},
    request: async (task) => mockValue(task),
  });
  assert.equal(done.status, "complete");
  assert.equal(done.completedTasks, done.totalTasks);
  assert.equal(Object.keys(done.replies).length, done.completedTasks + 1);
});

test("assignment retries only missing cells and preserves verified evidence", async () => {
  const s = await createSnapshot(project(3));
  const ex: Task = {
    kind: "extract",
    input: { snapshotId: s.id, batchId: "extract", records: s.chunks },
  };
  const packets = packetsFrom(mockValue(ex).data as BatchExtraction, s.chunks);
  const task: Task = {
    kind: "assign",
    input: {
      snapshotId: s.id,
      batchId: "assign",
      targets: [
        {
          id: "target",
          textZh: "佩戴舒适",
          sentimentApplicable: true,
          sourceIds: s.sources.map((x) => x.sourceId),
        },
      ],
      packets,
    },
  };
  let calls = 0;
  const result = await callOpenAI(task, {
    provider: "deepseek",
    model: "deepseek/test",
    key: "test",
    sleep: async () => {},
    fetcher: async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      const input = JSON.parse(body.messages[1].content);
      assert.equal(input.packets.length, calls === 1 ? 3 : 1);
      const value = mockValue({ kind: "assign", input }).data as {
        results: import("../src/types/analysis").EvidenceAssignment[];
      };
      if (calls === 1) value.results[0].assignments.pop();
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(value) },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
    },
  });
  assert.equal(calls, 2);
  validateTask(task, result.data);
  assert.equal(result.usage.attempts, 2);
  const { assignmentRepair } =
    await import("../src/lib/analysis/assignment-repair");
  const repair = assignmentRepair(task);
  const bad = mockValue(task).data as {
    results: import("../src/types/analysis").EvidenceAssignment[];
  };
  bad.results[0].assignments[0].quoteIds = ["fabricated"];
  bad.results[0].assignments.push(
    structuredClone(bad.results[0].assignments[1]),
  );
  const partial = repair.accept(bad);
  assert.equal(partial.results[0].assignments.length, 1);
  assert.equal(repair.remaining().input.packets.length, 2);
  assert.throws(() => validateTask(task, partial), /缺失/);
});
