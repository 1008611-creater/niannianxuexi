import test from "node:test";
import assert from "node:assert/strict";

import { getPageIntro } from "../lib/page-intros";

const primaryPaths = [
  "/home",
  "/partners",
  "/agents",
  "/co-writer",
  "/book",
  "/space",
  "/memory",
  "/knowledge",
  "/settings",
  "/billing",
  "/profile",
] as const;

test("page intros cover every primary student route in Chinese and English", () => {
  for (const path of primaryPaths) {
    const intro = getPageIntro(path);
    assert.ok(intro, `missing page intro for ${path}`);
    for (const language of ["zh", "en"] as const) {
      const content = intro.content[language];
      assert.ok(content.title.trim());
      assert.ok(content.summary.trim());
      assert.ok(content.confirmLabel.trim());
      assert.ok(content.actions.length > 0 && content.actions.length <= 3);
      assert.ok(content.actions.every((action) => action.trim().length > 0));
    }
  }
});

test("page intros apply to child routes without leaking to unrelated routes", () => {
  assert.equal(getPageIntro("/home/session-1")?.id, "home");
  assert.equal(getPageIntro("/space/score/photo/session-1")?.id, "learning-space");
  assert.equal(getPageIntro("/settings/appearance")?.id, "settings");
  assert.equal(getPageIntro("/admin/users"), null);
  assert.equal(getPageIntro("/login"), null);
});
