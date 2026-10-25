# VoxClean

Desktop app: record or upload audio → transcribe locally with Whisper → clean up or summarize locally with Ollama. The PRD in `.claude/rules/prd.md` is the source of truth for scope. Setup steps are in `README.md`.

The UI follows the "VoxClean App Design" canvas (https://claude.ai/artifact/L74EhiX4QaP9Ysq3CPuKCb): one artboard per screen plus "Errors and edge states". Its colors live as Tailwind theme tokens in `src/index.css` (`bg-canvas`, `text-muted`, `bg-record`, …); use those, not raw hex values.

## Non-negotiables (from the PRD)

- **Nothing leaves the machine.** The only network peer is Ollama on loopback. Three layers enforce it: `config::parse_local_url` rejects non-loopback URLs, `reqwest` is built without TLS, and the production CSP only allows IPC. Never add cloud APIs, telemetry, CDN scripts or remote fonts (fonts are bundled from `@fontsource`).
- **No persistence by default.** Recordings and transcripts live in memory only. Audio stays in the Rust process; the frontend only sees metadata (`AudioClip`).
- **Clean mode must not change meaning.** The prompts in `src-tauri/src/llm/prompts.rs` encode this, and the Result screen marks every removed word and flags any word the model added. Treat prompt edits as behavior changes.
- **Errors are user-facing.** Every command fails with `AppError { code, message }`; write `message` for end users and add a stable `code` for anything the UI needs to branch on. Error copy per code lives in `src/lib/errorContent.ts`.

## Architecture

The frontend (`src/`, React 19 + TypeScript + Tailwind v4) owns UI and workflow state. The backend (`src-tauri/src/`, Rust + Tauri 2) owns audio, models and all I/O.

| Path                        | Role                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/ipc.ts`            | The only module touching Tauri APIs (commands, events, dialog, clipboard, drag and drop). Every failure becomes an `AppError`.   |
| `src/lib/workflow.ts`       | Reducer with one state per screen: `idle → recording → ready → transcribing → transcript → result`. Pure and unit-tested.        |
| `src/hooks/useVoxClean.ts`  | Turns screen actions into IPC calls and reducer events. The backend call runs first; the state moves only when it succeeds.      |
| `src/screens/`              | One component per design artboard. Screens get data and callbacks as props and never call IPC for the workflow themselves.       |
| `src/components/`           | Shared UI: `ui.tsx` (buttons, progress, bar graph, segment list), `ErrorCard`, `AppChrome` (header steps + model-status footer). |
| `src/lib/diff.ts`           | Word-level Myers diff behind the strike-through removals and the "words that weren't in your recording" check.                   |
| `src/dev/`, `preview.html`  | Dev only: the app in a browser against a fake backend (see Commands). Not in the production build.                               |
| `src-tauri/src/commands.rs` | Thin `#[tauri::command]` handlers.                                                                                               |
| `src-tauri/src/config.rs`   | `Settings` (defaults plus `VOXCLEAN_*` env overrides) and the loopback check.                                                    |
| `src-tauri/src/llm/`        | `ollama.rs` (generate, list models, pull with progress) and `prompts.rs` (Clean / Summarize prompts, `Mode`).                    |

### Backend commands

Every command the UI calls is built: `system_status`, `process_text(text, mode)`, `pull_model` (emits `model-pull-progress`), the dialog and clipboard plugins, and these:

| Command / event                              | Returns / payload                                                                                       | Errors                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `list_input_devices`                         | `InputDevice[]` (`{ id, name, isDefault }`), default first                                              | `microphone_unavailable`                                     |
| `start_recording(device_id: Option<String>)` | `()`; once recording runs, the previous clip is dropped                                                 | `microphone_unavailable`                                     |
| `pause_recording`, `resume_recording`        | `()`                                                                                                    | `not_recording`, `microphone_unavailable`                    |
| `stop_recording`                             | `AudioClip` (`{ durationMs, peaks: [0–1; 72] }`); keeps the audio                                       | `not_recording`, `microphone_unavailable`                    |
| `discard_recording`                          | `()`; drops the recording in progress and the kept audio                                                |                                                              |
| `load_audio_file(path)`                      | `AudioClip`; keeps the audio                                                                            | `unsupported_format`, `file_unreadable` (both name the file) |
| `transcribe(language: Option<String>)`       | `Transcript` (`{ segments: [{ startMs, endMs, text }], language, languageDetected }`) of the kept audio | `no_audio`, `no_speech`, `cancelled`, `transcription_error`  |
| `cancel_transcription`                       | `()`; the pending `transcribe` rejects `cancelled`                                                      |                                                              |
| event `recording-level`                      | `f32` 0–1, every 100 ms while recording and not paused                                                  |                                                              |
| event `transcription-progress`               | `f32` 0–1                                                                                               |                                                              |

Audio (`src-tauri/src/audio/`):

- `capture.rs` records with `cpal`, `decode.rs` reads WAV, MP3, M4A (AAC/ALAC), FLAC and OGG Vorbis with `symphonia`, and `resample.rs` converts to 16 kHz with `rubato`. Recording happens in Rust rather than through `getUserMedia`, because WebKitGTK media capture on Linux is unreliable and its WebM/Opus output would need another decoder.
- Audio is held as `Audio` (16 kHz mono f32) in `AppState::audio()`: `AudioSession { recorder, clip }`, where `clip` is what `transcribe` reads. The UI calls `discard_recording` on Remove and Start over, so audio the UI can't reach isn't kept.
- cpal uses its PulseAudio host, which PipeWire's pulse server also serves, and falls back to ALSA. Capture asks for 20 ms buffers because PulseAudio's default buffer delays the first audio by about 2 s and starves the level meter. A 40 Hz DC filter removes the slowly fading offset some built-in mics start with.
- Decoding, resampling and transcribing run on blocking threads (`off_runtime` in `commands.rs`). Never hold the `audio()` guard across an `.await`.

Transcription (`src-tauri/src/transcription/`):

- `whisper-rs` (whisper.cpp; building it needs cmake and libclang). `Transcriber` keeps the model loaded after the first use (about 2 s to load) and holds the cancel flag of the running job; a new transcription cancels the one before.
- Beam search with 5 beams on at most 4 threads, both whisper.cpp's defaults. Whisper's encoder always works on a 30-second window, so any clip under 30 s takes about the same time: about 5 s on an i7-8665U laptop.
- Silent audio fails with `no_speech` before reaching Whisper, which otherwise makes up text such as "Thank you.". Segments that are only notes like `[BLANK_AUDIO]` or `(music)` are dropped.
- English-only models (`.en`) are always run in English.
- whisper-rs 0.16's `set_abort_callback_safe` reads its closure back as the wrong type, so a plain closure makes whisper.cpp abort at random ("Error code: -6"). Keep passing a `Box<dyn FnMut() -> bool>`, and recheck when upgrading whisper-rs.

Tests: the `commands.rs` tests call commands through Tauri's mock IPC (`tauri::test`), which checks argument names against what `ipc.ts` sends. Three tests need hardware or the model and are ignored by default: `cargo test -- --ignored records_from_the_default_microphone` needs a microphone, and `cargo test -- --ignored transcribes_` runs the installed model on Ubuntu's `/usr/share/sounds/alsa/Front_Center.wav`, directly and through IPC.

Not built yet: clip playback on the "Ready to transcribe" screen, which is in the design; it would play `AudioSession::clip`.

### Adding a command

1. Implement the logic in a backend module, returning `AppResult<T>`.
2. Add a thin handler in `commands.rs` and register it in `lib.rs` (`generate_handler!`).
3. Add the typed wrapper to `src/lib/ipc.ts`. Keep Rust and TS types in sync: Rust structs use `#[serde(rename_all = "camelCase")]`, and Tauri maps camelCase JS arguments to snake_case Rust parameters.
4. New error variants need a `code` in `error.rs`, in `AppErrorCode`, and copy in `errorContent.ts` if the generic card isn't enough.
5. Add it to `src/dev/mockBackend.ts` so the browser preview keeps working.

## Visual fidelity

UI changes go through the `visual-fidelity` skill (`.claude/skills/visual-fidelity/SKILL.md`): score, find the cause, look at it live, rate, fix, repeat. Done means `npm run visual` passes and the rubric is ≥ 4/5.

- `design/artboards/` holds the canvas's artboards verbatim, and `design/reference/` their rendered PNGs. Don't edit either to make a score pass.
- `design/screens.json` maps each screen to its artboard, its preview URL (`preview.html?screen=<name>`, fixtures in `src/dev/fixtures.ts`) and its thresholds.
- `design/deviations.md` lists the accepted differences. Any screen with a lowered threshold says why.
- The `visual-reviewer` agent gives an independent rating without editing anything.

## Commands

```sh
npm run tauri dev          # run the app (Vite on :1420 + Rust)
npm run dev                # browser only; open http://localhost:1420/preview.html (?screen=<name>, ?setup)
npm run check              # typecheck, lint, format check, frontend tests
npm run check:rust         # rustfmt, clippy, Rust tests
npm run visual             # score every screen against the design (.visual/report.md)
npm run visual:inspect -- <screen>   # element-by-element differences in px
npm run visual:references  # re-render design/reference after updating the artboards
npm test                   # frontend tests only (Vitest)
npm run format             # Prettier
```

## Conventions

- Frontend tests sit next to the code (`*.test.ts[x]`). `App.test.tsx` mocks `./lib/ipc` and drives the real app; `ipc.test.ts` mocks `@tauri-apps/api/core`.
- Use real `<button>`/`<label>` elements, keep touch targets ≥ 44px, and pair icons with visible text or an `aria-label`, as in the design. The exception is the footer's "Manage models", at 40px so the footer stays the design's height.
- Size elements to how the artboard renders, not to its declared CSS. The artboards use `line-height: normal` and content-box sizing; the app uses border-box (see the visual-fidelity skill).
- Rust unit tests go in a `#[cfg(test)] mod tests` at the bottom of each file.
- Keep `commands.rs` free of logic; anything worth testing belongs in a module.
