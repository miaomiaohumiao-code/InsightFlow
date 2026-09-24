import { parseModelJson, ModelJsonError } from "./model-json";
import "server-only";
import type { Task, TaskReply, Usage, TaskValue } from "@/types/analysis";
import { schemas, sanitizePriorityMetadata } from "./schemas";
import { SYSTEM, INSTRUCTIONS } from "./prompts";
import {
  validateTask,
  constrainAssignmentScope,
  reconcileOpportunityEvidence,
} from "./validation";
import { DEFAULT_MODEL } from "./snapshot";
import { assignmentRepair } from "./assignment-repair";

export class AnalysisError extends Error {
  constructor(
    message: string,
    public usage: Usage,
    public retryable: boolean,
    public status = 502,
  ) {
    super(message);
  }
}
export const emptyUsage = (model: string): Usage => ({
  attempts: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  unmeteredAttempts: 0,
  estimatedCostUsd: 0,
  model,
});
export function estimateCost(usage: Usage): number | null {
  if (!usage.model.startsWith("gpt-4.1-mini")) return null;
  return (
    ((usage.inputTokens - usage.cachedInputTokens) * 0.4 +
      usage.cachedInputTokens * 0.1 +
      usage.outputTokens * 1.6) /
    1e6
  );
}
type Config = {
  key: string;
  model: string;
  provider?: "openai" | "deepseek";
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
};
export async function callOpenAI(
  task: Task,
  config: Config,
): Promise<TaskReply> {
  const usage = emptyUsage(config.model);
  const deepseek = config.provider === "deepseek";
  const providerName = deepseek ? "DeepSeek" : "OpenAI";
  if (!config.key.trim())
    throw new AnalysisError(
      `服务端未配置 ${deepseek ? "DEEPSEEK_API_KEY" : "OPENAI_API_KEY"}。请在 .env.local 配置后重启服务。`,
      usage,
      false,
      503,
    );
  const fetcher = config.fetcher ?? fetch;
  const sleep =
    config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let correction = "";
  const repair = task.kind === "assign" ? assignmentRepair(task) : null;
  let requestTask = task;
  for (let attempt = 0; attempt < 3; attempt++) {
    let retryable = true;
    let status = 502;
    let message = "模型服务暂时不可用，请重试。";
    let retryAfter = 0;
    usage.attempts++;
    try {
      const response = await fetcher(
        deepseek
          ? "https://api.deepseek.com/chat/completions"
          : "https://api.openai.com/v1/responses",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.key}`,
          },
          body: JSON.stringify(
            deepseek
              ? {
                  model: config.model.replace(/^deepseek\//, ""),
                  stream: false,
                  thinking: { type: "disabled" },
                  temperature: 0,
                  max_tokens: task.kind === "aggregate" ? 24000 : 9000,
                  response_format: { type: "json_object" },
                  messages: [
                    {
                      role: "system",
                      content: `${SYSTEM}\n${INSTRUCTIONS[task.kind]}\n只返回一个 JSON 对象，必须满足以下 JSON Schema（不是让你输出 Schema 本身）：\n${JSON.stringify(schemas[task.kind])}\n${correction}`,
                    },
                    {
                      role: "user",
                      content: JSON.stringify(requestTask.input),
                    },
                  ],
                }
              : {
                  model: config.model,
                  store: false,
                  max_output_tokens: task.kind === "aggregate" ? 12000 : 9000,
                  input: [
                    {
                      role: "system",
                      content: `${SYSTEM}\n${INSTRUCTIONS[task.kind]}\n${correction}`,
                    },
                    {
                      role: "user",
                      content: JSON.stringify(requestTask.input),
                    },
                  ],
                  text: {
                    format: {
                      type: "json_schema",
                      name: `insightflow_${task.kind}`,
                      strict: true,
                      schema: schemas[task.kind],
                    },
                  },
                },
          ),
          signal: AbortSignal.timeout(config.timeoutMs ?? 45000),
        },
      );
      if (!response.ok) {
        usage.unmeteredAttempts++;
        retryable =
          response.status === 429 ||
          response.status >= 500 ||
          response.status === 408;
        status = response.status === 401 || response.status === 403 ? 503 : 502;
        message =
          response.status === 401 || response.status === 403
            ? `${providerName} 密钥无效或模型访问权限不足，请检查服务端配置。`
            : response.status === 402
              ? `${providerName} 余额不足，请充值后继续；已完成批次保留。`
              : response.status === 429
                ? `${providerName} 配额或速率受限，请检查余额并稍后重试。`
                : `${providerName} 请求失败（${response.status}），请检查模型配置或稍后重试。`;
        retryAfter =
          Math.min(Number(response.headers.get("retry-after")) || 0, 5) * 1000;
        if (response.status === 429) {
          const body = await response.json().catch(() => ({}));
          if (body?.error?.code === "insufficient_quota") retryable = false;
        }
        throw new AnalysisError(message, usage, retryable, status);
      }
      const body = await response.json();
      if (body.usage) {
        usage.inputTokens +=
          (deepseek ? body.usage.prompt_tokens : body.usage.input_tokens) ?? 0;
        usage.outputTokens +=
          (deepseek
            ? body.usage.completion_tokens
            : body.usage.output_tokens) ?? 0;
        usage.cachedInputTokens +=
          (deepseek
            ? body.usage.prompt_cache_hit_tokens
            : body.usage.input_tokens_details?.cached_tokens) ?? 0;
      } else usage.unmeteredAttempts++;
      const content = (body.output ?? []).flatMap(
        (o: { content?: Array<{ type: string; text?: string }> }) =>
          o.content ?? [],
      );
      if (content.some((c: { type: string }) => c.type === "refusal"))
        throw new AnalysisError(
          "模型拒绝处理本批数据，请检查输入后重试。",
          usage,
          false,
        );
      if (
        deepseek
          ? body.choices?.[0]?.finish_reason !== "stop"
          : body.status !== "completed"
      )
        throw new AnalysisError(
          "模型输出未完成，本批结果未保存；请缩小输入后重试。",
          usage,
          false,
        );
      let value = parseModelJson(
        deepseek
          ? body.choices?.[0]?.message?.content || ""
          : content
              .filter((c: { type: string }) => c.type === "output_text")
              .map((c: { text: string }) => c.text)
              .join(""),
      ) as TaskValue;
      try {
        if (task.kind === "aggregate")
          value = sanitizePriorityMetadata(value) as TaskValue;
        value = constrainAssignmentScope(task, value);
        if (repair) value = repair.accept(value);
        value = reconcileOpportunityEvidence(task, value);
        validateTask(task, value);
      } catch (error) {
        if (repair) requestTask = repair.remaining();
        correction = `上次输出未通过校验：${error instanceof Error ? error.message : "结构错误"}。修复错误，不得编造。`;
        throw new AnalysisError(
          `模型输出未通过校验：${error instanceof Error ? error.message : "结构错误"}`,
          usage,
          true,
        );
      }
      usage.estimatedCostUsd = estimateCost(usage);
      return { data: value, usage };
    } catch (error) {
      if (error instanceof AnalysisError) {
        retryable = error.retryable;
        message = error.message;
        status = error.status;
      } else {
        if (error instanceof SyntaxError)
          correction =
            "上次响应无法解析为 JSON。请输出一个完整、紧凑的 JSON 对象，不使用 Markdown 代码围栏；字符串中的换行和双引号必须正确转义。压缩所有说明，每条摘要和建议最多 80 个汉字，每组证据最多 3 个引文 ID，但必须保留 Schema 所有必填字段。";
        if (!(error instanceof SyntaxError)) usage.unmeteredAttempts++;
        message =
          error instanceof SyntaxError
            ? error instanceof ModelJsonError
              ? error.message + "。已尝试修正，请勿连续重复重试。"
              : "服务商响应不是有效 JSON，请稍后继续。"
            : "网络中断或请求超时，请重试。";
      }
      usage.estimatedCostUsd = estimateCost(usage);
      if (!retryable || attempt === 2)
        throw new AnalysisError(message, usage, retryable, status);
      await sleep(
        Math.max(retryAfter, 700 * 2 ** attempt + Math.random() * 300),
      );
    }
  }
  throw new AnalysisError("分析请求失败。", usage, true);
}
export function serverModel() {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
}
