//! Speech to text with whisper.cpp (through whisper-rs), on this computer.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread;

use serde::Serialize;
use whisper_rs::{
    FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters, WhisperError,
};

use crate::audio::Audio;
use crate::error::{AppError, AppResult};

/// Beams to decode with: whisper.cpp's own default. The encoder dominates
/// the run time, so beams cost little and punctuate better than greedy
/// decoding ("Front, center." rather than "Front Center.").
const BEAM_SIZE: i32 = 5;

/// whisper.cpp's own default. On a 4-core, 8-thread laptop, 8 threads were
/// no faster than 4.
const MAX_THREADS: usize = 4;

/// Mirrors `Transcript` in `src/lib/ipc.ts`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    segments: Vec<Segment>,
    /// ISO 639-1 code, e.g. "en".
    language: Option<String>,
    language_detected: bool,
}

/// Mirrors `Segment` in `src/lib/ipc.ts`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Segment {
    start_ms: i64,
    end_ms: i64,
    text: String,
}

/// Keeps the Whisper model loaded between transcriptions and tracks the one
/// running, so it can be cancelled.
#[derive(Default)]
pub struct Transcriber {
    model: Mutex<Option<Arc<Model>>>,
    running: Mutex<Option<Arc<AtomicBool>>>,
}

impl Transcriber {
    /// Marks the start of a transcription, cancelling any before it, and
    /// returns the flag that cancels this one.
    pub fn begin(&self) -> Arc<AtomicBool> {
        let cancelled = Arc::new(AtomicBool::new(false));
        if let Some(previous) = lock(&self.running).replace(Arc::clone(&cancelled)) {
            previous.store(true, Ordering::Relaxed);
        }
        cancelled
    }

    /// Cancels the running transcription, if there is one.
    pub fn cancel(&self) {
        if let Some(running) = lock(&self.running).as_ref() {
            running.store(true, Ordering::Relaxed);
        }
    }

    /// Transcribes `audio` with the model at `model_path` in `language`
    /// (ISO 639-1), or detects the language for `None`. Reports progress
    /// (0–1) and stops early once `cancelled` is set. Takes a while, longer
    /// the first time while the model loads: call it off the async runtime.
    pub fn transcribe(
        &self,
        model_path: &Path,
        audio: &Audio,
        language: Option<&str>,
        on_progress: impl FnMut(f32) + 'static,
        cancelled: &Arc<AtomicBool>,
    ) -> AppResult<Transcript> {
        // Whisper makes up words for silence ("Thank you."), so a silent
        // clip, e.g. from a muted microphone, never reaches it.
        if audio.is_silent() {
            return Err(AppError::NoSpeech);
        }
        let model = self.model(model_path)?;
        if cancelled.load(Ordering::Relaxed) {
            return Err(AppError::Cancelled);
        }
        model.transcribe(audio, language, on_progress, cancelled)
    }

    fn model(&self, path: &Path) -> AppResult<Arc<Model>> {
        let mut model = lock(&self.model);
        match model.as_ref() {
            Some(loaded) if loaded.path == path => Ok(Arc::clone(loaded)),
            _ => {
                let loaded = Arc::new(Model::load(path)?);
                *model = Some(Arc::clone(&loaded));
                Ok(loaded)
            }
        }
    }
}

/// A loaded Whisper model.
struct Model {
    path: PathBuf,
    context: WhisperContext,
}

impl Model {
    fn load(path: &Path) -> AppResult<Self> {
        if !path.is_file() {
            return Err(AppError::Transcription(format!(
                "the speech model isn't installed at {}",
                path.display()
            )));
        }
        // Without a logging backend this keeps whisper.cpp's logs off stderr.
        whisper_rs::install_logging_hooks();
        let context = WhisperContext::new_with_params(path, WhisperContextParameters::default())
            .map_err(|err| {
                AppError::Transcription(format!(
                    "couldn't load the speech model at {} ({err})",
                    path.display()
                ))
            })?;
        Ok(Self {
            path: path.to_path_buf(),
            context,
        })
    }

    fn transcribe(
        &self,
        audio: &Audio,
        language: Option<&str>,
        mut on_progress: impl FnMut(f32) + 'static,
        cancelled: &Arc<AtomicBool>,
    ) -> AppResult<Transcript> {
        // English-only models (".en") can't detect or write other languages.
        let language = if self.context.is_multilingual() {
            language
        } else {
            Some("en")
        };

        let mut params = FullParams::new(SamplingStrategy::BeamSearch {
            beam_size: BEAM_SIZE,
            patience: -1.0,
        });
        params.set_language(language);
        params.set_n_threads(threads());
        // Leave out notes such as "[Music]" where Whisper can.
        params.set_suppress_nst(true);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_progress_callback_safe(move |percent: i32| on_progress(percent as f32 / 100.0));
        // whisper-rs 0.16's `set_abort_callback_safe` stores the closure as a
        // `Box<dyn FnMut>` but reads it back as the closure's own type. With
        // a plain closure whisper.cpp read stray memory and aborted at random
        // ("Error code: -6"); a closure that already is a `Box<dyn FnMut>`
        // makes the two types the same.
        let abort = Arc::clone(cancelled);
        let should_abort: Box<dyn FnMut() -> bool> =
            Box::new(move || abort.load(Ordering::Relaxed));
        params.set_abort_callback_safe(should_abort);

        let mut state = self.context.create_state().map_err(failed)?;
        let result = state.full(params, audio.samples());
        if cancelled.load(Ordering::Relaxed) {
            return Err(AppError::Cancelled);
        }
        result.map_err(failed)?;

        let segments: Vec<Segment> = state
            .as_iter()
            .filter_map(|segment| {
                let text = segment.to_str_lossy().ok()?.trim().to_string();
                // Timestamps come in hundredths of a second.
                (!is_annotation(&text)).then(|| Segment {
                    start_ms: segment.start_timestamp() * 10,
                    end_ms: segment.end_timestamp() * 10,
                    text,
                })
            })
            .collect();
        if segments.is_empty() {
            return Err(AppError::NoSpeech);
        }

        Ok(Transcript {
            segments,
            language: match language {
                Some(code) => Some(code.to_string()),
                None => whisper_rs::get_lang_str(state.full_lang_id_from_state()).map(String::from),
            },
            language_detected: language.is_none(),
        })
    }
}

