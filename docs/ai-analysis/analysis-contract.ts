// Canonical contract, imported as types by the application. All fields required; absent values use null.
// *Draft and BatchExtraction are model outputs; AnalysisResult is assembled and verified by the application.
export type Level = "High" | "Medium" | "Low";

export type Status = "ready" | "not_applicable" | "insufficient_data" | "no_supported_finding";

export type EvidenceRefs = {
  supportingQuoteIds: Array<string>;
  contradictingQuoteIds: Array<string>;
};

export type FindingDraft = {
  id: string;
  titleZh: string;
  summaryZh: string;
  scopeGroupIds: Array<string>;
  evidence: EvidenceRefs;
  limitationsZh: Array<string>;
};

export type SentimentDraft = {
  summaryZh: string | null;
  evidence: EvidenceRefs;
};

export type ComparisonGroupDraft = {
  groupId: string;
  observationZh: string;
  evidence: EvidenceRefs;
};

export type ComparisonDraft = {
  id: string;
  topicFindingId: string;
  titleZh: string;
  groups: Array<ComparisonGroupDraft>;
  conclusionZh: string;
  limitationsZh: Array<string>;
};

export type ComparisonSectionDraft = {
  status: Status;
  reasonZh: string | null;
  items: Array<ComparisonDraft>;
};

export type BrandSectionDraft = {
  status: Status;
  reasonZh: string | null;
  ownBrandStrengths: Array<FindingDraft>;
  ownBrandWeaknesses: Array<FindingDraft>;
  competitorStrengths: Array<FindingDraft>;
  commonPainPoints: Array<FindingDraft>;
  opportunityGaps: Array<FindingDraft & { qualification: OpportunityQualification }>;
};

export type OpportunityQualification = {
  competitorBrandIds: string[];
  needZh: string;
  unmetNeedEvidence: EvidenceRefs;
  ownBrandFitEvidence: EvidenceRefs;
  ownBrandFitZh: string;
  fitStatus: "observed" | "potential";
  boundaryZh: string;
};

export type Priority = {
  level: Level;
  reasonZh: string;
};

export type InsightDraft = {
  id: string;
  titleZh: string;
  targetSegmentNeedId: string | null;
  userNeedFindingId: string | null;
  painPointFindingId: string | null;
  purchaseDriverFindingIds: Array<string>;
  purchaseBarrierFindingIds: Array<string>;
  evidence: EvidenceRefs;
  marketingImplicationZh: string;
  marketingPriority: Priority;
  limitationsZh: Array<string>;
};

export type OverallDraft = {
  topTopics: Array<FindingDraft>;
  sentiment: SentimentDraft;
  painPoints: Array<FindingDraft>;
  userNeeds: Array<FindingDraft>;
  purchaseDrivers: Array<FindingDraft>;
  purchaseBarriers: Array<FindingDraft>;
};

export type AnalysisDraft = {
  schemaVersion: "1.0.0";
  language: "zh-CN";
  snapshotId: string;
  overall: OverallDraft;
  conditional: {
  platformDifferences: ComparisonSectionDraft;
  timeDifferences: ComparisonSectionDraft;
  brandComparison: BrandSectionDraft;
};
  insightCards: Array<InsightDraft>;
  limitationsZh: Array<string>;
};

export type Quote = {
  quoteId: string;
  vocId: string;
  sourceId: string;
  start: number;
  end: number;
  originalText: string;
  translationZh: string | null;
};

export type Consistency = {
  status: "measured" | "not_applicable" | "insufficient_data";
  score: number | null;
  eligibleGroupCount: number;
  supportingGroupCount: number;
  reasonZh: string;
};

export type EvidenceStrength = {
  level: Level;
  ruleVersion: "evidence-v1";
  mentionFrequency: {
  supportingVocCount: number;
  contradictingVocCount: number;
  scopeVocCount: number;
  supportRate: number | null;
};
  crossPlatformConsistency: Consistency;
  timeConsistency: Consistency;
  sentimentConsistency: Consistency;
  reasonZh: string;
};

export type Evidence = {
  supportingVocIds: Array<string>;
  contradictingVocIds: Array<string>;
  sourceIds: Array<string>;
  representativeQuotes: Array<Quote>;
  strength: EvidenceStrength;
};

export type Finding = {
  id: string;
  titleZh: string;
  summaryZh: string;
  scopeGroupIds: Array<string>;
  evidence: Evidence;
  limitationsZh: Array<string>;
};

