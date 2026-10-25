use serde::ser::{Serialize, SerializeStruct, Serializer};

/// Every command returns this error type. It reaches the frontend as
/// `{ code, message }`, where `message` is written for the user (PRD §6:
/// processing errors must be communicated clearly).
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Ollama is not reachable at {url}. Make sure Ollama is running (`ollama serve`).")]
    OllamaUnavailable { url: String },

    #[error("The model \"{model}\" is not installed in Ollama. Run `ollama pull {model}`.")]
    ModelNotInstalled { model: String },

    #[error("Ollama returned an error: {0}")]
    Ollama(String),

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("There is no text to process.")]
    EmptyInput,

    #[error("{reason}")]
    MicrophoneUnavailable { reason: String },

    #[error(
        "“{file}” isn't a format VoxClean can read. Use a WAV, MP3, M4A, FLAC or OGG file instead."
    )]
    UnsupportedFormat { file: String },

    #[error("Couldn't open “{file}”: {reason}.")]
    FileUnreadable { file: String, reason: String },

    #[error("No recording is in progress.")]
    NotRecording,

    #[error("Audio processing failed: {0}")]
    Audio(String),

    #[error("There's no audio to transcribe. Record or upload audio first.")]
    NoAudio,

    #[error("No speech was found in this audio.")]
    NoSpeech,

    #[error("Transcription was cancelled.")]
    Cancelled,

    #[error("Transcription failed: {0}.")]
    Transcription(String),
}

impl AppError {
    /// Stable identifier the frontend can branch on. Mirrored by
    /// `AppErrorCode` in `src/lib/errors.ts`.
    pub fn code(&self) -> &'static str {
        match self {
            Self::OllamaUnavailable { .. } => "ollama_unavailable",
            Self::ModelNotInstalled { .. } => "model_not_installed",
            Self::Ollama(_) => "ollama_error",
            Self::Config(_) => "config_error",
            Self::EmptyInput => "empty_input",
            Self::MicrophoneUnavailable { .. } => "microphone_unavailable",
            Self::UnsupportedFormat { .. } => "unsupported_format",
            Self::FileUnreadable { .. } => "file_unreadable",
            Self::NotRecording => "not_recording",
            Self::Audio(_) => "audio_error",
            Self::NoAudio => "no_audio",
            Self::NoSpeech => "no_speech",
            Self::Cancelled => "cancelled",
            Self::Transcription(_) => "transcription_error",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_as_code_and_message() {
        let json = serde_json::to_value(AppError::ModelNotInstalled {
            model: "gemma3:4b".into(),
        })
        .unwrap();
        assert_eq!(json["code"], "model_not_installed");
        assert_eq!(
            json["message"],
            "The model \"gemma3:4b\" is not installed in Ollama. Run `ollama pull gemma3:4b`."
        );
    }
}
