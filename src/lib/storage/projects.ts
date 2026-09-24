import { openDB, type DBSchema } from "idb";
import { z } from "zod";
import { researchGoals, type Project } from "@/types/project";
import { vocPreviewSchema } from "@/types/voc";

const projectSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  name: z.string(),
  researchGoal: z.enum(researchGoals),
  customGoal: z.string(),
  ownBrandName: z.string(),
  sources: z.array(
    z.object({
      id: z.string(),
      platform: z.string(),
      brandType: z.enum(["own", "competitor"]),
      competitorName: z.string(),
      timeRange: z.object({
        unknown: z.boolean(),
        start: z.string(),
        end: z.string(),
      }),
      region: z.string(),
      product: z.string(),
      rawText: z.string(),
    }),
  ),
  createdAt: z.string(),
  updatedAt: z.string(),
  revision: z.number().int().nonnegative(),
  preview: vocPreviewSchema.optional(),
});

interface InsightFlowDB extends DBSchema {
  projects: { key: string; value: Project; indexes: { "by-updated": string } };
}

export class ConflictError extends Error {
  constructor() {
    super(
      "此项目已在其他标签页更新。请先复制当前未保存的内容，再重新加载项目。",
    );
  }
}

function database() {
  return openDB<InsightFlowDB>("insightflow", 1, {
    upgrade(db) {
      db.createObjectStore("projects", { keyPath: "id" }).createIndex(
        "by-updated",
        "updatedAt",
      );
    },
  });
}

export async function listProjects(): Promise<Project[]> {
  const db = await database();
  try {
    const rows = await db.getAll("projects");
    return rows
      .map((row) => projectSchema.parse(row))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } finally {
    db.close();
  }
}

export async function getProject(id: string): Promise<Project | undefined> {
  const db = await database();
  try {
    const row = await db.get("projects", id);
    return row ? projectSchema.parse(row) : undefined;
  } finally {
    db.close();
  }
}

// Compare revisions inside the transaction so another tab cannot silently overwrite edits.
export async function saveProject(
  project: Project,
  expectedRevision: number | null,
): Promise<Project> {
  const checked = projectSchema.parse(project);
  const db = await database();
  try {
    const tx = db.transaction("projects", "readwrite");
    const existing = await tx.store.get(project.id);
    if (
      expectedRevision === null
        ? !!existing
        : !existing || existing.revision !== expectedRevision
    ) {
      await tx.done;
      throw new ConflictError();
    }
    const saved = { ...checked, revision: (existing?.revision ?? -1) + 1 };
    await tx.store.put(saved);
    await tx.done;
    return saved;
  } finally {
    db.close();
  }
}

export function storageError(error: unknown): string {
  if (error instanceof ConflictError) return error.message;
  if (error instanceof DOMException && error.name === "QuotaExceededError")
    return "浏览器存储空间不足，尚未保存。请保留页面并复制原文备份后重试。";
  return "无法读取或保存浏览器数据。请检查浏览器存储权限；未保存的内容请先复制备份。";
}
