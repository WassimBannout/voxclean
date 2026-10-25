use std::sync::{Mutex, MutexGuard, PoisonError};

use crate::audio::{Audio, Recorder};
use crate::config::Settings;
use crate::llm::ollama::OllamaClient;

/// Shared state handed to every command through `tauri::State`.
pub struct AppState {
    pub settings: Settings,
    pub ollama: OllamaClient,
    audio: Mutex<AudioSession>,
}

/// The audio VoxClean holds. It lives in memory only and is gone when the
/// app closes (PRD §3.5).
#[derive(Default)]
pub struct AudioSession {
    /// The recording in progress.
    pub recorder: Option<Recorder>,
    /// The audio to transcribe: the last finished recording or loaded file.
    pub clip: Option<Audio>,
}

impl AppState {
    pub fn new(settings: Settings, ollama: OllamaClient) -> Self {
        Self {
            settings,
            ollama,
            audio: Mutex::default(),
        }
    }

    /// Locks the audio session. Don't hold the guard across an `.await`.
    pub fn audio(&self) -> MutexGuard<'_, AudioSession> {
        self.audio.lock().unwrap_or_else(PoisonError::into_inner)
    }
}
