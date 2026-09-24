import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import Ajv from "ajv";
import { schemas } from "../src/lib/analysis/schema-definitions";

test("standalone validators work without dynamic code generation and preserve errors", () => {
  const exports: Record<string, import("ajv").ValidateFunction> = {};
  runInNewContext(
    readFileSync(new URL("../src/lib/analysis/generated/validators.cjs", import.meta.url), "utf8"),
    { exports, require: createRequire(import.meta.url) },
    { contextCodeGeneration: { strings: false, wasm: false } },
  );
  const ajv = new Ajv({ strict: false, allErrors: true });
  for (const [name, schema] of Object.entries(schemas)) {
    const original = ajv.compile(schema);
    for (const input of [null, {}, { results: [] }, { results: [], unexpected: true }]) {
      assert.equal(exports[name](input), original(input), name);
      assert.equal(JSON.stringify(exports[name].errors), JSON.stringify(original.errors), name);
    }
  }
});
