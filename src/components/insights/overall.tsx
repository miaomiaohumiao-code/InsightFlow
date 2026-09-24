import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ComparisonSection, Finding } from "@/types/analysis";
import { competitors } from "@/lib/analysis/brand";
import { PROMPT_VERSION } from "@/lib/analysis/snapshot";
import {
  conditionalVisibility,
  insightMetrics,
  percent,
} from "@/lib/insights/view";
import {
  EvidenceDetails,
  LevelBadge,
  Limitations,
  RepresentativeQuotes,
  useReport,
} from "./evidence";

export function SectionHeading({
  number,
  title,
  english,
  description,
}: {
  number: string;
  title: string;
  english: string;
  description?: string;
}) {
  return (
    <header className="ins-section-heading">
      <span className="ins-section-number">{number}</span>
      <div>
        <h2>
          {title} <span>{english}</span>
        </h2>
        {description && <p>{description}</p>}
      </div>
    </header>
  );
}
export function Metrics() {
  const result = useReport();
  const metrics = insightMetrics(result);
  return (
    <div className="ins-metrics" aria-label="分析概览指标">
      {[
        ["VOC 总数量", "VOC RECORDS", metrics.voc, "本次分析纳入的评论"],
        ["核心主题", "CORE TOPICS", metrics.topics, "由评论证据支持的主题"],
        [
          "高证据洞察",
          "HIGH EVIDENCE INSIGHTS",
          metrics.highEvidence,
          "证据强度为高的 Insight",
        ],
        [
          "营销机会",
          "MARKETING OPPORTUNITIES",
          metrics.opportunities,
          "已识别的机会缺口 · 待验证",
        ],
      ].map(([title, english, value, note]) => (
        <div key={title}>
          <span>{title}</span>
          <small>{english}</small>
          <strong>{value}</strong>
          <p>{note}</p>
        </div>
      ))}
    </div>
  );
}
function TopicChart() {
  const { overall } = useReport();
  const data = [...overall.topTopics]
    .sort(
      (a, b) =>
        b.evidence.strength.mentionFrequency.supportingVocCount -
        a.evidence.strength.mentionFrequency.supportingVocCount,
    )
    .map((f) => ({
      title: f.titleZh,
      count: f.evidence.strength.mentionFrequency.supportingVocCount,
      id: f.id,
    }));
  return (
    <section className="ins-panel ins-topics">
      <div className="ins-panel-heading">
        <h3>
          主要主题 <span>Top Topics</span>
        </h3>
        <span>支持评论数</span>
      </div>
      {data.length ? (
        <>
          <div
            className="ins-topic-chart"
            style={{ height: Math.max(180, data.length * 56) }}
            aria-hidden="true"
          >
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={0}
              initialDimension={{
                width: 600,
                height: Math.max(180, data.length * 56),
              }}
            >
              <BarChart
                data={data}
                layout="vertical"
                margin={{ top: 5, right: 35, bottom: 5, left: 0 }}
                accessibilityLayer={false}
              >
                <CartesianGrid horizontal={false} stroke="#edf0ed" />
                <XAxis
                  type="number"
                  allowDecimals={false}
                  tick={{ fontSize: 10, fill: "#75817a" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="title"
                  width={145}
                  tick={{ fontSize: 11, fill: "#45544b" }}
                  tickFormatter={(value: string) =>
                    value.length > 11 ? `${value.slice(0, 11)}…` : value
                  }
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                />
                <Tooltip
                  cursor={{ fill: "#f3f7f3" }}
                  formatter={(value) => [`${value} 条`, "支持评论"]}
                  contentStyle={{
                    border: "1px solid #e4ebe5",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar
                  dataKey="count"
                  fill="#3c8063"
                  radius={[0, 4, 4, 0]}
                  barSize={18}
                  isAnimationActive={false}
                >
                  <LabelList
                    dataKey="count"
                    position="right"
                    fill="#385846"
                    fontSize={11}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="ins-caption">
            同一评论可涉及多个主题，各主题数量不能相加作为 VOC 总数。
          </p>
          <div className="ins-topic-notes">
            {data.map((item) => {
              const finding = overall.topTopics.find((f) => f.id === item.id)!;
              return (
                <details key={item.id}>
                  <summary>
                    <span>{item.title}</span>
                    <b>{item.count} 条</b>
                  </summary>
                  <p>{finding.summaryZh}</p>
                  <RepresentativeQuotes evidence={finding.evidence} />
                  <EvidenceDetails evidence={finding.evidence} />
                  <Limitations items={finding.limitationsZh} />
                </details>
              );
            })}
          </div>
        </>
      ) : (
        <p className="ins-empty-inline">当前样本尚未形成有证据支持的主题。</p>
      )}
    </section>
  );
}
function SentimentOverview() {
  const { overall } = useReport();
  const { sentiment } = overall;
  const items = (
    [
      ["positive", "正面", "#4f896d"],
      ["neutral", "中立", "#a3b6ae"],
      ["negative", "负面", "#b97b65"],
      ["mixed", "混合", "#c3a96f"],
      ["unknown", "无法判断", "#d8ddda"],
    ] as const
  ).map(([key, label, color]) => ({
    key,
    label,
    color,
    count: sentiment.counts[key],
  }));
  const total = items.reduce((n, i) => n + i.count, 0);
  return (
    <section className="ins-panel ins-sentiment">
      <h3>
        情感概览 <span>Sentiment</span>
      </h3>
      <p className="ins-caption">理解反馈的背景，而非单凭情绪判断需求。</p>
      <div className="ins-sentiment-bar" aria-hidden="true">
        {items
          .filter((i) => i.count > 0)
          .map((i) => (
            <span key={i.key} style={{ flex: i.count, background: i.color }} />
          ))}
      </div>
      <dl className="ins-sentiment-legend">
        {items.map((i) => (
          <div key={i.key}>
            <dt>
              <span style={{ background: i.color }} />
              {i.label}
            </dt>
            <dd>
              {i.count}{" "}
              <small>条 · {total ? percent(i.count / total) : "—"}</small>
            </dd>
          </div>
        ))}
      </dl>
      <p className="ins-caption">
        每条评论仅计入一个情感类别。混合表示同时存在正负反馈。
      </p>
    </section>
  );
}
export function FindingModule({
  title,
  english,
  items,
  empty = "当前样本未形成有充分证据的结论。",
}: {
  title: string;
  english: string;
  items: Finding[];
  empty?: string;
}) {
  return (
    <section className="ins-panel ins-finding-module">
      <h3>
        {title} <span>{english}</span>
      </h3>
      {items.length ? (
        <ol className="ins-finding-list">
          {items.map((f, index) => (
            <li key={f.id}>
              <div className="ins-finding-title">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h4>{f.titleZh}</h4>
              </div>
              <p>{f.summaryZh}</p>
              <div className="ins-finding-meta">
                <LevelBadge level={f.evidence.strength.level} />
                <span>
                  {f.evidence.strength.mentionFrequency.supportingVocCount}{" "}
                  条支持评论
                </span>
              </div>
              <details className="ins-finding-evidence">
                <summary>查看原文与依据</summary>
                <RepresentativeQuotes evidence={f.evidence} />
                <EvidenceDetails evidence={f.evidence} />
                <Limitations items={f.limitationsZh} />
              </details>
            </li>
          ))}
        </ol>
      ) : (
        <p className="ins-empty-inline">{empty}</p>
      )}
    </section>
  );
}
export function OverallAnalysis() {
  const { overall } = useReport();
  return (
    <section id="overall" className="ins-section">
      <SectionHeading
        number="01"
        title="理解整体声音"
        english="Overall Analysis"
        description="从反复出现的主题，找到需求与购买决策的线索。"
      />
      <Metrics />
      <div className="ins-overview-grid">
        <TopicChart />
        <SentimentOverview />
      </div>
      <div className="ins-two-columns">
        <FindingModule
          title="用户痛点"
          english="Pain Points"
          items={overall.painPoints}
        />
        <FindingModule
          title="用户需求"
          english="User Needs"
          items={overall.userNeeds}
        />
        <FindingModule
          title="购买驱动"
          english="Purchase Drivers"
          items={overall.purchaseDrivers}
          empty="未找到明确关联购买决策的驱动证据。正面评价不自动等于购买原因。"
        />
        <FindingModule
          title="购买障碍"
          english="Purchase Barriers"
          items={overall.purchaseBarriers}
          empty="未找到明确关联购买决策的障碍证据。负面评价不自动等于购买障碍。"
        />
      </div>
    </section>
  );
}
function ComparisonModule({
  title,
  english,
  section,
}: {
  title: string;
  english: string;
  section: ComparisonSection;
}) {
  const result = useReport();
  return (
    <section className="ins-panel ins-comparison">
      <h3>
        {title} <span>{english}</span>
      </h3>
      {section.status !== "ready" || !section.items.length ? (
        <p className="ins-empty-inline">
          <strong>暂不形成差异结论</strong>
          {section.reasonZh || "缺少足够的可比证据。"}
        </p>
      ) : (
        <>
          {section.reasonZh && (
            <p className="ins-caption">{section.reasonZh}</p>
          )}
          {section.items.map((item) => (
            <article key={item.id}>
              <h4>{item.titleZh}</h4>
              <div className="ins-comparison-groups">
                {item.groups.map((group) => (
                  <div key={group.groupId}>
                    <strong>
                      {result.groups.find((g) => g.groupId === group.groupId)
                        ?.labelZh || "来源组"}
                    </strong>
                    <p>{group.observationZh}</p>
                    <details>
                      <summary>查看支持证据</summary>
                      <RepresentativeQuotes evidence={group.evidence} />
                      <EvidenceDetails evidence={group.evidence} />
                    </details>
                  </div>
                ))}
              </div>
              <p className="ins-comparison-conclusion">{item.conclusionZh}</p>
              <Limitations items={item.limitationsZh} />
            </article>
          ))}
        </>
      )}
    </section>
  );
}
export function ConditionalAnalysis() {
  const result = useReport();
  const show = conditionalVisibility(result);
  if (!show.platforms && !show.periods && !show.brands) return null;
  const brand = result.conditional.brandComparison;
  return (
    <section id="comparisons" className="ins-section">
      <SectionHeading
        number="02"
        title="比较不同视角"
        english="Conditional Analysis"
        description="只在来源可比、证据充分时呈现差异。"
      />
      <div className="ins-two-columns ins-comparison-grid">
        {show.platforms && (
          <ComparisonModule
            title="平台差异"
            english="Platform Differences"
            section={result.conditional.platformDifferences}
          />
        )}
        {show.periods && (
          <ComparisonModule
            title="时间差异"
            english="Time Differences"
            section={result.conditional.timeDifferences}
          />
        )}
      </div>
      {show.brands && (
        <div className="ins-brand-section">
          <div className="ins-brand-heading">
            <h3>
              品牌对比 <span>Brand Comparison</span>
            </h3>
            {brand.reasonZh && <p>{brand.reasonZh}</p>}
            {result.promptVersion !== PROMPT_VERSION && (
              <p>
                此报告使用旧分析规则。缺少双边证据链的旧机会已排除；请返回 VOC
                页面重新分析，以生成按竞品区分的优势和可承接机会。
              </p>
            )}
          </div>
          <div className="ins-two-columns">
            <div className="ins-opportunities">
              <p className="ins-data-note">
                机会缺口需同时具备：竞品明确未满足的需求、自有品牌相关能力线索，以及二者之间可解释的承接关系。普通差异不等于机会。
              </p>
              <FindingModule
                title="机会缺口"
                english="Opportunity Gaps"
                items={brand.status === "ready" ? brand.opportunityGaps : []}
                empty="当前没有足够证据提出机会缺口。"
              />
              {brand.opportunityGaps.map(
                (gap) =>
                  gap.qualification && (
                    <div className="marketing-point" key={gap.id}>
                      <h4>{gap.titleZh} · 证据链</h4>
                      <p>
                        <strong>竞品：</strong>
                        {gap.qualification.competitorBrandIds
                          .map(
                            (id) =>
                              result.sources.find((s) => s.brandId === id)
                                ?.brandLabel ?? id,
                          )
                          .join("、")}
                      </p>
                      <p>
                        <strong>未满足需求：</strong>
                        {gap.qualification.needZh}
                      </p>
                      <p>
                        <strong>
                          {gap.qualification.fitStatus === "observed"
                            ? "已有体验线索"
                            : "潜在承接线索"}
                          ：
                        </strong>
                        {gap.qualification.ownBrandFitZh}
                      </p>
                      <p>
                        <strong>待核实与边界：</strong>
                        {gap.qualification.boundaryZh}
                      </p>
                      <p className="marketing-reason">
                        竞品需求支持引文{" "}
                        {
                          gap.qualification.unmetNeedEvidence.supportingQuoteIds
                            .length
                        }{" "}
                        条 · 自有品牌能力支持引文{" "}
                        {
                          gap.qualification.ownBrandFitEvidence
                            .supportingQuoteIds.length
                        }{" "}
                        条。引文数量不是独立用户数量。
                      </p>
                      <a
                        href={`#insight-title-${result.insightCards.findIndex((i) => i.originOpportunityId === gap.id)}`}
                      >
                        查看对应机会 Insight，选择后生成营销策略 →
                      </a>
                    </div>
                  ),
              )}
            </div>
            <FindingModule
              title="自有品牌优势"
              english="Own Brand Strengths"
              items={brand.status === "ready" ? brand.ownBrandStrengths : []}
            />
            <FindingModule
              title="自有品牌不足"
              english="Own Brand Weaknesses"
              items={brand.status === "ready" ? brand.ownBrandWeaknesses : []}
            />
            {competitors(result).map((competitor) => (
              <FindingModule
                key={competitor.brandId}
                title={`${competitor.label} · 竞品优势`}
                english="Competitor Strengths"
                items={brand.status === "ready" ? competitor.strengths : []}
                empty="此竞品当前缺少可支持的独立优势证据；不以其他品牌评论补齐。"
              />
            ))}
            <FindingModule
              title="共同痛点"
              english="Common Pain Points"
              items={brand.status === "ready" ? brand.commonPainPoints : []}
            />
          </div>
        </div>
      )}
    </section>
  );
}
