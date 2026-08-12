"use client";

import { useCallback, useMemo, useRef } from "react";
import { Mic, MicOff, Square, Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  type RealtimeTutorStartOptions,
  type RealtimeTutorState,
  type RealtimeTutorVariant,
  useRealtimeTutor,
} from "@/hooks/useRealtimeTutor";
import type { LearningMode } from "@/lib/learning-templates";

type RealtimeTutorProps = {
  questionId?: string;
  sessionId?: string;
  variant?: RealtimeTutorVariant;
  context?: string;
  learningMode?: LearningMode;
  learningTemplateId?: string;
  learningTemplateRevision?: number;
  layout?: "compact" | "call";
  disabled?: boolean;
  onSessionEnd?: () => void;
  onFallback?: () => void;
};

const stateIcon: Record<RealtimeTutorState, typeof Mic> = {
  idle: Mic,
  connecting: Volume2,
  listening: Mic,
  thinking: Volume2,
  speaking: Volume2,
  unavailable: Mic,
  permission_denied: Mic,
  error: Mic,
};

export default function RealtimeTutor({ questionId, sessionId, variant = "conversation", context = "", learningMode, learningTemplateId, learningTemplateRevision, layout = "compact", disabled = false, onSessionEnd, onFallback }: RealtimeTutorProps) {
  const { t } = useTranslation();
  const visualizerRef = useRef<HTMLDivElement>(null);
  const gestureStartRef = useRef(false);
  const updateAudioLevel = useCallback((level: number) => {
    visualizerRef.current?.style.setProperty("--audio-level", String(level));
  }, []);
  const tutor = useRealtimeTutor({ onSessionEnd, onAudioLevel: updateAudioLevel });
  const Icon = stateIcon[tutor.state];
  const fallbackOnly = ["unavailable", "permission_denied", "error"].includes(tutor.state);
  const startOptions = useMemo<RealtimeTutorStartOptions>(
    () => ({ questionId, sessionId, variant, context, learningMode, learningTemplateId, learningTemplateRevision }),
    [questionId, sessionId, variant, context, learningMode, learningTemplateId, learningTemplateRevision],
  );
  const startFromGesture = useCallback(() => {
    if (disabled || tutor.isActive || gestureStartRef.current) return;
    gestureStartRef.current = true;
    void tutor.start(startOptions).finally(() => {
      gestureStartRef.current = false;
    });
  }, [disabled, startOptions, tutor]);

  if (layout === "call") {
    if (!tutor.isActive) {
      return (
        <div className="flex w-full flex-col items-center justify-center gap-6 text-center">
          <img
            src="/niannian-logo.svg"
            alt={t("Nian Nian")}
            width={104}
            height={104}
            className="h-24 w-24 select-none"
            draggable={false}
          />
          <button
            type="button"
            disabled={disabled}
            onPointerDown={startFromGesture}
            onClick={startFromGesture}
            className="inline-flex min-h-12 items-center gap-2 rounded-full bg-emerald-600 px-5 text-sm font-medium text-white transition hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-45"
          >
            <Mic size={18} /> {t("Talk with Nian Nian")}
          </button>
          {tutor.message ? <p role="status" className="max-w-xs text-sm leading-6 text-[var(--muted-foreground)]">{tutor.message}</p> : null}
          {fallbackOnly && onFallback ? <button type="button" onClick={onFallback} className="min-h-11 text-sm font-medium text-emerald-700 underline underline-offset-4 dark:text-emerald-300">{t("Continue with recording or text")}</button> : null}
        </div>
      );
    }

    const isSpeaking = tutor.state === "speaking";
    const isListening = tutor.state === "listening" && tutor.microphoneEnabled;
    return (
      <section className="flex w-full max-w-sm flex-col items-center justify-center gap-5 text-center" aria-live="polite">
        <div className="grid w-full grid-cols-[48px_minmax(150px,1fr)_48px] items-center gap-4 sm:gap-6">
          <button
            type="button"
            onClick={tutor.toggleMicrophone}
            aria-label={tutor.microphoneEnabled ? t("Turn off microphone") : t("Turn on microphone")}
            title={tutor.microphoneEnabled ? t("Turn off microphone") : t("Turn on microphone")}
            className={`realtime-call-control ${tutor.microphoneEnabled ? "is-enabled" : ""}`}
          >
            {tutor.microphoneEnabled ? <Mic size={21} /> : <MicOff size={21} />}
          </button>

          <div
            ref={visualizerRef}
            className={`realtime-call-core ${isSpeaking ? "is-speaking" : ""} ${isListening ? "is-listening" : ""}`}
            data-state={tutor.state}
            aria-label={isSpeaking ? t("Nian Nian is speaking") : isListening ? t("Listening for your voice") : tutor.message}
          >
            <span className="realtime-call-ring realtime-call-ring-one" aria-hidden="true" />
            <span className="realtime-call-ring realtime-call-ring-two" aria-hidden="true" />
            {isSpeaking ? (
              <div className="realtime-call-speaker" aria-hidden="true"><Volume2 size={35} strokeWidth={2.3} /></div>
            ) : (
              <div className="realtime-call-level" aria-hidden="true">
                {Array.from({ length: 7 }, (_, index) => <span key={index} className="realtime-call-level-bar" />)}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={tutor.stop}
            aria-label={t("End conversation")}
            title={t("End conversation")}
            className="realtime-call-control realtime-call-stop"
          >
            <Square size={18} fill="currentColor" />
          </button>
        </div>
        <p role="status" className={`min-h-6 text-sm font-medium ${isSpeaking ? "text-violet-700 dark:text-violet-300" : "text-[var(--foreground)]"}`}>
          {tutor.message}
        </p>
        <p className="sr-only">{t("The left button controls the microphone and the right button ends the conversation.")}</p>
      </section>
    );
  }

  if (!tutor.isActive) {
    return (
      <div className="mt-3">
        <button
          type="button"
          disabled={disabled}
          onPointerDown={startFromGesture}
          onClick={startFromGesture}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-emerald-600/35 px-4 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-500/10 disabled:opacity-45 dark:text-emerald-300"
        >
          <Mic size={17} /> {t("Talk with Nian Nian")}
        </button>
        {tutor.message ? <p role="status" className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">{tutor.message}</p> : null}
        {fallbackOnly && onFallback ? <button type="button" onClick={onFallback} className="mt-2 min-h-11 text-sm font-medium text-emerald-700 underline underline-offset-4 dark:text-emerald-300">{t("Use a recording instead")}</button> : null}
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2.5" aria-live="polite">
      <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white ${tutor.state === "speaking" ? "animate-pulse" : ""}`}><Icon size={17} /></span>
      <p className="text-sm font-medium text-[var(--foreground)]">{tutor.message}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={tutor.stop} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-700"><Square size={14} fill="currentColor" /> {t("End")}</button>
        {onFallback ? <button type="button" onClick={() => { tutor.stop(); onFallback(); }} className="min-h-11 px-2 text-sm font-medium text-emerald-700 underline underline-offset-4 dark:text-emerald-300">{t("Use recording")}</button> : null}
      </div>
    </div>
  );
}
