"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Plus,
  Check,
  Circle,
  Database,
  Layers3,
  ArrowUpRight,
  LoaderCircle,
  ArrowRight,
} from "lucide-react";
import { useProject } from "@/hooks/use-project";
import {
  brandName,
  createSource,
  researchGoals,
  sourceIssues,
  type ResearchGoal,
} from "@/types/project";
import { AppShell } from "./app-shell";
import { SourceCard } from "./source-card";
import { VOCPreviewPanel } from "./voc-preview";
import { preparePreview } from "@/lib/voc/prepare";

export function ProjectEditor({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { project, loading, error, status, update, flush } =
    useProject(projectId);
  const [notice, setNotice] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [preparing, setPreparing] = useState(false);
  async function back() {
    if (await flush()) router.push("/");
  }
  if (loading)
    return (
      <AppShell active>
        <div className="page-state" role="status">
          <LoaderCircle className="spin" />
          正在读取项目…
        </div>
      </AppShell>
    );
  if (!project)
    return (
      <AppShell active>
        <div className="page-state">
          <h1>{error ? "暂时无法读取项目" : "找不到这个项目"}</h1>
          <p>
            {error || "项目保存在创建它的浏览器中，请返回首页查看本地项目。"}
          </p>
          <Link href="/" className="button secondary">
            返回首页
          </Link>
        </div>
      </AppShell>
    );
  const platforms = new Set(
    project.sources.map((s) => s.platform.trim()).filter(Boolean),
  );
  const competitors = new Set(
    project.sources
      .filter((s) => s.brandType === "competitor")
      .map((s) => s.competitorName.trim().toLocaleLowerCase())
      .filter(Boolean),
  );
  const completed = project.sources.filter(
    (s) => !sourceIssues(project, s).length,
  ).length;
  const chars = project.sources.reduce(
    (total, source) => total + source.rawText.length,
    0,
  );
  function addSource() {
    const source = createSource();
    update((p) => ({ ...p, sources: [...p.sources, source] }));
    requestAnimationFrame(() =>
      document
        .getElementById(`source-${source.id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }
  async function save() {
    if (await flush()) {
      setNotice("项目草稿已保存到当前浏览器。");
    }
  }
  async function previewData() {
    setPreparing(true);
    try {
      if (!(await flush())) return;
      update((p) => ({
        ...p,
        preview: p.preview ?? preparePreview(p.sources),
      }));
      setShowPreview(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setPreparing(false);
    }
  }
  return (
    <AppShell active onHome={() => void back()}>
      <main className="editor-main">
        <div className="editor-topline">
          <button className="back-link" onClick={back}>
            <ArrowLeft size={15} />
            所有项目
          </button>
          <span className={`save-status ${status}`} role="status">
            {status === "saving" ? (
              <LoaderCircle size={14} className="spin" />
            ) : status === "saved" ? (
              <Check size={14} />
            ) : (
              <Circle size={14} />
            )}
            {status === "saving"
              ? "正在保存…"
              : status === "saved"
                ? "已保存到本地"
                : "未能保存"}
          </span>
        </div>
        <section className="editor-heading">
          <div>
            <div className="eyebrow">PROJECT WORKSPACE</div>
            <h1>
              {showPreview ? "核对本次 VOC 数据" : "收集用户的真实声音"}
              <span className="phase-tag">
                {showPreview ? "Preview Data" : "VOC Input"}
              </span>
            </h1>
            <p>为每一批评论添加来源，让后续洞察有据可循。</p>
          </div>
        </section>
        <ol className="progress-steps">
          <li className="active">
            <span>1</span>输入 VOC
          </li>
          <li>
            <span>2</span>
            <button
              onClick={async () => {
                if (await flush())
                  router.push(`/projects/${projectId}/insights`);
              }}
            >
              发现洞察
            </button>
          </li>
          <li>
            <span>3</span>
            <button
              onClick={async () => {
                if (await flush())
                  router.push(
                    `/projects/${projectId}/insights#marketing-actions`,
                  );
              }}
            >
              营销行动与实验建议
            </button>
          </li>
        </ol>
        {error && (
          <div role="alert" className="error-banner">
            {error}
            <button onClick={() => void flush()}>重试保存</button>
          </div>
        )}
        {showPreview && project.preview ? (
          <VOCPreviewPanel
            project={project}
            preview={project.preview}
            saving={status === "saving"}
            saved={status === "saved"}
            onChange={(preview) => update((p) => ({ ...p, preview }))}
            onBack={() => {
              setShowPreview(false);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            onConfirm={async () => {
              if (!(await flush())) return false;
              update((p) => ({
                ...p,
                preview: p.preview
                  ? { ...p.preview, confirmedAt: new Date().toISOString() }
                  : undefined,
              }));
              return await flush();
            }}
          />
        ) : (
          <div className="editor-grid">
            <div className="editor-content">
              <section className="panel project-settings">
                <div className="panel-title">
                  <span className="section-index">01</span>
                  <h2>项目设置</h2>
                  <span>定义这次研究的起点</span>
                </div>
                <div className="form-grid two">
                  <div className="field">
                    <label htmlFor="project-name">
                      Project Name <span>项目名称</span>
                    </label>
                    <input
                      id="project-name"
                      value={project.name}
                      placeholder="例如：无线耳机新品营销研究"
                      onChange={(e) =>
                        update((p) => ({ ...p, name: e.target.value }))
                      }
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="research-goal">
                      Research Goal <span>研究目标</span>
                    </label>
                    <select
                      id="research-goal"
                      value={project.researchGoal}
                      onChange={(e) =>
                        update((p) => ({
                          ...p,
                          researchGoal: e.target.value as ResearchGoal,
                        }))
                      }
                    >
                      {researchGoals.map((goal) => (
                        <option key={goal}>{goal}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {project.researchGoal === "自定义" && (
                  <div className="field custom-goal">
                    <label htmlFor="custom-goal">自定义研究目标</label>
                    <input
                      id="custom-goal"
                      value={project.customGoal}
                      placeholder="这次研究，你最希望回答什么问题？"
                      onChange={(e) =>
                        update((p) => ({ ...p, customGoal: e.target.value }))
                      }
                    />
                  </div>
                )}
              </section>
              <section className="sources-section">
                <div className="sources-title">
                  <div>
                    <span className="section-index">02</span>
                    <h2>
                      VOC 来源{" "}
                      <span className="number-pill">
                        {project.sources.length}
                      </span>
                    </h2>
                  </div>
                  <p>相同平台的不同品牌或时间段，请分别添加来源。</p>
                </div>
                <datalist id="platform-options">
                  {[
                    "Reddit",
                    "TikTok",
                    "Amazon",
                    "小红书",
                    "微博",
                    "YouTube",
                    "Best Buy",
                    "品牌商店",
                    "用户访谈",
                    "客服反馈",
                  ].map((platform) => (
                    <option key={platform} value={platform} />
                  ))}
                </datalist>
                {project.sources.map((source, index) => (
                  <SourceCard
                    key={source.id}
                    source={source}
                    index={index}
                    project={project}
                    onChange={(patch) =>
                      update((p) => ({
                        ...p,
                        sources: p.sources.map((s) =>
                          s.id === source.id ? { ...s, ...patch } : s,
                        ),
                      }))
                    }
                    onOwnBrandChange={(name) =>
                      update((p) => ({ ...p, ownBrandName: name }))
                    }
                    onDelete={() =>
                      update((p) => ({
                        ...p,
                        sources: p.sources.filter((s) => s.id !== source.id),
                      }))
                    }
                  />
                ))}
                {project.sources.length === 0 && (
                  <div className="source-empty">
                    <Layers3 size={25} />
                    <h3>添加你的第一个 VOC 来源</h3>
                    <p>从一个平台、一批评论开始。</p>
                  </div>
                )}
                <button className="add-source" onClick={addSource}>
                  <Plus size={19} />
                  Add Another Source <span>添加另一个来源</span>
                </button>
              </section>
              <div className="editor-bottom">
                <div>
                  <strong>先保存声音，再发现洞察</strong>
                  <p>先查看清洗与拆分结果，再确认本次数据。</p>
                </div>
                <button
                  className="button secondary"
                  onClick={save}
                  disabled={status === "saving"}
                >
                  <Check size={16} />
                  保存项目
                </button>
                <button
                  className="button primary"
                  onClick={previewData}
                  disabled={preparing || status === "saving"}
                >
                  {preparing ? "正在准备…" : "Preview Data"}
                  <ArrowRight size={16} />
                </button>
              </div>
              {notice && (
                <p className="save-notice" role="status">
                  {notice}
                </p>
              )}
            </div>
            <aside className="overview">
              <div className="overview-panel">
                <div className="overview-title">
                  <h2>来源概览</h2>
                  <Layers3 size={18} />
                </div>
                <div className="overview-stats">
                  <div>
                    <strong>
                      {project.sources.length.toString().padStart(2, "0")}
                    </strong>
                    <span>VOC 来源</span>
                  </div>
                  <div>
                    <strong>
                      {platforms.size.toString().padStart(2, "0")}
                    </strong>
                    <span>不同平台</span>
                  </div>
                </div>
                <div className="overview-row">
                  <span>自有品牌</span>
                  <strong>{project.ownBrandName.trim() || "尚未填写"}</strong>
                </div>
                <div className="overview-row">
                  <span>竞品品牌</span>
                  <strong>{competitors.size} 个</strong>
                </div>
                <div className="overview-row">
                  <span>原文总字符</span>
                  <strong>{chars.toLocaleString("zh-CN")}</strong>
                </div>
                <div className="overview-divider" />
                <div className="overview-list-title">
                  来源填写情况{" "}
                  <span>
                    {completed}/{project.sources.length}
                  </span>
                </div>
                <ul className="source-checklist">
                  {project.sources.map((source, index) => {
                    const issues = sourceIssues(project, source);
                    return (
                      <li key={source.id}>
                        <a href={`#source-${source.id}`}>
                          <span
                            className={
                              issues.length ? "check-pending" : "check-done"
                            }
                          >
                            {issues.length ? (
                              <Circle size={14} />
                            ) : (
                              <Check size={14} />
                            )}
                          </span>
                          <span>
                            <strong>
                              {source.platform || `来源 ${index + 1}`}
                              {brandName(project, source)
                                ? ` · ${brandName(project, source)}`
                                : ""}
                            </strong>
                            <small>
                              {issues.length
                                ? `待填：${issues.join("、")}`
                                : "来源信息已填写"}
                            </small>
                          </span>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div className="input-tips">
                <div>
                  <span className="tip-marker" />
                  好的洞察，始于好的输入
                </div>
                <p>每张卡片保持同一平台、品牌和时间段，方便后续比较。</p>
                <p>
                  原文可以使用任何语言。不确定评论日期时，保留“日期未知”即可。
                </p>
                <span>
                  KEEP THE ORIGINAL VOICE <ArrowUpRight size={12} />
                </span>
              </div>
              <p className="privacy-note">
                <Database size={14} />
                编辑时保存在本地；点击 Analyze VOC 后将发送纳入评论至配置的 AI
                服务商。
              </p>
            </aside>
          </div>
        )}
      </main>
    </AppShell>
  );
}
