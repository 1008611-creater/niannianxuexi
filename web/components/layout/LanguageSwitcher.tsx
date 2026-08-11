"use client";

import { Languages } from "lucide-react";
import { useAppShell } from "@/context/AppShellContext";
import type { AppLanguage } from "@/context/app-shell-storage";
import { apiFetch, apiUrl } from "@/lib/api";

export default function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { language, setLanguage } = useAppShell();

  const selectLanguage = (next: AppLanguage) => {
    if (next === language) return;
    setLanguage(next);
    void apiFetch(apiUrl("/api/v1/settings/ui"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: next }),
    }).catch(() => {
      // The local selection remains usable if account preference sync is unavailable.
    });
  };

  if (compact) {
    const next = language === "zh" ? "en" : "zh";
    const label = language === "zh" ? "Switch to English" : "切换为中文";
    return (
      <button
        type="button"
        onClick={() => selectLanguage(next)}
        aria-label={label}
        title={label}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-[var(--foreground)]/85 transition-colors hover:bg-[var(--background)]/60"
      >
        <Languages size={17} strokeWidth={1.7} />
        <span className="absolute bottom-0.5 right-0.5 text-[8px] font-semibold text-[var(--muted-foreground)]">
          {language === "zh" ? "中" : "EN"}
        </span>
      </button>
    );
  }

  return (
    <div
      className="flex min-w-0 items-center gap-2"
      role="group"
      aria-label={language === "zh" ? "界面语言" : "Interface language"}
    >
      <Languages size={16} strokeWidth={1.6} className="shrink-0 text-[var(--muted-foreground)]" />
      <div className="grid h-8 grid-cols-2 rounded-md bg-[var(--background)]/60 p-0.5">
        {(["zh", "en"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => selectLanguage(item)}
            aria-pressed={language === item}
            className={`min-w-12 rounded px-2 text-xs transition-colors ${
              language === item
                ? "bg-[var(--card)] font-medium text-[var(--foreground)] shadow-sm"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            }`}
          >
            {item === "zh" ? "中文" : "EN"}
          </button>
        ))}
      </div>
    </div>
  );
}
