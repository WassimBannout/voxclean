use std::env;
use std::path::{Path, PathBuf};

use url::{Host, Url};

use crate::error::{AppError, AppResult};

const DEFAULT_OLLAMA_URL: &str = "http://127.0.0.1:11434";
pub(crate) const DEFAULT_OLLAMA_MODEL: &str = "gemma3:4b";
// Multilingual, so the "Spoken language" choice applies.
const DEFAULT_WHISPER_MODEL_FILE: &str = "ggml-base.bin";

/// Runtime settings. Until there is a settings screen, defaults can be
/// overridden with `VOXCLEAN_OLLAMA_URL`, `VOXCLEAN_OLLAMA_MODEL` and
/// `VOXCLEAN_WHISPER_MODEL`.
#[derive(Debug, Clone)]
pub struct Settings {
    pub ollama_url: Url,
    pub ollama_model: String,
    pub whisper_model_path: PathBuf,
}

impl Settings {
    pub fn from_env(app_data_dir: &Path) -> AppResult<Self> {
        let whisper_model_path = env_var("VOXCLEAN_WHISPER_MODEL")
            .map(PathBuf::from)
            .unwrap_or_else(|| app_data_dir.join("models").join(DEFAULT_WHISPER_MODEL_FILE));

        Ok(Self {
            ollama_url: parse_local_url(
                &env_var("VOXCLEAN_OLLAMA_URL").unwrap_or_else(|| DEFAULT_OLLAMA_URL.into()),
            )?,
            ollama_model: env_var("VOXCLEAN_OLLAMA_MODEL")
                .unwrap_or_else(|| DEFAULT_OLLAMA_MODEL.into()),
            whisper_model_path,
        })
    }
}

fn env_var(key: &str) -> Option<String> {
    env::var(key).ok().filter(|value| !value.trim().is_empty())
}

/// Parses the Ollama base URL and rejects anything that is not on this
/// machine, so a misconfiguration can never send transcripts off-device.
pub fn parse_local_url(raw: &str) -> AppResult<Url> {
    let url = Url::parse(raw)
        .map_err(|e| AppError::Config(format!("invalid Ollama URL {raw:?}: {e}")))?;
    let is_loopback = match url.host() {
        Some(Host::Domain(domain)) => domain == "localhost",
        Some(Host::Ipv4(ip)) => ip.is_loopback(),
        Some(Host::Ipv6(ip)) => ip.is_loopback(),
        None => false,
    };
    if url.scheme() != "http" || !is_loopback {
        return Err(AppError::Config(format!(
            "the Ollama URL must be http:// on this computer (localhost), got {raw:?}"
        )));
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_loopback_urls() {
        for raw in [
            "http://127.0.0.1:11434",
            "http://localhost:11434",
            "http://[::1]:11434",
        ] {
            assert!(parse_local_url(raw).is_ok(), "{raw}");
        }
    }

    #[test]
    fn rejects_remote_or_non_http_urls() {
        for raw in [
            "http://192.168.1.10:11434",
            "http://example.com",
            "https://localhost:11434",
            "not a url",
        ] {
            assert!(
                matches!(parse_local_url(raw), Err(AppError::Config(_))),
                "{raw}"
            );
        }
    }
}
