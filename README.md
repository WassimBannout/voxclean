# VoxClean

Turn spoken audio into clean, readable text on your own computer. VoxClean transcribes with Whisper and cleans up or summarizes with Ollama. No accounts and no cloud AI services; audio and text never leave the machine.

## Prerequisites

1. **Rust**:

   ```sh
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. **System libraries** (Ubuntu/Debian; for Tauri on other platforms see <https://tauri.app/start/prerequisites/>):

   ```sh
   sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
     libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev \
     libasound2-dev clang cmake
   ```

   `libasound2-dev` is for microphone recording; `clang` and `cmake` build whisper.cpp, which the first `cargo` build compiles (a few minutes).

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

## Installing

Build a Debian/Ubuntu package and install it (the first build takes several minutes):

```sh
npm run tauri build -- --bundles deb
sudo apt install ./src-tauri/target/release/bundle/deb/VoxClean_0.1.0_amd64.deb
```

VoxClean then appears in your applications. It uses the same models as the development build. Remove it with `sudo apt remove vox-clean`.

whisper.cpp is compiled for the CPU it's built on, so a package built this way may not run on older processors. To build one to share, run `GGML_NATIVE=OFF npm run tauri build -- --bundles deb` after `cargo clean` in `src-tauri`.

## Configuration

| Variable                 | Default                                                    |
| ------------------------ | ---------------------------------------------------------- |
| `VOXCLEAN_OLLAMA_URL`    | `http://127.0.0.1:11434` (must be localhost)               |
| `VOXCLEAN_OLLAMA_MODEL`  | `gemma3:4b`                                                |
| `VOXCLEAN_WHISPER_MODEL` | `~/.local/share/com.voxclean.desktop/models/ggml-base.bin` |
