import test from "node:test";
import assert from "node:assert/strict";
import { publicAIEnabled } from "../src/lib/analysis/access.server";
import { POST as analyze } from "../src/app/api/analysis/route";
import { POST as marketing } from "../src/app/api/marketing/route";
import { POST as experiments } from "../src/app/api/experiment-recommendations/route";

test("public AI switch protects all deployed endpoints even with a localhost host", async () => {
  const before = process.env.INSIGHTFLOW_ENABLE_PUBLIC_AI,
    vercel = process.env.VERCEL;
  try {
    process.env.VERCEL = "1";
    process.env.INSIGHTFLOW_ENABLE_PUBLIC_AI = "false";
    for (const url of [
      "https://demo.example/api/test",
      "http://localhost/api/test",
    ]) {
      assert.equal(publicAIEnabled(new Request(url)), false);
      for (const handler of [analyze, marketing, experiments])
        assert.equal(
          (
            await handler(
              new Request(url, {
                method: "POST",
                body: "{}",
                headers: { "Content-Type": "application/json" },
              }),
            )
          )?.status,
          403,
        );
    }
    process.env.INSIGHTFLOW_ENABLE_PUBLIC_AI = "true";
    assert.equal(publicAIEnabled(new Request("https://demo.example")), true);
    delete process.env.VERCEL;
    process.env.INSIGHTFLOW_ENABLE_PUBLIC_AI = "false";
    assert.equal(publicAIEnabled(new Request("http://localhost:3000")), true);
  } finally {
    if (before === undefined) delete process.env.INSIGHTFLOW_ENABLE_PUBLIC_AI;
    else process.env.INSIGHTFLOW_ENABLE_PUBLIC_AI = before;
    if (vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = vercel;
  }
});

