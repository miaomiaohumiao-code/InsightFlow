"use client";
import Link from "next/link";
import { prepareBrandReport } from "@/lib/analysis/brand";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Download,
  LoaderCircle,
  Pause,
  RefreshCw,
} from "lucide-react";
import type { Project } from "@/types/project";
import type { Checkpoint } from "@/types/analysis";
import { createSnapshot, PROMPT_VERSION } from "@/lib/analysis/snapshot";
import {
  browserRequest,
  createCheckpoint,
  runAnalysis,
} from "@/lib/analysis/runner";
import { latestAnalysis, saveAnalysis } from "@/lib/storage/analysis";

export function AnalysisPanel({
  project,
  onConfirm,
  saving,
  onRunning,
}: {
  project: Project;
  onConfirm: () => Promise<boolean>;
  saving: boolean;
  onRunning: (running: boolean) => void;
}) {
  const [run, setRun] = useState<Checkpoint>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const [service, setService] = useState<{ model: string; provider: string }>();
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/analysis", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((value) => {
        if (value) setService(value);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    mounted.current = true;
    latestAnalysis(project.id)
      .then((r) => {
        if (mounted.current) {
          setRun(r);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted.current) {
          setError("无法读取分析检查点，请检查浏览器存储。");
          setLoading(false);
        }
      });
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, [project.id]);
  useEffect(() => {
    let active = true;
    if (run)
      createSnapshot({
        ...project,
        preview: project.preview
          ? {
              ...project.preview,
              confirmedAt: project.preview.confirmedAt || "pending",
            }
          : undefined,
      })
        .then((s) => {
          if (active)
            setStale(
              s.hash !== run.snapshot.hash ||
                run.promptVersion !== PROMPT_VERSION ||
                (!!service && run.model !== service.model),
            );
        })
        .catch(() => {
          if (active) setStale(true);
        });
    return () => {
      active = false;
    };
  }, [project, run, service]);

  async function start() {
    if (abort.current) return;
    setError("");
    setRunning(true);
    onRunning(true);
    abort.current = new AbortController();
    const execute = async () => {
      const response = await fetch("/api/analysis", {
        signal: abort.current!.signal,
      });
      if (!response.ok) throw new Error("无法读取服务端分析配置。");
      const config = await response.json();
      setService(config);
      if (!config.configured)
        throw new Error(
          "分析服务尚未配置密钥。线上部署请由项目管理员在 Vercel 环境变量中配置并重新部署；本地运行请配置 .env.local 并重启。不要将密钥粘贴到评论或项目字段中。",
        );
      if (!config.enabled)
        throw new Error("此部署未启用公开 AI 分析，请检查服务端配置。");
      const snapshot = await createSnapshot({
        ...project,
        preview: {
          ...project.preview!,
          confirmedAt: project.preview!.confirmedAt || new Date().toISOString(),
        },
      });
      const existing = await latestAnalysis(project.id);
      const initial =
        existing &&
        existing.snapshot.hash === snapshot.hash &&
        existing.model === config.model &&
        existing.promptVersion === PROMPT_VERSION
          ? existing
          : createCheckpoint(snapshot, config.model);
      if (initial.status === "complete") {
        setRun(initial);
        return;
      }
      await runAnalysis(initial, {
        request: browserRequest,
        persist: saveAnalysis,
        onProgress: (r) => {
          if (mounted.current) setRun(r);
        },
        signal: abort.current!.signal,
        maxAttempts: config.maxAttempts,
      });
    };
    try {
      if (!(await onConfirm())) return;
      if (navigator.locks) {
        await navigator.locks.request(
          `insightflow-analysis:${project.id}`,
          { ifAvailable: true },
          async (lock) => {
            if (!lock)
              throw new Error(
                "此项目正在另一个标签页分析，请等待或暂停该任务。",
              );
            await execute();
          },
        );
      } else
        throw new Error(
          "当前浏览器不支持安全的任务锁，请使用新版 Chrome 或 Edge。",
        );
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : "分析无法启动。");
    } finally {
      abort.current = null;
      if (mounted.current) {
        setRunning(false);
        onRunning(false);
      }
    }
  }
  function download() {
    if (!run?.result) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(prepareBrandReport(run.result), null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `insightflow-${run.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const complete = !!run?.result && !stale;
  return (
    <section className="panel analysis-panel" aria-label="AI 分析状态">
      <div className="analysis-heading">
        <div>
          <h3>VOC 分析</h3>
          <p>
            点击后将纳入的评论及来源发送至{" "}
            {service
              ? service.provider === "deepseek"
                ? "DeepSeek"
                : "OpenAI"
              : "配置的 AI 服务商"}
            。结果与已完成批次保存在当前浏览器。
          </p>
        </div>
        <button
          className="button primary"
          disabled={
            running ||
            saving ||
            loading ||
            !project.preview?.records.some(
              (r) => r.included && r.text.trim(),
            ) ||
            complete
          }
          onClick={() => void start()}
        >
          {running ? (
            <LoaderCircle size={16} className="spin" />
          ) : run && !stale && !complete ? (
            <RefreshCw size={16} />
          ) : (
            <ArrowRight size={16} />
          )}
          {running
            ? "分析中…"
            : complete
              ? "分析已完成"
              : run && !stale
                ? "重试 / 继续分析"
                : "Analyze VOC"}
        </button>
      </div>
      {(error || run?.error) && (
        <div className="error-banner" role="alert">
          {error || run?.error}
        </div>
      )}
      {stale && (
        <p className="preview-warning">
          输入或分析配置已更改。下方是旧快照结果；重新分析会创建新任务。
        </p>
      )}
      {run && (
        <>
          <div className="analysis-progress" role="status">
            <strong>{run.phase}</strong>
            <span>
              {run.completedTasks} /{" "}
              {Math.max(run.totalTasks, run.completedTasks)} 个已规划任务完成
              {run.status !== "complete" && " · 分析尚未完成"}
            </span>
          </div>
          <progress
            aria-label="分析进度"
            value={run.completedTasks}
            max={Math.max(
              run.totalTasks,
              run.completedTasks + (run.status === "complete" ? 0 : 1),
              1,
            )}
          />
          <p className="preview-footnote">
            任务总数会在提取和聚合后更新。关闭页面会暂停；重开后点击继续。已完成任务无需重新调用。
          </p>
          <div className="analysis-usage">
            <span>已确认 API 尝试：{run.usage.attempts}</span>
            <span>输入：{run.usage.inputTokens.toLocaleString()} tokens</span>
            <span>输出：{run.usage.outputTokens.toLocaleString()} tokens</span>
            <span>
              已知用量估算：
              {run.usage.estimatedCostUsd === null
                ? "请查看服务商账单"
                : `$${run.usage.estimatedCostUsd.toFixed(4)}`}
            </span>
          </div>
          {(run.pendingTaskIds.length > 0 ||
            run.usage.unmeteredAttempts > 0) && (
            <p className="preview-footnote">
              有未收到完整回执或未提供用量的请求，次数与费用可能不完整；实际以
              服务商账单为准。
            </p>
          )}
          {run.result && (
            <div className="analysis-result">
              <strong>结果已通过 Schema 与引文校验</strong>
              <p>{run.result.overall.sentiment.summaryZh}</p>
              <p>
                {run.result.overall.topTopics.length} 个主要主题 ·{" "}
                {run.result.insightCards.length} 条 Insight ·{" "}
                {run.result.coverage.analyzedVocCount} 条 VOC
              </p>
              <Link
                className="button primary"
                href={`/projects/${project.id}/insights`}
              >
                查看 Insights <ArrowRight size={16} />
              </Link>
              <button className="button secondary" onClick={download}>
                <Download size={16} />
                下载结果 JSON
              </button>
              <details>
                <summary>查看结构化结果</summary>
                <pre>
                  {JSON.stringify(prepareBrandReport(run.result), null, 2)}
                </pre>
              </details>
            </div>
          )}
        </>
      )}
      {running && (
        <button
          className="button secondary"
          onClick={() => abort.current?.abort()}
        >
          <Pause size={16} />
          暂停分析
        </button>
      )}
    </section>
  );
}
