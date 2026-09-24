import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createProject, createSource } from "../src/types/project";
import {
  prepareSource,
  preparePreview,
  previewStats,
} from "../src/lib/voc/prepare";
import { getProject, saveProject } from "../src/lib/storage/projects";

const source = (rawText: string) => ({ ...createSource(), rawText });

test("explicit dated comment headers split without inventing authors or losing the original", () => {
  const s = source(
    "075 · comment_date: 2026-03-24\ncomment:\n> Pretty good sound.\n\n076 · comment_date: 2026-03-25\ncomment:\n> Comfortable for travel.",
  );
  const records = prepareSource(s);
  assert.equal(records.length, 2);
  assert.equal(records[0].text, "Pretty good sound.");
  assert.equal(records[1].author, undefined);
  assert.equal(records.map((r) => r.original).join(""), s.rawText);
});

test("numbered multilingual comments keep multiline bodies and exact source offsets", () => {
  const s = source(
    "1.  Battery   lasts all day.\r\nComfortable too.\r\n\r\n2. 音质很好，通勤方便。\r\n3. Très confortable! 😄",
  );
  const records = prepareSource(s);
  assert.equal(records.length, 3);
  assert.equal(records[0].text, "Battery lasts all day.\nComfortable too.");
  assert.equal(records[1].text, "音质很好，通勤方便。");
  for (const r of records)
    assert.equal(r.original, s.rawText.slice(r.start, r.end));
  assert.equal(records.map((r) => r.original).join(""), s.rawText);
});

test("explicit authors and timestamps separate comments and remove contextual UI metadata", () => {
  const records = prepareSource(
    source(
      "User: Alice\n2 days ago\nReview: Comfortable on long flights.\nReply\nShare\nUser: Bob\n3天前\n评论：电池续航不错，外出方便。\n回复",
    ),
  );
  assert.deepEqual(
    records.map((r) => r.author),
    ["Alice", "Bob"],
  );
  assert.deepEqual(
    records.map((r) => r.text),
    ["Comfortable on long flights.", "电池续航不错，外出方便。"],
  );
});

test("bare names followed by timestamps and Reddit author lines are recognized", () => {
  const records = prepareSource(
    source("Alice\n2 days ago\nLong battery life.\nu/bob\nComfortable fit."),
  );
  assert.equal(records.length, 2);
  assert.deepEqual(
    records.map((r) => r.author),
    ["Alice", "u/bob"],
  );
  assert.equal(records[0].text, "Long battery life.");
});

test("uncertain paragraphs remain one flagged block; explicit overrides are available", () => {
  const s = source(
    "Very comfortable.\nAlso lightweight.\n\n电池续航时间不错。",
  );
  assert.equal(prepareSource(s).length, 1);
  assert.ok(prepareSource(s)[0].flags.includes("boundary"));
  assert.equal(prepareSource(s, "paragraphs").length, 2);
  assert.equal(prepareSource(s, "lines").length, 3);
});

test("numbered feature lists after prose are not mistaken for separate reviews", () => {
  const records = prepareSource(
    source("My main concerns:\n1. Battery is weak.\n2. Fit is poor."),
  );
  assert.equal(records.length, 1);
  assert.ok(records[0].text.includes("1. Battery"));
});

test("standalone links are archived, inline links and substantive UI-related comments survive", () => {
  const r = prepareSource(
    source(
      "加载更多评论\n排序方式很难用\nSee https://example.com/a for details.\nhttps://example.com/b",
    ),
  )[0];
  assert.equal(
    r.text,
    "排序方式很难用\nSee https://example.com/a for details.",
  );
  assert.deepEqual(r.links, ["https://example.com/a", "https://example.com/b"]);
  assert.ok(r.original.includes("加载更多评论"));
});

test("separators, short comments and emoji-only reactions are preserved for review", () => {
  const records = prepareSource(
    source("好\n---\n😄👍\n---\nWonderful sound quality."),
  );
  assert.equal(records.length, 3);
  assert.equal(previewStats(records).short, 2);
  assert.ok(records.every((r) => r.included));
});

test("exact long duplicates in one source are excluded reversibly; cross-source repeats survive", () => {
  const text = "Comfortable headphones for all day listening.";
  const a = source(`1. ${text}\n2. ${text}`);
  const b = source(text);
  const records = preparePreview([a, b]).records;
  assert.deepEqual(
    records.map((r) => r.included),
    [true, false, true],
  );
  assert.equal(records[1].duplicateOf, records[0].id);
  records[1].included = true;
  assert.equal(previewStats(records).total, 3);
});

test("different authors, short repeats and different archived URLs are not auto-excluded", () => {
  const text = "Comfortable headphones for all day listening.";
  const a = source(`User: Alice\n${text}\nUser: Bob\n${text}`);
  const b = source("1. 好\n2. 好");
  const c = source(
    `1. ${text}\nhttps://example.com/a\n2. ${text}\nhttps://example.com/b`,
  );
  assert.ok(preparePreview([a, b, c]).records.every((r) => r.included));
});

test("empty and metadata-only input cannot count as usable VOC", () => {
  assert.deepEqual(prepareSource(source(" \n\t")), []);
  const records = prepareSource(source("加载更多评论\nhttps://example.com"));
  assert.equal(previewStats(records).total, 0);
  assert.equal(records[0].exclusion, "empty");
});

test("long blocks are flagged and warning counts follow inclusion decisions", () => {
  const records = prepareSource(source("长文本".repeat(600)));
  assert.equal(previewStats(records).manyAmbiguous, true);
  records[0].reviewed = true;
  assert.equal(previewStats(records).unresolved, 0);
  records[0].included = false;
  assert.equal(previewStats(records).ambiguous, 0);
});

test("bulk paste handles 2000 numbered records without truncating the last review", () => {
  const records = prepareSource(
    source(
      Array.from(
        { length: 2000 },
        (_, i) => `${i + 1}. 第 ${i + 1} 条评论，戴着很舒服。`,
      ).join("\n"),
    ),
  );
  assert.equal(records.length, 2000);
  assert.equal(records[1999].text, "第 2000 条评论，戴着很舒服。");
});

test("preview choices, confirmation, original text and offsets persist with the project", async () => {
  const p = createProject();
  p.sources[0].rawText = "1. Great sound quality.\n2. 好";
  p.preview = preparePreview(p.sources);
  p.preview.records[1].included = false;
  p.preview.records[1].reviewed = true;
  p.preview.confirmedAt = new Date().toISOString();
  const saved = await saveProject(p, null);
  assert.deepEqual((await getProject(p.id))?.preview, saved.preview);
  assert.equal(
    (await getProject(p.id))?.sources[0].rawText,
    p.sources[0].rawText,
  );
});
