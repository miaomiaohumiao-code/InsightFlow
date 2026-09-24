import type {
  AnalysisDraft,
  BatchExtraction,
  Checkpoint,
  EvidenceAssignment,
  Packet,
  Snapshot,
  Task,
  TaskReply,
  Usage,
} from "@/types/analysis";
import { batches, hash, PROMPT_VERSION } from "./snapshot";
import { packetsFrom, targetsFrom, validateTask } from "./validation";
import { assemble, normalizeConditional } from "./assemble";

export const blankUsage = (model: string): Usage => ({
  attempts: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  unmeteredAttempts: 0,
  estimatedCostUsd: 0,
  model,
});
export class TaskFailure extends Error {
  constructor(
    message: string,
    public usage?: Usage,
    public fatal = false,
  ) {
    super(message);
  }
}
export function createCheckpoint(
  snapshot: Snapshot,
  model: string,
): Checkpoint {
  const now = new Date().toISOString();
  return {
    version: 1,
    id: crypto.randomUUID(),
    snapshot,
    model,
    promptVersion: PROMPT_VERSION,
    createdAt: now,
    updatedAt: now,
    status: "paused",
    phase: "等待开始",
    completedTasks: 0,
    totalTasks: batches(snapshot.chunks).length,
    usage: blankUsage(model),
    replies: {},
    pendingTaskIds: [],
    error: null,
    result: null,
  };
}
function addUsage(to: Usage, next: Usage) {
  for (const key of [
    "attempts",
    "inputTokens",
    "outputTokens",
    "cachedInputTokens",
    "unmeteredAttempts",
  ] as const)
    to[key] += next[key];
  to.estimatedCostUsd =
    to.estimatedCostUsd === null || next.estimatedCostUsd === null
      ? null
      : to.estimatedCostUsd + next.estimatedCostUsd;
}
type Options = {
  request: (
    task: Task,
    key: string,
    model: string,
    signal?: AbortSignal,
  ) => Promise<TaskReply>;
  persist: (checkpoint: Checkpoint) => Promise<void>;
  onProgress?: (checkpoint: Checkpoint) => void;
  signal?: AbortSignal;
  maxAttempts?: number;
};
export function balancePackets(
  packets: Packet[],
  snapshot: Snapshot,
): Packet[] {
  const brands = new Map(snapshot.sources.map((s) => [s.sourceId, s.brandId]));
  const queues = new Map<string, Packet[]>();
  for (const packet of packets) {
    const brand = brands.get(packet.sourceId) ?? packet.sourceId;
    if (!queues.has(brand)) queues.set(brand, []);
    queues.get(brand)!.push(packet);
  }
  // Interleave brands without dropping or duplicating comments or changing counts.
  const result: Packet[] = [];
  for (let i = 0; result.length < packets.length; i++)
    for (const queue of queues.values()) if (queue[i]) result.push(queue[i]);
  return result;
}
export async function runAnalysis(
  initial: Checkpoint,
  options: Options,
): Promise<Checkpoint> {
  const state = structuredClone(initial);
  const { snapshot } = state;
  // Cached replies from abandoned aggregation branches are reusable, but are not
  // completed tasks on the current execution path.
  const completed = new Set<string>();
  state.completedTasks = 0;
  const emit = async () => {
    state.updatedAt = new Date().toISOString();
    await options.persist(structuredClone(state));
    options.onProgress?.(structuredClone(state));
  };
  const checkPause = () => {
    if (options.signal?.aborted)
      throw new Error("分析已暂停，已完成批次保留。");
  };
  async function perform(task: Task) {
    checkPause();
    const key = await hash({
      task,
      model: state.model,
      promptVersion: state.promptVersion,
    });
    const cached = state.replies[key];
    if (cached) {
      try {
        validateTask(task, cached.data);
        completed.add(key);
        state.completedTasks = completed.size;
        await emit();
        return cached;
      } catch {
        // A tightened contract may invalidate older intermediates; do not reuse them.
        delete state.replies[key];
        state.completedTasks = completed.size;
        state.result = null;
        await emit();
      }
    }
    if (state.usage.attempts + 3 > (options.maxAttempts ?? 250))
      throw new Error(
        "本次分析达到 250 次调用安全上限。已保存检查点，请缩小数据或调整服务端预算。",
      );
    // Persist intent before any paid request. A lost HTTP reply cannot be mistaken for zero usage.
    if (!state.pendingTaskIds.includes(key)) state.pendingTaskIds.push(key);
    await emit();
    try {
      const reply = await options.request(
        task,
        key,
        state.model,
        options.signal,
      );
      addUsage(state.usage, reply.usage);
      validateTask(task, reply.data);
      state.replies[key] = reply;
      state.pendingTaskIds = state.pendingTaskIds.filter((id) => id !== key);
      completed.add(key);
      state.completedTasks = completed.size;
      await emit();
      return reply;
    } catch (error) {
      if (error instanceof TaskFailure && error.usage) {
        addUsage(state.usage, error.usage);
        state.pendingTaskIds = state.pendingTaskIds.filter((id) => id !== key);
      }
      await emit();
      throw error;
    }
  }
  try {
    state.status = "running";
    state.error = null;
    await emit();
    const chunks = batches(snapshot.chunks);
    const packets: Packet[] = [];
    let failed = 0;
    for (let index = 0; index < chunks.length; index++) {
      checkPause();
      state.phase = `提取主题和证据：第 ${index + 1}/${chunks.length} 批`;
      try {
        const reply = await perform({
          kind: "extract",
          input: {
            snapshotId: snapshot.id,
            batchId: `extract:${index}`,
            records: chunks[index],
          },
        });
        packets.push(
          ...packetsFrom(reply.data as BatchExtraction, chunks[index]),
        );
      } catch (error) {
        if (error instanceof TaskFailure && error.fatal) throw error;
        failed++;
        state.error = error instanceof Error ? error.message : "批次提取失败。";
        await emit();
      }
    }
    if (failed)
      throw new Error(
        `${failed} 个提取批次失败；已完成批次保留。${state.error}`,
      );
    const packetGroups = batches(balancePackets(packets, snapshot), 22000, 12);
    state.totalTasks = chunks.length + packetGroups.length;
    let draft: AnalysisDraft | null = null;
    // Incremental reduce never transmits the entire raw corpus in one prompt.
    for (let i = 0; i < packetGroups.length; i++) {
      state.phase = `聚合主题：第 ${i + 1}/${packetGroups.length} 组`;
      const reply = await perform({
        kind: "aggregate",
        input: {
          snapshotId: snapshot.id,
          goal: snapshot.goal,
          sources: snapshot.sources,
          groups: snapshot.groups,
          packets: packetGroups[i],
          previous: draft,
        },
      });
      draft = reply.data as AnalysisDraft;
    }
    if (!draft) throw new Error("没有有效聚合结果。");
    draft = normalizeConditional(draft, snapshot);
    const targets = targetsFrom(
      draft,
      snapshot.groups,
      snapshot.sources.map((s) => s.sourceId),
    );
    const targetGroups = batches(targets, 9000, 3);
    state.totalTasks += targetGroups.length * packetGroups.length;
    const assignments: EvidenceAssignment[] = [];
    failed = 0;
    for (let t = 0; t < targetGroups.length; t++)
      for (let p = 0; p < packetGroups.length; p++) {
        checkPause();
        state.phase = `核验证据：结论组 ${t + 1}/${targetGroups.length}，评论批 ${p + 1}/${packetGroups.length}`;
        try {
          const reply = await perform({
            kind: "assign",
            input: {
              snapshotId: snapshot.id,
              batchId: `assign:${t}:${p}`,
              targets: targetGroups[t],
              packets: packetGroups[p],
            },
          });
          assignments.push(
            ...(reply.data as { results: EvidenceAssignment[] }).results,
          );
        } catch (error) {
          if (error instanceof TaskFailure && error.fatal) throw error;
          failed++;
          state.error =
            error instanceof Error ? error.message : "证据核验失败。";
          await emit();
        }
      }
    if (failed)
      throw new Error(
        `${failed} 个证据批次失败；不发布不完整统计。${state.error}`,
      );
    state.phase = "校验并生成结果";
    await emit();
    state.result = assemble(state, draft, packets, assignments);
    state.status = "complete";
    state.phase = "分析完成";
    state.error = null;
  } catch (error) {
    state.status = options.signal?.aborted ? "paused" : "failed";
    state.error = error instanceof Error ? error.message : "分析失败，请重试。";
  }
  await emit();
  return state;
}

export async function browserRequest(
  task: Task,
  key: string,
  model: string,
  signal?: AbortSignal,
): Promise<TaskReply> {
  const response = await fetch("/api/analysis", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Task-Key": key },
    body: JSON.stringify({ task, model }),
    signal,
  });
  const body = await response.json();
  if (!response.ok)
    throw new TaskFailure(
      body.error || "分析请求失败。",
      body.usage,
      body.retryable === false,
    );
  return body as TaskReply;
}
