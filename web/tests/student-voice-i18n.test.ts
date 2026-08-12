import test from "node:test";
import assert from "node:assert/strict";

test("the student voice controls are localized in both supported UI languages", async () => {
  const { readFile } = await import("node:fs/promises");
  const [realtimeTutor, childProfileSetup, zhLocale, enLocale] = await Promise.all([
    readFile("components/space/RealtimeTutor.tsx", "utf8"),
    readFile("components/learning/ChildProfileSetup.tsx", "utf8"),
    readFile("locales/zh/app.json", "utf8"),
    readFile("locales/en/app.json", "utf8"),
  ]);

  assert.match(realtimeTutor, /useTranslation/);
  assert.match(realtimeTutor, /t\("Talk with Nian Nian"\)/);
  assert.match(realtimeTutor, /t\("Turn off microphone"\)/);
  assert.match(realtimeTutor, /t\("End conversation"\)/);
  assert.match(childProfileSetup, /t\("PEP edition \(specific volume to be confirmed\)"\)/);
  assert.match(childProfileSetup, /t\("Focus on \{\{areas\}\}"/);

  const zh = JSON.parse(zhLocale) as Record<string, string>;
  const en = JSON.parse(enLocale) as Record<string, string>;
  const keys = [
    "Talk with Nian Nian",
    "Turn off microphone",
    "Turn on microphone",
    "Nian Nian is speaking",
    "Listening for your voice",
    "End conversation",
    "PEP edition (specific volume to be confirmed)",
    "Focus on {{areas}}",
  ];

  for (const key of keys) {
    assert.equal(typeof en[key], "string", `missing English key: ${key}`);
    assert.equal(typeof zh[key], "string", `missing Chinese key: ${key}`);
  }
  assert.equal(zh["Talk with Nian Nian"], "和念念老师说");
  assert.equal(zh["Nian Nian is speaking"], "念念老师正在说话");
});