/// Whether `text` is empty or one of Whisper's notes about what isn't
/// speech, such as "[BLANK_AUDIO]", "(music)" or "*coughs*".
fn is_annotation(text: &str) -> bool {
    text.is_empty()
        || [('[', ']'), ('(', ')'), ('*', '*')]
            .iter()
            .any(|&(open, close)| text.len() > 1 && text.starts_with(open) && text.ends_with(close))
}

fn threads() -> i32 {
    thread::available_parallelism().map_or(4, |n| n.get().min(MAX_THREADS)) as i32
}

fn failed(err: WhisperError) -> AppError {
    AppError::Transcription(err.to_string())
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use std::time::Instant;

    use super::*;

    #[test]
    fn recognizes_whispers_notes_about_non_speech() {
        for note in ["", "[BLANK_AUDIO]", "(music)", "*coughs*", "[ Silence ]"] {
            assert!(is_annotation(note), "{note:?}");
        }
        for speech in ["So, the launch date is moving.", "(", "*", "We [might] go"] {
            assert!(!is_annotation(speech), "{speech:?}");
        }
    }

    #[test]
    fn serializes_like_the_frontend_transcript() {
        let transcript = Transcript {
            segments: vec![Segment {
                start_ms: 0,
                end_ms: 1_440,
                text: "Front, center.".into(),
            }],
            language: Some("en".into()),
            language_detected: true,
        };
        assert_eq!(
            serde_json::to_value(transcript).unwrap(),
            serde_json::json!({
                "segments": [{ "startMs": 0, "endMs": 1440, "text": "Front, center." }],
                "language": "en",
                "languageDetected": true,
            })
        );
    }

    #[test]
    fn a_new_transcription_cancels_the_one_before() {
        let transcriber = Transcriber::default();
        let first = transcriber.begin();
        let second = transcriber.begin();
        assert!(first.load(Ordering::Relaxed));
        assert!(!second.load(Ordering::Relaxed));
        transcriber.cancel();
        assert!(second.load(Ordering::Relaxed));
    }

    #[test]
    fn silence_is_no_speech_without_loading_a_model() {
        let silence = Audio::from_mono(vec![0.0; 32_000], 16_000).unwrap();
        let err = Transcriber::default()
            .transcribe(
                Path::new("/nonexistent/ggml-base.bin"),
                &silence,
                None,
                |_| {},
                &Arc::default(),
            )
            .err();
        assert_eq!(err.map(|err| err.code()), Some("no_speech"));
    }

    #[test]
    fn a_missing_model_says_where_it_looked() {
        let tone = Audio::from_mono(vec![0.5; 32_000], 16_000).unwrap();
        let err = Transcriber::default()
            .transcribe(
                Path::new("/nonexistent/ggml-base.bin"),
                &tone,
                None,
                |_| {},
                &Arc::default(),
            )
            .err()
            .unwrap();
        assert_eq!(err.code(), "transcription_error");
        assert!(err.to_string().contains("/nonexistent/ggml-base.bin"));
    }

    fn installed_model() -> PathBuf {
        std::env::var_os("VOXCLEAN_WHISPER_MODEL").map_or_else(
            || {
                PathBuf::from(std::env::var_os("HOME").unwrap())
                    .join(".local/share/com.voxclean.desktop/models/ggml-base.bin")
            },
            PathBuf::from,
        )
    }

    /// Needs the Whisper model and Ubuntu's ALSA test sounds:
    /// `cargo test -- --ignored transcribes_speech_with_the_installed_model`.
    #[test]
    #[ignore]
    fn transcribes_speech_with_the_installed_model() {
        let audio = crate::audio::decode_file(Path::new("/usr/share/sounds/alsa/Front_Center.wav"))
            .unwrap();
        let progress = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&progress);
        let transcriber = Transcriber::default();

        let started = Instant::now();
        let transcript = transcriber
            .transcribe(
                &installed_model(),
                &audio,
                None,
                move |p| lock(&seen).push(p),
                &transcriber.begin(),
            )
            .unwrap();
        println!(
            "{transcript:#?}\nin {:?}, progress {:?}",
            started.elapsed(),
            lock(&progress)
        );

        let text: String = transcript
            .segments
            .iter()
            .map(|s| s.text.to_lowercase())
            .collect();
        assert!(text.contains("front") && text.contains("center"), "{text}");
        assert_eq!(transcript.language.as_deref(), Some("en"));
        assert!(transcript.language_detected);
        assert!(!lock(&progress).is_empty());

        // The model stays loaded for the next one.
        let started = Instant::now();
        transcriber
            .transcribe(
                &installed_model(),
                &audio,
                Some("en"),
                |_| {},
                &transcriber.begin(),
            )
            .unwrap();
        println!("again, with the model loaded: {:?}", started.elapsed());

        // A cancelled transcription says so.
        let cancelled = transcriber.begin();
        transcriber.cancel();
        let err = transcriber
            .transcribe(&installed_model(), &audio, Some("en"), |_| {}, &cancelled)
            .err();
        assert_eq!(err.map(|err| err.code()), Some("cancelled"));
    }
}
