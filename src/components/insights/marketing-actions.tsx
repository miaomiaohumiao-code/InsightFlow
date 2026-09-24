"use client";
import { useEffect, useRef, useState } from "react";
import { openDB } from "idb";
import {
  fields,
  validateAction,
  type MarketingAction,
  type MarketingMode,
} from "@/lib/marketing/contract";
import { useReport, RepresentativeQuotes } from "./evidence";
import { ExperimentRecommendation } from "./experiment-recommendation";

type Saved = {
  key: string;
  mode: MarketingMode;
  ids: string[];
  action: MarketingAction;
  createdAt: string;
  usage: {
    attempts: number;
    inputTokens: number;
    outputTokens: number;
    model: string;
  };
};
async function database() {
  return openDB("insightflow-marketing", 1, {
    upgrade(db) {
      db.createObjectStore("actions", { keyPath: "key" });
    },
  });
}
export function MarketingActions({ selectedIds }: { selectedIds: string[] }) {
  const report = useReport();
  const prefix = `v1:${report.runId}:${report.inputHash}:`;
  const [saved, setSaved] = useState<Saved[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const running = useRef(false);
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const db = await database();
        const rows: Saved[] = await db.getAll("actions");
        db.close();
        const valid = rows
          .filter((r) => r.key.startsWith(prefix))
          .filter((r) => {
            try {
              validateAction(r.action, r.ids);
              return true;
            } catch {
              return false;
            }
          });
        if (active) setSaved(valid);
      } catch {
        if (active)
          setWarning("无法读取本地策略；仍可生成并导出，请勿依赖自动保存。");
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [prefix]);
  async function generate(mode: MarketingMode) {
    if (running.current || !ready) return;
    const selected = report.insightCards.filter((i) =>
      selectedIds.includes(i.id),
    );
    if (!selected.length || (mode === "combine" && selected.length < 2)) return;
    if (mode === "combine" && selected.length > 8) {
      setError("合并最多支持 8 条洞察，请缩小范围。");
      return;
    }
    running.current = true;
    setBusy(true);
    setError("");
    section.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    const groups = mode === "separate" ? selected.map((i) => [i]) : [selected];
    let failed = 0;
    try {
      for (let index = 0; index < groups.length; index++) {
        const group = groups[index];
        const ids = group.map((i) => i.id);
        const key = prefix + mode + ":" + JSON.stringify([...ids].sort());
        setProgress(
          `正在生成 ${index + 1} / ${groups.length} 套策略，已完成结果会自动保留`,
        );
        if (saved.some((r) => r.key === key)) continue;
        try {
          const finding = (
            id: string | null,
            list: typeof report.overall.userNeeds,
          ) =>
            list
              .filter((f) => f.id === id)
              .map((f) => `${f.titleZh}：${f.summaryZh}`);
          const insights = group.map((i) => ({
            id: i.id,
            titleZh: i.titleZh,
            segment: i.targetSegment?.labelZh ?? null,
            implication: i.marketingImplicationZh,
            strength: i.evidence.strength.level,
            needs: i.originOpportunityId
              ? [
                  report.conditional.brandComparison.opportunityGaps.find(
                    (g) => g.id === i.originOpportunityId,
                  )?.qualification?.needZh ?? i.titleZh,
                ]
              : finding(i.userNeedFindingId, report.overall.userNeeds),
            pains: finding(i.painPointFindingId, report.overall.painPoints),
            drivers: report.overall.purchaseDrivers
              .filter((f) => i.purchaseDriverFindingIds.includes(f.id))
              .map((f) => `${f.titleZh}：${f.summaryZh}`),
            barriers: report.overall.purchaseBarriers
              .filter((f) => i.purchaseBarrierFindingIds.includes(f.id))
              .map((f) => `${f.titleZh}：${f.summaryZh}`),
            quotes: i.evidence.representativeQuotes.slice(0, 8).map((q) => ({
              originalText: q.originalText,
              source:
                report.sources.find((s) => s.sourceId === q.sourceId)
                  ?.platformLabel ?? "来源未知",
            })),
            limitations: i.limitationsZh,
          }));
          const response = await fetch("/api/marketing", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode, insights }),
            signal: AbortSignal.timeout(170000),
          });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error ?? "生成失败");
          const row: Saved = {
            key,
            mode,
            ids,
            action: validateAction(body.action, ids),
            createdAt: new Date().toISOString(),
            usage: body.usage,
          };
          setSaved((rows) => [...rows.filter((r) => r.key !== key), row]);
          try {
            const db = await database();
            await db.put("actions", row);
            db.close();
          } catch {
            setWarning("策略已生成但本地保存失败，请立即导出备份。");
          }
        } catch (e) {
          failed++;
          setError(e instanceof Error ? e.message : "生成失败，请重试");
        }
      }
      setProgress(
        failed
          ? `本轮有 ${failed} 套未完成。再次点击同一模式可补齐；成功结果不会重复生成。`
          : "生成完成；再次选择相同洞察和模式会复用已有策略。",
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  function download() {
    const blob = new Blob(
      [
        JSON.stringify(
          { schemaVersion: 1, runId: report.runId, actions: saved },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "insightflow-marketing.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="ins-section" ref={section} id="marketing-actions">
      <h2>
        营销行动 <small>Marketing Action</small>
      </h2>
      <p>
        将所选洞察转化为待验证的营销策略。渠道与广告位置为测试建议，产品能力需核实后对外使用。
      </p>
      <div
        className={
          selectedIds.length
            ? "ins-selection-bar ins-generation-buttons"
            : "ins-generation-buttons"
        }
      >
        <span>已选择 {selectedIds.length} 条洞察</span>
        <button
          className="button secondary"
          disabled={!ready || busy || !selectedIds.length}
          onClick={() => generate("separate")}
        >
          Generate Separately
        </button>
        <button
          className="button primary"
          disabled={!ready || busy || selectedIds.length < 2}
          onClick={() => generate("combine")}
        >
          Combine Insights
        </button>
        {!!saved.length && (
          <button className="button secondary" onClick={download}>
            导出营销策略
          </button>
        )}
      </div>
      <p>单独生成：每条一套；合并生成：至少选择 2 条，共同形成一套策略。</p>
      <p role="status" aria-live="polite">
        {progress}
      </p>
      {error && <p role="alert">{error}</p>}
      {warning && <p role="alert">{warning}</p>}
      {saved.map((row) => (
        <article className="ins-panel marketing-result" key={row.key}>
          <span>
            {row.mode === "combine" ? "合并策略" : "单条策略"} ·{" "}
            {new Date(row.createdAt).toLocaleString("zh-CN")}
          </span>
          <h3>{row.action.titleZh}</h3>
          <div className="ins-card-grid">
            {(
              [
                "coreConsumerInsight",
                "marketingOpportunity",
                "targetSegment",
                "valueProposition",
                "coreSellingPoint",
                "messageAngle",
                "creativeDirection",
                "recommendedChannel",
                "recommendedPlacement",
                "campaignIdea",
              ] as (keyof typeof fields)[]
            ).map((key) => (
              <div
                key={key}
                className={`marketing-point ${key === "coreConsumerInsight" || key === "marketingOpportunity" ? "strategy-focus" : ""}`}
              >
                <h4>{fields[key]}</h4>
                <p>{row.action[key].textZh}</p>
                <p className="marketing-reason">
                  依据：{row.action[key].reasonZh}
                </p>
                <div>
                  {row.action[key].insightIds.map((id) => (
                    <a
                      key={id}
                      href={`#marketing-evidence-${encodeURIComponent(row.key)}-${encodeURIComponent(id)}`}
                    >
                      ↗{" "}
                      {report.insightCards.find((i) => i.id === id)?.titleZh ??
                        id}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <h4>验证计划</h4>
          <p>{row.action.validationPlanZh}</p>
          <details>
            <summary>查看关联洞察和原始证据</summary>
            {row.ids.map((id) => {
              const insight = report.insightCards.find((i) => i.id === id);
              return insight ? (
                <div
                  key={id}
                  id={`marketing-evidence-${encodeURIComponent(row.key)}-${encodeURIComponent(id)}`}
                >
                  <h4>{insight.titleZh}</h4>
                  <p>{insight.marketingImplicationZh}</p>
                  <RepresentativeQuotes evidence={insight.evidence} />
                </div>
              ) : null;
            })}
          </details>
          <p>
            调用 {row.usage.attempts} 次 · 输入 {row.usage.inputTokens} / 输出{" "}
            {row.usage.outputTokens} Token
          </p>
          <ExperimentRecommendation
            actionKey={row.key}
            action={row.action}
            ids={row.ids}
          />
        </article>
      ))}
    </section>
  );
}
