import test from "node:test";
import assert from "node:assert/strict";
import { collapseExactDoubledAnswer } from "../lib/stream";

test("collapses only a substantial exact duplicated streamed answer", () => {
  const answer = "这是一次完整的数学诊断反馈，用于验证重复流式回答会被安全折叠。".repeat(3);
  assert.equal(collapseExactDoubledAnswer(answer + answer), answer);
});

test("leaves ordinary short or non-identical text unchanged", () => {
  assert.equal(collapseExactDoubledAnswer("好好"), "好好");
  const mixed = `${"甲".repeat(80)}${"乙".repeat(80)}`;
  assert.equal(collapseExactDoubledAnswer(mixed), mixed);
});
