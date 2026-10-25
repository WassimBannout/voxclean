import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { AudioClip, SystemStatus } from "../lib/ipc";
import {
  CLEAN,
  CLIP_PEAKS,
  DEVICES,
  RECORDING_LEVELS,
  SUMMARY,
  TRANSCRIPT,
} from "./sampleData";

// A stand-in for the Rust backend, so the UI can be worked on in a browser
// before the audio and Whisper commands exist. URL parameters:
//   ?setup        start with the language model missing
//   ?hold=64      stop the model download at 64% (for screenshots)
//   ?screen=name  open a screen directly (see fixtures.ts)

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

export function installMockBackend(params: URLSearchParams) {
  const screen = params.get("screen");
  const holdAt = Number(params.get("hold")) || 100;
  const status: SystemStatus = {
    ollama: {
      url: "http://127.0.0.1:11434/",
      model: "gemma3:4b",
      reachable: true,
      modelInstalled: !(params.has("setup") || screen === "setup"),
    },
    whisper: {
      modelPath:
        "/home/you/.local/share/com.voxclean.desktop/models/ggml-base.bin",
      modelFound: true,
    },
  };

  let levelTimer: number | undefined;
  let recordedMs = 0;
  let resumedAt = 0;
  let cancelled = false;

  const startLevels = () => {
    resumedAt = Date.now();
    levelTimer = window.setInterval(
      () => void emit("recording-level", 0.15 + Math.random() * 0.8),
      120,
    );
  };
  const stopLevels = () => {
    window.clearInterval(levelTimer);
    recordedMs += Date.now() - resumedAt;
  };

  // The recording fixture is already "live": replay the artboard's meter once.
  if (screen === "recording") {
    window.setTimeout(async () => {
      for (const level of RECORDING_LEVELS)
        await emit("recording-level", level);
    }, 300);
  }

  mockWindows("main");
  mockIPC(
    async (cmd, payload) => {
      const args = (payload ?? {}) as Record<string, unknown>;
      switch (cmd) {
        case "system_status":
          return structuredClone(status);

        case "process_text":
          await sleep(1500);
          return args.mode === "summarize" ? SUMMARY : CLEAN;

        case "pull_model": {
          const total = 3_338_801_804;
          for (let step = 1; step <= 20; step++) {
            await sleep(150);
            const percent = Math.min(step * 5, holdAt);
            await emit("model-pull-progress", {
              status: "pulling a2af6cc3eb7f",
              completed: (total * percent) / 100,
              total,
            });
            if (percent === holdAt && holdAt < 100) await new Promise(() => {});
          }
          status.ollama.modelInstalled = true;
          return null;
        }

        case "list_input_devices":
          return DEVICES;

        case "start_recording":
          recordedMs = 0;
          startLevels();
          return null;

        case "pause_recording":
          stopLevels();
          return null;

        case "resume_recording":
          startLevels();
          return null;

        case "stop_recording":
          stopLevels();
          return {
            durationMs: recordedMs,
            peaks: CLIP_PEAKS,
          } satisfies AudioClip;

        case "discard_recording":
          stopLevels();
          return null;

        case "load_audio_file": {
          const path = String(args.path);
          if (!/\.(wav|mp3|m4a|flac|ogg)$/i.test(path)) {
            throw {
              code: "unsupported_format",
              message: `“${path.split("/").pop()}” isn't a format VoxClean can read. Use a WAV, MP3, M4A, FLAC or OGG file instead.`,
            };
          }
          return { durationMs: 42_000, peaks: CLIP_PEAKS } satisfies AudioClip;
        }

        case "transcribe":
          cancelled = false;
          for (let step = 1; step <= 25; step++) {
            await sleep(100);
            if (cancelled)
              throw { code: "cancelled", message: "Transcription cancelled." };
            await emit("transcription-progress", step / 25);
          }
          return TRANSCRIPT;

        case "cancel_transcription":
          cancelled = true;
          return null;

        case "plugin:dialog|open":
          return "/home/you/Recordings/team-update.m4a";

        case "plugin:clipboard-manager|write_text":
          return null;

        default:
          throw `Command ${cmd} not found`;
      }
    },
    { shouldMockEvents: true },
  );
}
