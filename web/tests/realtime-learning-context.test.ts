import test from "node:test";
import assert from "node:assert/strict";

import { buildRealtimeLearningContext } from "../lib/realtime-learning-context";

test("realtime context keeps the user's work and labels prior agent replies for verification", () => {
  const context = buildRealtimeLearningContext([
    { role: "user", content: "这道一次函数题我不会列式" },
    { role: "assistant", content: "先看两个已知点，再求斜率。" },
    { role: "user", content: "我把斜率算成了 1/2", hasAttachment: true },
  ]);

  assert.match(context, /\[用户的任务、材料或困惑\]/);
  assert.match(context, /我把斜率算成了 1\/2 \[包含图片或文件\]/);
  assert.match(context, /\[页面上已有的 Agent 回复，必须自行核验\]/);
  assert.match(context, /\[最近明确困惑\]\n- 我把斜率算成了 1\/2/);
  assert.match(context, /\[最近已讲进度\]\n- 先看两个已知点，再求斜率。/);
  assert.match(context, /不要用泛化问候替代对当前问题的确认/);
  assert.match(context, /不保证其中已有结论正确/);
});

test("realtime learning context retains only the latest bounded conversation", () => {
  const context = buildRealtimeLearningContext(Array.from({ length: 14 }, (_, index) => ({
    role: index % 2 ? "assistant" as const : "user" as const,
    content: "第 " + index + " 条",
  })));

  assert.doesNotMatch(context, /第 0 条/);
  assert.match(context, /第 13 条/);
});
