const pad = (n: number) => String(n).padStart(2, "0");

function clockParts(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    h: Math.floor(total / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
  };
}

/** Lengths of audio: 42_000 → "0:42", 3_725_000 → "1:02:05". */
export function formatDuration(ms: number): string {
  const { h, m, s } = clockParts(ms);
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Timers and timestamps: 42_000 → "00:42", 3_725_000 → "1:02:05". */
export function formatClock(ms: number): string {
  const { h, m, s } = clockParts(ms);
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** "Recording, 25 Oct 14:32" in the user's locale. */
export function recordingTitle(at: number, locale?: string): string {
  const date = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
  }).format(at);
  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
  return `Recording, ${date} ${time}`;
}

const languageNames = new Intl.DisplayNames(["en"], { type: "language" });

/** "English, detected automatically" */
export function languageLabel(code: string | null, detected: boolean): string {
  let name = "Unknown language";
  try {
    if (code) name = languageNames.of(code) ?? code;
  } catch {
    name = code ?? name;
  }
  return detected ? `${name}, detected automatically` : name;
}

/** Last path segment, for both / and \ separators. */
export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** ".../models/ggml-base.bin" → "base". */
export function whisperModelName(path: string): string {
  return fileName(path)
    .replace(/^ggml-/, "")
    .replace(/\.bin$/, "");
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}
