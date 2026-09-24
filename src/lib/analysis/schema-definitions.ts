import extraction from "../../../docs/ai-analysis/batch-extraction.schema.json";
import draft from "../../../docs/ai-analysis/analysis-draft.schema.json";
import assignment from "../../../docs/ai-analysis/evidence-assignment.schema.json";
import result from "../../../docs/ai-analysis/analysis-result.schema.json";

export const schemas = {
  extract: extraction,
  aggregate: draft,
  assign: {
    type: "object",
    properties: { results: { type: "array", items: assignment } },
    required: ["results"],
    additionalProperties: false,
  },
  result,
};
