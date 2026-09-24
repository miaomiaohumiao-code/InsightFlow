import type { VOCPreview } from "./voc";

export const researchGoals = [
  "新产品上市",
  "寻找新传播卖点",
  "竞品分析",
  "理解用户需求",
  "自定义",
] as const;
export type ResearchGoal = (typeof researchGoals)[number];
export type BrandType = "own" | "competitor";

export interface Source {
  id: string;
  platform: string;
  brandType: BrandType;
  competitorName: string;
  timeRange: { unknown: boolean; start: string; end: string };
  region: string;
  product: string;
  rawText: string;
}

export interface Project {
  schemaVersion: 1;
  id: string;
  name: string;
  researchGoal: ResearchGoal;
  customGoal: string;
  ownBrandName: string;
  sources: Source[];
  createdAt: string;
  updatedAt: string;
  revision: number;
  preview?: VOCPreview;
}

export function createSource(brandType: BrandType = "own"): Source {
  return {
    id: crypto.randomUUID(),
    platform: "",
    brandType,
    competitorName: "",
    timeRange: { unknown: true, start: "", end: "" },
    region: "",
    product: "",
    rawText: "",
  };
}

export function createProject(): Project {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    name: "",
    researchGoal: "新产品上市",
    customGoal: "",
    ownBrandName: "",
    sources: [createSource()],
    createdAt: now,
    updatedAt: now,
    revision: 0,
  };
}

export const brandName = (project: Project, source: Source) =>
  source.brandType === "own" ? project.ownBrandName : source.competitorName;

export function sourceIssues(project: Project, source: Source): string[] {
  const issues: string[] = [];
  if (!source.platform.trim()) issues.push("平台");
  if (!brandName(project, source).trim()) issues.push("品牌名称");
  if (!source.product.trim()) issues.push("产品 / 话题");
  if (!source.rawText.trim()) issues.push("VOC 原文");
  if (!source.timeRange.unknown) {
    if (!source.timeRange.start || !source.timeRange.end)
      issues.push("完整时间范围");
    else if (source.timeRange.start > source.timeRange.end)
      issues.push("有效时间范围");
  }
  return issues;
}
