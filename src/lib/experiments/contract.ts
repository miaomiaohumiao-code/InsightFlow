import { z } from "zod";
import { primarilyChinese } from "@/lib/chinese";
import { fields, actionSchema, validateAction } from "@/lib/marketing/contract";

export const variables = [
  "开头吸引点",
  "核心卖点",
  "信息角度",
  "行动号召",
  "视觉风格",
  "创意形式",
  "广告位置",
  "优惠传播信息",
] as const;
export const metricLabels = {
  CTR: "点击率",
  CVR: "转化率",
  CPA: "单次转化成本",
  InstallRate: "安装率",
  CPI: "单次安装成本",
  ActivationRate: "激活率",
  EngagementRate: "互动率",
  UsageFrequency: "使用频次",
  Retention: "留存率",
  AddToCartRate: "加购率",
  PurchaseRate: "购买率",
} as const;
export const contextMetrics = {
  广告素材: ["CTR", "CVR", "CPA"],
  应用拉新: ["InstallRate", "CPI", "ActivationRate"],
  产品内容: ["EngagementRate", "UsageFrequency", "Retention"],
  电商转化: ["AddToCartRate", "PurchaseRate", "CVR", "CPA"],
} as const;
const zh = z
  .string()
  .min(2)
  .max(2000)
  .refine(primarilyChinese, "必须以中文输出，不能仅在外语正文中添加中文词语");
export const recommendationSchema = z
  .object({
    testObjectiveZh: zh,
    hypothesisZh: zh,
    whyTestThisZh: zh,
    context: z.enum(["广告素材", "应用拉新", "产品内容", "电商转化"]),
    coreVariable: z.enum(variables),
    groupA: z.object({ variableContentZh: zh }).strict(),
    groupB: z.object({ variableContentZh: zh }).strict(),
    sharedSetupZh: zh,
    metrics: z
      .array(
        z
          .object({
            metric: z.enum([
              "CTR",
              "CVR",
              "CPA",
              "InstallRate",
              "CPI",
              "ActivationRate",
              "EngagementRate",
              "UsageFrequency",
              "Retention",
              "AddToCartRate",
              "PurchaseRate",
            ]),
            role: z.enum(["主要指标", "辅助指标"]),
            reasonZh: zh,
            measurementZh: zh,
          })
          .strict(),
      )
      .min(1)
      .max(3),
    insightIds: z.array(z.string().min(1)).min(1).max(8),
    actionFields: z
      .array(
        z.enum(
          Object.keys(fields) as [
            keyof typeof fields,
            ...(keyof typeof fields)[],
          ],
        ),
      )
      .min(1)
      .max(10),
    prerequisitesZh: zh,
  })
  .strict();
export type Recommendation = z.infer<typeof recommendationSchema>;
export const inputSchema = z
  .object({
    action: actionSchema,
    insights: z
      .array(
        z
          .object({
            id: z.string().min(1).max(200),
            titleZh: zh,
            implicationZh: zh,
            strength: z.enum(["High", "Medium", "Low"]),
            limitationsZh: z.array(z.string().max(2500)).max(30),
            quotes: z
              .array(
                z
                  .object({
                    originalText: z.string().max(12000),
                    platform: z.string().max(500),
                  })
                  .strict(),
              )
              .max(8),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();
export type RecommendationInput = z.infer<typeof inputSchema>;
export function validateInput(value: unknown) {
  const input = inputSchema.parse(value);
  const ids = input.insights.map((i) => i.id);
  if (new Set(ids).size !== ids.length) throw new Error("洞察引用重复");
  validateAction(input.action, ids);
  return input;
}
export function validateRecommendation(
  value: unknown,
  input: RecommendationInput,
) {
  const result = recommendationSchema.parse(value);
  const ids = input.insights.map((i) => i.id);
  if (
    result.insightIds.some((id) => !ids.includes(id)) ||
    new Set(result.insightIds).size !== result.insightIds.length
  )
    throw new Error("实验建议引用了无效洞察");
  if (new Set(result.actionFields).size !== result.actionFields.length)
    throw new Error("策略引用重复");
  const actionIds = new Set(
    result.actionFields.flatMap((f) => input.action[f].insightIds),
  );
  if (result.insightIds.some((id) => !actionIds.has(id)))
    throw new Error("洞察与策略依据不一致");
  if (
    result.groupA.variableContentZh.trim() ===
    result.groupB.variableContentZh.trim()
  )
    throw new Error("两组方案必须有区别");
  const allowed: readonly string[] = contextMetrics[result.context];
  if (
    result.metrics.some((m) => !allowed.includes(m.metric)) ||
    new Set(result.metrics.map((m) => m.metric)).size !==
      result.metrics.length ||
    result.metrics.filter((m) => m.role === "主要指标").length !== 1
  )
    throw new Error("指标必须符合场景，且只有一个主要指标");
  const text = JSON.stringify(result);
  const primary = result.metrics.find((m) => m.role === "主要指标")!;
  for (const [code, label] of Object.entries(metricLabels)) {
    if (
      code !== primary.metric &&
      new RegExp(`主要指标(?:为|是|：|\\s)*(${code}\\b|${label})`).test(
        result.hypothesisZh,
      )
    )
      throw new Error("实验假设中的主要指标必须与推荐指标一致");
  }
  if (
    !["视觉风格", "创意形式", "广告位置"].includes(result.coreVariable) &&
    /特写|情境画面|场景画面|外观展示|人物画面/.test(
      result.groupA.variableContentZh + result.groupB.variableContentZh,
    )
  )
    throw new Error(
      "文案变量的 A/B 两组只能输出文案，不能同时更换画面；共同画面放在 sharedSetupZh",
    );
  if (
    /(?:A\s*组)[\s\S]*(?:相比|相较|优于|胜过|比)[\s\S]*B\s*组/u.test(
      result.hypothesisZh,
    )
  )
    throw new Error(
      "A 组必须是基准，B 组是洞察方案；请提出 B 相比 A 的待验证假设",
    );
  if (/[tTｔＴ]\s*检验|卡方检验|方差分析/u.test(text))
    throw new Error("不要指定统计检验方法，交由实际实验平台和负责人决定");
  if (
    /低证据强度|证据强度[为：· ]*低/u.test(result.whyTestThisZh) &&
    !input.insights.some(
      (i) => result.insightIds.includes(i.id) && i.strength === "Low",
    )
  )
    throw new Error("不得将输入洞察的证据等级擅自改为低");
  if (
    /(?:样本量|每组样本|每组人数|每组用户|每组|单组)(?:为|需|要|至少|不少于|达到|约|建议|：|:|\s)*(?:\d|[一二三四五六七八九十百千万]+(?:人|名|个|条))|(?:显著性|置信水平)(?:为|达到|：|:|\s)*\d|统计显著|已验证有效|已证实提升/u.test(
      text,
    )
  )
    throw new Error("不能指定样本量或判断实验显著性");
  return result;
}
export const executionNotes = [
  "本卡片是待验证的实验建议，应交由真实广告平台、产品实验平台或企业内部实验系统执行。",
  "A/B 两组只改变标注的核心变量；其他素材、受众条件、落地页、预算和周期尽量保持一致。测试广告位置时，仅位置作为差异。",
  "开始前在实际平台确认转化事件、归因口径与观察窗口，两组保持一致；本平台不收集实验结果。",
  "具体样本量、流量分配、停止规则和显著性判断由实际实验平台及实验负责人决定，本平台不作计算或判断。",
  "A 组为建议基准，未提供现有素材，不能当作当前正在投放的方案。两组涉及的性能、服务与优惠均须核实后使用。",
] as const;
