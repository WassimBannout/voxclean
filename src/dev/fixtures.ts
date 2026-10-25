import type { AudioSource, WorkflowState } from "../lib/workflow";
import { CLEAN, CLIP_PEAKS, SUMMARY, TRANSCRIPT } from "./sampleData";

// Workflow states behind `?screen=<name>` (see design/screens.json), so each
// screen opens straight into the state its design artboard shows.

const DEVICE = "Built-in microphone";

const source: AudioSource = {
  kind: "recording",
  recordedAt: new Date(2026, 9, 25, 14, 32).getTime(),
  deviceName: DEVICE,
  clip: { durationMs: 42_000, peaks: CLIP_PEAKS },
};

const done = (text: string) => ({
  status: "done" as const,
  generated: text,
  text,
});

export function fixtureState(screen: string | null): WorkflowState | undefined {
  switch (screen) {
    case "recording": {
      // 42 seconds in, like the artboard.
      const startedAt = Date.now() - 42_000;
      return {
        status: "recording",
        startedAt,
        deviceName: DEVICE,
        elapsedMs: 0,
        resumedAt: startedAt,
      };
    }
    case "ready":
      return { status: "ready", source };
    case "transcribing":
      return { status: "transcribing", source, progress: 0.62 };
    case "transcript":
      return {
        status: "transcript",
        source,
        transcript: TRANSCRIPT,
        results: {},
      };
    case "result":
    case "result-summary":
      return {
        status: "result",
        source,
        transcript: TRANSCRIPT,
        mode: screen === "result" ? "clean" : "summarize",
        results: { clean: done(CLEAN), summarize: done(SUMMARY) },
      };
    default:
      return undefined;
  }
}
