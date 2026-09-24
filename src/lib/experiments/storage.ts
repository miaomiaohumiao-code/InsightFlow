import { openDB } from "idb";
import type { Recommendation, RecommendationInput } from "./contract";
import { validateRecommendation } from "./contract";
import { hash } from "@/lib/analysis/snapshot";
export type SavedRecommendation = {
  key: string;
  createdAt: string;
  recommendation: Recommendation;
  usage: {
    attempts: number;
    inputTokens: number;
    outputTokens: number;
    unmeteredAttempts: number;
    model: string;
  };
};
export async function recommendationKey(
  actionKey: string,
  input: RecommendationInput,
) {
  return `ab-v1:${actionKey}:${await hash(input)}`;
}
async function database() {
  return openDB("insightflow-experiment-recommendations", 1, {
    upgrade(db) {
      db.createObjectStore("recommendations", { keyPath: "key" });
    },
  });
}
export async function readRecommendation(
  key: string,
  input: RecommendationInput,
): Promise<SavedRecommendation | undefined> {
  const db = await database();
  try {
    const row = (await db.get("recommendations", key)) as
      SavedRecommendation | undefined;
    if (row) validateRecommendation(row.recommendation, input);
    return row;
  } finally {
    db.close();
  }
}
export async function saveRecommendation(row: SavedRecommendation) {
  const db = await database();
  try {
    await db.put("recommendations", row);
  } finally {
    db.close();
  }
}
