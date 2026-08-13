"use client";

import { ArrowRight, BookOpen, Camera, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LearningTemplateAction } from "@/lib/learning-templates";

type JuniorMathBridgeProps = {
  onStartAction: (action: LearningTemplateAction) => void;
};

const ACTIONS = [
  { id: "photo" as const, icon: Camera, label: "拍题问念念", detail: "上传题目后，从卡住的那一步开始" },
  { id: "concept" as const, icon: BookOpen, label: "问课本知识点", detail: "把一个概念讲到你能自己用" },
  { id: "paper" as const, icon: FileText, label: "分析试卷", detail: "上传试卷，找出下一步重点" },
];

export default function JuniorMathBridge({ onStartAction }: JuniorMathBridgeProps) {
  const { t } = useTranslation();

  return (
    <section
      aria-labelledby="junior-math-bridge-title"
      data-testid="junior-math-bridge"
      className="w-full max-w-[720px] shrink-0 overflow-hidden rounded-2xl border border-emerald-600/20 bg-[var(--card)] shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">{t("推荐学习入口")}</p>
          <h2 id="junior-math-bridge-title" className="mt-1 text-lg font-semibold tracking-tight text-[var(--foreground)]">
            {t("初二数学 · 人教版")}
          </h2>
          <p className="mt-1 text-sm leading-5 text-[var(--muted-foreground)]">{t("入学衔接，先从一道题开始")}</p>
        </div>
        <span className="shrink-0 rounded-full border border-amber-600/25 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-800 dark:text-amber-200">
          {t("资料逐步核验")}
        </span>
      </div>

      <div className="grid gap-2 p-3 sm:grid-cols-3 sm:p-4">
        {ACTIONS.map(({ id, icon: Icon, label, detail }) => (
          <button
            key={id}
            type="button"
            onClick={() => onStartAction(id)}
            className="group flex min-h-[88px] items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-3 text-left transition hover:border-emerald-600/45 hover:bg-emerald-500/5 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/45"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-700 dark:text-emerald-300">
              <Icon size={18} strokeWidth={1.8} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-[var(--foreground)]">{t(label)}</span>
              <span className="mt-1 block text-xs leading-4 text-[var(--muted-foreground)]">{t(detail)}</span>
            </span>
            <ArrowRight size={16} className="shrink-0 text-[var(--muted-foreground)] transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  );
}
