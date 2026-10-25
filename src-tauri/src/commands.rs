//! Tauri command handlers. Keep these thin: validate input, call into a
//! module, return its result. Async commands that borrow `State` must return
//! a `Result`, which is why `system_status` does even though it never fails.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime, State};

use crate::audio::{self, AudioClip, InputDevice, Recorder};
use crate::error::{AppError, AppResult};
use crate::llm::ollama;
use crate::llm::prompts::{self, Mode};
use crate::state::{AppState, AudioSession};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStatus {
    ollama: OllamaStatus,
    whisper: WhisperStatus,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaStatus {
    url: String,
    model: String,
    reachable: bool,
    model_installed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperStatus {
    model_path: String,
    model_found: bool,
}

/// Reports whether the local models VoxClean depends on are ready.
#[tauri::command]
pub async fn system_status(state: State<'_, AppState>) -> AppResult<SystemStatus> {
    let settings = &state.settings;
    let models = state.ollama.list_models().await;

    Ok(SystemStatus {
        ollama: OllamaStatus {
            url: settings.ollama_url.to_string(),
            model: settings.ollama_model.clone(),
            reachable: models.is_ok(),
            model_installed: models
                .as_deref()
                .is_ok_and(|installed| ollama::is_installed(installed, &settings.ollama_model)),
        },
        whisper: WhisperStatus {
            model_path: settings.whisper_model_path.display().to_string(),
            model_found: settings.whisper_model_path.is_file(),
        },
    })
}

/// Runs Clean Transcript or Summarize on `text` with the configured model.
#[tauri::command]
pub async fn process_text(
    state: State<'_, AppState>,
    text: String,
    mode: Mode,
) -> AppResult<String> {
    let transcript = text.trim();
    if transcript.is_empty() {
        return Err(AppError::EmptyInput);
    }

    let output = state
        .ollama
        .generate(
            &state.settings.ollama_model,
            prompts::system_prompt(mode),
            &prompts::user_prompt(transcript),
        )
        .await?;
    Ok(output.trim().to_string())
}

/// Downloads the configured language model through Ollama, emitting
/// `model-pull-progress` events along the way.
#[tauri::command]
pub async fn pull_model(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    state
        .ollama
        .pull(&state.settings.ollama_model, |progress| {
            // Emitting only fails once the window is gone; the download carries on.
            let _ = app.emit("model-pull-progress", progress);
        })
        .await
}

/// The microphones VoxClean can record from, the system default first.
#[tauri::command]
pub async fn list_input_devices() -> AppResult<Vec<InputDevice>> {
    audio::list_input_devices()
}

/// Starts recording, emitting `recording-level` every 100 ms. Once it's
/// running, the clip from before is dropped.
#[tauri::command]
pub async fn start_recording<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    device_id: Option<String>,
) -> AppResult<()> {
    // Close any earlier recording first; some devices only open once.
    state.audio().recorder = None;
    let recorder = Recorder::start(device_id.as_deref(), move |level| {
        let _ = app.emit("recording-level", level);
    })?;
    let mut audio = state.audio();
    audio.recorder = Some(recorder);
    audio.clip = None;
    Ok(())
}

#[tauri::command]
pub async fn pause_recording(state: State<'_, AppState>) -> AppResult<()> {
    state
        .audio()
        .recorder
        .as_ref()
        .ok_or(AppError::NotRecording)?
        .pause();
    Ok(())
}

#[tauri::command]
pub async fn resume_recording(state: State<'_, AppState>) -> AppResult<()> {
    state
        .audio()
        .recorder
        .as_ref()
        .ok_or(AppError::NotRecording)?
        .resume()
}

/// Stops recording and keeps the audio for transcription.
#[tauri::command]
pub async fn stop_recording(state: State<'_, AppState>) -> AppResult<AudioClip> {
    let recorder = state
        .audio()
        .recorder
        .take()
        .ok_or(AppError::NotRecording)?;
    let (audio, clip) = off_runtime(move || {
        let audio = recorder.finish()?;
        let clip = audio.clip();
        Ok((audio, clip))
    })
    .await?;
    state.audio().clip = Some(audio);
    Ok(clip)
}

/// Drops the recording in progress and the audio held for transcription.
#[tauri::command]
pub async fn discard_recording(state: State<'_, AppState>) -> AppResult<()> {
    *state.audio() = AudioSession::default();
    Ok(())
}

/// Decodes an audio file and keeps it for transcription.
#[tauri::command]
pub async fn load_audio_file(state: State<'_, AppState>, path: PathBuf) -> AppResult<AudioClip> {
    let (audio, clip) = off_runtime(move || {
        let audio = audio::decode_file(&path)?;
        let clip = audio.clip();
        Ok((audio, clip))
    })
    .await?;
    state.audio().clip = Some(audio);
    Ok(clip)
}

/// Runs slow audio work (decoding, resampling) on a blocking thread.
async fn off_runtime<T: Send + 'static>(
    work: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|err| AppError::Audio(err.to_string()))?
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};
    use tauri::ipc::{CallbackFn, InvokeBody};
    use tauri::test::{INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder, mock_context};
    use tauri::webview::InvokeRequest;
    use tauri::{App, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

    use super::*;
    use crate::audio::testing::{temp_path, write_wav};
    use crate::config::Settings;
    use crate::llm::ollama::OllamaClient;

    /// The app with its audio commands, in a mock runtime.
    fn app() -> (App<MockRuntime>, WebviewWindow<MockRuntime>) {
        let settings = Settings::from_env(&temp_path("app-data")).unwrap();
        let ollama = OllamaClient::new(settings.ollama_url.clone()).unwrap();
        let app = mock_builder()
            .manage(AppState::new(settings, ollama))
            .invoke_handler(tauri::generate_handler![
                start_recording,
                stop_recording,
                discard_recording,
                load_audio_file
            ])
            .build(mock_context(tauri::test::noop_assets()))
            .unwrap();
        let window = WebviewWindowBuilder::new(&app, "main", WebviewUrl::default())
            .build()
            .unwrap();
        (app, window)
    }

    /// Calls a command with the arguments `src/lib/ipc.ts` passes.
    fn invoke(window: &WebviewWindow<MockRuntime>, cmd: &str, args: Value) -> Result<Value, Value> {
        let request = InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "tauri://localhost".parse().unwrap(),
            body: InvokeBody::Json(args),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        };
        get_ipc_response(window, request).map(|body| body.deserialize().unwrap())
    }

    #[test]
    fn loads_a_file_and_returns_its_clip() {
        let (_app, window) = app();
        let path = temp_path("ipc.wav");
        write_wav(&path, 16_000, 1, &vec![8_000; 16_000]);

        let clip = invoke(&window, "load_audio_file", json!({ "path": path }));
        std::fs::remove_file(&path).unwrap();

        let clip = clip.unwrap();
        assert_eq!(clip["durationMs"], 1_000);
        assert_eq!(clip["peaks"].as_array().unwrap().len(), 72);
    }

    #[test]
    fn a_missing_file_fails_with_its_name() {
        let (_app, window) = app();
        let err = invoke(
            &window,
            "load_audio_file",
            json!({ "path": temp_path("ipc-gone.m4a") }),
        )
        .unwrap_err();
        assert_eq!(err["code"], "file_unreadable");
        assert!(err["message"].as_str().unwrap().contains("ipc-gone.m4a"));
    }

    #[test]
    fn stopping_needs_a_recording_and_discarding_does_not() {
        let (_app, window) = app();
        let err = invoke(&window, "stop_recording", json!({})).unwrap_err();
        assert_eq!(err["code"], "not_recording");
        assert_eq!(
            invoke(&window, "discard_recording", json!({})),
            Ok(Value::Null)
        );
    }

    #[test]
    fn recording_from_an_unplugged_microphone_fails() {
        let (_app, window) = app();
        let err = invoke(
            &window,
            "start_recording",
            json!({ "deviceId": "unplugged" }),
        )
        .unwrap_err();
        assert_eq!(err["code"], "microphone_unavailable");
        assert_eq!(
            err["message"],
            "The selected microphone is no longer connected."
        );
    }
}
