"use client";

import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Sparkles, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  getLearnerProfile,
  getLearnerQuestions,
  saveLearnerProfile,
  type LearnerProfile,
  type LearnerQuestion,
} from "@/lib/learner-profile-api";

type Props = { onReady?: (profile: LearnerProfile) => void };

export default function ChildProfileSetup({ onReady }: Props) {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<LearnerProfile | null>(null);
  const [questions, setQuestions] = useState<LearnerQuestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [childName, setChildName] = useState("");
  const [grade, setGrade] = useState("junior-2-bridge");
  const [textbook, setTextbook] = useState("人教版（具体册次待确认）");
  const [answers, setAnswers] = useState<Record<string, number>>({});

  useEffect(() => {
    let alive = true;
    Promise.all([getLearnerProfile(), getLearnerQuestions()])
      .then(([nextProfile, nextQuestions]) => {
        if (!alive) return;
        setProfile(nextProfile);
        setQuestions(nextQuestions);
        if (nextProfile) {
          setChildName(nextProfile.child_name);
          setTextbook(nextProfile.textbook_edition);
          setAnswers(
            Object.fromEntries(
              (nextProfile.assessment.results ?? [])
                .filter(
                  (result) =>
                    typeof result.question_id === "string" &&
                    Number.isInteger(result.choice),
                )
                .map((result) => [result.question_id, result.choice as number]),
            ),
          );
        }
      })
      .catch(() => {
        if (alive) setError(t("Could not load learner profile"));
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [t]);

  async function handleSave() {
    if (!childName.trim() || Object.keys(answers).length !== questions.length) {
      setError(t("Enter a child name and answer every question"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const next = await saveLearnerProfile({
        child_name: childName,
        grade: gradeOptions.find((option) => option.value === grade)?.label ?? grade,
        textbook_edition: textbook,
        answers,
      });
      setProfile(next);
      setOpen(false);
      onReady?.(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Could not save learner profile"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;

  const gradeOptions = [
    { value: "junior-2-bridge", label: t("Junior 2 bridge") },
    { value: "junior-1", label: t("Junior 1") },
    { value: "junior-2", label: t("Junior 2") },
    { value: "junior-3", label: t("Junior 3") },
  ];

  return (
    <section className="w-full max-w-[720px] rounded-2xl border border-sky-600/20 bg-[var(--card)] shadow-sm" data-testid="child-profile-setup">
      <div className="flex items-center gap-3 px-5 py-4 sm:px-6">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-600/10 text-sky-700 dark:text-sky-300">
          {profile ? <CheckCircle2 size={18} /> : <Users size={18} />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-[var(--foreground)]">
            {profile ? t("Nian Nian is ready for {{name}}", { name: profile.child_name }) : t("Set up a learner first")}
          </h2>
          <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
            {profile
              ? `${profile.assessment.level}${profile.assessment.weak_areas.length ? ` · 重点看 ${profile.assessment.weak_areas.join("、")}` : ""}`
              : t("Use one minute to match explanations to the learner's grade, material, and starting point")}
          </p>
        </div>
        <button type="button" onClick={() => setOpen(true)} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-sky-700 px-3 text-sm font-medium text-white transition hover:bg-sky-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600/40">
          {profile ? t("Update learner profile") : t("Start setup")}<ArrowRight size={15} />
        </button>
      </div>

      {open ? (
        <div className="border-t border-[var(--border)] px-5 py-5 sm:px-6" role="dialog" aria-modal="true" aria-labelledby="child-profile-title">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-sky-700 dark:text-sky-300">{t("Child learning profile")}</p>
              <h3 id="child-profile-title" className="mt-1 text-lg font-semibold text-[var(--foreground)]">{t("Let Nian Nian meet the learner")}</h3>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]">{t("Close")}</button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <label className="text-sm text-[var(--foreground)]">{t("Child name")}<input value={childName} onChange={(e) => setChildName(e.target.value)} placeholder={t("For example: Xiaoyu")} className="mt-1.5 h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 outline-none focus:border-sky-600" /></label>
            <label className="text-sm text-[var(--foreground)]">{t("Grade")}<select value={grade} onChange={(e) => setGrade(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 outline-none focus:border-sky-600">{gradeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label className="text-sm text-[var(--foreground)]">{t("Textbook edition")}<input value={textbook} onChange={(e) => setTextbook(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 outline-none focus:border-sky-600" /></label>
          </div>
          <div className="mt-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]"><Sparkles size={16} className="text-sky-600" />{t("Complete four quick questions so Nian Nian can adapt")}</div>
            {questions.map((question, index) => (
              <fieldset key={question.id} className="rounded-xl border border-[var(--border)] p-3">
                <legend className="px-1 text-sm text-[var(--foreground)]">{index + 1}. {question.prompt}</legend>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {question.options.map((option, optionIndex) => (
                    <label key={option} className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm transition ${answers[question.id] === optionIndex ? "border-sky-600 bg-sky-600/10 text-sky-800 dark:text-sky-200" : "border-[var(--border)] hover:border-sky-600/50"}`}>
                      <input type="radio" name={question.id} checked={answers[question.id] === optionIndex} onChange={() => setAnswers((current) => ({ ...current, [question.id]: optionIndex }))} className="sr-only" />{option}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          {error ? <p className="mt-3 text-sm text-red-600" role="alert">{error}</p> : null}
          <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setOpen(false)} className="h-10 rounded-lg px-3 text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)]/50">{t("Later")}</button><button type="button" onClick={() => void handleSave()} disabled={saving} className="h-10 rounded-lg bg-sky-700 px-4 text-sm font-medium text-white disabled:opacity-50">{saving ? t("Saving...") : t("Complete and personalize")}</button></div>
        </div>
      ) : null}
    </section>
  );
}
