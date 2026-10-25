//! Microphone capture, audio file decoding, and the audio VoxClean holds.
//!
//! Audio never leaves this process. It is kept as 16 kHz mono `f32`, the
//! format Whisper expects, and the frontend only ever sees an [`AudioClip`]
//! summary of it.

mod capture;
mod decode;
mod resample;

use serde::Serialize;

use crate::error::AppResult;

pub use capture::{InputDevice, Recorder, list_input_devices};
pub use decode::decode_file;

/// The sample rate Whisper works at.
pub const SAMPLE_RATE: u32 = 16_000;

/// Bars in the waveform overview; the design draws 72.
const PEAK_COUNT: usize = 72;

/// Below this RMS (-60 dBFS) a clip counts as silent.
const SILENCE_RMS: f32 = 0.001;

/// Mono audio at [`SAMPLE_RATE`].
pub struct Audio {
    samples: Vec<f32>,
}

impl Audio {
    /// Takes mono samples recorded or decoded at `sample_rate` and resamples
    /// them to [`SAMPLE_RATE`]. Slow for long clips: call it off the async
    /// runtime.
    pub fn from_mono(samples: Vec<f32>, sample_rate: u32) -> AppResult<Self> {
        Ok(Self {
            samples: resample::to_sample_rate(samples, sample_rate)?,
        })
    }

    /// The part of the audio the frontend gets to see.
    pub fn clip(&self) -> AudioClip {
        AudioClip {
            duration_ms: self.samples.len() as u64 * 1000 / u64::from(SAMPLE_RATE),
            peaks: peaks(&self.samples, PEAK_COUNT),
        }
    }
}

/// Mirrors `AudioClip` in `src/lib/ipc.ts`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioClip {
    duration_ms: u64,
    /// Loudness overview for the waveform, each value 0–1.
    peaks: Vec<f32>,
}

/// Splits `samples` into `count` equal stretches and returns the loudness
/// (RMS) of each, scaled so the loudest is 1. A silent clip stays flat
/// instead of having its noise floor stretched to full height.
fn peaks(samples: &[f32], count: usize) -> Vec<f32> {
    let count = count.min(samples.len());
    let levels: Vec<f32> = (0..count)
        .map(|i| rms(&samples[i * samples.len() / count..(i + 1) * samples.len() / count]))
        .collect();
    let loudest = levels.iter().copied().fold(0.0, f32::max);
    if loudest < SILENCE_RMS {
        return vec![0.0; count];
    }
    levels.into_iter().map(|level| level / loudest).collect()
}

/// Root mean square of `samples`, 0 for none.
fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum: f64 = samples.iter().map(|&s| f64::from(s) * f64::from(s)).sum();
    (sum / samples.len() as f64).sqrt() as f32
}

#[cfg(test)]
pub(crate) mod testing {
    use std::fs;
    use std::path::{Path, PathBuf};

    /// A path in the temp directory, unique to this test run.
    pub fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("voxclean-{}-{name}", std::process::id()))
    }

    /// Writes 16-bit PCM WAV with interleaved `samples`.
    pub fn write_wav(path: &Path, sample_rate: u32, channels: u16, samples: &[i16]) {
        let data_len = (samples.len() * 2) as u32;
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes()); // PCM
        bytes.extend_from_slice(&channels.to_le_bytes());
        bytes.extend_from_slice(&sample_rate.to_le_bytes());
        bytes.extend_from_slice(&(sample_rate * u32::from(channels) * 2).to_le_bytes());
        bytes.extend_from_slice(&(channels * 2).to_le_bytes());
        bytes.extend_from_slice(&16u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_len.to_le_bytes());
        for sample in samples {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
        fs::write(path, bytes).unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rms_of_a_full_scale_square_wave_is_one() {
        assert_eq!(rms(&[1.0, -1.0, 1.0, -1.0]), 1.0);
        assert_eq!(rms(&[]), 0.0);
    }

    #[test]
    fn peaks_scale_the_loudest_stretch_to_one() {
        let samples: Vec<f32> = [0.1, 0.4, 0.2].iter().flat_map(|&v| [v; 100]).collect();
        let peaks = peaks(&samples, 3);
        assert_eq!(peaks.len(), 3);
        assert!((peaks[0] - 0.25).abs() < 1e-6);
        assert_eq!(peaks[1], 1.0);
        assert!((peaks[2] - 0.5).abs() < 1e-6);
    }

    #[test]
    fn peaks_of_silence_are_flat() {
        assert_eq!(peaks(&[0.0001; 1000], 4), vec![0.0; 4]);
    }

    #[test]
    fn peaks_of_a_short_clip_have_one_bar_per_sample() {
        assert_eq!(peaks(&[0.5, 0.25], 72).len(), 2);
        assert!(peaks(&[], 72).is_empty());
    }

    #[test]
    fn clip_reports_the_duration_at_16_khz() {
        let audio = Audio {
            samples: vec![0.0; 24_000],
        };
        let json = serde_json::to_value(audio.clip()).unwrap();
        assert_eq!(json["durationMs"], 1500);
        assert_eq!(json["peaks"].as_array().unwrap().len(), PEAK_COUNT);
    }
}
