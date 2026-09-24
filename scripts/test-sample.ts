import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { loadEnvConfig } from "@next/env";
import { createProject, createSource } from "../src/types/project";
import { preparePreview, previewStats } from "../src/lib/voc/prepare";
import { createSnapshot, batches } from "../src/lib/analysis/snapshot";
import {
  createCheckpoint,
  runAnalysis,
  TaskFailure,
} from "../src/lib/analysis/runner";
import { AnalysisError } from "../src/lib/analysis/openai.server";
import {
  callAnalysis,
  serverKey,
  serverModel,
  serverProvider,
} from "../src/lib/analysis/provider.server";
import type { Checkpoint } from "../src/types/analysis";

async function main() {
  loadEnvConfig(process.cwd(), true);
  await mkdir(".local", { recursive: true });
  if (!existsSync(".local/sample-voc.txt")) {
    const command = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-File", "scripts/extract-sample.ps1"],
      { encoding: "utf8", windowsHide: true },
    );
    if (command.status !== 0)
      throw new Error("无法读取样例数据.docx，请检查该文件是否存在。");
  }
  const text = await readFile(".local/sample-voc.txt", "utf8");
  const p = createProject();
  p.id = "sample-voc-step4";
  p.name = "样例验证 · 无线耳机";
  p.ownBrandName = "Soundcore";
  p.researchGoal = "理解用户需求";
  p.sources = [];
  for (const [index, section] of text.split(/^## /m).slice(1).entries()) {
    const field = (name: string) =>
      new RegExp(`^${name}:\\s*(.+)$`, "m").exec(section)?.[1]?.trim() ?? "";
    const own = field("brand_type") === "Own Brand";
    const date = field("time_range").match(
      /(\d{4}-\d{2}-\d{2})\s*\/\s*(\d{4}-\d{2}-\d{2})/,
    );
    const commentAt = section.search(/^\d{3}\s*·\s*(?:author|comment_date):/m);
    if (commentAt < 0) continue;
    p.sources.push({
      ...createSource(own ? "own" : "competitor"),
      id: `sample-source-${index + 1}`,
      platform: field("platform"),
      competitorName: own ? "" : field("brand_name"),
      product: field("product"),
      region: field("region"),
      timeRange: date
        ? { unknown: false, start: date[1], end: date[2] }
        : { unknown: true, start: "", end: "" },
      rawText: section.slice(commentAt).trim(),
    });
  }
  p.preview = preparePreview(p.sources);
  p.preview.confirmedAt = "sample-confirmed";
  const snapshot = await createSnapshot(p);
  const stats = previewStats(p.preview.records);
  await writeFile(".local/sample-project.json", JSON.stringify(p, null, 2));
  const summary = {
    testedAt: new Date().toISOString(),
    sampleSources: p.sources.length,
    candidateVocCount: stats.candidates,
    includedVocCount: stats.total,
    transmissionFragments: snapshot.chunks.length,
    extractionBatches: batches(snapshot.chunks).length,
    model: serverModel(),
    provider: serverProvider(),
    actualApiCalls: 0,
    success: false,
    status: "pending",
    reason: "",
    usage: null as Checkpoint["usage"] | null,
  };
  if (!serverKey()) {
    summary.status = "blocked_missing_key";
    summary.reason =
      "未配置当前服务商密钥；已完成样例预处理和批次检查，未发送数据。";
  } else {
    let initial = createCheckpoint(snapshot, serverModel());
    if (existsSync(".local/sample-checkpoint.json")) {
      const old = JSON.parse(
        await readFile(".local/sample-checkpoint.json", "utf8"),
      ) as Checkpoint;
      if (
        old.snapshot.hash === snapshot.hash &&
        old.model === initial.model &&
        old.promptVersion === initial.promptVersion
      )
        initial = old;
    }
    const startCalls = initial.usage.attempts;
    const final = await runAnalysis(initial, {
      persist: async (r) => {
        await writeFile(
          ".local/sample-checkpoint.json",
          JSON.stringify(r, null, 2),
        );
      },
      onProgress: (r) => {
        console.log(
          `${r.phase} | ${r.completedTasks}/${r.totalTasks} | API attempts ${r.usage.attempts}`,
        );
      },
      request: async (task) => {
        try {
          return await callAnalysis(task);
        } catch (e) {
          if (e instanceof AnalysisError)
            throw new TaskFailure(e.message, e.usage, !e.retryable);
          throw e;
        }
      },
    });
    summary.actualApiCalls = final.usage.attempts - startCalls;
    summary.success = final.status === "complete";
    summary.status = final.status;
    summary.reason = final.error ?? "结果通过结构与引文校验。";
    summary.usage = final.usage;
    if (final.result)
      await writeFile(
        ".local/sample-analysis-result.json",
        JSON.stringify(final.result, null, 2),
      );
  }
  await writeFile(
    ".local/sample-test-report.json",
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary, null, 2));
}
main().catch(() => {
  console.error("样例测试未完成，请检查文件、环境变量和已保存的检查点。");
  process.exitCode = 1;
});
