import "server-only";
import { publicAIEnabled as enabled } from "@/lib/analysis/access.server";
import { z } from "zod";
import { createHash } from "node:crypto";
import { AnalysisError, emptyUsage } from "@/lib/analysis/openai.server";
import {
  callAnalysis,
  serverKey,
  serverModel,
  serverProvider,
} from "@/lib/analysis/provider.server";
import type { Task, TaskReply } from "@/types/analysis";
import { PROMPT_VERSION } from "@/lib/analysis/snapshot";

export const runtime = "nodejs";
export const maxDuration = 180;
const text = z.string().max(12000);
const chunk = z
  .object({
    id: text,
    parentId: text,
    sourceId: text,
    original: z.string().max(2000),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    flags: z.array(text).max(8),
  })
  .strict();
const source = z
  .object({
    sourceId: text,
    platformId: text,
    platformLabel: text,
    brandId: text,
    brandType: z.enum(["own", "competitor"]),
    brandLabel: text,
    periodId: text.nullable(),
    periodStart: text.nullable(),
    periodEnd: text.nullable(),
    region: text.nullable(),
    productTopic: text,
  })
  .strict();
const quote = z
  .object({
    quoteId: text,
    vocId: text,
    sourceId: text,
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    originalText: text,
    translationZh: text.nullable(),
  })
  .strict();
const packet = z
  .object({
    vocId: text,
    parentId: text,
    sourceId: text,
    sentiment: text,
    aspects: z
      .array(
        z
          .object({
            category: text,
            labelZh: text,
            assertionZh: text,
            polarity: text,
            quoteIds: z.array(text).max(12),
          })
          .strict(),
      )
      .max(20),
    quotes: z.array(quote).max(40),
  })
  .strict();
const envelope = z
  .object({
    model: z.string().max(100),
    task: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("extract"),
          input: z
            .object({
              snapshotId: text,
              batchId: text,
              records: z.array(chunk).min(1).max(12),
            })
            .strict(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("aggregate"),
          input: z
            .object({
              snapshotId: text,
              goal: text,
              sources: z.array(source).max(60),
              groups: z
                .array(
                  z
                    .object({
                      groupId: text,
                      dimension: z.enum(["platform", "period", "brand"]),
                      labelZh: text,
                      sourceIds: z.array(text).max(60),
                    })
                    .strict(),
                )
                .max(180),
              packets: z.array(packet).min(1).max(12),
              previous: z.unknown(),
            })
            .strict(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("assign"),
          input: z
            .object({
              snapshotId: text,
              batchId: text,
              targets: z
                .array(
                  z
                    .object({
                      id: text,
                      textZh: text,
                      sourceIds: z.array(text).max(60),
                      sentimentApplicable: z.boolean(),
                    })
                    .strict(),
                )
                .min(1)
                .max(3),
              packets: z.array(packet).min(1).max(12),
            })
            .strict(),
        })
        .strict(),
    ]),
  })
  .strict();

const cache = new Map<string, { at: number; promise: Promise<TaskReply> }>();
const counts = new Map<string, { at: number; count: number }>();
export async function GET(request: Request) {
  return Response.json(
    {
      configured: !!serverKey(),
      enabled: enabled(request),
      model: serverModel(),
      provider: serverProvider(),
      maxAttempts: 250,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  const model = serverModel();
  if (!enabled(request))
    return Response.json(
      {
        error: "此部署未启用公开 AI 调用。请在服务端配置后再使用。",
        usage: emptyUsage(model),
      },
      { status: 403 },
    );
  if (
    request.headers.get("origin") &&
    request.headers.get("origin") !== new URL(request.url).origin
  )
    return Response.json(
      { error: "不接受跨站分析请求。", usage: emptyUsage(model) },
      { status: 403 },
    );
  if (!request.headers.get("content-type")?.includes("application/json"))
    return Response.json(
      { error: "请求格式应为 JSON。", usage: emptyUsage(model) },
      { status: 415 },
    );
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error("empty");
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 180000) {
        await reader.cancel();
        return Response.json(
          {
            error: "当前任务超过请求预算，请缩小输入。",
            usage: emptyUsage(model),
          },
          { status: 413 },
        );
      }
      chunks.push(value);
    }
    const input = envelope.parse(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );
    if (input.model !== model)
      return Response.json(
        {
          error: "服务端模型配置已变化。请为当前数据启动新的分析。",
          usage: emptyUsage(model),
        },
        { status: 409 },
      );
    if (input.task.kind === "aggregate" && input.task.input.previous !== null) {
      const { assertSchema } = await import("@/lib/analysis/schemas");
      assertSchema("aggregate", input.task.input.previous);
    }
    const task = input.task as Task;
    const key = createHash("sha256")
      .update(JSON.stringify({ task, model, promptVersion: PROMPT_VERSION }))
      .digest("hex");
    for (const [k, value] of cache)
      if (Date.now() - value.at > 15 * 60000) cache.delete(k);
    if (cache.has(key))
      return Response.json(await cache.get(key)!.promise, {
        headers: { "Cache-Control": "no-store" },
      });
    const client =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    for (const [k, v] of counts)
      if (Date.now() - v.at > 60000) counts.delete(k);
    const bucket = counts.get(client) ?? { at: Date.now(), count: 0 };
    if (bucket.count >= 30)
      return Response.json(
        { error: "请求过于频繁，请一分钟后续跑。", usage: emptyUsage(model) },
        { status: 429 },
      );
    bucket.count++;
    counts.set(client, bucket);
    if (cache.size >= 200) cache.delete(cache.keys().next().value!);
    const promise = callAnalysis(task);
    cache.set(key, { at: Date.now(), promise });
    try {
      return Response.json(await promise, {
        headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      cache.delete(key);
      throw error;
    }
  } catch (error) {
    if (error instanceof AnalysisError)
      return Response.json(
        {
          error: error.message,
          usage: error.usage,
          retryable: error.retryable,
        },
        { status: error.status },
      );
    return Response.json(
      {
        error: "请求数据不符合分析契约，或任务数据过大。",
        usage: emptyUsage(model),
      },
      { status: 400 },
    );
  }
}
