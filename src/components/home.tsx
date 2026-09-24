"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowUpRight,
  Plus,
  FolderOpen,
  Layers3,
  MessageSquareText,
  Target,
} from "lucide-react";
import { createProject, type Project } from "@/types/project";
import {
  listProjects,
  saveProject,
  storageError,
} from "@/lib/storage/projects";
import { latestCompletedAnalysis } from "@/lib/storage/analysis";
import { AppShell } from "./app-shell";

export function Home() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [analyzedIds, setAnalyzedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  useEffect(() => {
    listProjects()
      .then(async (rows) => {
        setProjects(rows);
        const completed = await Promise.all(
          rows.map(async (p) =>
            (await latestCompletedAnalysis(p.id)) ? p.id : null,
          ),
        );
        setAnalyzedIds(new Set(completed.filter((id): id is string => !!id)));
      })
      .catch((err) => setError(storageError(err)))
      .finally(() => setLoading(false));
  }, []);
  async function newProject() {
    setCreating(true);
    setError("");
    try {
      const project = await saveProject(createProject(), null);
      router.push(`/projects/${project.id}/input`);
    } catch (err) {
      setError(storageError(err));
      setCreating(false);
    }
  }
  return (
    <AppShell>
      <main className="home-main">
        <div className="eyebrow">FROM VOICES TO DECISIONS</div>
        <section className="home-heading">
          <div>
            <h1>
              让用户的声音，
              <br />
              <span>成为下一步的方向。</span>
            </h1>
            <p>汇集多来源 VOC，将用户反馈转化为有依据的营销决策。</p>
          </div>
          <button
            className="button primary"
            disabled={creating || loading}
            onClick={newProject}
          >
            <Plus size={18} />
            {creating ? "正在创建…" : "New Project"}
          </button>
        </section>
        {error && (
          <div role="alert" className="error-banner">
            {error}
            <button onClick={() => window.location.reload()}>重新加载</button>
          </div>
        )}
        <section className="journey" aria-label="研究流程">
          <div>
            <span className="journey-icon">
              <MessageSquareText size={20} />
            </span>
            <span className="step-label">01 · COLLECT</span>
            <h3>收集真实声音</h3>
            <p>
              按平台、品牌和时间整理 VOC，
              <br />
              让每一份反馈都有清晰的来源。
            </p>
          </div>
          <ArrowRight className="journey-arrow" size={20} />
          <div>
            <span className="journey-icon muted">
              <Layers3 size={20} />
            </span>
            <span className="step-label">02 · UNDERSTAND</span>
            <h3>发现用户洞察</h3>
            <p>
              从需求与痛点出发，
              <br />
              理解影响购买决策的关键因素。
            </p>
          </div>
          <ArrowRight className="journey-arrow" size={20} />
          <div>
            <span className="journey-icon muted">
              <Target size={20} />
            </span>
            <span className="step-label">03 · ACT</span>
            <h3>形成营销行动</h3>
            <p>
              把洞察转化为传播方向，
              <br />
              生成可交给真实平台执行的实验建议。
            </p>
          </div>
        </section>
        <section className="recent-section">
          <div className="section-heading">
            <div>
              <h2>
                最近项目 <span>Recent Projects</span>
              </h2>
              <p>继续上次的研究，或从一个新问题开始。</p>
            </div>
            <span className="count-label">{projects.length} 个项目</span>
          </div>
          {loading ? (
            <div className="empty-state" role="status">
              正在读取本地项目…
            </div>
          ) : projects.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">
                <FolderOpen size={28} />
              </span>
              <h3>你的第一个洞察，从这里开始</h3>
              <p>创建项目，粘贴评论，为你的研究建立一个清晰的起点。</p>
              <button
                className="button secondary"
                disabled={creating}
                onClick={newProject}
              >
                <Plus size={16} />
                创建第一个项目
              </button>
            </div>
          ) : (
            <div className="project-grid">
              {projects.map((project) => (
                <Link
                  className="project-card"
                  href={`/projects/${project.id}/${analyzedIds.has(project.id) ? "insights" : "input"}`}
                  key={project.id}
                >
                  <div className="project-card-top">
                    <span className="project-icon">
                      <FolderOpen size={20} />
                    </span>
                    <span className="draft-badge">
                      {analyzedIds.has(project.id) ? "查看洞察" : "草稿"}
                    </span>
                    <ArrowUpRight size={18} />
                  </div>
                  <h3>{project.name.trim() || "未命名项目"}</h3>
                  <p>
                    {project.researchGoal === "自定义"
                      ? project.customGoal || "自定义研究"
                      : project.researchGoal}
                  </p>
                  <div className="project-card-bottom">
                    <span>
                      {project.sources.length} 个来源 ·{" "}
                      {
                        new Set(
                          project.sources
                            .map((s) => s.platform.trim())
                            .filter(Boolean),
                        ).size
                      }{" "}
                      个平台
                    </span>
                    <time dateTime={project.updatedAt}>
                      {new Date(project.updatedAt).toLocaleDateString("zh-CN", {
                        month: "short",
                        day: "numeric",
                      })}
                    </time>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
        <footer className="main-footer">
          <span>INSIGHTFLOW</span>先听见，再理解，然后行动。
        </footer>
      </main>
    </AppShell>
  );
}
