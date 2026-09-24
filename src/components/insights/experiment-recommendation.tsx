"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MarketingAction } from "@/lib/marketing/contract";
import { fields } from "@/lib/marketing/contract";
import {
  executionNotes,
  metricLabels,
  validateInput,
  validateRecommendation,
} from "@/lib/experiments/contract";
import {
  readRecommendation,
  recommendationKey,
  saveRecommendation,
  type SavedRecommendation,
} from "@/lib/experiments/storage";
import { RepresentativeQuotes, useReport } from "./evidence";

export function ExperimentRecommendation({
  actionKey,
  action,
  ids,
}: {
  actionKey: string;
  action: MarketingAction;
  ids: string[];
}) {
  const report = useReport();
  const input = useMemo(
    () => ({
      action,
      insights: report.insightCards
        .filter((i) => ids.includes(i.id))
        .map((i) => ({
          id: i.id,
          titleZh: i.titleZh,
          implicationZh: i.marketingImplicationZh,
          strength: i.evidence.strength.level,
          limitationsZh: i.limitationsZh,
          quotes: i.evidence.representativeQuotes.slice(0, 8).map((q) => ({
            originalText: q.originalText,
            platform:
              report.sources.find((s) => s.sourceId === q.sourceId)
                ?.platformLabel ?? "来源未知",
          })),
        })),
    }),
    [action, ids, report],
  );
  const [loaded, setLoaded] = useState<{
    key: string;
    saved?: SavedRecommendation;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        validateInput(input);
        const key = await recommendationKey(actionKey, input);
        let saved: SavedRecommendation | undefined;
        try {
          saved = await readRecommendation(key, input);
        } catch {
          if (active)
            setWarning(
              "已保存建议无法读取或未通过当前校验，请重新生成。原始记录仍保留在本地。",
            );
        }
        if (active) setLoaded({ key, saved });
      } catch {
        if (active) setError("当前策略与洞察引用不一致，无法生成实验建议。");
      }
    })();
    return () => {
      active = false;
      controller.current?.abort();
    };
  }, [actionKey, input]);
  async function generate() {
    if (!loaded || controller.current || loaded.saved) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/experiment-recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(155000)]),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "实验建议生成失败");
      const row: SavedRecommendation = {
        key: loaded.key,
        createdAt: new Date().toISOString(),
        recommendation: validateRecommendation(body.recommendation, input),
        usage: body.usage,
      };
      setLoaded({ key: loaded.key, saved: row });
      try {
        await saveRecommendation(row);
        setWarning("");
      } catch {
        setWarning("建议已生成，但本地保存失败。请导出备份。");
      }
    } catch (e) {
      setError(
        abort.signal.aborted
          ? "已取消生成，未执行任何实验。"
          : e instanceof Error
            ? e.message
            : "生成失败，请重试",
      );
    } finally {
      controller.current = null;
      setBusy(false);
    }
  }
  const result = loaded?.saved?.recommendation;
  function download() {
    if (!result) return;
    const text = [
      `# A/B 实验建议：${action.titleZh}`,
      "状态：待验证建议；非实验结果",
      `## 测试目标\n${result.testObjectiveZh}`,
      `## 实验假设\n${result.hypothesisZh}`,
      `## 为什么值得测试\n${result.whyTestThisZh}`,
      `## A 组（建议基准，非现有素材）\n${result.groupA.variableContentZh}`,
      `## B 组\n${result.groupB.variableContentZh}`,
      `## 唯一核心变量\n${result.coreVariable}`,
      `## 两组共同设置\n${result.sharedSetupZh}`,
      `## 推荐指标\n${result.metrics.map((m) => `- ${metricLabels[m.metric]}（${m.role}）：${m.reasonZh}\n  测量口径：${m.measurementZh}`).join("\n")}`,
      `## 执行建议\n${executionNotes.map((n) => `- ${n}`).join("\n")}`,
      `## 执行前核实\n${result.prerequisitesZh}`,
      `## 来源洞察\n${result.insightIds
        .map((id) => {
          const i = report.insightCards.find((i) => i.id === id);
          return `- ${i?.titleZh}（${id}）\n  ${i?.marketingImplicationZh}`;
        })
        .join("\n")}`,
      `## 来源策略\n${result.actionFields.map((f) => `- ${fields[f]}：${action[f].textZh}`).join("\n")}`,
    ].join("\n\n");
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/markdown;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "InsightFlow-实验建议.md";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="ab-module" aria-label={`实验建议：${action.titleZh}`}>
      <div className="ab-heading">
        <div>
          <span className="ab-eyebrow">下一步 · 值得测试什么</span>
          <h3>A/B 实验建议</h3>
        </div>
        <span className="ab-badge">仅建议 · 待验证</span>
      </div>
      <p>
        基于这套营销策略及其关联洞察生成一张建议卡片，交由真实平台执行。页面上其他洞察的勾选变化不会改变本策略的依据。
      </p>
      {!result && (
        <button
          className="button primary"
          disabled={!loaded || busy}
          onClick={generate}
        >
          {busy ? "正在生成实验建议…" : "生成实验建议"}
        </button>
      )}
      {busy && (
        <button
          className="button secondary"
          onClick={() => controller.current?.abort()}
        >
          取消生成
        </button>
      )}
      {busy && (
        <p role="status">
          正在核对单一变量、指标场景与证据引用；未启动任何真实实验。
        </p>
      )}
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {warning && <p role="alert">{warning}</p>}
      {result && (
        <article className="ab-card">
          <div className="ab-card-top">
            <span>
              {result.context} ·{" "}
              {new Date(loaded!.saved!.createdAt).toLocaleString("zh-CN")}
            </span>
            <button className="button secondary" onClick={download}>
              导出实验建议
            </button>
          </div>
          <h4>测试目标</h4>
          <p>{result.testObjectiveZh}</p>
          <h4>实验假设</h4>
          <p>{result.hypothesisZh}</p>
          <h4>为什么值得测试</h4>
          <p>{result.whyTestThisZh}</p>
          <div className="ab-variants">
            <div>
              <span className="ab-group">A</span>
              <h4>对照组 · 建议基准</h4>
              <p>{result.groupA.variableContentZh}</p>
              <small>未提供现有素材，此处为待确认的基准方案。</small>
            </div>
            <div>
              <span className="ab-group">B</span>
              <h4>测试组 · 新方案</h4>
              <p>{result.groupB.variableContentZh}</p>
            </div>
          </div>
          <h4>唯一核心变量</h4>
          <p>
            <span className="ab-badge">{result.coreVariable}</span>
          </p>
          <h4>两组共同设置</h4>
          <p>{result.sharedSetupZh}</p>
          <h4>推荐指标</h4>
          <ul className="ab-metrics">
            {result.metrics.map((m) => (
              <li key={m.metric}>
                <strong>{metricLabels[m.metric]}</strong>
                <span className="ab-badge">{m.role}</span>
                <p>{m.reasonZh}</p>
                <p className="marketing-reason">测量口径：{m.measurementZh}</p>
              </li>
            ))}
          </ul>
          <h4>执行建议</h4>
          <ul className="ab-notes">
            {executionNotes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <h4>执行前需核实</h4>
          <p>{result.prerequisitesZh}</p>
          <details className="ab-evidence">
            <summary>查看来源洞察与营销策略</summary>
            {result.insightIds.map((id) => {
              const i = report.insightCards.find((i) => i.id === id);
              return i ? (
                <div key={id}>
                  <h4>{i.titleZh}</h4>
                  <p>{i.marketingImplicationZh}</p>
                  <RepresentativeQuotes evidence={i.evidence} />
                </div>
              ) : null;
            })}
            {result.actionFields.map((f) => (
              <div key={f}>
                <h4>策略依据 · {fields[f]}</h4>
                <p>{action[f].textZh}</p>
                <p className="marketing-reason">{action[f].reasonZh}</p>
              </div>
            ))}
          </details>
          <p className="ab-footnote">
            本建议可重复查看，不会自动重新调用
            AI。此处不显示实验数据、胜出方案或显著性结论。
          </p>
        </article>
      )}
    </section>
  );
}
