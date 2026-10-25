import { describe, expect, it } from "vitest";
import {
  fileName,
  formatClock,
  formatDuration,
  languageLabel,
  plural,
  recordingTitle,
  whisperModelName,
} from "./format";

describe("format", () => {
  it("formats durations and clocks", () => {
    expect(formatDuration(42_000)).toBe("0:42");
    expect(formatDuration(3_725_000)).toBe("1:02:05");
    expect(formatClock(42_000)).toBe("00:42");
    expect(formatClock(7_999)).toBe("00:07");
    expect(formatClock(3_725_000)).toBe("1:02:05");
    expect(formatClock(-5)).toBe("00:00");
  });

  it("titles recordings by when they started", () => {
    const at = new Date(2026, 9, 25, 14, 32).getTime();
    expect(recordingTitle(at, "en-GB")).toBe("Recording, 25 Oct 14:32");
  });

  it("names the transcript language", () => {
    expect(languageLabel("en", true)).toBe("English, detected automatically");
    expect(languageLabel("fr", false)).toBe("French");
    expect(languageLabel(null, false)).toBe("Unknown language");
  });

  it("reads names from paths", () => {
    expect(fileName("/home/me/voice memo.m4a")).toBe("voice memo.m4a");
    expect(fileName("C:\\Users\\me\\memo.wav")).toBe("memo.wav");
    expect(whisperModelName("/data/models/ggml-base.en.bin")).toBe("base.en");
  });

  it("pluralizes", () => {
    expect(plural(1, "word")).toBe("1 word");
    expect(plural(3, "word")).toBe("3 words");
  });
});
