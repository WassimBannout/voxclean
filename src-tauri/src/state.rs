use crate::config::Settings;
use crate::llm::ollama::OllamaClient;

/// Shared state handed to every command through `tauri::State`.
pub struct AppState {
    pub settings: Settings,
    pub ollama: OllamaClient,
}
