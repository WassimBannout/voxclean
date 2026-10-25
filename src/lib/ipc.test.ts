import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { processText } from "./ipc";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockInvoke = vi.mocked(invoke);

describe("ipc", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("calls the Rust command with its parameter names", async () => {
    mockInvoke.mockResolvedValue("Hello.");
    await expect(processText("um hello", "clean")).resolves.toBe("Hello.");
    expect(mockInvoke).toHaveBeenCalledWith("process_text", {
      text: "um hello",
      mode: "clean",
    });
  });

  it("rejects with the AppError sent by Rust", async () => {
    const error = {
      code: "ollama_unavailable",
      message: "Ollama is not reachable.",
    };
    mockInvoke.mockRejectedValue(error);
    await expect(processText("hello", "summarize")).rejects.toEqual(error);
  });

  it("wraps any other failure as an unknown AppError", async () => {
    mockInvoke.mockRejectedValue("Command process_text not found");
    await expect(processText("hello", "clean")).rejects.toEqual({
      code: "unknown",
      message: "Command process_text not found",
    });
  });
});
