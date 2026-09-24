import Link from "next/link";
import { ArrowUpRight, Database, Layers3 } from "lucide-react";

export function AppShell({
  children,
  active = false,
  onHome,
  view = "input",
}: {
  children: React.ReactNode;
  active?: boolean;
  onHome?: () => void;
  view?: "input" | "insights";
}) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        {onHome ? (
          <button onClick={onHome} className="brand">
            <span className="brand-mark">
              <Layers3 size={22} />
            </span>
            InsightFlow<span className="brand-dot">.</span>
          </button>
        ) : (
          <Link href="/" className="brand">
            <span className="brand-mark">
              <Layers3 size={22} />
            </span>
            InsightFlow<span className="brand-dot">.</span>
          </Link>
        )}
        <div className="workspace-label">WORKSPACE</div>
        {onHome ? (
          <button onClick={onHome} className="nav-item">
            <Layers3 size={18} />
            我的项目 <span>↗</span>
          </button>
        ) : (
          <Link href="/" className={`nav-item ${!active ? "selected" : ""}`}>
            <Layers3 size={18} />
            我的项目 <span>↗</span>
          </Link>
        )}
        {active && (
          <div className="nav-item selected current-nav">
            <span className="nav-dot" />
            {view === "insights" ? "洞察分析" : "VOC 输入"}
          </div>
        )}
        <div className="sidebar-note">
          <Database size={17} />
          <strong>你的研究，保存在本地</strong>
          <p>
            项目仅保存在当前浏览器。
            <br />
            清除网站数据会移除项目。
          </p>
          <span>
            LOCAL WORKSPACE <ArrowUpRight size={12} />
          </span>
        </div>
        <div className="sidebar-footer">
          InsightFlow <span>本地保存</span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>
            工作空间 <span className="slash">/</span>{" "}
            <strong>
              {active
                ? view === "insights"
                  ? "Insights"
                  : "VOC Input"
                : "我的项目"}
            </strong>
          </span>
          <span className="local-badge">
            <span />
            本地工作空间
          </span>
        </header>
        {children}
      </div>
    </div>
  );
}
