import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { fields } from "../src/lib/marketing/contract";
import {
  validateInput,
  validateRecommendation,
  executionNotes,
  type Recommendation,
} from "../src/lib/experiments/contract";
import {
  recommendationKey,
  saveRecommendation,
  readRecommendation,
} from "../src/lib/experiments/storage";
import { POST } from "../src/app/api/experiment-recommendations/route";

const input = validateInput({
  action: {
    titleZh: "降低使用顾虑",
    validationPlanZh: "先核实产品能力再测试传播表达",
    ...Object.fromEntries(
      Object.keys(fields).map((f) => [
        f,
        {
          textZh: "关注简单操作的需求人群",
          reasonZh: "用户希望减少设置负担",
          insightIds: ["i1"],
        },
      ]),
    ),
  },
  insights: [
    {
      id: "i1",
      titleZh: "设置复杂造成顾虑",
      implicationZh: "测试易用性信息是否降低顾虑",
      strength: "Low",
      limitationsZh: ["单一来源"],
      quotes: [{ originalText: "Setup feels complicated", platform: "评论区" }],
    },
  ],
});
function fixture(): Recommendation {
  return {
    testObjectiveZh: "验证易用性表达能否提高点击意愿",
    hypothesisZh: "相比功能表达，易用性表达可能提高点击率，需实验验证",
    whyTestThisZh: "部分反馈提及设置负担，策略建议减少操作顾虑",
    context: "广告素材",
    coreVariable: "信息角度",
    groupA: { variableContentZh: "发现更多设备功能" },
    groupB: { variableContentZh: "了解设备操作方式" },
    sharedSetupZh: "两组固定图片、按钮、受众与落地页",
    metrics: [
      {
        metric: "CTR",
        role: "主要指标",
        reasonZh: "检验文案是否更能吸引关注",
        measurementZh: "点击次数除以曝光次数，两组统一口径",
      },
    ],
    insightIds: ["i1"],
    actionFields: ["messageAngle"],
    prerequisitesZh: "核实操作演示是否存在并保持两组一致",
  };
}
test("实验建议限制唯一变量、完整中文卡片与建议范围", () => {
  assert.equal(
    validateRecommendation(fixture(), input).coreVariable,
    "信息角度",
  );
  assert.throws(() =>
    validateRecommendation(
      { ...fixture(), coreVariable: ["信息角度", "广告位置"] },
      input,
    ),
  );
  assert.throws(() =>
    validateRecommendation({ ...fixture(), sampleSize: 1000 }, input),
  );
  assert.throws(() =>
    validateRecommendation(
      { ...fixture(), testObjectiveZh: "English only" },
      input,
    ),
  );
  assert.throws(() =>
    validateRecommendation({ ...fixture(), groupB: fixture().groupA }, input),
  );
  assert.throws(() =>
    validateRecommendation(
      { ...fixture(), prerequisitesZh: "每组样本量至少1000人" },
      input,
    ),
  );
  assert.ok(executionNotes.some((n) => n.includes("显著性判断由实际实验平台")));
});
test("不同场景指标必须匹配且只有一个主要指标", () => {
  for (const [context, metric] of [
    ["应用拉新", "InstallRate"],
    ["产品内容", "Retention"],
    ["电商转化", "PurchaseRate"],
  ] as const) {
    const r = fixture();
    r.context = context;
    r.metrics[0].metric = metric;
    assert.equal(validateRecommendation(r, input).metrics[0].metric, metric);
  }
  assert.throws(() =>
    validateRecommendation({ ...fixture(), context: "应用拉新" }, input),
  );
  const duplicate = fixture();
  duplicate.metrics.push({ ...duplicate.metrics[0] });
  assert.throws(() => validateRecommendation(duplicate, input));
  const twoPrimary = fixture();
  twoPrimary.metrics.push({ ...twoPrimary.metrics[0], metric: "CVR" });
  assert.throws(() => validateRecommendation(twoPrimary, input));
});
test("实验假设不得倒置基准与洞察方案，也不指定检验方法", () => {
  assert.throws(
    () =>
      validateRecommendation(
        {
          ...fixture(),
          hypothesisZh: "洞察方案可能在主要指标CVR上更好，待验证",
        },
        input,
      ),
    /主要指标/,
  );
  assert.throws(
    () =>
      validateRecommendation(
        {
          ...fixture(),
          groupA: { variableContentZh: "产品正面外观特写画面，写了解产品" },
          groupB: { variableContentZh: "用户使用情境画面，写简单操作" },
        },
        input,
      ),
    /更换画面/,
  );
  assert.throws(
    () =>
      validateRecommendation(
        {
          ...fixture(),
          hypothesisZh: "A组舒适表达相比B组功能表达可能获得更高转化率",
        },
        input,
      ),
    /基准/,
  );
  assert.throws(
    () =>
      validateRecommendation(
        { ...fixture(), prerequisitesZh: "确认平台支持分组T检验" },
        input,
      ),
    /统计检验/,
  );
  const medium = structuredClone(input);
  medium.insights[0].strength = "Medium";
  assert.throws(
    () =>
      validateRecommendation(
        { ...fixture(), whyTestThisZh: "低证据强度，需要验证设置负担" },
        medium,
      ),
    /证据等级/,
  );
});
test("建议引用仅允许关联策略支持的洞察", () => {
  assert.throws(() =>
    validateRecommendation({ ...fixture(), insightIds: ["invented"] }, input),
  );
  assert.throws(() =>
    validateRecommendation(
      { ...fixture(), actionFields: ["inventedField"] },
      input,
    ),
  );
  assert.throws(() =>
    validateInput({
      ...input,
      insights: [{ ...input.insights[0], id: "other" }],
    }),
  );
});
test("实验建议持久化且按策略内容隔离", async () => {
  const key = await recommendationKey("test-action", input);
  const changed = structuredClone(input);
  changed.action.messageAngle.textZh = "测试另一种需求表达";
  assert.notEqual(key, await recommendationKey("test-action", changed));
  assert.notEqual(key, await recommendationKey("other-action", input));
  await saveRecommendation({
    key,
    createdAt: new Date().toISOString(),
    recommendation: fixture(),
    usage: {
      attempts: 1,
      inputTokens: 0,
      outputTokens: 0,
      unmeteredAttempts: 0,
      model: "test",
    },
  });
  assert.equal(
    (await readRecommendation(key, input))?.recommendation.hypothesisZh,
    fixture().hypothesisZh,
  );
});
test("服务端拒绝越界输入、限制请求体、成功校验并处理鉴权失败", async () => {
  const request = (body: unknown) =>
    new Request("http://localhost/api/experiment-recommendations", {
      method: "POST",
      body: JSON.stringify(body),
    });
  assert.equal((await POST(request({ ...input, execute: true }))).status, 400);
  assert.equal((await POST(request({ text: "a".repeat(180001) }))).status, 413);
  const originalFetch = globalThis.fetch,
    provider = process.env.AI_PROVIDER,
    key = process.env.DEEPSEEK_API_KEY;
  process.env.AI_PROVIDER = "deepseek";
  process.env.DEEPSEEK_API_KEY = "test-only";
  try {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(fixture()) },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 200 },
      });
    };
    const res = await POST(request(input));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.usage.attempts, 1);
    assert.equal(body.recommendation.coreVariable, "信息角度");
    assert.equal(calls, 1);
    globalThis.fetch = async () => {
      calls++;
      return new Response("", { status: 401 });
    };
    assert.equal((await POST(request(input))).status, 502);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (provider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = provider;
    if (key === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = key;
  }
});
