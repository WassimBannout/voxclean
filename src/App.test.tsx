import { render, screen, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import * as ipc from "./lib/ipc";

vi.mock("./lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof ipc>();
  const subscribed = async () => () => {};
  return {
    ...actual,
    getSystemStatus: vi.fn(),
    processText: vi.fn(),
    pullModel: vi.fn(),
    onModelPullProgress: vi.fn(subscribed),
    listInputDevices: vi.fn(async () => []),
    startRecording: vi.fn(),
    pauseRecording: vi.fn(),
    resumeRecording: vi.fn(),
    stopRecording: vi.fn(),
    discardRecording: vi.fn(),
    loadAudioFile: vi.fn(),
    transcribe: vi.fn(),
    cancelTranscription: vi.fn(),
    onRecordingLevel: vi.fn(subscribed),
    onTranscriptionProgress: vi.fn(subscribed),
    pickAudioFile: vi.fn(),
    onFileDrop: vi.fn(subscribed),
    copyText: vi.fn(),
  };
});

const ready: ipc.SystemStatus = {
  ollama: {
    url: "http://127.0.0.1:11434/",
    model: "gemma3:4b",
    reachable: true,
    modelInstalled: true,
  },
  whisper: { modelPath: "/data/models/ggml-base.bin", modelFound: true },
};

const transcript: ipc.Transcript = {
  segments: [
    {
      startMs: 0,
      endMs: 5_000,
      text: "Um, so the launch date is, uh, moving.",
    },
    { startMs: 5_000, endMs: 9_000, text: "We tell the team on Monday." },
  ],
  language: "en",
  languageDetected: true,
};
const ORIGINAL =
  "Um, so the launch date is, uh, moving. We tell the team on Monday.";
const CLEANED = "The launch date is moving. We tell the team on Monday.";

async function openTranscript(user: UserEvent) {
  vi.mocked(ipc.pickAudioFile).mockResolvedValue("/home/me/memo.wav");
  vi.mocked(ipc.loadAudioFile).mockResolvedValue({
    durationMs: 9_000,
    peaks: [0.3, 0.6],
  });
  vi.mocked(ipc.transcribe).mockResolvedValue(transcript);

  render(<App />);
  await user.click(await screen.findByRole("button", { name: "Choose file" }));
  expect(
    await screen.findByRole("heading", { name: "Ready to transcribe" }),
  ).toBeInTheDocument();
  expect(screen.getByText("memo.wav")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Transcribe" }));
  expect(
    await screen.findByRole("heading", { name: "Original transcript" }),
  ).toBeInTheDocument();
  expect(ipc.transcribe).toHaveBeenCalledWith(null);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ipc.getSystemStatus).mockResolvedValue(ready);
});