export type SentimentCounts = {
  positive: number;
  neutral: number;
  negative: number;
  mixed: number;
  unknown: number;
};

export type Sentiment = {
  summaryZh: string | null;
  evidence: Evidence;
  unit: "voc_record";
  analyzedVocCount: number;
  counts: SentimentCounts;
};

export type ComparisonGroup = {
  groupId: string;
  observationZh: string;
  evidence: Evidence;
};

export type Comparison = {
  id: string;
  topicFindingId: string;
  titleZh: string;
  groups: Array<ComparisonGroup>;
  conclusionZh: string;
  limitationsZh: Array<string>;
};

export type ComparisonSection = {
  status: Status;
  reasonZh: string | null;
  items: Array<Comparison>;
};

export type BrandSection = {
  status: Status;
  reasonZh: string | null;
  ownBrandStrengths: Array<Finding>;
  ownBrandWeaknesses: Array<Finding>;
  competitorStrengths: Array<Finding>;
  commonPainPoints: Array<Finding>;
  opportunityGaps: Array<Finding & { qualification?: OpportunityQualification }>;
};

export type Insight = {
  originOpportunityId?: string;
  id: string;
  titleZh: string;
  userNeedFindingId: string | null;
  painPointFindingId: string | null;
  purchaseDriverFindingIds: Array<string>;
  purchaseBarrierFindingIds: Array<string>;
  evidence: Evidence;
  marketingImplicationZh: string;
  marketingPriority: Priority;
  limitationsZh: Array<string>;
  targetSegment: {
  type: "need_based";
  needFindingId: string;
  labelZh: string;
} | null;
};

export type Overall = {
  topTopics: Array<Finding>;
  sentiment: Sentiment;
  painPoints: Array<Finding>;
  userNeeds: Array<Finding>;
  purchaseDrivers: Array<Finding>;
  purchaseBarriers: Array<Finding>;
};

export type SourceSnapshot = {
  sourceId: string;
  platformId: string;
  platformLabel: string;
  brandId: string;
  brandType: "own" | "competitor";
  brandLabel: string;
  periodId: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  region: string | null;
  productTopic: string;
};

export type AnalysisResult = {
  groups: Array<AnalysisGroup>;
  schemaVersion: "1.0.0";
  language: "zh-CN";
  snapshotId: string;
  runId: string;
  createdAt: string;
  inputHash: string;
  promptVersion: string;
  modelVersion: string;
  coverage: {
  status: "complete" | "partial";
  includedVocCount: number;
  analyzedVocCount: number;
  failedVocIds: Array<string>;
  excludedDuplicateVocIds: Array<string>;
  unresolvedBoundaryVocCount: number;
};
  sources: Array<SourceSnapshot>;
  overall: Overall;
  conditional: {
  platformDifferences: ComparisonSection;
  timeDifferences: ComparisonSection;
  brandComparison: BrandSection;
};
  insightCards: Array<Insight>;
  limitationsZh: Array<string>;
};

export type ExtractedQuote = {
  originalText: string;
  translationZh: string | null;
};

export type Aspect = {
  category: "topic" | "pain_point" | "user_need" | "purchase_driver" | "purchase_barrier";
  labelZh: string;
  assertionZh: string;
  polarity: "positive" | "neutral" | "negative" | "mixed" | "unknown";
  quotes: Array<ExtractedQuote>;
};

export type RecordExtraction = {
  vocId: string;
  status: "analyzed" | "uncertain" | "not_analyzable";
  reasonZh: string | null;
  sentiment: "positive" | "neutral" | "negative" | "mixed" | "unknown";
  aspects: Array<Aspect>;
};

export type BatchExtraction = {
  schemaVersion: "1.0.0";
  snapshotId: string;
  batchId: string;
  records: Array<RecordExtraction>;
};

export type AnalysisGroup = {
  groupId: string;
  dimension: "platform" | "period" | "brand";
  labelZh: string;
  sourceIds: Array<string>;
};

export type EvidenceAssignment = {
  schemaVersion: "1.0.0";
  snapshotId: string;
  candidateId: string;
  batchId: string;
  assignments: Array<{
    vocId: string;
    stance: "supports" | "contradicts" | "mentions_only" | "not_mentioned" | "uncertain";
    quoteIds: Array<string>;
    aspectSentiment: "positive" | "neutral" | "negative" | "mixed" | "unknown";
  }>;
};
