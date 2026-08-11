import test from "node:test";
import assert from "node:assert/strict";

import {
  JUNIOR_MATH_BRIDGE_TEMPLATE,
} from "../lib/learning-templates";

test("the first learning entry stays a bounded, rights-aware template", () => {
  const template = JUNIOR_MATH_BRIDGE_TEMPLATE;
  assert.equal(template.id, "junior-math-bridge-pep");
  assert.equal(template.grade, "初二入学衔接");
  assert.equal(template.subject, "数学");
  assert.equal(template.textbookEdition, "人教版（待核实具体册次）");
  assert.equal(template.rightsStatus, "pending_review");
  assert.deepEqual(template.defaultActions, ["photo", "concept", "paper"]);
  assert.equal(template.toolPolicy, "student_safe");
  assert.equal(template.teachingPolicy, "guided_first");
});
test("the student homepage owns the entry without creating a template center", async () => {
  const { readFile } = await import("node:fs/promises");
  const page = await readFile(
    "app/(workspace)/home/[[...sessionId]]/page.tsx",
    "utf8",
  );
  const card = await readFile("components/learning/JuniorMathBridge.tsx", "utf8");
  assert.match(page, /<JuniorMathBridge/);
  assert.match(page, /handleJuniorMathAction/);
  assert.doesNotMatch(page, /模板中心|课程包导航/);
  assert.match(card, /data-testid="junior-math-bridge"/);
  assert.match(card, /拍题问念念/);
  assert.match(card, /问课本知识点/);
  assert.match(card, /分析试卷/);
});
