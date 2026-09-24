"use client";

import { useState } from "react";
import {
  ArrowLeft,
  Check,
  AlertTriangle,
  Filter,
  FileText,
} from "lucide-react";
import type { Project } from "@/types/project";
import { brandName } from "@/types/project";
import {
  flagLabels,
  type SplitMode,
  type VOCPreview,
  type VOCRecord,
} from "@/types/voc";
import { preparePreview, previewStats } from "@/lib/voc/prepare";
import { AnalysisPanel } from "./analysis-panel";

const methods = {
  author: "作者边界",
  numbered: "连续编号",
  separator: "明确分隔线",
  paragraphs: "用户指定空行分隔",
  lines: "用户指定每行一条",
  unsplit: "保守保留原块",
};

export function VOCPreviewPanel({
  project,
  preview,
  onChange,
  onBack,
  onConfirm,
  saving,
  saved,
}: {
  project: Project;
  preview: VOCPreview;
  onChange: (preview: VOCPreview) => void;
  onBack: () => void;
  onConfirm: () => Promise<boolean>;
  saving: boolean;
  saved: boolean;
}) {
  const [sourceId, setSourceId] = useState("all");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [rebuildSource, setRebuildSource] = useState<{
    id: string;
    mode: SplitMode;
  }>();
  const stats = previewStats(preview.records);
  const filtered = preview.records.filter(
    (record) =>
      (sourceId === "all" || record.sourceId === sourceId) &&
      (filter === "all" ||
        (filter === "included" && record.included) ||
        (filter === "excluded" && !record.included) ||
        (filter === "short" && record.flags.includes("short")) ||
        (filter === "ambiguous" &&
          record.flags.some((f) => f === "boundary" || f === "long"))),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 10));
  const currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(currentPage * 10, currentPage * 10 + 10);
  function changeRecord(id: string, patch: Partial<VOCRecord>) {
    onChange({
      ...preview,
      confirmedAt: undefined,
      records: preview.records.map((r) =>
        r.id === id ? { ...r, ...patch } : r,
      ),
    });
  }
  function rebuild() {
    if (!rebuildSource) return;
    const next = preparePreview(project.sources, {
      ...preview.modes,
      [rebuildSource.id]: rebuildSource.mode,
    });
    // A different split may change duplicate references across sources: rebuild all derived decisions explicitly.
    onChange(next);
    setPage(0);
    setRebuildSource(undefined);
  }
  return (
    <section className="preview-workspace" aria-label="VOC 数据预览">
      <div className="preview-heading">
        <div>
          <div className="eyebrow">REVIEW YOUR DATA</div>
          <h2>先核对声音，再开始分析</h2>
          <p>原文始终保留。检查拆分边界、短评及排除项，确认本次使用的数据。</p>
        </div>
        <span className="preview-local">
          <FileText size={16} />
          本地预处理
        </span>
      </div>
      <div
        className={`preview-health ${!stats.total || stats.ambiguous || stats.total < 50 ? "needs-review" : ""}`}
        role="status"
      >
        <div>
          <strong>
            {!stats.total
              ? "暂无可分析数据"
              : stats.ambiguous
                ? "先核对拆分，再确认数据"
                : stats.total < 50
                  ? "数据已拆分，样本量较少"
                  : "未发现明显拆分异常"}
          </strong>
          <p>
            {!stats.total
              ? "返回输入页添加评论，或检查被排除的记录。"
              : `已纳入 ${stats.total} 条评论。${stats.ambiguous ? `${stats.ambiguous} 条可能有拆分异常。` : "仍建议抽查原文与拆分结果。"}${stats.short ? `另有 ${stats.short} 条极短评论需结合上下文判断。` : ""} 提示不代表统计代表性或分析质量保证。`}
          </p>
        </div>
        {!!stats.ambiguous && (
          <button
            className="button secondary"
            onClick={() => {
              setFilter("ambiguous");
              setSourceId("all");
              setPage(0);
            }}
            disabled={analyzing}
          >
            查看拆分异常
          </button>
        )}
      </div>
      <div className="preview-metrics">
        {[
          ["VOC 总数量", stats.total, "本次纳入的候选评论"],
          ["来源数量", project.sources.length, "按平台、品牌和时间区分"],
          ["可能拆分异常", stats.ambiguous, "含长文本及不明确边界"],
          ["极短评论", stats.short, "已保留，请结合上下文判断"],
        ].map(([label, value, hint]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{hint}</small>
          </div>
        ))}
      </div>
      <div className="preview-warnings">
        {stats.total < 50 && (
          <div className="preview-warning" role="status">
            <AlertTriangle size={17} />
            <div>
              <strong>当前样本少于 50 条</strong>
              <p>样本量较小，后续结果仅供方向性参考。你仍可确认并继续。</p>
            </div>
          </div>
        )}
        {stats.manyAmbiguous && (
          <div className="preview-warning">
            <AlertTriangle size={17} />
            <div>
              <strong>较多数据的评论边界不明确</strong>
              <p>
                至少 30%
                的纳入记录存在疑似边界或长文本问题。系统保留了原块，当前数量可能低于实际评论数；可调整分隔方式或返回编辑。此提示不阻止继续。
              </p>
            </div>
          </div>
        )}
        {stats.total === 0 && (
          <div className="error-banner" role="alert">
            暂无可纳入的评论。请返回输入 VOC，或恢复有正文的排除项。
          </div>
        )}
      </div>
      <fieldset disabled={analyzing} className="preview-edit-controls">
        <section className="panel preview-sources">
          <div className="panel-title">
            <h3>各来源数据</h3>
            <span>自动识别不确定时，由你指定边界</span>
          </div>
          <div className="preview-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>来源</th>
                  <th>纳入 / 候选</th>
                  <th>疑似异常 / 短评</th>
                  <th>拆分方式</th>
                </tr>
              </thead>
              <tbody>
                {project.sources.map((source, index) => {
                  const sourceStats = previewStats(
                    preview.records.filter((r) => r.sourceId === source.id),
                  );
                  return (
                    <tr key={source.id}>
                      <td>
                        <strong>
                          {source.platform || `来源 ${index + 1}`}
                        </strong>
                        <small>
                          {brandName(project, source) || "品牌未填写"} ·{" "}
                          {source.timeRange.unknown
                            ? "日期未知"
                            : `${source.timeRange.start || "未填写"} — ${source.timeRange.end || "未填写"}`}
                        </small>
                      </td>
                      <td>
                        {sourceStats.total} / {sourceStats.candidates}
                      </td>
                      <td>
                        {sourceStats.ambiguous} / {sourceStats.short}
                      </td>
                      <td>
                        <select
                          aria-label={`来源 ${index + 1} 拆分方式`}
                          value={preview.modes[source.id] ?? "auto"}
                          onChange={(e) =>
                            setRebuildSource({
                              id: source.id,
                              mode: e.target.value as SplitMode,
                            })
                          }
                        >
                          <option value="auto">自动 · 保守识别</option>
                          <option value="paragraphs">按空行分隔</option>
                          <option value="lines">每行一条</option>
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="preview-footnote">
            候选数包含排除项；纳入数不包含空内容。极短文本指不足 5
            个文字或数字字符，表情不计入长度，但会保留。
          </p>
        </section>
        {rebuildSource && (
          <div className="preview-rebuild" role="alert">
            <strong>重新拆分会重置本次预览的纳入选择与核对状态。</strong>
            <p>
              “空行分隔”适用于每段一条评论；“每行一条”适用于每行都是独立评论。原始
              VOC 不受影响。
            </p>
            <div>
              <button
                className="button secondary"
                onClick={() => setRebuildSource(undefined)}
              >
                取消
              </button>
              <button className="button primary" onClick={rebuild}>
                确认重新拆分
              </button>
            </div>
          </div>
        )}
        <section className="preview-results">
          <div className="section-heading">
            <div>
              <h3>拆分结果</h3>
              <p>
                共 {preview.records.length} 个候选记录，{stats.excluded}{" "}
                个已排除。前后文均可在原文中核对。
              </p>
            </div>
          </div>
          <div className="preview-filters">
            <Filter size={16} />
            <label>
              来源
              <select
                value={sourceId}
                onChange={(e) => {
                  setSourceId(e.target.value);
                  setPage(0);
                }}
              >
                <option value="all">全部来源</option>
                {project.sources.map((s, i) => (
                  <option key={s.id} value={s.id}>
                    {i + 1}. {s.platform || "未填写平台"} ·{" "}
                    {brandName(project, s) || "未填写品牌"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              查看
              <select
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setPage(0);
                }}
              >
                <option value="all">全部记录</option>
                <option value="included">纳入评论</option>
                <option value="ambiguous">疑似拆分异常</option>
                <option value="short">极短文本</option>
                <option value="excluded">已排除记录</option>
              </select>
            </label>
            <span>{filtered.length} 条结果</span>
          </div>
          {visible.length === 0 && (
            <div className="source-empty">此筛选下没有记录。</div>
          )}
          {visible.map((record) => {
            const source = project.sources.find(
              (s) => s.id === record.sourceId,
            )!;
            const index = preview.records.indexOf(record) + 1;
            return (
              <article
                className={`preview-record ${record.included ? "" : "excluded"}`}
                key={record.id}
              >
                <header>
                  <span className="source-number">
                    {String(index).padStart(2, "0")}
                  </span>
                  <div>
                    <strong>
                      {source.platform || "未填写平台"} ·{" "}
                      {brandName(project, source) || "未填写品牌"}
                    </strong>
                    <small>
                      {methods[record.method]}
                      {record.author ? ` · 作者：${record.author}` : ""}
                    </small>
                  </div>
                  <label className="include-toggle">
                    <input
                      type="checkbox"
                      checked={record.included}
                      disabled={!record.text.trim()}
                      onChange={(e) =>
                        changeRecord(record.id, { included: e.target.checked })
                      }
                      aria-label={`纳入记录 ${index}`}
                    />
                    纳入
                  </label>
                </header>
                {record.flags.length > 0 && (
                  <div className="record-flags">
                    {record.flags.map((flag) => (
                      <span key={flag}>{flagLabels[flag]}</span>
                    ))}
                    {record.reviewed && (
                      <span className="reviewed-badge">已人工核对</span>
                    )}
                  </div>
                )}
                <p className="record-content">
                  {record.text ||
                    "清洗后没有评论正文，仅包含链接或明确页面杂项。"}
                </p>
                {!record.included && (
                  <p className="exclusion-reason">
                    {record.exclusion === "empty"
                      ? "默认排除：没有正文；如清洗不合适，请返回编辑。"
                      : record.exclusion === "duplicate"
                        ? `默认排除：同来源、同作者的完整文本重复，对应记录 ${preview.records.findIndex((r) => r.id === record.duplicateOf) + 1}。可勾选恢复。`
                        : "已由你排除，可勾选恢复。"}
                  </p>
                )}
                <div className="record-actions">
                  <details>
                    <summary>查看原文与清洗说明</summary>
                    <p>
                      {record.changes.length
                        ? record.changes.join("；")
                        : "未改变正文内容"}
                    </p>
                    <pre>{record.original}</pre>
                    {record.links.length > 0 && (
                      <p className="record-links">
                        提取到的链接（未访问）：{record.links.join(" · ")}
                      </p>
                    )}
                  </details>
                  {record.flags.length > 0 && (
                    <button
                      className="text-button"
                      onClick={() =>
                        changeRecord(record.id, { reviewed: !record.reviewed })
                      }
                    >
                      {record.reviewed ? "撤销核对" : "已核对此记录"}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
          <div className="preview-pagination">
            <span>
              第 {currentPage + 1} / {pages} 页 · 每页最多 10 条
            </span>
            <button
              className="button secondary"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              上一页
            </button>
            <button
              className="button secondary"
              disabled={currentPage >= pages - 1}
              onClick={() => setPage(currentPage + 1)}
            >
              下一页
            </button>
          </div>
        </section>
      </fieldset>
      {preview.confirmedAt && saved && (
        <div className="preview-confirmed" role="status">
          <Check size={20} />
          <div>
            <strong>预览已确认并保存</strong>
            <p>分析使用本次纳入的评论。更改数据或纳入选择后需要重新确认。</p>
          </div>
        </div>
      )}
      <div className="preview-bottom">
        <button
          className="button secondary"
          onClick={onBack}
          disabled={analyzing}
        >
          <ArrowLeft size={16} />
          Back to Edit
        </button>
        <div>
          <span>
            {stats.total} 条评论待用于分析 · {stats.unresolved} 条边界异常未核对
          </span>
        </div>
      </div>
      <AnalysisPanel
        project={project}
        onConfirm={onConfirm}
        saving={saving}
        onRunning={setAnalyzing}
      />
    </section>
  );
}
