import { describe, expect, it } from "vitest";
import type { AppError } from "./errors";
import type { AudioClip, Transcript } from "./ipc";
import {
  currentStep,
  initialState,
  recordingElapsedMs,
  transcriptText,
  workflowReducer,
  type WorkflowEvent,
  type WorkflowState,
} from "./workflow";

const run = (events: WorkflowEvent[], from: WorkflowState = initialState) =>
  events.reduce(workflowReducer, from);

const clip: AudioClip = { durationMs: 42_000, peaks: [0.2, 0.8] };
const transcript: Transcript = {
  segments: [
    { startMs: 0, endMs: 7_000, text: " Um, the launch date is moving. " },
    { startMs: 7_000, endMs: 12_000, text: "It's moving to March." },
  ],
  language: "en",
  languageDetected: true,
};
const ollamaDown: AppError = {
  code: "ollama_unavailable",
  message: "Ollama is not reachable.",
};
const loadFile: WorkflowEvent = {
  type: "fileLoaded",
  path: "/tmp/memo.wav",
  name: "memo.wav",
  clip,
};
const toTranscript: WorkflowEvent[] = [
  loadFile,
  { type: "transcriptionStarted" },
  { type: "transcriptionSucceeded", transcript },
];

describe("workflowReducer", () => {
  it("walks the PRD flow from recording to an edited result", () => {
    const state = run([
      { type: "recordingStarted", at: 1_000, deviceName: "USB headset" },
      { type: "recordingStopped", clip },
      { type: "transcriptionStarted" },
      { type: "transcriptionProgressed", progress: 0.5 },
      { type: "transcriptionSucceeded", transcript },
      { type: "processingStarted", mode: "clean" },
      { type: "processingSucceeded", mode: "clean", text: "The launch." },
      { type: "resultEdited", mode: "clean", text: "The launch moves." },
    ]);

    expect(state).toEqual({
      status: "result",
      source: {
        kind: "recording",
        recordedAt: 1_000,
        deviceName: "USB headset",
        clip,
      },
      transcript,
      mode: "clean",
      results: {
        clean: {
          status: "done",
          generated: "The launch.",
          text: "The launch moves.",
        },
      },
    });
  });

  it("excludes paused time from the recording duration", () => {
    const state = run([
      { type: "recordingStarted", at: 0, deviceName: "Mic" },
      { type: "recordingPaused", at: 10_000 },
      { type: "recordingResumed", at: 25_000 },
    ]);
    if (state.status !== "recording") throw new Error(state.status);
    expect(recordingElapsedMs(state, 30_000)).toBe(15_000);

    const paused = workflowReducer(state, {
      type: "recordingPaused",
      at: 30_000,
    });
    if (paused.status !== "recording") throw new Error(paused.status);
    expect(recordingElapsedMs(paused, 99_000)).toBe(15_000);
  });

  it("keeps the clip and shows the error when transcription fails", () => {
    const state = run([
      loadFile,
      { type: "transcriptionStarted" },
      { type: "transcriptionFailed", error: ollamaDown },
    ]);
    expect(state).toMatchObject({
      status: "ready",
      source: { kind: "file", name: "memo.wav" },
      error: ollamaDown,
    });
  });

  it("returns to the clip without an error when transcription is cancelled", () => {
    const state = run([
      loadFile,
      { type: "transcriptionStarted" },
      { type: "transcriptionCancelled" },
      // A result that arrives after cancelling is dropped.
      { type: "transcriptionSucceeded", transcript },
    ]);
    expect(state).toEqual({
      status: "ready",
      source: expect.objectContaining({ name: "memo.wav" }),
    });
  });

  it("records audio failures where they happened", () => {
    expect(run([{ type: "audioFailed", error: ollamaDown }])).toEqual({
      status: "idle",
      error: ollamaDown,
    });
    expect(
      run([loadFile, { type: "audioFailed", error: ollamaDown }]),
    ).toMatchObject({
      status: "ready",
      error: ollamaDown,
    });
  });

  it("keeps both modes' results and switches between them", () => {
    const state = run([
      ...toTranscript,
      { type: "processingStarted", mode: "clean" },
      { type: "processingSucceeded", mode: "clean", text: "Clean." },
      { type: "processingStarted", mode: "summarize" },
      { type: "processingSucceeded", mode: "summarize", text: "- Point" },
      { type: "modeSelected", mode: "clean" },
    ]);
    expect(state).toMatchObject({
      status: "result",
      mode: "clean",
      results: {
        clean: { status: "done", text: "Clean." },
        summarize: { status: "done", text: "- Point" },
      },
    });
  });

  it("records a failed mode and retries it", () => {
    const failed = run([
      ...toTranscript,
      { type: "processingStarted", mode: "summarize" },
      { type: "processingFailed", mode: "summarize", error: ollamaDown },
    ]);
    expect(failed).toMatchObject({
      results: { summarize: { status: "failed", error: ollamaDown } },
    });
    expect(
      workflowReducer(failed, { type: "processingStarted", mode: "summarize" }),
    ).toMatchObject({ results: { summarize: { status: "pending" } } });
  });

  it("restores the generated text after edits", () => {
    const state = run([
      ...toTranscript,
      { type: "processingStarted", mode: "clean" },
      { type: "processingSucceeded", mode: "clean", text: "Generated." },
      { type: "resultEdited", mode: "clean", text: "Mine." },
      { type: "resultRestored", mode: "clean" },
    ]);
    expect(state).toMatchObject({
      results: { clean: { generated: "Generated.", text: "Generated." } },
    });
  });

  it("goes back to the transcript without losing results", () => {
    const state = run([
      ...toTranscript,
      { type: "processingStarted", mode: "clean" },
      { type: "backToTranscript" },
      // A result that lands while the transcript is showing is still kept.
      { type: "processingSucceeded", mode: "clean", text: "Clean." },
    ]);
    expect(state).toMatchObject({
      status: "transcript",
      results: { clean: { status: "done", text: "Clean." } },
    });
  });

  it("ignores events that do not apply to the current state", () => {
    expect(
      workflowReducer(initialState, {
        type: "processingSucceeded",
        mode: "clean",
        text: "x",
      }),
    ).toBe(initialState);

    const transcribing = run([loadFile, { type: "transcriptionStarted" }]);
    expect(workflowReducer(transcribing, loadFile)).toBe(transcribing);
    expect(workflowReducer(transcribing, { type: "reset" })).toBe(transcribing);

    const recording = run([
      { type: "recordingStarted", at: 0, deviceName: "Mic" },
    ]);
    expect(workflowReducer(recording, { type: "reset" })).toBe(recording);
  });
});

describe("helpers", () => {
  it("maps states to header steps", () => {
    expect(currentStep(initialState)).toBe(1);
    expect(currentStep(run([loadFile, { type: "transcriptionStarted" }]))).toBe(
      2,
    );
    expect(
      currentStep(
        run([...toTranscript, { type: "modeSelected", mode: "clean" }]),
      ),
    ).toBe(3);
  });

  it("joins transcript segments into plain text", () => {
    expect(transcriptText(transcript)).toBe(
      "Um, the launch date is moving. It's moving to March.",
    );
  });
});
