import test from "node:test";
import assert from "node:assert/strict";
import { parseModelJson } from "../src/lib/analysis/model-json";
test("model JSON accepts complete plain or fenced objects without changing values", () => {
  const expected = { quote: '原文 "test"', id: "q:1" };
  const raw = JSON.stringify(expected);
  assert.deepEqual(parseModelJson(raw), expected);
  assert.deepEqual(parseModelJson("```json\n" + raw + "\n```"), expected);
});
test("model JSON rejects truncation, empty replies and surrounding prose without leaking content", () => {
  for (const raw of ["", '{"secret":"PRIVATE', '说明：{"id":1}', '{"id":1,}']) {
    assert.throws(
      () => parseModelJson(raw),
      (e) => e instanceof SyntaxError && !e.message.includes("PRIVATE"),
    );
  }
});
