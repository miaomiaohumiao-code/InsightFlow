import draft from "../../../docs/ai-analysis/analysis-draft.schema.json";
import { schemas } from "./schema-definitions";
import * as validators from "./generated/validators.cjs";
export { schemas };

// Remove only unknown priority metadata. Required values and evidence are never repaired here.
export function sanitizePriorityMetadata(value: unknown): unknown {
  const copy = structuredClone(value);
  if (
    !copy ||
    typeof copy !== "object" ||
    !("insightCards" in copy) ||
    !Array.isArray(copy.insightCards)
  )
    return copy;
  const allowed = new Set(Object.keys(draft.$defs.Priority.properties));
  for (const card of copy.insightCards) {
    const priority = card?.marketingPriority;
    if (!priority || typeof priority !== "object" || Array.isArray(priority))
      continue;
    for (const key of Object.keys(priority))
      if (!allowed.has(key)) delete priority[key];
  }
  return copy;
}
export function assertSchema(kind: keyof typeof schemas, value: unknown): void {
  const validate = validators[kind];
  if (!validate(value))
    throw new Error(
      `输出结构校验失败：${validate.errors
        ?.slice(0, 3)
        .map(
          (e) => `${e.instancePath} ${e.keyword} ${JSON.stringify(e.params)}`,
        )
        .join("；")}`,
    );
}

// The semantic verifier additionally checks that every generated explanation is Chinese.
export function assertChinese(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [key, v] of Object.entries(value)) {
    if (key.endsWith("Zh")) {
      for (const text of Array.isArray(v) ? v : [v]) {
        if (
          text !== null &&
          (typeof text !== "string" || !/[\u3400-\u9fff]/u.test(text))
        )
          throw new Error(`中文字段校验失败：${key}`);
        if (typeof text === "string") {
          const han = (text.match(/[\u3400-\u9fff]/gu) ?? []).length;
          const latinWords = (text.match(/[a-zA-Z]{2,}/g) ?? []).length;
          if (latinWords > Math.max(8, han))
            throw new Error(`中文字段包含过多外语正文：${key}`);
        }
      }
    }
    if (Array.isArray(v)) v.forEach(assertChinese);
    else assertChinese(v);
  }
}
