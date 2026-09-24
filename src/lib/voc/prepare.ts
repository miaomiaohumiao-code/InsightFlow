import type { Source } from "@/types/project";
import type { SplitMode, VOCPreview, VOCRecord } from "@/types/voc";

type Line = { text: string; start: number; end: number };
const authorPattern =
  /^(?:\d{1,5}\s*[·|]\s*)?(?:author|username|user|作者|用户名|用户)\s*[:：]\s*(.+)$/i;
const redditAuthor = /^u\/[\w-]{2,40}$/;
const datedHeader =
  /^\d{1,5}\s*[·|]\s*comment_date\s*:\s*\d{4}-\d{2}-\d{2}\s*$/i;
const timestamp =
  /^(?:\d+\s*(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+ago|\d+\s*(?:秒|分钟|小时|天|周|个月|年)前|\d{4}[-/]\d{1,2}[-/]\d{1,2})$/i;
const numbered = /^(?:\[(\d{1,5})\]|(\d{1,5})[.)、．])\s*(\S.*)$/;
const separator = /^(?:-{3,}|\*{3,}|={3,}|_{3,})$/;
const pageChrome =
  /^(?:sort by(?:\s*:\s*(?:best|top|new|old))?|view all comments|load more comments|all comments|全部评论|加载更多评论|查看全部评论|排序方式(?:[:：]\s*(?:最新|最热|默认))?)$/i;
const actionChrome =
  /^(?:reply|share|report|save|like|回复|分享|举报|点赞|收藏|\d+\s*(?:likes?|upvotes?|replies|赞|回复))$/i;
const identity = (line: string) =>
  authorPattern
    .exec(line)?.[1]
    ?.split(/\s*[·|]\s*(?:context|region)\s*:/i)[0]
    ?.trim() || (redditAuthor.test(line) ? line : undefined);

function linesOf(raw: string): Line[] {
  return Array.from(raw.matchAll(/[^\r\n]+|(?:\r\n|\r|\n)/g)).reduce<Line[]>(
    (lines, match) => {
      // Newline tokens retain empty-line boundaries; offsets always refer to the untouched source.
      if (/^[\r\n]+$/.test(match[0])) {
        if (!lines.length || lines[lines.length - 1].end < match.index!)
          lines.push({ text: "", start: match.index!, end: match.index! });
        return lines;
      }
      lines.push({
        text: match[0].trim(),
        start: match.index!,
        end: match.index! + match[0].length,
      });
      return lines;
    },
    [],
  );
}

