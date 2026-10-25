import type { AppError } from "./errors";
import type { AudioClip, ProcessingMode, Transcript } from "./ipc";

/** Where the audio came from. The audio itself stays in the Rust process. */
export type AudioSource =
  | {
      kind: "recording";
      recordedAt: number;
      deviceName: string;
      clip: AudioClip;
    }
  | { kind: "file"; path: string; name: string; clip: AudioClip };

/** The outcome of one processing mode. Both modes can exist side by side. */
export type ModeResult =
  | { status: "pending" }
  | { status: "done"; generated: string; text: string }
  | { status: "failed"; error: AppError };

export type Results = Partial<Record<ProcessingMode, ModeResult>>;

export type RecordingState = Extract<WorkflowState, { status: "recording" }>;

/**
 * One state per screen of the flow (PRD §4). Settled states carry the last
 * error so the UI can show it next to the action that failed.
 */
export type WorkflowState =
  | { status: "idle"; error?: AppError }
  | {
      status: "recording";
      startedAt: number;
      deviceName: string;
      /** Time recorded before the current stretch. */
      elapsedMs: number;
      /** When the current stretch began; `null` while paused. */
      resumedAt: number | null;
    }
  | { status: "ready"; source: AudioSource; error?: AppError }
  | { status: "transcribing"; source: AudioSource; progress: number | null }
  | {
      status: "transcript";
      source: AudioSource;
      transcript: Transcript;
      results: Results;
    }
  | {
      status: "result";
      source: AudioSource;
      transcript: Transcript;
      results: Results;
      mode: ProcessingMode;
    };

export type WorkflowEvent =
  | { type: "recordingStarted"; at: number; deviceName: string }
  | { type: "recordingPaused"; at: number }
  | { type: "recordingResumed"; at: number }
  | { type: "recordingStopped"; clip: AudioClip }
  | { type: "recordingDiscarded" }
  | { type: "fileLoaded"; path: string; name: string; clip: AudioClip }
  | { type: "audioFailed"; error: AppError }
  | { type: "audioRemoved" }
  | { type: "transcriptionStarted" }
  | { type: "transcriptionProgressed"; progress: number }
  | { type: "transcriptionSucceeded"; transcript: Transcript }
  | { type: "transcriptionFailed"; error: AppError }
  | { type: "transcriptionCancelled" }
  | { type: "processingStarted"; mode: ProcessingMode }
  | { type: "processingSucceeded"; mode: ProcessingMode; text: string }
  | { type: "processingFailed"; mode: ProcessingMode; error: AppError }
  | { type: "modeSelected"; mode: ProcessingMode }
  | { type: "resultEdited"; mode: ProcessingMode; text: string }
  | { type: "resultRestored"; mode: ProcessingMode }
  | { type: "backToTranscript" }
  | { type: "reset" };

export const initialState: WorkflowState = { status: "idle" };

/** True while the backend holds a live recording or transcription job. */
export function isBusy(state: WorkflowState): boolean {
  return state.status === "recording" || state.status === "transcribing";
}

export function recordingElapsedMs(state: RecordingState, now: number) {
  return (
    state.elapsedMs +
    (state.resumedAt === null ? 0 : Math.max(0, now - state.resumedAt))
  );
}

/** Which of the three header steps the state belongs to. */
export function currentStep(state: WorkflowState): 1 | 2 | 3 {
  switch (state.status) {
    case "idle":
    case "recording":
    case "ready":
      return 1;
    case "transcribing":
    case "transcript":
      return 2;
    case "result":
      return 3;
  }
}

export function transcriptText(transcript: Transcript): string {
  return transcript.segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ");
}

function updateResult(
  results: Results,
  mode: ProcessingMode,
  from: ModeResult["status"],
  next: (current: ModeResult) => ModeResult,
): Results {
  const current = results[mode];
  return current?.status === from
    ? { ...results, [mode]: next(current) }
    : results;
}

