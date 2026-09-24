import type { Project } from "@/types/project";
import { brandName } from "@/types/project";
import type { Snapshot, Chunk, AnalysisGroup } from "@/types/analysis";

export const PROMPT_VERSION = "insightflow-v1.1.0-brand-evidence";
export const DEFAULT_MODEL = "gpt-4.1-mini-2025-04-14";
export async function hash(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
const norm = (s: string) => s.trim().toLocaleLowerCase().replace(/\s+/g, " ");
export async function createSnapshot(project: Project): Promise<Snapshot> {
  if (!project.preview?.confirmedAt) throw new Error("请先确认 Preview 数据。");
  const included = project.preview.records.filter(
    (r) => r.included && r.text.trim(),
  );
  if (!included.length) throw new Error("没有可分析的评论。");
  const canonical = {
    name: project.name,
    goal: project.researchGoal,
    customGoal: project.customGoal,
    ownBrandName: project.ownBrandName,
    sources: project.sources,
    records: project.preview.records,
    parserVersion: project.preview.parserVersion,
  };
  const inputHash = await hash(canonical);
  const sources = project.sources
    .filter((s) => included.some((r) => r.sourceId === s.id))
    .map((s) => {
      if (
        !s.platform.trim() ||
        !brandName(project, s).trim() ||
        !s.product.trim()
      )
        throw new Error("请补齐来源的平台、品牌和产品信息后再分析。");
      const validDate =
        !s.timeRange.unknown &&
        /^\d{4}-\d{2}-\d{2}$/.test(s.timeRange.start) &&
        /^\d{4}-\d{2}-\d{2}$/.test(s.timeRange.end) &&
        s.timeRange.start <= s.timeRange.end;
      return {
        sourceId: s.id,
        platformId: `platform:${norm(s.platform)}`,
        platformLabel: s.platform.trim(),
        brandId: `brand:${s.brandType}:${norm(brandName(project, s))}`,
        brandType: s.brandType,
        brandLabel: brandName(project, s).trim(),
        periodId: validDate
          ? `period:${s.timeRange.start}:${s.timeRange.end}`
          : null,
        periodStart: validDate ? s.timeRange.start : null,
        periodEnd: validDate ? s.timeRange.end : null,
        region: s.region.trim() || null,
        productTopic: s.product.trim(),
      };
    });
  const groups: AnalysisGroup[] = [];
  for (const [dimension, field] of [
    ["platform", "platformId"],
    ["period", "periodId"],
    ["brand", "brandId"],
  ] as const) {
    for (const id of new Set(
      sources.map((s) => s[field]).filter((id): id is string => !!id),
    )) {
      const members = sources.filter((s) => s[field] === id);
      groups.push({
        groupId: id,
        dimension,
        labelZh: `${dimension === "platform" ? "平台" : dimension === "period" ? "时间段" : "品牌"}：${id.split(":").slice(1).join(" · ")}`,
        sourceIds: members.map((s) => s.sourceId),
      });
    }
  }
  const chunks: Chunk[] = [];
  for (const r of included) {
    const raw = project.sources.find((s) => s.id === r.sourceId)?.rawText;
    if (raw?.slice(r.start, r.end) !== r.original)
      throw new Error("预览与原文不一致，请重新生成 Preview。");
    // Conservative UTF-8 byte bound; paragraph preference, with surrogate-safe fallback.
    let offset = 0;
    while (offset < r.original.length) {
      let length = Math.min(1800, r.original.length - offset);
      if (offset + length < r.original.length) {
        const paragraph = r.original.lastIndexOf("\n", offset + length);
        if (paragraph > offset + length / 2) length = paragraph - offset + 1;
        if (/[\uD800-\uDBFF]/.test(r.original[offset + length - 1])) length--;
      }
      const start = r.start + offset;
      chunks.push({
        id: `${r.id}:fragment:${offset}`,
        parentId: r.id,
        sourceId: r.sourceId,
        original: r.original.slice(offset, offset + length),
        start,
        end: start + length,
        flags: r.flags,
      });
      offset += length;
    }
  }
  return {
    id: `snapshot:${inputHash}`,
    hash: inputHash,
    projectId: project.id,
    goal:
      project.researchGoal === "自定义"
        ? project.customGoal
        : project.researchGoal,
    sources,
    groups,
    chunks,
    includedVocIds: included.map((r) => r.id),
    excludedDuplicateVocIds: project.preview.records
      .filter((r) => !r.included && r.exclusion === "duplicate")
      .map((r) => r.id),
    unresolvedBoundaryVocCount: included.filter(
      (r) =>
        !r.reviewed && r.flags.some((f) => f === "boundary" || f === "long"),
    ).length,
  };
}

export function batches<T>(items: T[], maxBytes = 18000, maxItems = 12): T[][] {
  const result: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const item of items) {
    const size = new TextEncoder().encode(JSON.stringify(item)).length;
    if (size > maxBytes)
      throw new Error(
        "单条派生数据超过安全批次预算，请缩小原文或重试更小的批次。",
      );
    if (
      current.length &&
      (bytes + size > maxBytes || current.length >= maxItems)
    ) {
      result.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += size;
  }
  if (current.length) result.push(current);
  return result;
}
