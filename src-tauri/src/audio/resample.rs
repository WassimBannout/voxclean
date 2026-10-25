//! Sample rate conversion with rubato.

use rubato::audioadapter_buffers::direct::InterleavedSlice;
use rubato::{Fft, FixedSync, Resampler};

use super::SAMPLE_RATE;
use crate::error::{AppError, AppResult};

/// Frames the resampler takes per FFT pass.
const CHUNK_FRAMES: usize = 1024;

/// Converts mono audio from `sample_rate` to [`SAMPLE_RATE`]. The FFT
/// resampler suits whole clips: the ratio is fixed and it filters out what
/// 16 kHz can't hold.
pub fn to_sample_rate(samples: Vec<f32>, sample_rate: u32) -> AppResult<Vec<f32>> {
    if sample_rate == SAMPLE_RATE || samples.is_empty() {
        return Ok(samples);
    }
    let mut resampler = Fft::<f32>::new(
        sample_rate as usize,
        SAMPLE_RATE as usize,
        CHUNK_FRAMES,
        1,
        FixedSync::Input,
    )
    .map_err(failed)?;
    let input = InterleavedSlice::new(&samples, 1, samples.len()).map_err(failed)?;
    let output = resampler
        .process_all(&input, samples.len(), None)
        .map_err(failed)?;
    Ok(output.take_data())
}

fn failed(err: impl std::fmt::Display) -> AppError {
    AppError::Audio(format!("couldn't convert the sample rate ({err})"))
}

#[cfg(test)]
mod tests {
    use std::f32::consts::TAU;

    use super::*;

    fn sine(frequency: f32, sample_rate: u32, seconds: f32) -> Vec<f32> {
        let frames = (sample_rate as f32 * seconds) as usize;
        (0..frames)
            .map(|i| 0.5 * (TAU * frequency * i as f32 / sample_rate as f32).sin())
            .collect()
    }

    fn rising_zero_crossings(samples: &[f32]) -> usize {
        samples
            .windows(2)
            .filter(|w| w[0] < 0.0 && w[1] >= 0.0)
            .count()
    }

    #[test]
    fn converts_48_khz_to_16_khz_keeping_length_and_pitch() {
        let output = to_sample_rate(sine(440.0, 48_000, 1.0), 48_000).unwrap();
        assert_eq!(output.len(), 16_000);
        // A 440 Hz tone still crosses zero 440 times a second.
        assert!((438..=441).contains(&rising_zero_crossings(&output)));
    }

    #[test]
    fn converts_44_1_khz_too() {
        let output = to_sample_rate(sine(440.0, 44_100, 0.5), 44_100).unwrap();
        assert_eq!(output.len(), 8_000);
    }

    #[test]
    fn leaves_16_khz_and_empty_audio_alone() {
        assert_eq!(
            to_sample_rate(vec![0.1, 0.2], 16_000).unwrap(),
            vec![0.1, 0.2]
        );
        assert!(to_sample_rate(Vec::new(), 48_000).unwrap().is_empty());
    }

    #[test]
    fn rejects_a_zero_sample_rate() {
        let err = to_sample_rate(vec![0.0; 10], 0).unwrap_err();
        assert_eq!(err.code(), "audio_error");
    }
}
