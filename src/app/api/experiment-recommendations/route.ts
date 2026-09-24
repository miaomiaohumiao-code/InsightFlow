import "server-only";
import { publicAIEnabled } from "@/lib/analysis/access.server";
import { z } from "zod";
import {
  recommendationSchema,
  validateInput,
  validateRecommendation,
} from "@/lib/experiments/contract";
import { RECOMMENDATION_PROMPT } from "@/lib/experiments/prompt";
import {
  serverKey,
  serverModel,
  serverProvider,
} from "@/lib/analysis/provider.server";

export const runtime = "nodejs";
export const maxDuration = 180;
let active = 0;
export async function POST(request: Request) {
  if (!publicAIEnabled(request))
    return Response.json(
      { error: "此部署未启用公开 AI 调用。" },
      { status: 403 },
    );
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return Response.json({ error: "请求来源不匹配" }, { status: 403 });
  if (active >= 3)
    return Response.json(
      { error: "正在处理其他建议请求，请稍后重试" },
      { status: 429 },
    );
  active++;
  try {
    // Bound streamed bytes before decoding; a forged Content-Length cannot bypass this limit.
    const reader = request.body?.getReader();
    if (!reader)
      return Response.json({ error: "缺少策略和洞察" }, { status: 400 });
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 180000) {
        await reader.cancel();
        return Response.json(
          { error: "证据内容过大，请缩小策略范围" },
          { status: 413 },
        );
      }
      chunks.push(value);
    }
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.length;
    }
    let input;
    try {
      input = validateInput(JSON.parse(new TextDecoder().decode(buffer)));
    } catch {
      return Response.json(
        { error: "策略与洞察格式或引用不一致，请重新载入分析结果" },
        { status: 400 },
      );
    }
    const key = serverKey();
    if (!key)
      return Response.json(
        { error: "服务端尚未配置 AI 密钥" },
        { status: 503 },
      );
    const deepseek = serverProvider() === "deepseek",
      model = serverModel();
    const schema = z.toJSONSchema(recommendationSchema);
    const usage = {
      attempts: 0,
      inputTokens: 0,
      outputTokens: 0,
      unmeteredAttempts: 0,
      model,
    };
    let correction = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      usage.attempts++;
      let metered = false;
      try {
        const messages = [
          {
            role: "system",
            content: `${RECOMMENDATION_PROMPT}\nJSON Schema: ${JSON.stringify(schema)}\n${correction}`,
          },
          { role: "user", content: JSON.stringify(input) },
        ];
        const response = await fetch(
          deepseek
            ? "https://api.deepseek.com/chat/completions"
            : "https://api.openai.com/v1/responses",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${key}`,
            },
            signal: AbortSignal.any([
              request.signal,
              AbortSignal.timeout(45000),
            ]),
            body: JSON.stringify(
              deepseek
                ? {
                    model: model.replace(/^deepseek\//, ""),
                    thinking: { type: "disabled" },
                    max_tokens: 4500,
                    response_format: { type: "json_object" },
                    messages,
                  }
                : {
                    model,
                    store: false,
                    max_output_tokens: 4500,
                    input: messages,
                    text: {
                      format: {
                        type: "json_schema",
                        name: "experiment_recommendation",
                        strict: true,
                        schema,
                      },
                    },
                  },
            ),
          },
        );
        if (!response.ok) {
          if ([400, 401, 402, 403, 404].includes(response.status))
            return Response.json(
              {
                error: `AI 服务无法生成建议（${response.status}），请检查余额、密钥或模型配置。`,
                usage,
              },
              { status: 502 },
            );
          throw new Error("服务暂不可用");
        }
        const body = await response.json();
        if (body.usage) {
          metered = true;
          usage.inputTokens +=
            body.usage.prompt_tokens ?? body.usage.input_tokens ?? 0;
          usage.outputTokens +=
            body.usage.completion_tokens ?? body.usage.output_tokens ?? 0;
        }
        if (
          deepseek
            ? body.choices?.[0]?.finish_reason !== "stop"
            : body.status !== "completed"
        )
          throw new Error("输出未完成");
        const text = deepseek
          ? body.choices[0].message.content
          : body.output
              .flatMap(
                (o: { content?: { text?: string }[] }) => o.content ?? [],
              )
              .map((c: { text?: string }) => c.text ?? "")
              .join("");
        const recommendation = validateRecommendation(JSON.parse(text), input);
        if (!metered) usage.unmeteredAttempts++;
        return Response.json({ recommendation, usage });
      } catch (e) {
        console.warn(
          "Experiment recommendation validation:",
          e instanceof z.ZodError
            ? e.issues
                .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                .join("; ")
            : e instanceof Error
              ? e.message
              : "unknown error",
        );
        if (!metered) usage.unmeteredAttempts++;
        if (request.signal.aborted)
          return Response.json(
            { error: "建议请求已取消", usage },
            { status: 499 },
          );
        correction =
          e instanceof z.ZodError
            ? "上次输出字段或中文格式未通过校验，请严格遵守 Schema。"
            : e instanceof SyntaxError
              ? "上次不是合法 JSON，请仅返回 JSON。"
              : `上次输出未通过校验或请求失败：${e instanceof Error ? e.message.slice(0, 300) : "未知原因"}。检查引用、指标场景、唯一主要指标、单变量和样本量限制。`;
        if (attempt === 2)
          return Response.json(
            {
              error:
                "实验建议暂未通过校验或服务连接失败，请重试；原有策略和建议保留。",
              usage,
            },
            { status: 502 },
          );
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * (attempt + 1)),
        );
      }
    }
    return Response.json({ error: "实验建议未完成，请重试" }, { status: 502 });
  } catch {
    return Response.json({ error: "无法读取实验建议请求" }, { status: 400 });
  } finally {
    active--;
  }
}
