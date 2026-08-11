import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const webRoot = process.cwd();
const read = (...parts: string[]) => readFileSync(path.join(webRoot, ...parts), "utf8");

test("student entry skips preset learning plans and opens photo help", () => {
  const sidebar = read("components", "sidebar", "SidebarShell.tsx");
  const scorePage = read("app", "(utility)", "space", "score", "page.tsx");
  const diagnosticPage = read(
    "app",
    "(utility)",
    "space",
    "score",
    "diagnostic",
    "page.tsx",
  );
  const chatPage = read("app", "(workspace)", "home", "[[...sessionId]]", "page.tsx");
  const composer = read("components", "chat", "home", "ChatComposer.tsx");
  const personaSelector = read(
    "components",
    "chat",
    "home",
    "PersonaSelector.tsx",
  );
  const utilitySidebar = read("components", "sidebar", "UtilitySidebar.tsx");
  const masteryPath = read(
    "app",
    "(utility)",
    "space",
    "learning",
    "page.tsx",
  );
  const appShell = read("components", "layout", "AppShell.tsx");
  const spaceMain = read("components", "space", "SpaceMain.tsx");
  const studentRoute = path.join(
    webRoot,
    "app",
    "(workspace)",
    "space",
    "score",
    "photo",
    "[[...sessionId]]",
    "page.tsx",
  );

  assert.ok(existsSync(studentRoute), "student photo route must exist");
  assert.match(sidebar, /href: "\/space",/);
  assert.doesNotMatch(sidebar, /STUDENT_NAV|studentMode/);
  assert.doesNotMatch(utilitySidebar, /studentMode/);
  assert.doesNotMatch(sidebar, /\/home\?student=1/);
  assert.match(scorePage, /redirect\("\/home"\)/);
  assert.match(masteryPath, /\/home\?capability=mastery_path/);
  assert.doesNotMatch(masteryPath, /Mastery Path 模式/);
  assert.doesNotMatch(masteryPath, /RotateCcw|Trash2/);
  assert.match(diagnosticPage, /redirect\("\/home"\)/);
  assert.match(chatPage, /pathname\.startsWith\("\/space\/score\/photo"\)/);
  assert.match(chatPage, /<RealtimeTutor/);
  assert.match(chatPage, /layout="call"/);
  assert.match(chatPage, /variant="conversation"/);
  assert.doesNotMatch(chatPage, /welcomeGreeting|animate-fade-in/);
  assert.match(chatPage, /prompt && !studentModeRef\.current/);
  assert.match(chatPage, /inputPlaceholder=\{studentModeRef\.current \? t\("Photo, voice, or text question"\) : undefined\}/);
  assert.match(chatPage, /flexGrow: hasMessages \? 0 : studentModeRef\.current \? 0 : 1\.4/);
  assert.match(chatPage, /`\/space\/score\/photo\/\$\{state\.sessionId\}`/);
  assert.match(chatPage, /!studentModeRef\.current \? \(/);
  assert.match(
    chatPage,
    /!studentModeRef\.current \? \(\s*<SessionViewerPanel/s,
  );
  assert.match(composer, /pathname\.startsWith\("\/space\/score\/photo"\)/);
  assert.match(composer, /studentMode \? "bg-emerald-600 text-white hover:bg-emerald-700/);
  assert.match(personaSelector, /max-md:fixed max-md:inset-x-3/);
  assert.match(
    personaSelector,
    /max-md:bottom-\[calc\(env\(safe-area-inset-bottom\)\+5rem\)\]/,
  );
  assert.match(appShell, /max-md:overflow-y-auto/);
  assert.match(appShell, /max-md:touch-pan-y/);
  assert.match(spaceMain, /overflow-y-auto overscroll-y-contain touch-pan-y/);
  assert.match(spaceMain, /const FULL_BLEED = \["\/space\/learning"\]/);
  assert.match(composer, /max-md:max-h-\[50dvh\] max-md:overflow-y-auto/);
  assert.match(composer, /max-md:fixed max-md:inset-x-3/);
  assert.match(chatPage, /overflow-y-auto overscroll-y-contain touch-pan-y/);
});
