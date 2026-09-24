import { z } from "zod";

export const splitModes = ["auto", "paragraphs", "lines"] as const;
export type SplitMode = (typeof splitModes)[number];
export const flagLabels = {
  boundary: "边界不明确，保留原块",
  long: "长文本，可能包含多条评论",
  short: "极短文本",
  duplicate: "相同文本，需核对来源",
} as const;

export const vocRecordSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  start: z.number().int(),
  end: z.number().int(),
  original: z.string(),
  text: z.string(),
  author: z.string().optional(),
  method: z.enum([
    "author",
    "numbered",
    "separator",
    "paragraphs",
    "lines",
    "unsplit",
  ]),
  flags: z.array(z.enum(["boundary", "long", "short", "duplicate"])),
  changes: z.array(z.string()),
  links: z.array(z.string()),
  included: z.boolean(),
  reviewed: z.boolean(),
  exclusion: z.enum(["duplicate", "empty"]).optional(),
  duplicateOf: z.string().optional(),
});
export const vocPreviewSchema = z.object({
  parserVersion: z.literal(1),
  generatedAt: z.string(),
  confirmedAt: z.string().optional(),
  modes: z.record(z.string(), z.enum(splitModes)),
  records: z.array(vocRecordSchema),
});
export type VOCRecord = z.infer<typeof vocRecordSchema>;
export type VOCPreview = z.infer<typeof vocPreviewSchema>;
