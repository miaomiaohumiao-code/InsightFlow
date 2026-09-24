import { z } from "zod";
import { primarilyChinese } from "@/lib/chinese";
export const fields = {
  targetSegment: "目标需求人群",
  coreConsumerInsight: "核心消费者洞察",
  marketingOpportunity: "营销机会",
  valueProposition: "价值主张",
  coreSellingPoint: "核心卖点",
  messageAngle: "信息切入角度",
  creativeDirection: "创意方向",
  recommendedChannel: "推荐渠道及理由",
  recommendedPlacement: "推荐广告位置及理由",
  campaignIdea: "活动创意",
} as const;
const zh = z
  .string()
  .min(2)
  .max(2500)
  .refine(primarilyChinese, "必须以中文输出，不能仅在外语正文中添加中文词语");
const point = z
  .object({
    textZh: zh,
    reasonZh: zh,
    insightIds: z.array(z.string().min(1)).min(1).max(8),
  })
  .strict();
export const actionSchema = z
  .object({
    titleZh: zh,
    targetSegment: point,
    coreConsumerInsight: point,
    marketingOpportunity: point,
    valueProposition: point,
    coreSellingPoint: point,
    messageAngle: point,
    creativeDirection: point,
    recommendedChannel: point,
    recommendedPlacement: point,
    campaignIdea: point,
    validationPlanZh: zh,
  })
  .strict();
export type MarketingAction = z.infer<typeof actionSchema>;
export type MarketingMode = "separate" | "combine";
export function validateAction(value: unknown, ids: string[]) {
  const result = actionSchema.parse(value);
  if (
    /年龄|性别|职业|收入|男性|女性|男人|女人|男生|女生|学生|白领|上班族|宝妈|老人|老年|年轻|中年|\d+\s*岁|高薪|低薪|大学生|程序员|医生|教师|退休|富裕|贫困/u.test(
      result.targetSegment.textZh,
    )
  )
    throw new Error("目标人群只能使用需求标签，不能假设人口属性");
  const used = new Set<string>();
  for (const key of Object.keys(fields) as (keyof typeof fields)[]) {
    for (const id of result[key].insightIds) {
      if (!ids.includes(id)) throw new Error("策略引用了未选择的洞察");
      used.add(id);
    }
  }
  if (ids.some((id) => !used.has(id))) throw new Error("策略遗漏了所选洞察");
  if (ids.some((id) => !result.coreConsumerInsight.insightIds.includes(id)))
    throw new Error("共同需求必须解释所有所选洞察");
  return result;
}
