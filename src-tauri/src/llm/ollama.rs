use std::time::Duration;

use reqwest::{Client, Response, StatusCode};
use serde::{Deserialize, Serialize};
use url::Url;

use crate::error::{AppError, AppResult};

/// Minimal client for the Ollama HTTP API. The base URL is validated as
/// loopback by `config::parse_local_url` before it gets here.
pub struct OllamaClient {
    http: Client,
    base_url: Url,
}

#[derive(Deserialize)]
struct TagsResponse {
    models: Vec<ModelEntry>,
}

#[derive(Deserialize)]
struct ModelEntry {
    name: String,
}

#[derive(Serialize)]
struct GenerateRequest<'a> {
    model: &'a str,
    system: &'a str,
    prompt: &'a str,
    stream: bool,
    options: GenerateOptions,
}

#[derive(Serialize)]
struct GenerateOptions {
    temperature: f32,
}

#[derive(Deserialize)]
struct GenerateResponse {
    response: String,
}

#[derive(Deserialize)]
struct ErrorResponse {
    error: String,
}

#[derive(Serialize)]
struct PullRequest<'a> {
    model: &'a str,
    stream: bool,
}

/// One NDJSON line from `/api/pull`. Failures arrive as an `error` line in a
/// 200 response, not as an HTTP error.
#[derive(Deserialize)]
struct PullLine {
    #[serde(default)]
    status: String,
    total: Option<u64>,
    completed: Option<u64>,
    error: Option<String>,
}

/// Download progress, forwarded to the frontend as `model-pull-progress`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullProgress {
    pub status: String,
    pub completed: Option<u64>,
    pub total: Option<u64>,
}

impl OllamaClient {
    pub fn new(base_url: Url) -> AppResult<Self> {
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(3))
            // Long transcripts on CPU-only machines can take minutes.
            .timeout(Duration::from_secs(600))
            .build()
            .map_err(|e| AppError::Ollama(e.to_string()))?;
        Ok(Self { http, base_url })
    }

    /// Names of the installed models, e.g. `["gemma3:4b"]`.
    pub async fn list_models(&self) -> AppResult<Vec<String>> {
        let response = self
            .http
            .get(self.endpoint("api/tags")?)
            .send()
            .await
            .map_err(|e| self.request_error(e))?;
        let tags: TagsResponse = check(response, None)
            .await?
            .json()
            .await
            .map_err(|e| AppError::Ollama(e.to_string()))?;
        Ok(tags.models.into_iter().map(|m| m.name).collect())
    }

    pub async fn generate(&self, model: &str, system: &str, prompt: &str) -> AppResult<String> {
        let body = GenerateRequest {
            model,
            system,
            prompt,
            stream: false,
            // Low temperature: cleanup and summaries should stay close to the source.
            options: GenerateOptions { temperature: 0.2 },
        };
        let response = self
            .http
            .post(self.endpoint("api/generate")?)
            .json(&body)
            .send()
            .await
            .map_err(|e| self.request_error(e))?;
        let generated: GenerateResponse = check(response, Some(model))
            .await?
            .json()
            .await
            .map_err(|e| AppError::Ollama(e.to_string()))?;
        Ok(generated.response)
    }

    /// Downloads `model`. Ollama does the downloading, so VoxClean itself
    /// still only talks to localhost.
    pub async fn pull(
        &self,
        model: &str,
        mut on_progress: impl FnMut(PullProgress),
    ) -> AppResult<()> {
        let response = self
            .http
            .post(self.endpoint("api/pull")?)
            .json(&PullRequest {
                model,
                stream: true,
            })
            // Multi-gigabyte downloads outlast the client's default timeout.
            .timeout(Duration::from_secs(6 * 60 * 60))
            .send()
            .await
            .map_err(|e| self.request_error(e))?;
        let mut response = check(response, None).await?;

        let mut buffer = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|e| self.request_error(e))? {
            buffer.extend_from_slice(&chunk);
            while let Some(end) = buffer.iter().position(|&b| b == b'\n') {
                let line: Vec<u8> = buffer.drain(..=end).collect();
                if let Some(progress) = parse_pull_line(&line)? {
                    on_progress(progress);
                }
            }
        }
        if let Some(progress) = parse_pull_line(&buffer)? {
            on_progress(progress);
        }
        Ok(())
    }

    fn endpoint(&self, path: &str) -> AppResult<Url> {
        self.base_url
            .join(path)
            .map_err(|e| AppError::Config(e.to_string()))
    }

    fn request_error(&self, err: reqwest::Error) -> AppError {
        if err.is_connect() {
            AppError::OllamaUnavailable {
                url: self.base_url.to_string(),
            }
        } else if err.is_timeout() {
            AppError::Ollama("the request timed out".into())
        } else {
            AppError::Ollama(err.to_string())
        }
    }
}