describe("App", () => {
  it("opens setup on first run while Ollama isn't running", async () => {
    vi.mocked(ipc.getSystemStatus).mockResolvedValue({
      ...ready,
      ollama: { ...ready.ollama, reachable: false, modelInstalled: false },
    });
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Set up local models" }),
    ).toBeInTheDocument();
    expect(screen.getByText("ollama serve")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("downloads a missing language model from setup", async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.getSystemStatus)
      .mockResolvedValueOnce({
        ...ready,
        ollama: { ...ready.ollama, modelInstalled: false },
      })
      .mockResolvedValue(ready);
    vi.mocked(ipc.pullModel).mockResolvedValue();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Download" }));
    expect(ipc.pullModel).toHaveBeenCalled();
    const next = await screen.findByRole("button", { name: "Continue" });
    expect(next).toBeEnabled();

    await user.click(next);
    expect(
      await screen.findByRole("heading", {
        name: "Turn speech into clean text",
      }),
    ).toBeInTheDocument();
  });

  it("cleans up an uploaded file, marks removals, and copies the edited result", async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.processText).mockResolvedValue(CLEANED);
    vi.mocked(ipc.copyText).mockResolvedValue();
    await openTranscript(user);

    await user.click(screen.getByRole("button", { name: /Clean transcript/ }));
    const editor = await screen.findByRole("textbox", {
      name: /Clean transcript/,
    });
    expect(ipc.processText).toHaveBeenCalledWith(ORIGINAL, "clean");
    expect(editor).toHaveValue(CLEANED);

    const original = screen.getByRole("region", {
      name: "Original transcript",
    });
    const struck = [...original.querySelectorAll("li del")].map(
      (el) => el.textContent,
    );
    expect(struck).toEqual(["Um, so", "uh,"]);
    expect(within(original).getByText(/3 words/)).toBeInTheDocument();

    await user.type(editor, " Thanks.");
    await user.click(screen.getByRole("button", { name: "Restore" }));
    expect(editor).toHaveValue(CLEANED);

    await user.click(screen.getByRole("button", { name: "Copy text" }));
    expect(ipc.copyText).toHaveBeenCalledWith(CLEANED);
    expect(
      await screen.findByRole("button", { name: "Copied" }),
    ).toBeInTheDocument();
  });

  it("shows how to start Ollama when cleanup fails, and retries", async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.processText)
      .mockRejectedValueOnce({
        code: "ollama_unavailable",
        message: "Ollama is not reachable.",
      })
      .mockResolvedValueOnce(CLEANED);
    await openTranscript(user);

    await user.click(screen.getByRole("button", { name: /Clean transcript/ }));
    expect(
      await screen.findByRole("heading", { name: "Ollama isn't running" }),
    ).toBeInTheDocument();
    expect(screen.getByText("ollama serve")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("textbox", { name: /Clean transcript/ }),
    ).toHaveValue(CLEANED);
  });

  it("keeps the clean result when switching to the summary and back", async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.processText).mockImplementation(async (_text, mode) =>
      mode === "clean" ? CLEANED : "- The launch date is moving.",
    );
    await openTranscript(user);

    await user.click(screen.getByRole("button", { name: /Summarize/ }));
    expect(await screen.findByRole("textbox", { name: /Summary/ })).toHaveValue(
      "- The launch date is moving.",
    );

    await user.click(screen.getByRole("button", { name: "Clean transcript" }));
    await screen.findByRole("textbox", { name: /Clean transcript/ });
    await user.click(screen.getByRole("button", { name: "Summary" }));
    expect(await screen.findByRole("textbox", { name: /Summary/ })).toHaveValue(
      "- The launch date is moving.",
    );
    expect(ipc.processText).toHaveBeenCalledTimes(2);
  });

  it("records, pauses and stops into the ready screen", async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.startRecording).mockResolvedValue();
    vi.mocked(ipc.pauseRecording).mockResolvedValue();
    vi.mocked(ipc.stopRecording).mockResolvedValue({
      durationMs: 42_000,
      peaks: [],
    });
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Start recording" }),
    );
    expect(ipc.startRecording).toHaveBeenCalledWith(null);
    expect(screen.getByRole("timer")).toHaveTextContent("00:00");

    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByRole("heading", { name: "Paused" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(
      await screen.findByRole("heading", { name: "Ready to transcribe" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Recording, /)).toBeInTheDocument();
    expect(screen.getByText("0:42")).toBeInTheDocument();
  });

  it("drops the backend's audio when the clip is removed", async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.pickAudioFile).mockResolvedValue("/home/me/memo.wav");
    vi.mocked(ipc.loadAudioFile).mockResolvedValue({
      durationMs: 9_000,
      peaks: [0.3, 0.6],
    });
    vi.mocked(ipc.discardRecording).mockResolvedValue();
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Choose file" }),
    );
    await user.click(await screen.findByRole("button", { name: "Remove" }));
    expect(
      await screen.findByRole("heading", {
        name: "Turn speech into clean text",
      }),
    ).toBeInTheDocument();
    expect(ipc.discardRecording).toHaveBeenCalledOnce();
  });

  it("drops the backend's audio when starting over", async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.discardRecording).mockResolvedValue();
    await openTranscript(user);

    await user.click(
      screen.getByRole("button", { name: "Start over with new audio" }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Turn speech into clean text",
      }),
    ).toBeInTheDocument();
    expect(ipc.discardRecording).toHaveBeenCalledOnce();
  });

  it("reports a backend command that isn't available yet", async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.pickAudioFile).mockResolvedValue("/home/me/memo.wav");
    vi.mocked(ipc.loadAudioFile).mockRejectedValue(
      "Command load_audio_file not found",
    );
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Choose file" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Something went wrong" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Command load_audio_file not found"),
    ).toBeInTheDocument();
  });
});
