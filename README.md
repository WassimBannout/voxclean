# VoxClean

Turn spoken audio into clean, readable text on your own computer. VoxClean transcribes with Whisper and cleans up or summarizes with Ollama. No accounts and no cloud AI services; audio and text never leave the machine.

## Prerequisites

1. **Rust**:

   ```sh
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. **Tauri system libraries** (Ubuntu/Debian; other platforms: <https://tauri.app/start/prerequisites/>):

   ```sh
   sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
     libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
   ```

   Microphone recording and Whisper will also need `sudo apt install libasound2-dev clang`.

3. **Node.js 20+** and npm.

4. **Ollama** with a model (the default is `gemma3:4b`):

   ```sh
   ollama pull gemma3:4b
   ```

5. **Whisper model** in the app data directory (the default is the multilingual `ggml-base.bin`):

   ```sh
   mkdir -p ~/.local/share/com.voxclean.desktop/models
   curl -L -o ~/.local/share/com.voxclean.desktop/models/ggml-base.bin \
     https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
   ```

## Development

```sh
npm install
npm run tauri dev
```

If a model is missing, VoxClean opens on a setup screen that checks each one and can download the language model through Ollama.

To work on the UI without Rust, run `npm run dev` and open <http://localhost:1420/preview.html>. It runs the app against a fake backend that uses sample data; add `?setup` to the URL to see the first-run setup.

```sh
npm run check               # typecheck, lint, format check, frontend tests
cd src-tauri && cargo test  # backend tests
```

## Configuration

| Variable                 | Default                                                    |
| ------------------------ | ---------------------------------------------------------- |
| `VOXCLEAN_OLLAMA_URL`    | `http://127.0.0.1:11434` (must be localhost)               |
| `VOXCLEAN_OLLAMA_MODEL`  | `gemma3:4b`                                                |
| `VOXCLEAN_WHISPER_MODEL` | `~/.local/share/com.voxclean.desktop/models/ggml-base.bin` |
