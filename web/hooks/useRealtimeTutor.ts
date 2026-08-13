"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { wsUrl } from "@/lib/api";
import { base64ToPcm16, floatToPcm16, pcm16ToBase64, pcm16ToFloat32, resample } from "@/lib/realtime-tutor";
import type { LearningMode } from "@/lib/learning-templates";

export type RealtimeTutorState = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "unavailable" | "permission_denied" | "error";
export type RealtimeTutorVariant = "conversation" | "diagnostic" | "practice";

export type RealtimeTutorStartOptions = {
  questionId?: string;
  sessionId?: string;
  variant?: RealtimeTutorVariant;
  context?: string;
  learningMode?: LearningMode;
  learningTemplateId?: string;
  learningTemplateRevision?: number;
};

type RealtimeTutorOptions = {
  onSessionEnd?: () => void;
  onAudioLevel?: (level: number) => void;
};

const INPUT_SAMPLE_RATE = 16_000;
const OUTPUT_SAMPLE_RATE = 24_000;
const NATIVE_AUDIO_EVENT = "niannian-native-audio";
const NATIVE_AUDIO_PERMISSION_EVENT = "niannian-native-audio-permission";
const AUDIO_WORKLET_PROCESSOR_SOURCE = `
class NianNianAudioInputProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) {
      const frame = channel.slice();
      this.port.postMessage(frame, [frame.buffer]);
    }
    return true;
  }
}

registerProcessor("niannian-audio-input-processor", NianNianAudioInputProcessor);
`;

type NativeAudioFrame = { audio?: unknown; level?: unknown };
type NativeAudioPermission = { granted?: unknown };
type NativeMicrophoneBridge = {
  startCapture: () => string;
  stopCapture: () => void;
  setMuted: (muted: boolean) => void;
  reportStatus?: (status: string) => void;
};

declare global {
  interface Window {
    NianNianNativeAudio?: NativeMicrophoneBridge;
  }
}

