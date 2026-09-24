import { createContext, useContext } from "react";
import type { AnalysisResult, Evidence, Level, Quote } from "@/types/analysis";
import { levelLabel, percent } from "@/lib/insights/view";

export const ReportContext = createContext<AnalysisResult | null>(null);
export function useReport() {
  const result = useContext(ReportContext);
  if (!result) throw new Error("缺少分析结果。");
  return result;
}
export function LevelBadge({
  level,
  label = "证据",
}: {
  level: Level;
  label?: string;
}) {
  return (
    <span
      className={`ins-level ${level.toLowerCase()}`}
      aria-label={`${label}：${levelLabel[level]}`}
    >
      <span aria-hidden="true" />
      {label} · {levelLabel[level]}
    </span>
  );
}
function QuoteBlock({ quote, evidence }: { quote: Quote; evidence: Evidence }) {
  const result = useReport();
  const source = result.sources.find((s) => s.sourceId === quote.sourceId);
  const supports = evidence.supportingVocIds.includes(quote.vocId);
  const contradicts = evidence.contradictingVocIds.includes(quote.vocId);
  return (
    <figure className="ins-quote">
      <div className="ins-quote-label">
        原始评论{" "}
        <span>
          {supports && contradicts
            ? "含支持与反例"
            : contradicts
              ? "反例"
              : supports
                ? "支持证据"
                : "关联证据"}
        </span>
      </div>
      <blockquote dir="auto">{quote.originalText}</blockquote>
      <figcaption>
        {source ? (
          <>
            <strong>
              {source.platformLabel} · {source.brandLabel}
            </strong>
            <span>
              {source.brandType === "own" ? "自有品牌" : "竞品"} ·{" "}
              {source.periodStart && source.periodEnd
                ? `${source.periodStart} 至 ${source.periodEnd}`
                : "日期未知"}
              {source.region ? ` · ${source.region}` : ""}
            </span>
            <span>{source.productTopic}</span>
          </>
        ) : (
          "来源信息缺失"
        )}
      </figcaption>
      {quote.translationZh && (
        <details className="ins-translation">
          <summary>查看中文翻译</summary>
          <p>{quote.translationZh}</p>
        </details>
      )}
    </figure>
  );
}
export function RepresentativeQuotes({ evidence }: { evidence: Evidence }) {
  const quotes = evidence.representativeQuotes;
  if (!quotes.length)
    return <p className="ins-empty-inline">暂无可展示的原始引文。</p>;
  return (
    <div>
      <QuoteBlock quote={quotes[0]} evidence={evidence} />
      {quotes.length > 1 && (
        <details className="ins-more-quotes">
          <summary>查看其余 {quotes.length - 1} 条代表性评论</summary>
          {quotes.slice(1).map((q) => (
            <QuoteBlock key={q.quoteId} quote={q} evidence={evidence} />
          ))}
        </details>
      )}
    </div>
  );
}
export function EvidenceDetails({ evidence }: { evidence: Evidence }) {
  const { strength } = evidence;
  const f = strength.mentionFrequency;
  return (
    <details className="ins-evidence-details">
      <summary>证据强度说明</summary>
      <p>{strength.reasonZh}</p>
      <dl>
        <div>
          <dt>提及频次</dt>
          <dd>
            {f.supportingVocCount} / {f.scopeVocCount} 条 ·{" "}
            {percent(f.supportRate)}
          </dd>
        </div>
        <div>
          <dt>反例评论</dt>
          <dd>{f.contradictingVocCount} 条</dd>
        </div>
        {(
          [
            ["跨平台一致性", strength.crossPlatformConsistency],
            ["时间一致性", strength.timeConsistency],
            ["情感一致性", strength.sentimentConsistency],
          ] as const
        ).map(([label, item]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              {item.status === "measured"
                ? percent(item.score)
                : item.status === "not_applicable"
                  ? "不适用"
                  : "证据不足"}
              <small>{item.reasonZh}</small>
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
export function Limitations({ items }: { items: string[] }) {
  return items.length ? (
    <details className="ins-limitations">
      <summary>解读边界</summary>
      <ul>
        {items.map((text, i) => (
          <li key={i}>{text}</li>
        ))}
      </ul>
    </details>
  ) : null;
}
