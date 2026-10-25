import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Transcript } from "../lib/ipc";
import type { Results } from "../lib/workflow";
import { ResultScreen } from "./ResultScreen";

const transcript: Transcript = {
  segments: [{ startMs: 0, endMs: 4_000, text: "um the meeting moved" }],
  language: "en",
  languageDetected: true,
};

function renderResult(results: Results, mode: "clean" | "summarize" = "clean") {
  const props = {
    transcript,
    results,
    mode,
    model: "gemma3:4b",
    onSelectMode: vi.fn(),
    onEdit: vi.fn(),
    onRestore: vi.fn(),
    onRetry: vi.fn(),
    onOpenSetup: vi.fn(),
    onBack: vi.fn(),
    onStartOver: vi.fn(),
  };
  render(<ResultScreen {...props} />);
  return props;
}

const done = (text: string) => ({
  status: "done" as const,
  generated: text,
  text,
});

describe("ResultScreen", () => {
  it("flags words the cleanup added, and can fall back to the original", async () => {
    const user = userEvent.setup();
    const props = renderResult({
      clean: done("The meeting moved to Thursday."),
    });

    expect(
      screen.getByRole("heading", { name: "Review before copying" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/“to”, “Thursday”/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Use original" }));
    expect(props.onEdit).toHaveBeenCalledWith("clean", "um the meeting moved");
  });

  it("doesn't flag a cleanup that only removed and repunctuated", () => {
    renderResult({ clean: done("The meeting moved.") });
    expect(
      screen.queryByRole("heading", { name: "Review before copying" }),
    ).not.toBeInTheDocument();
  });

  it("shows progress while a mode is generating", () => {
    renderResult({ summarize: { status: "pending" } }, "summarize");
    expect(screen.getByText(/Summarizing with/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy text" })).toBeDisabled();
  });

  it("hides the original and switches modes", async () => {
    const user = userEvent.setup();
    const props = renderResult({ clean: done("The meeting moved.") });

    await user.click(screen.getByRole("button", { name: "Hide original" }));
    expect(
      screen.queryByRole("region", { name: "Original transcript" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Summary" }));
    expect(props.onSelectMode).toHaveBeenCalledWith("summarize");
  });

  it("offers the model download when the model is missing", async () => {
    const user = userEvent.setup();
    const props = renderResult({
      clean: {
        status: "failed",
        error: { code: "model_not_installed", message: "Not installed." },
      },
    });

    expect(
      screen.getByRole("heading", { name: "Language model not installed" }),
    ).toBeInTheDocument();
    expect(screen.getByText("ollama pull gemma3:4b")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Download model" }));
    expect(props.onOpenSetup).toHaveBeenCalled();
  });
});
