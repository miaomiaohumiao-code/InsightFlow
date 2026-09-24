"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Trash2,
  MessageSquareText,
} from "lucide-react";
import {
  brandName,
  sourceIssues,
  type Project,
  type Source,
} from "@/types/project";

export function SourceCard({
  source,
  index,
  project,
  onChange,
  onOwnBrandChange,
  onDelete,
}: {
  source: Source;
  index: number;
  project: Project;
  onChange: (patch: Partial<Source>) => void;
  onOwnBrandChange: (name: string) => void;
  onDelete: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const prefix = `source-${source.id}`;
  const issues = sourceIssues(project, source);
  const invalidDate =
    !source.timeRange.unknown &&
    !!source.timeRange.start &&
    !!source.timeRange.end &&
    source.timeRange.start > source.timeRange.end;
  const name = brandName(project, source);
  return (
    <article className="source-card" id={prefix}>
      <header className="source-header">
        <span className="source-number">
          {String(index + 1).padStart(2, "0")}
        </span>
        <div className="source-title">
          <h3>
            {source.platform.trim() || "新来源"}
            {name.trim() && <span> / {name}</span>}
          </h3>
          <p>{source.product || "一个平台 × 一个品牌 × 一个时间段"}</p>
        </div>
        <span className={`source-status ${issues.length ? "" : "complete"}`}>
          {issues.length ? "待完善" : "已填写"}
        </span>
        <button
          className="icon-button"
          aria-label={`${collapsed ? "展开" : "收起"}来源 ${index + 1}`}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
        </button>
        <button
          className="icon-button danger"
          aria-label={`删除来源 ${index + 1}`}
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 size={16} />
        </button>
      </header>
      {confirmDelete && (
        <div className="delete-confirm" role="alert">
          <span>删除此来源及其中的 VOC？此操作不可撤销。</span>
          <button
            className="text-button"
            onClick={() => setConfirmDelete(false)}
          >
            取消
          </button>
          <button className="button danger-button" onClick={onDelete}>
            确认删除
          </button>
        </div>
      )}
      {!collapsed && (
        <div className="source-body">
          <div className="source-section-label">
            来源信息 <span>同一平台、品牌和时间段归为一组</span>
          </div>
          <div className="form-grid three">
            <div className="field">
              <label htmlFor={`${prefix}-platform`}>
                Platform <span>平台</span>
              </label>
              <input
                id={`${prefix}-platform`}
                list="platform-options"
                value={source.platform}
                onChange={(e) => onChange({ platform: e.target.value })}
                placeholder="选择或输入平台"
              />
            </div>
            <div className="field">
              <label htmlFor={`${prefix}-type`}>
                Brand Type <span>品牌角色</span>
              </label>
              <select
                id={`${prefix}-type`}
                value={source.brandType}
                onChange={(e) =>
                  onChange({ brandType: e.target.value as Source["brandType"] })
                }
              >
                <option value="own">Own Brand · 自有品牌</option>
                <option value="competitor">Competitor · 竞品</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor={`${prefix}-brand`}>
                Brand Name <span>品牌名称</span>
              </label>
              <input
                id={`${prefix}-brand`}
                value={name}
                onChange={(e) =>
                  source.brandType === "own"
                    ? onOwnBrandChange(e.target.value)
                    : onChange({ competitorName: e.target.value })
                }
                placeholder={
                  source.brandType === "own"
                    ? "输入自有品牌名称"
                    : "输入竞品名称"
                }
                aria-describedby={
                  source.brandType === "own"
                    ? `${prefix}-brand-hint`
                    : undefined
                }
              />
              {source.brandType === "own" && (
                <small id={`${prefix}-brand-hint`}>
                  所有自有品牌来源共用此名称
                </small>
              )}
            </div>
          </div>
          <div className="form-grid source-details">
            <div className="field">
              <div className="field-heading">
                <label htmlFor={`${prefix}-start`}>
                  Time Range <span>时间范围</span>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={source.timeRange.unknown}
                    onChange={(e) =>
                      onChange({
                        timeRange: {
                          ...source.timeRange,
                          unknown: e.target.checked,
                        },
                      })
                    }
                  />
                  日期未知
                </label>
              </div>
              <div className="date-range">
                <input
                  type="date"
                  id={`${prefix}-start`}
                  aria-label={`来源 ${index + 1} 开始日期`}
                  disabled={source.timeRange.unknown}
                  value={source.timeRange.start}
                  onChange={(e) =>
                    onChange({
                      timeRange: { ...source.timeRange, start: e.target.value },
                    })
                  }
                  aria-invalid={invalidDate}
                />
                <span>至</span>
                <input
                  type="date"
                  aria-label={`来源 ${index + 1} 结束日期`}
                  disabled={source.timeRange.unknown}
                  value={source.timeRange.end}
                  min={source.timeRange.start || undefined}
                  onChange={(e) =>
                    onChange({
                      timeRange: { ...source.timeRange, end: e.target.value },
                    })
                  }
                  aria-invalid={invalidDate}
                />
              </div>
              {invalidDate && (
                <small className="field-error">结束日期不能早于开始日期</small>
              )}
            </div>
            <div className="field">
              <label htmlFor={`${prefix}-region`}>
                Region <span>地区 · 可选</span>
              </label>
              <input
                id={`${prefix}-region`}
                value={source.region}
                onChange={(e) => onChange({ region: e.target.value })}
                placeholder="例如：美国、欧洲"
              />
            </div>
          </div>
          <div className="field product-field">
            <label htmlFor={`${prefix}-product`}>
              Product / Topic <span>产品或研究话题</span>
            </label>
            <input
              id={`${prefix}-product`}
              value={source.product}
              onChange={(e) => onChange({ product: e.target.value })}
              placeholder="例如：无线降噪耳机 / 长时间佩戴体验"
            />
          </div>
          <div className="field voc-field">
            <div className="field-heading">
              <label htmlFor={`${prefix}-voc`}>
                <MessageSquareText size={15} />
                VOC 原始文本
              </label>
              <span>支持多语言 · 批量粘贴</span>
            </div>
            <textarea
              id={`${prefix}-voc`}
              value={source.rawText}
              onChange={(e) => onChange({ rawText: e.target.value })}
              placeholder={
                "在这里粘贴来自同一来源的用户评论…\n\n保留用户的原始表达。你可以一次粘贴多条评论，无需翻译。"
              }
              spellCheck={false}
              rows={12}
            />
            <div className="textarea-footer">
              <span>原文完整保留，点击 Preview Data 查看拆分结果</span>
              <span>{source.rawText.length.toLocaleString("zh-CN")} 字符</span>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