function clean(original: string, method: VOCRecord["method"]) {
  const structured = method === "author";
  const changes = new Set<string>();
  const links = Array.from(
    new Set(original.match(/https?:\/\/[^\s<>]+/gi) ?? []),
  );
  let author: string | undefined;
  let contentSeen = false;
  const lines = original.replace(/\r\n?/g, "\n").split("\n");
  const cleaned = lines
    .map((rawLine, index) => {
      let line = rawLine.replace(/[\t \u00a0]+/g, " ").trim();
      if (
        structured &&
        (identity(line) ||
          (index === 0 && timestamp.test(lines[index + 1]?.trim() ?? "")))
      ) {
        author ??= identity(line) || line;
        changes.add("作者信息已提取");
        return "";
      }
      if (
        structured &&
        (timestamp.test(line) ||
          datedHeader.test(line) ||
          /^(?:comment|review|评论|评价)\s*[:：]\s*$/i.test(line))
      ) {
        changes.add("已移除结构化元信息");
        return "";
      }
      if (
        pageChrome.test(line) ||
        (structured && contentSeen && actionChrome.test(line)) ||
        separator.test(line)
      ) {
        changes.add("已移除独立页面杂项");
        return "";
      }
      if (/^https?:\/\/\S+$/i.test(line) || /^source_url\s*:/i.test(line)) {
        changes.add("独立 URL 已转存为链接");
        return "";
      }
      if (method === "numbered" && index === 0) {
        const marker = numbered.exec(line);
        if (marker) {
          line = marker[3];
          changes.add("已移除评论编号");
        }
      }
      if (structured) {
        line = line.replace(/^(?:comment|review|评论|评价)\s*[:：]\s*/i, "");
        if (/^>/.test(line)) {
          line = line.replace(/^>\s?/, "");
          changes.add("已移除引用格式标记");
        }
      }
      if (line) contentSeen = true;
      return line;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (
    original.replace(/\r\n?/g, "\n") !== original ||
    lines.some((line) => line !== line.replace(/[\t \u00a0]+/g, " ").trim()) ||
    /\n{3,}/.test(original.replace(/\r\n?/g, "\n"))
  )
    changes.add("已整理空格与空行");
  // URLs inside sentences stay in place: removing one can change the meaning of a review.
  if (links.length && !changes.has("独立 URL 已转存为链接"))
    changes.add("正文 URL 保留，可在原文中查看");
  return { text: cleaned, author, changes: [...changes], links };
}

export function prepareSource(
  source: Source,
  mode: SplitMode = "auto",
): VOCRecord[] {
  const raw = source.rawText;
  if (!raw.trim()) return [];
  const lines = linesOf(raw);
  let starts: number[] = [0];
  let method: VOCRecord["method"] = "unsplit";
  if (mode === "lines") {
    starts = lines.filter((l) => l.text).map((l) => l.start);
    method = "lines";
  } else if (mode === "paragraphs") {
    starts = [
      0,
      ...Array.from(
        raw.matchAll(/(?:\r?\n|\r)[\t ]*(?:(?:\r?\n|\r)[\t ]*)+/g),
      ).map((m) => m.index! + m[0].length),
    ];
    method = "paragraphs";
  } else {
    const authors = lines.filter(
      (line, i) =>
        identity(line.text) ||
        datedHeader.test(line.text) ||
        (/^[\p{L}\p{N}_ .-]{2,40}$/u.test(line.text) &&
          timestamp.test(lines[i + 1]?.text ?? "")),
    );
    const numbers = lines.filter((line) => numbered.test(line.text));
    const sequence = numbers.map((line) =>
      Number(numbered.exec(line.text)![1] ?? numbered.exec(line.text)![2]),
    );
    if (authors.length >= 2) {
      starts = authors.map((l) => l.start);
      method = "author";
    } else if (
      numbers.length >= 2 &&
      !clean(raw.slice(0, numbers[0].start), "unsplit").text &&
      sequence.every((n, i) => !i || n === sequence[i - 1] + 1)
    ) {
      starts = numbers.map((l) => l.start);
      method = "numbered";
    } else if (lines.some((line) => separator.test(line.text))) {
      starts = [
        0,
        ...lines
          .filter((line) => separator.test(line.text))
          .map((line) => line.end),
      ];
      method = "separator";
    }
    // Keep any preamble as an auditable record instead of silently losing it.
    if (starts[0] > 0 && raw.slice(0, starts[0]).trim()) starts.unshift(0);
  }
  return starts
    .map((start, i): VOCRecord | undefined => {
      const end = starts[i + 1] ?? raw.length;
      const original = raw.slice(start, end);
      if (!original.trim()) return undefined;
      const result = clean(original, method);
      const meaningful = [...result.text.replace(/[\s\p{P}\p{S}]/gu, "")]
        .length;
      const flags: VOCRecord["flags"] = [];
      if (result.text && meaningful < 5) flags.push("short");
      if (result.text.length > 1500) flags.push("long");
      if (
        method === "unsplit" &&
        (/\n|\r/.test(result.text) || /(?:^|\s)\d+[.)、]\s/.test(result.text))
      )
        flags.push("boundary");
      return {
        id: `${source.id}:${start}:${end}:${mode}`,
        sourceId: source.id,
        start,
        end,
        original,
        ...result,
        method,
        flags,
        included: !!result.text,
        reviewed: false,
        ...(!result.text ? { exclusion: "empty" as const } : {}),
      };
    })
    .filter((record): record is VOCRecord => !!record);
}

export function preparePreview(
  sources: Source[],
  modes: Record<string, SplitMode> = {},
): VOCPreview {
  const records = sources.flatMap((source) =>
    prepareSource(source, modes[source.id] ?? "auto"),
  );
  const seen = new Map<string, VOCRecord[]>();
  for (const record of records) {
    if (!record.text) continue;
    // Case and punctuation are meaningful. No fuzzy or translation-based deduplication.
    const key = record.text.replace(/\s+/g, " ").trim();
    const matches = seen.get(key) ?? [];
    const definite = matches.find(
      (other) =>
        other.sourceId === record.sourceId &&
        other.author === record.author &&
        JSON.stringify(other.links) === JSON.stringify(record.links) &&
        key.length >= 20,
    );
    if (matches.length) {
      record.flags.push("duplicate");
      record.duplicateOf = (definite ?? matches[0]).id;
      if (definite) {
        record.included = false;
        record.exclusion = "duplicate";
      }
    }
    matches.push(record);
    seen.set(key, matches);
  }
  return {
    parserVersion: 1,
    generatedAt: new Date().toISOString(),
    modes: Object.fromEntries(
      sources.map((s) => [s.id, modes[s.id] ?? "auto"]),
    ),
    records,
  };
}

export function previewStats(records: VOCRecord[]) {
  const included = records.filter((r) => r.included && r.text.trim());
  const ambiguous = included.filter((r) =>
    r.flags.some((f) => f === "boundary" || f === "long"),
  );
  return {
    total: included.length,
    candidates: records.length,
    excluded: records.length - included.length,
    ambiguous: ambiguous.length,
    short: included.filter((r) => r.flags.includes("short")).length,
    unresolved: ambiguous.filter((r) => !r.reviewed).length,
    manyAmbiguous:
      ambiguous.length > 0 &&
      ambiguous.length / Math.max(included.length, 1) >= 0.3,
  };
}
