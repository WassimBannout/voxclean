/**
 * Mirrors `AppError::code` in src-tauri/src/error.rs. `no_speech` and
 * `cancelled` are the contract for the transcription commands that aren't
 * built yet. `unknown` covers failures that never reached a command (e.g. a
 * missing command name).
 */
export type AppErrorCode =
  | "ollama_unavailable"
  | "model_not_installed"
  | "ollama_error"
  | "config_error"
  | "empty_input"
  | "unsupported_format"
  | "file_unreadable"
  | "microphone_unavailable"
  | "not_recording"
  | "audio_error"
  | "no_speech"
  | "cancelled"
  | "unknown";

/** What every Rust command rejects with. `message` is written for the user. */
export interface AppError {
  code: AppErrorCode;
  message: string;
}

export function isAppError(value: unknown): value is AppError {
  if (typeof value !== "object" || value === null) return false;
  const { code, message } = value as Record<string, unknown>;
  return typeof code === "string" && typeof message === "string";
}

/** Normalizes anything `invoke` can reject with into an AppError. */
export function toAppError(value: unknown): AppError {
  if (isAppError(value)) return value;
  if (value instanceof Error)
    return { code: "unknown", message: value.message };
  return { code: "unknown", message: String(value) };
}
