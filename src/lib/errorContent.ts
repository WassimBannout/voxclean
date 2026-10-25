import type { AppError } from "./errors";

export type ErrorIcon = "alert" | "download" | "file" | "micOff" | "mute";

export interface ErrorContent {
  /** The part of the app the error came from, shown as a small label. */
  area?: string;
  title: string;
  body: string;
  /** A terminal command that fixes it. */
  command?: string;
  icon: ErrorIcon;
  tone: "warn" | "neutral";
}

/** Copy for each error, from the design's "Errors and edge states" board. */
export function describeError(error: AppError, model: string): ErrorContent {
  switch (error.code) {
    case "ollama_unavailable":
      return {
        area: "Clean / Summarize",
        title: "Ollama isn't running",
        body: "VoxClean couldn't reach Ollama on this computer, so it can't clean up or summarize yet. Your transcript is kept.",
        command: "ollama serve",
        icon: "alert",
        tone: "warn",
      };
    case "model_not_installed":
      return {
        area: "Clean / Summarize",
        title: "Language model not installed",
        body: `Ollama is running, but ${model} isn't installed. Download it once and it works offline from then on.`,
        command: `ollama pull ${model}`,
        icon: "download",
        tone: "neutral",
      };
    case "unsupported_format":
    case "file_unreadable":
      // The backend names the file in its message.
      return {
        area: "Upload",
        title: "Can't open this file",
        body: error.message,
        icon: "file",
        tone: "warn",
      };
    case "microphone_unavailable":
      return {
        area: "Recording",
        title: "Microphone access is off",
        body: "Allow VoxClean to use the microphone in your system settings, then try again. Uploading a file still works.",
        icon: "micOff",
        tone: "warn",
      };
    case "no_speech":
      return {
        area: "Transcription",
        title: "No speech found",
        body: "Whisper didn't hear any speech in this recording. Check that the right microphone is selected and its level moves while you talk.",
        icon: "mute",
        tone: "neutral",
      };
    default:
      return {
        title: "Something went wrong",
        body: error.message,
        icon: "alert",
        tone: "warn",
      };
  }
}