/** Events that don't apply to the current state are ignored. */
export function workflowReducer(
  state: WorkflowState,
  event: WorkflowEvent,
): WorkflowState {
  switch (event.type) {
    case "recordingStarted":
      return isBusy(state)
        ? state
        : {
            status: "recording",
            startedAt: event.at,
            deviceName: event.deviceName,
            elapsedMs: 0,
            resumedAt: event.at,
          };

    case "recordingPaused":
      return state.status === "recording" && state.resumedAt !== null
        ? {
            ...state,
            elapsedMs: recordingElapsedMs(state, event.at),
            resumedAt: null,
          }
        : state;

    case "recordingResumed":
      return state.status === "recording" && state.resumedAt === null
        ? { ...state, resumedAt: event.at }
        : state;

    case "recordingStopped":
      return state.status === "recording"
        ? {
            status: "ready",
            source: {
              kind: "recording",
              recordedAt: state.startedAt,
              deviceName: state.deviceName,
              clip: event.clip,
            },
          }
        : state;

    case "recordingDiscarded":
      return state.status === "recording" ? initialState : state;

    case "fileLoaded":
      return isBusy(state)
        ? state
        : {
            status: "ready",
            source: {
              kind: "file",
              path: event.path,
              name: event.name,
              clip: event.clip,
            },
          };

    case "audioFailed":
      if (state.status === "ready") return { ...state, error: event.error };
      return state.status === "idle" || state.status === "recording"
        ? { status: "idle", error: event.error }
        : state;

    case "audioRemoved":
      return state.status === "ready" ? initialState : state;

    case "transcriptionStarted":
      return state.status === "ready"
        ? { status: "transcribing", source: state.source, progress: null }
        : state;

    case "transcriptionProgressed":
      return state.status === "transcribing"
        ? { ...state, progress: event.progress }
        : state;

    case "transcriptionSucceeded":
      return state.status === "transcribing"
        ? {
            status: "transcript",
            source: state.source,
            transcript: event.transcript,
            results: {},
          }
        : state;

    case "transcriptionFailed":
      return state.status === "transcribing"
        ? { status: "ready", source: state.source, error: event.error }
        : state;

    case "transcriptionCancelled":
      return state.status === "transcribing"
        ? { status: "ready", source: state.source }
        : state;

    case "processingStarted":
      return state.status === "transcript" || state.status === "result"
        ? {
            status: "result",
            source: state.source,
            transcript: state.transcript,
            results: { ...state.results, [event.mode]: { status: "pending" } },
            mode: event.mode,
          }
        : state;

    case "processingSucceeded":
    case "processingFailed": {
      if (state.status !== "transcript" && state.status !== "result")
        return state;
      const outcome: ModeResult =
        event.type === "processingSucceeded"
          ? { status: "done", generated: event.text, text: event.text }
          : { status: "failed", error: event.error };
      const results = updateResult(
        state.results,
        event.mode,
        "pending",
        () => outcome,
      );
      return results === state.results ? state : { ...state, results };
    }

    case "modeSelected":
      return state.status === "transcript" || state.status === "result"
        ? {
            status: "result",
            source: state.source,
            transcript: state.transcript,
            results: state.results,
            mode: event.mode,
          }
        : state;

    case "resultEdited":
    case "resultRestored": {
      if (state.status !== "result") return state;
      const results = updateResult(state.results, event.mode, "done", (r) =>
        r.status === "done"
          ? {
              ...r,
              text: event.type === "resultEdited" ? event.text : r.generated,
            }
          : r,
      );
      return results === state.results ? state : { ...state, results };
    }

    case "backToTranscript":
      return state.status === "result"
        ? {
            status: "transcript",
            source: state.source,
            transcript: state.transcript,
            results: state.results,
          }
        : state;

    case "reset":
      return isBusy(state) ? state : initialState;
  }
}
