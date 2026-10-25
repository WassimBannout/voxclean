mod commands;
mod config;
mod error;
mod llm;
mod state;

use tauri::Manager;

use crate::config::Settings;
use crate::llm::ollama::OllamaClient;
use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let settings = Settings::from_env(&app.path().app_data_dir()?)?;
            let ollama = OllamaClient::new(settings.ollama_url.clone())?;
            app.manage(AppState { settings, ollama });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::system_status,
            commands::process_text,
            commands::pull_model
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
