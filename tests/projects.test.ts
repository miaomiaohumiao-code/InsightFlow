import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createProject,
  createSource,
  brandName,
  sourceIssues,
} from "../src/types/project";
import {
  saveProject,
  getProject,
  listProjects,
  ConflictError,
} from "../src/lib/storage/projects";

test("persists original multilingual VOC and all source fields without truncation", async () => {
  const project = createProject();
  project.name = "耳机研究";
  project.researchGoal = "自定义";
  project.customGoal = "理解长时间佩戴需求";
  project.ownBrandName = "Soundcore";
  project.sources[0] = {
    ...project.sources[0],
    platform: "Reddit",
    product: "耳机",
    region: "欧洲",
    rawText: "原文\n\nIch liebe sie 😄\r\nTrès bien! ".repeat(5000),
    timeRange: { unknown: false, start: "2026-01-01", end: "2026-02-01" },
  };
  project.sources.push({
    ...createSource("competitor"),
    competitorName: "Sony",
    platform: "Reddit",
    rawText: "fine",
  });
  const saved = await saveProject(project, null);
  assert.deepEqual(await getProject(project.id), saved);
  assert.equal(
    (await getProject(project.id))?.sources[0].rawText,
    project.sources[0].rawText,
  );
  assert.ok((await listProjects()).some((p) => p.id === project.id));
});

test("concurrent stale writes are rejected instead of losing another tab's changes", async () => {
  const first = await saveProject(createProject(), null);
  const second = await saveProject(
    { ...first, name: "新名称" },
    first.revision,
  );
  await assert.rejects(
    saveProject({ ...first, name: "过期名称" }, first.revision),
    ConflictError,
  );
  assert.equal((await getProject(first.id))?.name, second.name);
});

test("one shared own brand supports multiple source periods and independent competitors", () => {
  const project = createProject();
  project.ownBrandName = "Soundcore";
  project.sources.push(
    createSource(),
    { ...createSource("competitor"), competitorName: "Sony" },
    { ...createSource("competitor"), competitorName: "Apple" },
  );
  assert.deepEqual(
    project.sources.map((s) => brandName(project, s)),
    ["Soundcore", "Soundcore", "Sony", "Apple"],
  );
  project.ownBrandName = "Anker";
  assert.deepEqual(
    project.sources.map((s) => brandName(project, s)),
    ["Anker", "Anker", "Sony", "Apple"],
  );
});

test("unknown dates remain valid and reversed dates are flagged without discarding drafts", () => {
  const project = createProject();
  project.ownBrandName = "Example";
  const source = {
    ...project.sources[0],
    platform: "Reddit",
    product: "耳机",
    rawText: "评论",
  };
  assert.deepEqual(sourceIssues(project, source), []);
  source.timeRange = { unknown: false, start: "2026-02-02", end: "2026-01-01" };
  assert.ok(sourceIssues(project, source).includes("有效时间范围"));
});

test("source deletion persists and missing projects do not create replacement drafts", async () => {
  const project = createProject();
  project.sources.push(createSource("competitor"));
  const saved = await saveProject(project, null);
  const remaining = saved.sources[1];
  await saveProject({ ...saved, sources: [remaining] }, saved.revision);
  assert.deepEqual((await getProject(saved.id))?.sources, [remaining]);
  assert.equal(await getProject("nonexistent-project"), undefined);
});
