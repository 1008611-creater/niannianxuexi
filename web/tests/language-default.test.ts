import assert from "node:assert/strict";
import test from "node:test";

import { normalizeLanguage } from "../context/app-shell-storage";

test("a missing saved language defaults to Chinese", () => {
  assert.equal(normalizeLanguage(null), "zh");
  assert.equal(normalizeLanguage(undefined), "zh");
});

test("an explicit English preference remains English", () => {
  assert.equal(normalizeLanguage("en"), "en");
});
