"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  Circle,
  CircleCheck,
  CircleDot,
  GraduationCap,
  Loader2,
  type LucideIcon,
} from "lucide-react";

import {
  fetchAllProgress,
  fetchMasteryMap,
  type MasteryMapResult,
  type ObjectiveStatus,
  type ProgressSummary,
} from "@/lib/learning-api";

const STATUS_META: Record<
  ObjectiveStatus,
  { cn: string; en: string; className: string; icon: LucideIcon }
> = {
  mastered: {
    cn: "已掌握",
    en: "Mastered",
    className: "text-emerald-600 dark:text-emerald-400",
    icon: CircleCheck,
  },
  learning: {
    cn: "练习中",
    en: "Practising",
    className: "text-amber-600 dark:text-amber-400",
    icon: CircleDot,
  },
  new: {
    cn: "待练习",
    en: "To practise",
    className: "text-[var(--muted-foreground)]",
    icon: Circle,
  },
};

export default function MasteryPathPage() {
  const { i18n } = useTranslation();
  const zh = i18n.language?.toLowerCase().startsWith("zh");
  const tr = useCallback((cn: string, en: string) => (zh ? cn : en), [zh]);
  const [paths, setPaths] = useState<ProgressSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<MasteryMapResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void fetchAllProgress()
      .then((result) => {
        if (!active) return;
        const available = result.summaries
          .filter((path) => path.kp_count > 0)
          .sort((a, b) => b.updated_at - a.updated_at);
        setPaths(available);
        setSelected(available[0]?.book_id ?? null);
      })
      .catch(() => {
        if (active) setPaths([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    void fetchMasteryMap(selected)
      .then((result) => {
        if (active) setDetail(result);
      })
      .catch(() => {
        if (active) setDetail(null);
      });
    return () => {
      active = false;
    };
  }, [selected]);

  const focus = detail?.next.knowledge_point_name;
  const practicePrompt = `请作为耐心老师陪我练习${focus ? `“${focus}”` : "当前数学知识点"}：一次只出一题，我可以拍题、语音回答或直接输入；先给思路提示，不直接公布完整答案。`;
  const practiceHref = `/home?capability=mastery_path&prompt=${encodeURIComponent(practicePrompt)}`;

  const mastered = detail?.map.counts.mastered ?? 0;
  const total = detail?.map.counts.total ?? 0;
  const activePath = paths.find((path) => path.book_id === selected);

  return (
    <main className="mx-auto min-h-full max-w-3xl px-5 py-5 pb-[calc(2rem+env(safe-area-inset-bottom,0px))] sm:px-8 sm:py-7">
      <header>
        <h1 className="font-serif text-[24px] font-semibold leading-tight text-[var(--foreground)]">
          {tr("精通之路", "Mastery path")}
        </h1>
        {paths.length > 1 ? (
          <select
            aria-label={tr("选择学习路径", "Choose learning path")}
            value={selected ?? ""}
            onChange={(event) => setSelected(event.target.value || null)}
            className="mt-3 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-[13px] text-[var(--foreground)] outline-none focus:border-emerald-500"
          >
            {paths.map((path) => (
              <option key={path.book_id} value={path.book_id}>{path.name}</option>
            ))}
          </select>
        ) : activePath ? (
          <p className="mt-1 text-[13px] text-[var(--muted-foreground)]">{activePath.name}</p>
        ) : null}
      </header>

      {loading ? (
        <div className="mt-8 flex justify-center py-12 text-[var(--muted-foreground)]" role="status">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : !detail ? (
        <section className="mt-6 border border-[var(--border)] bg-[var(--card)] p-5">
          <GraduationCap className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
          <h2 className="mt-4 text-[19px] font-semibold text-[var(--foreground)]">
            {tr("开始你的第一项练习", "Start your first practice")}
          </h2>
          <a
            href={practiceHref}
            className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-[14px] font-semibold text-white transition-colors hover:bg-emerald-700 active:scale-[0.99]"
          >
            {tr("和念念老师开始练习", "Start practising")}
            <ArrowRight size={16} />
          </a>
        </section>
      ) : (
        <>
          <section className="mt-6 border border-emerald-500/35 bg-emerald-500/[0.045] p-5">
            <div className="text-[13px] font-medium text-emerald-600 dark:text-emerald-400">
              {mastered}/{total} {tr("已掌握", "mastered")}
            </div>
            <h2 className="mt-2 text-[20px] font-semibold leading-snug text-[var(--foreground)]">
              {detail.next.action === "complete"
                ? tr("开始新的专题练习", "Start a new topic")
                : detail.next.knowledge_point_name}
            </h2>
            <a
              href={practiceHref}
              className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-[14px] font-semibold text-white transition-colors hover:bg-emerald-700 active:scale-[0.99]"
            >
              {tr("和念念老师练习", "Practise with your tutor")}
              <ArrowRight size={16} />
            </a>
          </section>

          <section className="mt-5">
            <h2 className="text-[16px] font-semibold text-[var(--foreground)]">
              {tr("知识点进度", "Knowledge points")}
            </h2>
            <div className="mt-3 overflow-hidden border border-[var(--border)] bg-[var(--card)]">
              {detail.map.modules.flatMap((module) => module.knowledge_points).map((kp) => {
                const meta = STATUS_META[kp.status];
                const Icon = meta.icon;
                return (
                  <div key={kp.id} className="flex min-h-12 items-center gap-3 border-b border-[var(--border)] px-3.5 last:border-b-0">
                    <Icon size={16} className={`shrink-0 ${meta.className}`} />
                    <span className="min-w-0 flex-1 truncate text-[14px] text-[var(--foreground)]">{kp.name}</span>
                    <span className={`shrink-0 text-[12px] ${meta.className}`}>{zh ? meta.cn : meta.en}</span>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
