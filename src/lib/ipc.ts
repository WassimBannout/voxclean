import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open } from "@tauri-apps/plugin-dialog";
import { toAppError } from "./errors";

// The only module that touches Tauri APIs, so every failure reaches the UI as
// an AppError. Commands marked "planned" are not implemented in Rust yet; the
// UI is built against these signatures (see CLAUDE.md).

/** Mirrors `llm::prompts::Mode` in Rust. */
export type ProcessingMode = "clean" | "summarize";

/** Mirrors `commands::SystemStatus` in Rust. */
export interface SystemStatus {
  ollama: {
    url: string;
    model: string;
    reachable: boolean;
    modelInstalled: boolean;
  };
  whisper: {
    modelPath: string;
    modelFound: boolean;
  };
}

export interface InputDevice {
  id: string;
  name: string;
  isDefault: boolean;
}

/** Audio held in the Rust process; the UI only gets its shape. */
export interface AudioClip {
  durationMs: number;
  /** Loudness overview for the waveform, each value 0–1. */
  peaks: number[];
}

export interface Segment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface Transcript {
  segments: Segment[];
  /** ISO 639-1 code, e.g. "en". */
  language: string | null;
  languageDetected: boolean;
}

/** One line of `ollama pull` progress. */
export interface PullProgress {
  status: string;
  completed: number | null;
  total: number | null;
}

export const AUDIO_EXTENSIONS = ["wav", "mp3", "m4a", "flac", "ogg"];

async function call<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    throw toAppError(err);
  }
}

async function subscribe<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<UnlistenFn> {
  try {
    return await listen<T>(event, (e) => handler(e.payload));
  } catch (err) {
    throw toAppError(err);
  }
}

export function getSystemStatus(): Promise<SystemStatus> {
  return call("system_status");
}

export function processText(
  text: string,
  mode: ProcessingMode,
): Promise<string> {
  return call("process_text", { text, mode });
}

/** Downloads the configured language model through Ollama. */
export function pullModel(): Promise<void> {
  return call("pull_model");
}

export function onModelPullProgress(
  handler: (progress: PullProgress) => void,
): Promise<UnlistenFn> {
  return subscribe("model-pull-progress", handler);
}

/** Planned. */
export function listInputDevices(): Promise<InputDevice[]> {
  return call("list_input_devices");
}

/** Planned. `null` records from the system default device. */
export function startRecording(deviceId: string | null): Promise<void> {
  return call("start_recording", { deviceId });
}

/** Planned. */
export function pauseRecording(): Promise<void> {
  return call("pause_recording");
}

/** Planned. */
export function resumeRecording(): Promise<void> {
  return call("resume_recording");
}

/** Planned. */
export function stopRecording(): Promise<AudioClip> {
  return call("stop_recording");
}

/** Planned. */
export function discardRecording(): Promise<void> {
  return call("discard_recording");
}

/** Planned. Rejects with `unsupported_format` for files it can't decode. */
export function loadAudioFile(path: string): Promise<AudioClip> {
  return call("load_audio_file", { path });
}

/** Planned. `null` lets Whisper detect the language. */
export function transcribe(language: string | null): Promise<Transcript> {
  return call("transcribe", { language });
}

/** Planned. The pending `transcribe` call rejects with `cancelled`. */
export function cancelTranscription(): Promise<void> {
  return call("cancel_transcription");
}

/** Planned. Input level 0–1, emitted while recording. */
export function onRecordingLevel(
  handler: (level: number) => void,
): Promise<UnlistenFn> {
  return subscribe("recording-level", handler);
}

/** Planned. Fraction of the audio transcribed so far, 0–1. */
export function onTranscriptionProgress(
  handler: (progress: number) => void,
): Promise<UnlistenFn> {
  return subscribe("transcription-progress", handler);
}

export async function pickAudioFile(): Promise<string | null> {
  try {
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Audio", extensions: AUDIO_EXTENSIONS }],
    });
    return path;
  } catch (err) {
    throw toAppError(err);
  }
}

/** Files dragged onto the window, from Tauri's native drag and drop. */
export async function onFileDrop(handlers: {
  onHover: (hovering: boolean) => void;
  onDrop: (paths: string[]) => void;
}): Promise<UnlistenFn> {
  try {
    return await getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === "drop") handlers.onDrop(payload.paths);
      else handlers.onHover(payload.type !== "leave");
    });
  } catch (err) {
    throw toAppError(err);
  }
}

export async function copyText(text: string): Promise<void> {
  try {
    await writeText(text);
  } catch (err) {
    throw toAppError(err);
  }
}
