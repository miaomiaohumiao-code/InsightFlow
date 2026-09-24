import "server-only";
import { callOpenAI, serverModel as openAIModel } from "./openai.server";
import type { Task } from "@/types/analysis";

export function serverProvider(): "openai" | "deepseek" {
  const value = process.env.AI_PROVIDER?.trim() || "deepseek";
  if (value !== "openai" && value !== "deepseek")
    throw new Error("AI_PROVIDER 必须为 openai 或 deepseek。");
  return value;
}
export function serverModel() {
  // Provider namespace is persisted and hashed, so checkpoints cannot cross providers.
  return serverProvider() === "deepseek"
    ? `deepseek/${process.env.DEEPSEEK_MODEL?.trim() || "deepseek-flash"}`
    : openAIModel();
}
export function serverKey() {
  return (
    (serverProvider() === "deepseek"
      ? process.env.DEEPSEEK_API_KEY
      : process.env.OPENAI_API_KEY
    )?.trim() || ""
  );
}
export function callAnalysis(task: Task) {
  return callOpenAI(task, {
    provider: serverProvider(),
    model: serverModel(),
    key: serverKey(),
  });
}
