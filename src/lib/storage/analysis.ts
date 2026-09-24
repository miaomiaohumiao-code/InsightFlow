import { openDB, type DBSchema } from "idb";
import type { Checkpoint } from "@/types/analysis";

interface AnalysisDB extends DBSchema {
  runs: { key: string; value: Checkpoint; indexes: { "by-project": string } };
}
function database() {
  return openDB<AnalysisDB>("insightflow-analysis", 1, {
    upgrade(db) {
      db.createObjectStore("runs", { keyPath: "id" }).createIndex(
        "by-project",
        "snapshot.projectId",
      );
    },
  });
}
export async function saveAnalysis(value: Checkpoint) {
  const db = await database();
  try {
    await db.put("runs", structuredClone(value));
  } finally {
    db.close();
  }
}
export async function latestAnalysis(projectId: string) {
  return (await analysisHistory(projectId))[0];
}
export async function analysisHistory(projectId: string) {
  const db = await database();
  try {
    const records = await db.getAllFromIndex("runs", "by-project", projectId);
    return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } finally {
    db.close();
  }
}
export async function latestCompletedAnalysis(projectId: string) {
  return (await analysisHistory(projectId)).find(
    (r) => r.status === "complete" && r.result?.coverage.status === "complete",
  );
}