/// Turns a non-2xx response into an `AppError`. Ollama answers 404 when the
/// requested model is not installed.
async fn check(response: Response, model: Option<&str>) -> AppResult<Response> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    if let (Some(model), StatusCode::NOT_FOUND) = (model, status) {
        return Err(AppError::ModelNotInstalled {
            model: model.to_string(),
        });
    }
    let message = response
        .json::<ErrorResponse>()
        .await
        .map(|e| e.error)
        .unwrap_or_else(|_| status.to_string());
    Err(AppError::Ollama(message))
}

fn parse_pull_line(line: &[u8]) -> AppResult<Option<PullProgress>> {
    let line = line.trim_ascii();
    if line.is_empty() {
        return Ok(None);
    }
    let parsed: PullLine =
        serde_json::from_slice(line).map_err(|e| AppError::Ollama(e.to_string()))?;
    if let Some(error) = parsed.error {
        return Err(AppError::Ollama(error));
    }
    Ok(Some(PullProgress {
        status: parsed.status,
        completed: parsed.completed,
        total: parsed.total,
    }))
}

/// Ollama treats a bare model name as its `:latest` tag.
pub fn is_installed(installed: &[String], wanted: &str) -> bool {
    let wanted = if wanted.contains(':') {
        wanted.to_string()
    } else {
        format!("{wanted}:latest")
    };
    installed.contains(&wanted)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_tags_and_implicit_latest() {
        let installed = vec!["gemma3:4b".to_string(), "llama3.2:latest".to_string()];
        assert!(is_installed(&installed, "gemma3:4b"));
        assert!(is_installed(&installed, "llama3.2"));
        assert!(!is_installed(&installed, "gemma3"));
        assert!(!is_installed(&installed, "mistral:7b"));
    }

    /// Needs Ollama running with the default model: `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn cleans_a_transcript_with_local_ollama() {
        use crate::config::{DEFAULT_OLLAMA_MODEL, parse_local_url};
        use crate::llm::prompts::{self, Mode};

        tauri::async_runtime::block_on(async {
            let client =
                OllamaClient::new(parse_local_url("http://127.0.0.1:11434").unwrap()).unwrap();
            let models = client.list_models().await.unwrap();
            assert!(
                is_installed(&models, DEFAULT_OLLAMA_MODEL),
                "pull {DEFAULT_OLLAMA_MODEL} first"
            );

            let transcript = "um so the, the launch date is, uh, moving to March";
            let cleaned = client
                .generate(
                    DEFAULT_OLLAMA_MODEL,
                    prompts::system_prompt(Mode::Clean),
                    &prompts::user_prompt(transcript),
                )
                .await
                .unwrap();
            println!("{cleaned}");
            let lower = cleaned.to_lowercase();
            assert!(
                lower.contains("launch date") && lower.contains("march"),
                "{cleaned}"
            );
            assert!(!lower.contains(" uh"), "{cleaned}");

            let missing = client.generate("no-such-model:1b", "", "hi").await;
            assert!(matches!(missing, Err(AppError::ModelNotInstalled { .. })));
        });
    }

    #[test]
    fn parses_pull_progress_lines() {
        let line = br#"{"status":"pulling 6a0746a1ec1a","digest":"sha256:6a07","total":100,"completed":40}"#;
        assert_eq!(
            parse_pull_line(line).unwrap(),
            Some(PullProgress {
                status: "pulling 6a0746a1ec1a".into(),
                completed: Some(40),
                total: Some(100)
            })
        );
        assert_eq!(parse_pull_line(b"  \n").unwrap(), None);
    }

    #[test]
    fn reports_pull_errors_sent_in_the_stream() {
        let line = br#"{"error":"pull model manifest: file does not exist"}"#;
        assert!(
            matches!(parse_pull_line(line), Err(AppError::Ollama(msg)) if msg.contains("does not exist"))
        );
    }
}
