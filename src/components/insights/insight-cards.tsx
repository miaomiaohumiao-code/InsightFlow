import { ListChecks } from "lucide-react";
import type { Insight } from "@/types/analysis";
import type { InsightSelection, InsightSort } from "@/lib/insights/view";
import { sortInsights } from "@/lib/insights/view";
import {
  EvidenceDetails,
  LevelBadge,
  Limitations,
  RepresentativeQuotes,
  useReport,
} from "./evidence";
import { SectionHeading } from "./overall";

function InsightCard({
  insight,
  selected,
  onToggle,
  index,
}: {
  insight: Insight;
  selected: boolean;
  onToggle: () => void;
  index: number;
}) {
  const report = useReport();
  const { overall } = report;
  const opportunity = report.conditional.brandComparison.opportunityGaps.find(
    (g) => g.id === insight.originOpportunityId,
  )?.qualification;
  const need = overall.userNeeds.find(
    (f) => f.id === insight.userNeedFindingId,
  );
  const pain = overall.painPoints.find(
    (f) => f.id === insight.painPointFindingId,
  );
  const drivers = overall.purchaseDrivers.filter((f) =>
    insight.purchaseDriverFindingIds.includes(f.id),
  );
  const barriers = overall.purchaseBarriers.filter((f) =>
    insight.purchaseBarrierFindingIds.includes(f.id),
  );
  return (
    <article
      className={`ins-card ${selected ? "is-selected" : ""}`}
      aria-labelledby={`insight-title-${index}`}
    >
      <div className="ins-card-top">
        <span>INSIGHT {String(index + 1).padStart(2, "0")}</span>
        <label className="ins-select">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={`选择洞察：${insight.titleZh}`}
          />
          {selected ? "已选择" : "选择洞察"}
        </label>
      </div>
      <h3 id={`insight-title-${index}`}>{insight.titleZh}</h3>
      <div className="ins-card-badges">
        <LevelBadge level={insight.evidence.strength.level} label="证据强度" />
        <LevelBadge
          level={insight.marketingPriority.level}
          label="营销优先级"
        />
      </div>
      <div className="ins-segment">
        <span>需求型人群</span>
        <p>
          {insight.targetSegment?.labelZh ||
            (opportunity
              ? `关注「${opportunity.needZh}」的人群`
              : "证据不足，暂不划分人群")}
        </p>
      </div>
      <dl className="ins-card-factors">
        <div>
          <dt>用户需求</dt>
          <dd>{need?.titleZh || opportunity?.needZh || "暂无明确需求关联"}</dd>
        </div>
        <div>
          <dt>用户痛点</dt>
          <dd>{pain?.titleZh || "暂无明确痛点关联"}</dd>
        </div>
        <div>
          <dt>购买驱动</dt>
          <dd>
            {drivers.length
              ? drivers.map((f) => f.titleZh).join("；")
              : "暂无明确购买驱动证据"}
          </dd>
        </div>
        <div>
          <dt>购买障碍</dt>
          <dd>
            {barriers.length
              ? barriers.map((f) => f.titleZh).join("；")
              : "暂无明确购买障碍证据"}
          </dd>
        </div>
      </dl>
      <RepresentativeQuotes evidence={insight.evidence} />
      <div className="ins-implication">
        <span>
          营销启示 <small>MARKETING IMPLICATION</small>
        </span>
        <p>{insight.marketingImplicationZh}</p>
      </div>
      <div className="ins-card-reasons">
        <EvidenceDetails evidence={insight.evidence} />
        <details>
          <summary>营销优先级说明</summary>
          <p>{insight.marketingPriority.reasonZh}</p>
        </details>
        <Limitations items={insight.limitationsZh} />
      </div>
    </article>
  );
}
export function InsightCards({
  selection,
  onChange,
}: {
  selection: InsightSelection;
  onChange: (next: InsightSelection) => void;
}) {
  const result = useReport();
  const cards = sortInsights(result.insightCards, selection.sort);
  const selected = new Set(selection.selectedIds);
  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ ...selection, selectedIds: [...next] });
  }
  return (
    <section id="insights" className="ins-section ins-cards-section">
      <SectionHeading
        number="03"
        title="找到值得行动的洞察"
        english="Insight Cards"
        description="结合证据强度与营销价值，选择值得进一步探索的方向。"
      />
      {cards.length ? (
        <>
          <div className="ins-card-toolbar">
            <div>
              <ListChecks size={18} />
              <strong>{cards.length} 条洞察</strong>
              <span aria-live="polite">已选择 {selected.size} 条</span>
            </div>
            <div>
              <button
                className="ins-text-button"
                onClick={() =>
                  onChange({
                    ...selection,
                    selectedIds:
                      selected.size === cards.length
                        ? []
                        : cards.map((c) => c.id),
                  })
                }
              >
                {selected.size === cards.length ? "取消全选" : "选择全部"}
              </button>
              <label>
                排序{" "}
                <select
                  aria-label="Insight 排序"
                  value={selection.sort}
                  onChange={(e) =>
                    onChange({
                      ...selection,
                      sort: e.target.value as InsightSort,
                    })
                  }
                >
                  <option value="original">默认顺序</option>
                  <option value="evidence">Evidence Strength · 从高到低</option>
                  <option value="priority">
                    Marketing Priority · 从高到低
                  </option>
                </select>
              </label>
            </div>
          </div>
          <div className="ins-card-grid">
            {cards.map((insight) => (
              <InsightCard
                key={insight.id}
                index={result.insightCards.findIndex(
                  (i) => i.id === insight.id,
                )}
                insight={insight}
                selected={selected.has(insight.id)}
                onToggle={() => toggle(insight.id)}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="ins-panel ins-empty-inline">
          <strong>当前尚未形成可用洞察</strong>
          保留已有主题供研究参考；可补充评论后重新分析。
        </div>
      )}
    </section>
  );
}