function websocketEndpoint(path: string): string {
  if (/^wss?:\/\//.test(path)) return path;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path.startsWith("/") ? path : `/${path}`}`;
}

async function requestRealtimeHandoff(signal?: AbortSignal): Promise<string> {
  try {
    const response = await fetch("/api/v1/realtime/tutor-token", {
      credentials: "include",
      cache: "no-store",
      signal,
    });
    if (!response.ok) return "";
    const payload = (await response.json()) as { token?: unknown };
    return typeof payload.token === "string" ? payload.token : "";
  } catch {
    return "";
  }
}

async function openMicrophone(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (error) {
    // Older Android WebViews can reject optional audio-processing constraints
    // even when the Android microphone permission is already granted.
    if (error instanceof DOMException && error.name === "OverconstrainedError") {
      return navigator.mediaDevices.getUserMedia({ audio: true });
    }
    throw error;
  }
}

function nativeMicrophoneBridge(): NativeMicrophoneBridge | null {
  const bridge = window.NianNianNativeAudio;
  if (!bridge
    || typeof bridge.startCapture !== "function"
    || typeof bridge.stopCapture !== "function"
    || typeof bridge.setMuted !== "function") return null;
  bridge.reportStatus?.("available");
  return bridge;
}

function nativeMicrophoneError(status: string): DOMException {
  if (status === "permission_denied") {
    return new DOMException("Native microphone permission denied", "NotAllowedError");
  }
  return new DOMException("Native microphone input unavailable", "NotReadableError");
}

async function startNativeMicrophone(bridge: NativeMicrophoneBridge): Promise<void> {
  bridge.reportStatus?.("start-requested");
  let resolvePermission: ((granted: boolean) => void) | null = null;
  const permissionResult = new Promise<boolean>((resolve) => {
    resolvePermission = resolve;
  });
  const onPermission = (event: Event) => {
    const detail = (event as CustomEvent<NativeAudioPermission>).detail;
    resolvePermission?.(detail?.granted === true);
  };
  window.addEventListener(NATIVE_AUDIO_PERMISSION_EVENT, onPermission, { once: true });
  const status = bridge.startCapture();
  bridge.reportStatus?.(`start-${status}`);
  if (status === "started") {
    window.removeEventListener(NATIVE_AUDIO_PERMISSION_EVENT, onPermission);
    return;
  }
  if (status !== "permission_requested") {
    window.removeEventListener(NATIVE_AUDIO_PERMISSION_EVENT, onPermission);
    throw nativeMicrophoneError(status);
  }
  const granted = await permissionResult;
  if (!granted) throw nativeMicrophoneError("permission_denied");
  const retryStatus = bridge.startCapture();
  if (retryStatus !== "started") throw nativeMicrophoneError(retryStatus);
}

function microphoneErrorMessage(error: unknown): string {
  if (!(error instanceof DOMException)) return "无法启动麦克风，请退出后重新打开念念。";
  if (error.name === "NotAllowedError" || error.name === "SecurityError") {
    return "网页没有拿到麦克风权限，请在手机设置中关闭后重新允许麦克风。";
  }
  if (error.name === "NotFoundError") return "没有检测到可用麦克风，请检查手机的录音设备。";
  if (error.name === "NotReadableError") {
    return "手机没有把录音设备交给念念，请确认系统“麦克风访问”总开关已打开后重试。";
  }
  if (error.name === "AbortError") return "录音初始化被中断，请退出后重新打开念念。";
  return "麦克风暂时无法使用，请退出后重新打开念念。";
}

function createAudioWorkletModuleUrl(): string {
  return URL.createObjectURL(new Blob([AUDIO_WORKLET_PROCESSOR_SOURCE], { type: "application/javascript" }));
}

export function useRealtimeTutor({ onSessionEnd, onAudioLevel }: RealtimeTutorOptions = {}) {
  const [state, setState] = useState<RealtimeTutorState>("idle");
  const [message, setMessage] = useState("");
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const socketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<AudioNode | null>(null);
  const inputSilencerRef = useRef<GainNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const browserCaptureWatchdogRef = useRef<number | null>(null);
  const browserFrameSeenRef = useRef(false);
  const browserCaptureNoticeRef = useRef(false);
  const nativeCaptureCleanupRef = useRef<(() => void) | null>(null);
  const nativeBridgeRef = useRef<NativeMicrophoneBridge | null>(null);
  const handoffAbortRef = useRef<AbortController | null>(null);
  const startAttemptRef = useRef(0);
  const nextPlayAtRef = useRef(0);
  const stoppedRef = useRef(false);
  const terminalRef = useRef(false);
  const greetingPendingRef = useRef(false);
  const assistantSpeakingRef = useRef(false);
  const resumeInputTimerRef = useRef<number | null>(null);
  const onSessionEndRef = useRef(onSessionEnd);
  const onAudioLevelRef = useRef(onAudioLevel);
  const microphoneEnabledRef = useRef(true);
  const detectedInputRef = useRef(false);
  useEffect(() => {
    onSessionEndRef.current = onSessionEnd;
  }, [onSessionEnd]);
  useEffect(() => {
    onAudioLevelRef.current = onAudioLevel;
  }, [onAudioLevel]);

  const send = useCallback((payload: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  }, []);

  const stopOutput = useCallback(() => {
    const context = contextRef.current;
    nextPlayAtRef.current = context?.currentTime ?? 0;
  }, []);

  const release = useCallback((notify = true) => {
    stoppedRef.current = true;
    startAttemptRef.current += 1;
    handoffAbortRef.current?.abort();
    handoffAbortRef.current = null;
    greetingPendingRef.current = false;
    assistantSpeakingRef.current = false;
    if (resumeInputTimerRef.current !== null) {
      window.clearTimeout(resumeInputTimerRef.current);
      resumeInputTimerRef.current = null;
    }
    microphoneEnabledRef.current = true;
    setMicrophoneEnabled(true);
    onAudioLevelRef.current?.(0);
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "session.end" }));
      socket.close(1000);
    }
    socketRef.current = null;
    nativeCaptureCleanupRef.current?.();
    nativeCaptureCleanupRef.current = null;
    nativeBridgeRef.current = null;
    if (browserCaptureWatchdogRef.current !== null) {
      window.clearTimeout(browserCaptureWatchdogRef.current);
      browserCaptureWatchdogRef.current = null;
    }
    browserFrameSeenRef.current = false;
    browserCaptureNoticeRef.current = false;
    processorRef.current?.disconnect();
    inputSilencerRef.current?.disconnect();
    sourceRef.current?.disconnect();
    processorRef.current = null;
    inputSilencerRef.current = null;
    sourceRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const context = contextRef.current;
    contextRef.current = null;
    if (context && context.state !== "closed") void context.close();
    if (notify) {
      setState("idle");
      setMessage("");
    }
  }, []);

  const playAudio = useCallback((base64: string) => {
    const context = contextRef.current;
    if (!context || !base64) return;
    try {
      const samples = pcm16ToFloat32(base64ToPcm16(base64));
      const audio = context.createBuffer(1, samples.length, OUTPUT_SAMPLE_RATE);
      audio.getChannelData(0).set(samples);
      const source = context.createBufferSource();
      source.buffer = audio;
      source.connect(context.destination);
      const startAt = Math.max(context.currentTime + 0.01, nextPlayAtRef.current);
      source.start(startAt);
      nextPlayAtRef.current = startAt + audio.duration;
    } catch {
      setState("error");
      setMessage("老师的声音播放失败，请改用录音作答。");
    }
  }, []);

  const setInputPausedForAssistant = useCallback((paused: boolean) => {
    assistantSpeakingRef.current = paused;
    nativeBridgeRef.current?.setMuted(paused || !microphoneEnabledRef.current);
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !paused && microphoneEnabledRef.current;
    });
    if (paused) {
      onAudioLevelRef.current?.(0);
      send({ type: "input_audio_buffer.clear" });
    }
  }, [send]);

  const start = useCallback(async (input: string | RealtimeTutorStartOptions, legacyVariant: RealtimeTutorVariant = "conversation") => {
    const options: RealtimeTutorStartOptions = typeof input === "string"
      ? { questionId: input, variant: legacyVariant }
      : input;
    release(false);
    const attempt = startAttemptRef.current + 1;
    startAttemptRef.current = attempt;
    stoppedRef.current = false;
    terminalRef.current = false;
    greetingPendingRef.current = false;
    assistantSpeakingRef.current = false;
    if (resumeInputTimerRef.current !== null) {
      window.clearTimeout(resumeInputTimerRef.current);
      resumeInputTimerRef.current = null;
    }
    detectedInputRef.current = false;
    microphoneEnabledRef.current = true;
    setMicrophoneEnabled(true);
    onAudioLevelRef.current?.(0);
    setState("connecting");
    setMessage("正在连接念念老师…");
    const nativeBridge = nativeMicrophoneBridge();
    if ((!nativeBridge && !navigator.mediaDevices?.getUserMedia) || typeof AudioContext === "undefined") {
      setState("unavailable");
      setMessage("当前设备不支持实时语音，请改用录音作答。");
      return;
    }
    try {
      // Android WebView can reject AudioContext.resume() even though native
      // AudioRecord works. Do not let playback initialization block capture.
      let context: AudioContext | null = null;
      try {
        context = new AudioContext();
        contextRef.current = context;
        const resume = context.resume();
        if (nativeBridge) {
          void resume.catch(() => undefined);
        } else {
          await resume;
        }
        nextPlayAtRef.current = context.currentTime;
      } catch (error) {
        contextRef.current = null;
        if (!nativeBridge) throw error;
      }
      if (nativeBridge) {
        let receivedNativeFrame = false;
        let forwardedNativeFrame = false;
        const onNativeAudio = (event: Event) => {
          const detail = (event as CustomEvent<NativeAudioFrame>).detail;
          if (!detail || typeof detail.audio !== "string") return;
          if (!receivedNativeFrame) {
            receivedNativeFrame = true;
            nativeBridge.reportStatus?.("first-frame-delivered");
          }
          if (!microphoneEnabledRef.current || assistantSpeakingRef.current || greetingPendingRef.current) {
            onAudioLevelRef.current?.(0);
            return;
          }
          const level = typeof detail.level === "number" ? detail.level : 0;
          onAudioLevelRef.current?.(Math.min(1, Math.max(0, level)));
          if (!detectedInputRef.current && level >= 0.015) {
            detectedInputRef.current = true;
            setMessage("已检测到你的声音，正在发送给念念老师");
          }
          const socket = socketRef.current;
          if (socket?.readyState !== WebSocket.OPEN) return;
          socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: detail.audio }));
          if (!forwardedNativeFrame) {
            forwardedNativeFrame = true;
            nativeBridge.reportStatus?.("first-frame-forwarded");
          }
        };
        window.addEventListener(NATIVE_AUDIO_EVENT, onNativeAudio);
        nativeBridgeRef.current = nativeBridge;
        nativeCaptureCleanupRef.current = () => {
          window.removeEventListener(NATIVE_AUDIO_EVENT, onNativeAudio);
          nativeBridge.stopCapture();
        };
        await startNativeMicrophone(nativeBridge);
      } else {
        if (!context) throw new DOMException("Audio output unavailable", "NotReadableError");
        const stream = await openMicrophone();
        if (stoppedRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const source = context.createMediaStreamSource(stream);
        sourceRef.current = source;

        const forwardBrowserAudio = (samples: Float32Array) => {
          if (!samples.length) return;
          browserFrameSeenRef.current = true;
          if (browserCaptureWatchdogRef.current !== null) {
            window.clearTimeout(browserCaptureWatchdogRef.current);
            browserCaptureWatchdogRef.current = null;
          }
          if (!microphoneEnabledRef.current || assistantSpeakingRef.current || greetingPendingRef.current) {
            onAudioLevelRef.current?.(0);
            return;
          }
          let sum = 0;
          for (let index = 0; index < samples.length; index += 1) sum += samples[index] * samples[index];
          const level = Math.min(1, Math.max(0, Math.sqrt(sum / samples.length) * 6));
          onAudioLevelRef.current?.(level);
          const socket = socketRef.current;
          if (!detectedInputRef.current && level >= 0.015) {
            detectedInputRef.current = true;
            setMessage("已检测到你的声音，正在发送给念念老师");
          }
          if (socket?.readyState === WebSocket.OPEN && !browserCaptureNoticeRef.current && !detectedInputRef.current) {
            browserCaptureNoticeRef.current = true;
            setMessage("麦克风已接通，正在检测你的声音");
          }
          if (socket?.readyState !== WebSocket.OPEN) return;
          const pcm = floatToPcm16(resample(samples, context.sampleRate, INPUT_SAMPLE_RATE));
          socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: pcm16ToBase64(pcm) }));
        };

        const connectScriptProcessor = () => {
          source.disconnect();
          processorRef.current?.disconnect();
          inputSilencerRef.current?.disconnect();
          inputSilencerRef.current = null;
          const processor = context.createScriptProcessor(2048, 1, 1);
          processor.onaudioprocess = (event) => {
            event.outputBuffer.getChannelData(0).fill(0);
            forwardBrowserAudio(event.inputBuffer.getChannelData(0));
          };
          source.connect(processor);
          processor.connect(context.destination);
          processorRef.current = processor;
        };

        // ScriptProcessor is unreliable on some desktop browsers. AudioWorklet
        // runs on the audio rendering thread and keeps the PCM capture path live.
        if (context.audioWorklet && typeof AudioWorkletNode !== "undefined") {
          try {
            const workletModuleUrl = createAudioWorkletModuleUrl();
            try {
              await context.audioWorklet.addModule(workletModuleUrl);
            } finally {
              URL.revokeObjectURL(workletModuleUrl);
            }
            const processor = new AudioWorkletNode(context, "niannian-audio-input-processor", {
              numberOfInputs: 1,
              numberOfOutputs: 1,
              channelCount: 1,
              outputChannelCount: [1],
            });
            const silencer = context.createGain();
            silencer.gain.value = 0;
            processor.port.onmessage = (event: MessageEvent<unknown>) => {
              if (event.data instanceof Float32Array) {
                forwardBrowserAudio(event.data);
                return;
              }
              if (ArrayBuffer.isView(event.data) && "length" in event.data) {
                forwardBrowserAudio(Float32Array.from(event.data as unknown as ArrayLike<number>));
              }
            };
            processor.port.start?.();
            source.connect(processor);
            processor.connect(silencer);
            silencer.connect(context.destination);
            processorRef.current = processor;
            inputSilencerRef.current = silencer;
            browserCaptureWatchdogRef.current = window.setTimeout(() => {
              if (!stoppedRef.current && !browserFrameSeenRef.current && processorRef.current === processor) {
                connectScriptProcessor();
                setMessage("已切换兼容录音模式，正在检测你的声音");
              }
            }, 1500);
          } catch {
            connectScriptProcessor();
          }
        } else {
          connectScriptProcessor();
        }
      }

      if (stoppedRef.current || startAttemptRef.current !== attempt) return;
      const handoffAbort = new AbortController();
      handoffAbortRef.current = handoffAbort;
      const handoffTimeout = window.setTimeout(() => handoffAbort.abort(), 8_000);
      const handoff = await requestRealtimeHandoff(handoffAbort.signal);
      window.clearTimeout(handoffTimeout);
      if (handoffAbortRef.current === handoffAbort) handoffAbortRef.current = null;
      if (stoppedRef.current || startAttemptRef.current !== attempt) return;
      if (handoffAbort.signal.aborted) {
        setState("error");
        setMessage("连接念念老师超时，请再点一次。");
        return;
      }
      const baseSocketUrl = websocketEndpoint(wsUrl("/api/v1/realtime/tutor"));
      const socket = new WebSocket(
        handoff
          ? `${baseSocketUrl}?handoff=${encodeURIComponent(handoff)}`
          : baseSocketUrl,
      );
      socketRef.current = socket;
      const socketTimeout = window.setTimeout(() => {
        if (socket.readyState === WebSocket.CONNECTING && !stoppedRef.current && startAttemptRef.current === attempt) {
          socket.close();
          setState("error");
          setMessage("连接念念老师超时，请再点一次。");
        }
      }, 15_000);
      socket.onopen = () => {
        window.clearTimeout(socketTimeout);
        const payload: Record<string, unknown> = {
          type: "session.start",
          variant: options.variant ?? "conversation",
        };
        if (options.questionId) payload.question_id = options.questionId;
        if (options.sessionId) payload.session_id = options.sessionId;
        if (options.context) payload.context = options.context.slice(-6000);
        if (options.learningMode) payload.learning_mode = options.learningMode;
        if (options.learningTemplateId) {
          payload.learning_template_id = options.learningTemplateId;
          if (options.learningTemplateRevision !== undefined) {
            payload.learning_template_revision = options.learningTemplateRevision;
          }
        }
        socket.send(JSON.stringify(payload));
      };
      socket.onmessage = (messageEvent) => {
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(String(messageEvent.data)) as Record<string, unknown>;
        } catch {
          return;
        }
        const type = String(event.type || "");
        if (type === "opening") {
          greetingPendingRef.current = true;
          setState("thinking");
          setMessage(
            event.has_realtime_image === true
              ? "已带入当前题目图片，念念老师正在和你打招呼"
              : "念念老师正在和你打招呼",
          );
          return;
        }
        if (type === "ready" || type === "session.updated") {
          if (greetingPendingRef.current) return;
          setState("listening");
          setMessage("念念老师正在听");
          return;
        }
        if (type === "input_audio_buffer.speech_started") {
          if (greetingPendingRef.current) return;
          stopOutput();
          send({ type: "response.cancel" });
          setState("listening");
          setMessage("念念老师正在听");
          return;
        }
        if (type === "input_audio_buffer.speech_stopped") {
          setState("thinking");
          setMessage("念念老师正在思考");
          return;
        }
        if (type === "response.audio.delta") {
          const audio = event.delta;
          if (!assistantSpeakingRef.current) setInputPausedForAssistant(true);
          if (typeof audio === "string") playAudio(audio);
          setState("speaking");
          setMessage(
            greetingPendingRef.current
              ? "念念老师正在和你打招呼"
              : "念念老师正在回答",
          );
          return;
        }
        if (type === "response.audio.done" || type === "response.done") {
          greetingPendingRef.current = false;
          const context = contextRef.current;
          const waitMs = context
            ? Math.max(0, (nextPlayAtRef.current - context.currentTime) * 1000) + 80
            : 120;
          if (resumeInputTimerRef.current !== null) window.clearTimeout(resumeInputTimerRef.current);
          resumeInputTimerRef.current = window.setTimeout(() => {
            resumeInputTimerRef.current = null;
            setInputPausedForAssistant(false);
            if (!stoppedRef.current) {
              setState("listening");
              setMessage("念念老师正在听");
            }
          }, waitMs);
          return;
        }
        if (type === "limit_reached" || type === "unavailable") {
          terminalRef.current = true;
          setState("unavailable");
          setMessage(typeof event.message === "string" ? event.message : "请改用录音作答。");
          return;
        }
        if (type === "error") {
          terminalRef.current = true;
          setState("error");
          setMessage(typeof event.message === "string" ? event.message : "念念老师暂时无法连接，请改用录音作答。");
        }
      };
      socket.onerror = () => {
        if (!stoppedRef.current) {
          setState("error");
          setMessage("念念老师暂时无法连接，请改用录音作答。");
        }
      };
      socket.onclose = () => {
        window.clearTimeout(socketTimeout);
        onSessionEndRef.current?.();
        if (!stoppedRef.current && !terminalRef.current) {
          setState("idle");
        }
      };
    } catch (error) {
      release(false);
      const permissionFailure = error instanceof DOMException
        && (error.name === "NotAllowedError" || error.name === "SecurityError");
      setState(permissionFailure ? "permission_denied" : "error");
      setMessage(microphoneErrorMessage(error));
    }
  }, [playAudio, release, send, setInputPausedForAssistant, stopOutput]);

  const stop = useCallback(() => release(true), [release]);

  const toggleMicrophone = useCallback(() => {
    setMicrophoneEnabled((enabled) => {
      const nextEnabled = !enabled;
      microphoneEnabledRef.current = nextEnabled;
      nativeBridgeRef.current?.setMuted(assistantSpeakingRef.current || !nextEnabled);
      streamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = nextEnabled && !assistantSpeakingRef.current;
      });
      if (!nextEnabled) onAudioLevelRef.current?.(0);
      return nextEnabled;
    });
  }, []);

  useEffect(() => () => release(false), [release]);

  return {
    state,
    message,
    start,
    stop,
    microphoneEnabled,
    toggleMicrophone,
    isActive: ["connecting", "listening", "thinking", "speaking"].includes(state),
  };
}
