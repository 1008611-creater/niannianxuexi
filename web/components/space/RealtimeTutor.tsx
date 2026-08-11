"use client";

import { useCallback, useRef } from "react";
import { Mic, MicOff, Square, Volume2 } from "lucide-react";

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
  layout?: "compact" | "call";
  disabled?: boolean;
  onTranscript?: (text: string) => void;
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

export default function RealtimeTutor({ questionId, sessionId, variant = "conversation", context = "", learningMode, layout = "compact", disabled = false, onTranscript, onSessionEnd, onFallback }: RealtimeTutorProps) {
  const visualizerRef = useRef<HTMLDivElement>(null);
  const gestureStartRef = useRef(false);
  const updateAudioLevel = useCallback((level: number) => {
    visualizerRef.current?.style.setProperty("--audio-level", String(level));
  }, []);
  const tutor = useRealtimeTutor({ onTranscript, onSessionEnd, onAudioLevel: updateAudioLevel });
  const Icon = stateIcon[tutor.state];
  const fallbackOnly = ["unavailable", "permission_denied", "error"].includes(tutor.state);
  const startOptions: RealtimeTutorStartOptions = { questionId, sessionId, variant, context, learningMode };
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
            alt="念念"
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
            <Mic size={18} /> 和念念老师说
          </button>
          {tutor.message ? <p role="status" className="max-w-xs text-sm leading-6 text-[var(--muted-foreground)]">{tutor.message}</p> : null}
          {fallbackOnly && onFallback ? <button type="button" onClick={onFallback} className="min-h-11 text-sm font-medium text-emerald-700 underline underline-offset-4 dark:text-emerald-300">用录音或文字继续</button> : null}
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
            aria-label={tutor.microphoneEnabled ? "关闭麦克风" : "打开麦克风"}
            title={tutor.microphoneEnabled ? "关闭麦克风" : "打开麦克风"}
            className={`realtime-call-control ${tutor.microphoneEnabled ? "is-enabled" : ""}`}
          >
            {tutor.microphoneEnabled ? <Mic size={21} /> : <MicOff size={21} />}
          </button>

          <div
            ref={visualizerRef}
            className={`realtime-call-core ${isSpeaking ? "is-speaking" : ""} ${isListening ? "is-listening" : ""}`}
            data-state={tutor.state}
            aria-label={isSpeaking ? "念念老师正在说话" : isListening ? "正在检测你的声音" : tutor.message}
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
            aria-label="结束通话"
            title="结束通话"
            className="realtime-call-control realtime-call-stop"
          >
            <Square size={18} fill="currentColor" />
          </button>
        </div>
        <p role="status" className={`min-h-6 text-sm font-medium ${isSpeaking ? "text-violet-700 dark:text-violet-300" : "text-[var(--foreground)]"}`}>
          {tutor.message}
        </p>
        <p className="sr-only">左侧按钮控制麦克风，右侧按钮结束通话。</p>
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
          <Mic size={17} /> 和念念老师说
        </button>
        {tutor.message ? <p role="status" className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">{tutor.message}</p> : null}
        {fallbackOnly && onFallback ? <button type="button" onClick={onFallback} className="mt-2 min-h-11 text-sm font-medium text-emerald-700 underline underline-offset-4 dark:text-emerald-300">改用录音作答</button> : null}
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2.5" aria-live="polite">
      <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white ${tutor.state === "speaking" ? "animate-pulse" : ""}`}><Icon size={17} /></span>
      <p className="text-sm font-medium text-[var(--foreground)]">{tutor.message}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={tutor.stop} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-700"><Square size={14} fill="currentColor" /> 结束</button>
        {onFallback ? <button type="button" onClick={() => { tutor.stop(); onFallback(); }} className="min-h-11 px-2 text-sm font-medium text-emerald-700 underline underline-offset-4 dark:text-emerald-300">改用录音</button> : null}
      </div>
    </div>
  );
}
