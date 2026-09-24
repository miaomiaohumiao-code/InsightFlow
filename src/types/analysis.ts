export type * from "../../docs/ai-analysis/analysis-contract";
import type {
  AnalysisDraft,
  AnalysisResult,
  AnalysisGroup,
  SourceSnapshot,
  Quote,
  BatchExtraction,
  EvidenceAssignment,
} from "../../docs/ai-analysis/analysis-contract";

export type Chunk = {
  id: string;
  parentId: string;
  sourceId: string;
  original: string;
  start: number;
  end: number;
  flags: string[];
};
export type Snapshot = {
  id: string;
  projectId: string;
  hash: string;
  goal: string;
  sources: SourceSnapshot[];
  groups: AnalysisGroup[];
  chunks: Chunk[];
  includedVocIds: string[];
  excludedDuplicateVocIds: string[];
  unresolvedBoundaryVocCount: number;
};
export type Packet = {
  vocId: string;
  parentId: string;
  sourceId: string;
  sentiment: string;
  aspects: Array<{
    category: string;
    labelZh: string;
    assertionZh: string;
    polarity: string;
    quoteIds: string[];
  }>;
  quotes: Quote[];
};
export type Target = {
  id: string;
  textZh: string;
  sourceIds: string[];
  sentimentApplicable: boolean;
};
export type Task =
  | {
      kind: "extract";
      input: { snapshotId: string; batchId: string; records: Chunk[] };
    }
  | {
      kind: "aggregate";
      input: {
        snapshotId: string;
        goal: string;
        sources: SourceSnapshot[];
        groups: AnalysisGroup[];
        packets: Packet[];
        previous: AnalysisDraft | null;
      };
    }
  | {
      kind: "assign";
      input: {
        snapshotId: string;
        batchId: string;
        targets: Target[];
        packets: Packet[];
      };
    };
export type TaskValue =
  BatchExtraction | AnalysisDraft | { results: EvidenceAssignment[] };
export type Usage = {
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  unmeteredAttempts: number;
  estimatedCostUsd: number | null;
  model: string;
};
export type TaskReply = { data: TaskValue; usage: Usage };
export type Checkpoint = {
  version: 1;
  id: string;
  snapshot: Snapshot;
  createdAt: string;
  updatedAt: string;
  model: string;
  promptVersion: string;
  status: "paused" | "running" | "failed" | "complete";
  phase: string;
  completedTasks: number;
  totalTasks: number;
  usage: Usage;
  replies: Record<string, TaskReply>;
  pendingTaskIds: string[];
  error: string | null;
  result: AnalysisResult | null;
};
