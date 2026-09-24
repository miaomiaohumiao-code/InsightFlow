"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowDown,
  Check,
  Download,
  LoaderCircle,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { getProject, storageError } from "@/lib/storage/projects";
import { analysisHistory } from "@/lib/storage/analysis";
import { createSnapshot } from "@/lib/analysis/snapshot";
import { assertSchema } from "@/lib/analysis/schemas";
import { prepareBrandReport } from "@/lib/analysis/brand";
import {
  conditionalVisibility,
  readSelection,
  selectionKey,
  type InsightSelection,
} from "@/lib/insights/view";
import type { Project } from "@/types/project";
import type { AnalysisResult, Checkpoint } from "@/types/analysis";
import { Limitations, ReportContext } from "./evidence";
import { ConditionalAnalysis, OverallAnalysis } from "./overall";
import { MarketingActions } from "./marketing-actions";
import { InsightCards } from "./insight-cards";

type Loaded = {
  project: Project;
  run?: Checkpoint;
  newerRun: boolean;
  stale: boolean;
  selection: InsightSelection;
  storageWarning: string;
};
export function InsightsPage({ projectId }: { projectId: string }) {
  const [loaded, setLoaded] = useState<Loaded>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [project, history] = await Promise.all([
          getProject(projectId),
          analysisHistory(projectId),
        ]);
        if (!project) {
          if (active)
            setError(
              "当前浏览器中没有这个项目。请回到创建项目的浏览器，或返回首页。",
            );
          return;
        }
        const run = history.find(
          (r) =>
            r.status === "complete" && r.result?.coverage.status === "complete",
        );
        let stale = false;
        let selection: InsightSelection = { selectedIds: [], sort: "original" };
        let storageWarning = "";
        if (run?.result) {
          assertSchema("result", run.result);
          run.result = prepareBrandReport(run.result);
          try {
            stale =
              (await createSnapshot(project)).hash !== run.result.inputHash;
          } catch {
            stale = true;
          }
          try {
            selection = readSelection(
              localStorage.getItem(selectionKey(projectId, run.result)),
              run.result.insightCards,
            );
          } catch {
            storageWarning = "无法读取本地洞察选择；你仍可查看报告和临时选择。";
          }
        }
        if (active)
          setLoaded({
            project,
            run,
            newerRun: !!run && history[0]?.id !== run.id,
            stale,
            selection,
            storageWarning,
          });
      } catch (e) {
        if (active)
          setError(
            e instanceof Error && e.message.startsWith("输出结构")
              ? "已保存的分析结果格式不完整，请返回 VOC 页面重新分析。"
              : storageError(e),
          );
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [projectId]);
  function changeSelection(selection: InsightSelection) {
    if (!loaded?.run?.result) return;
    let storageWarning = "";
    try {
      localStorage.setItem(
        selectionKey(projectId, loaded.run.result),
        JSON.stringify(selection),
      );
    } catch {
      storageWarning = "当前选择未能保存到本地，刷新页面后可能丢失。";
    }
    setLoaded({ ...loaded, selection, storageWarning });
  }
  function download(result: AnalysisResult) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `insightflow-${result.runId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  const result = loaded?.run?.result;
  return (
    <AppShell active view="insights">
      {loading ? (
        <div className="page-state" role="status">
          <LoaderCircle className="spin" />
          正在读取分析结果…
        </div>
      ) : error ? (
        <div className="page-state">
          <h1>暂时无法打开洞察</h1>
          <p role="alert">{error}</p>
          <div className="ins-empty-actions">
            <button
              className="button secondary"
              onClick={() => window.location.reload()}
            >
              重新加载
            </button>
            <Link className="button secondary" href="/">
              返回首页
            </Link>
          </div>
        </div>
      ) : !result || !loaded ? (
        <div className="page-state">
          <h1>先完成一次 VOC 分析</h1>
          <p>分析完成后，主题、品牌对比和 Insight Cards 会保存在这里。</p>
          <Link
            className="button primary"
            href={`/projects/${projectId}/input`}
          >
            前往 VOC Input
          </Link>
        </div>
      ) : (
        <ReportContext.Provider value={result}>
          <main
            className={`ins-main ${loaded.selection.selectedIds.length ? "has-selection" : ""}`}
          >
            <div className="ins-topline">
              <Link href={`/projects/${projectId}/input`} className="back-link">
                <ArrowLeft size={15} />
                返回 VOC Input
              </Link>
              <span>
                <Check size={14} />
                已保存的分析结果
              </span>
            </div>
            <header className="ins-page-heading">
              <div>
                <div className="eyebrow">VOICE OF CUSTOMER · RESEARCH</div>
                <h1>
                  从用户声音，到清晰洞察<span>Insights</span>
                </h1>
                <p>
                  {loaded.project.name || "未命名项目"} <span>·</span>{" "}
                  {loaded.run?.snapshot.goal}
                </p>
              </div>
              <button
                className="button secondary"
                onClick={() => download(result)}
              >
                <Download size={16} />
                导出结果
              </button>
            </header>
            <div className="ins-report-meta">
              <span>{result.sources.length} 个来源</span>
              <span>
                {new Set(result.sources.map((s) => s.platformId)).size} 个平台
              </span>
              <span>
                分析于 {new Date(result.createdAt).toLocaleString("zh-CN")}
              </span>
            </div>
            {loaded.stale && (
              <div className="ins-notice" role="status">
                VOC
                输入已更改。下方展示上一次已完成的分析；需重新分析才能反映新数据。
                <Link href={`/projects/${projectId}/input`}>
                  返回更新分析 →
                </Link>
              </div>
            )}
            {loaded.newerRun && (
              <div className="ins-notice">
                较新的分析尚未完成，当前展示最近一次完整报告。
              </div>
            )}
            {result.coverage.unresolvedBoundaryVocCount > 0 && (
              <p className="ins-data-note">
                本次有 {result.coverage.unresolvedBoundaryVocCount}{" "}
                条评论的拆分边界尚待核对，解读证据强度时请保留这一限制。
              </p>
            )}
            {loaded.storageWarning && (
              <p className="error-banner" role="alert">
                {loaded.storageWarning}
              </p>
            )}
            <nav className="ins-anchor-nav" aria-label="报告章节">
              <a href="#overall">整体分析</a>
              {Object.values(conditionalVisibility(result)).some(Boolean) && (
                <a href="#comparisons">条件对比</a>
              )}
              <a href="#insights">
                <ArrowDown size={14} />
                Insight Cards
              </a>
              <a href="#marketing-actions">营销策略与实验建议</a>
            </nav>
            <OverallAnalysis />
            <ConditionalAnalysis />
            <InsightCards
              selection={loaded.selection}
              onChange={changeSelection}
            />
            <MarketingActions selectedIds={loaded.selection.selectedIds} />
            <footer className="ins-footer">
              <Limitations items={result.limitationsZh} />
              <p>洞察来自当前样本，营销建议需要进一步验证。</p>
            </footer>
          </main>
        </ReportContext.Provider>
      )}
    </AppShell>
  );
}
