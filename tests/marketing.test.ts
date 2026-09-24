import test from "node:test";
import assert from "node:assert/strict";
import { fields, validateAction } from "../src/lib/marketing/contract";
function fixture(ids = ["one"]) {
  return {
    titleZh: "稳定体验的验证方向",
    validationPlanZh: "先验证产品性能，再比较沟通方案的点击与转化。",
    ...Object.fromEntries(
      Object.keys(fields).map((k) => [
        k,
        {
          textZh: "关注可靠使用体验的需求人群",
          reasonZh: "源于稳定性需求，需进一步测试",
          insightIds: ids,
        },
      ]),
    ),
  };
}
test("营销策略拒绝未选洞察与遗漏的合并依据", () => {
  assert.throws(() => validateAction(fixture(["other"]), ["one"]));
  assert.throws(() => validateAction(fixture(), ["one", "two"]));
  assert.equal(
    validateAction(fixture(["one", "two"]), ["one", "two"]).coreConsumerInsight
      .insightIds.length,
    2,
  );
});
test("营销策略必须中文且不能增加自由字段", () => {
  assert.throws(() =>
    validateAction(
      {
        ...fixture(),
        titleZh:
          "中文 This long English paragraph should never pass the Chinese output validation just because it contains two Chinese characters",
      },
      ["one"],
    ),
  );
  assert.throws(() =>
    validateAction({ ...fixture(), titleZh: "English only" }, ["one"]),
  );
  assert.throws(() =>
    validateAction({ ...fixture(), inventedAge: 25 }, ["one"]),
  );
  assert.throws(() =>
    validateAction(
      {
        ...fixture(),
        targetSegment: {
          textZh: "年轻白领",
          reasonZh: "猜测用户身份",
          insightIds: ["one"],
        },
      },
      ["one"],
    ),
  );
  const incomplete = fixture() as Record<string, unknown>;
  delete incomplete.recommendedPlacement;
  assert.throws(() => validateAction(incomplete, ["one"]));
});
