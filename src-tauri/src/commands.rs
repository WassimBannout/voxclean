//! Tauri command handlers. Keep these thin: validate input, call into a
//! module, return its result. Async commands that borrow `State` must return
//! a `Result`, which is why `system_status` does even though it never fails.

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::error::{AppError, AppResult};
use crate::llm::ollama;
use crate::llm::prompts::{self, Mode};
use crate::state::AppState;

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
