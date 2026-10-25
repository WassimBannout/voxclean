//! Microphone capture with cpal.
//!
//! cpal's audio callback runs on its own thread. It mixes each buffer down to
//! mono, filters out DC offset, appends it to the recording and notes how
//! loud it was; a second thread reports that level to the UI every 100 ms.

use std::f32::consts::TAU;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{
    BufferSize, ErrorKind, FromSample, SampleFormat, SizedSample, StreamConfig, SupportedBufferSize,
};
use serde::Serialize;

use super::{Audio, rms};
use crate::error::{AppError, AppResult};

/// How often the input level is reported while recording.
const LEVEL_INTERVAL: Duration = Duration::from_millis(100);

/// The quietest level the meter shows, in dBFS. Speech lands mid-scale.
const METER_FLOOR_DB: f32 = -60.0;

/// Audio buffers per second (20 ms each). Small buffers keep every meter
/// update fed and make PulseAudio start at once: with its default buffer the
/// first audio takes two seconds to arrive.
const BUFFERS_PER_SECOND: u32 = 50;

/// The DC filter's cutoff. Voices start around 80 Hz and lose under 1 dB at
/// 100 Hz; a fading start-up offset is flattened to the level of room noise.
const DC_CUTOFF_HZ: f32 = 40.0;

/// Mirrors `InputDevice` in `src/lib/ipc.ts`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputDevice {
    id: String,
    name: String,
    is_default: bool,
}

/// The microphones the system offers, the default first.
pub fn list_input_devices() -> AppResult<Vec<InputDevice>> {
    let host = cpal::default_host();
    let default_id = host
        .default_input_device()
        .and_then(|device| device.id().ok());
    let mut devices: Vec<InputDevice> = host
        .input_devices()
        .map_err(microphone_error)?
        .filter_map(|device| {
            let id = device.id().ok()?;
            // PulseAudio offers a "Monitor of …" source for every output. It
            // records what the computer plays, not a microphone.
            if id.id().ends_with(".monitor") {
                return None;
            }
            Some(InputDevice {
                name: device.description().ok()?.name().to_string(),
                is_default: default_id.as_ref() == Some(&id),
                id: id.id().to_string(),
            })
        })
        .collect();
    devices.sort_by_key(|device| !device.is_default);
    Ok(devices)
}

/// A recording in progress. Dropping it closes the microphone and throws the
/// audio away; [`Recorder::finish`] keeps it.
pub struct Recorder {
    stream: cpal::Stream,
    shared: Arc<Shared>,
    sample_rate: u32,
}

/// What the audio callback, the level thread and the recorder share.
#[derive(Default)]
struct Shared {
    /// Mono samples at the device's sample rate.
    samples: Mutex<Vec<f32>>,
    paused: AtomicBool,
    stopped: AtomicBool,
    /// The loudest buffer's RMS since the level was last reported, as `f32`
    /// bits. Non-negative floats order the same as their bits, so
    /// `fetch_max` works on them.
    level: AtomicU32,
    /// Whether any audio arrived since the level was last reported.
    heard: AtomicBool,
    /// The first error the stream reported.
    failure: Mutex<Option<String>>,
}

impl Recorder {
    /// Starts recording from the device with `device_id`, or the system
    /// default for `None`. `on_level` gets the input level (0–1) every
    /// 100 ms while recording isn't paused.
    pub fn start(
        device_id: Option<&str>,
        on_level: impl Fn(f32) + Send + 'static,
    ) -> AppResult<Self> {
        let host = cpal::default_host();
        let device = match device_id {
            Some(id) => host
                .input_devices()
                .map_err(microphone_error)?
                .find(|device| device.id().is_ok_and(|device_id| device_id.id() == id))
                .ok_or_else(|| unavailable("The selected microphone is no longer connected."))?,
            None => host
                .default_input_device()
                .ok_or_else(|| unavailable("No microphone was found."))?,
        };
        let supported = device.default_input_config().map_err(microphone_error)?;
        let mut config = supported.config();
        if let SupportedBufferSize::Range { min, max } = *supported.buffer_size() {
            let frames = config.sample_rate / BUFFERS_PER_SECOND;
            config.buffer_size = BufferSize::Fixed(frames.clamp(min, max));
        }
        let shared = Arc::new(Shared::default());

        let stream = match supported.sample_format() {
            SampleFormat::I8 => build_stream::<i8>(&device, config, &shared),
            SampleFormat::I16 => build_stream::<i16>(&device, config, &shared),
            SampleFormat::I24 => build_stream::<cpal::I24>(&device, config, &shared),
            SampleFormat::I32 => build_stream::<i32>(&device, config, &shared),
            SampleFormat::U8 => build_stream::<u8>(&device, config, &shared),
            SampleFormat::U16 => build_stream::<u16>(&device, config, &shared),
            SampleFormat::F32 => build_stream::<f32>(&device, config, &shared),
            SampleFormat::F64 => build_stream::<f64>(&device, config, &shared),
            other => {
                return Err(unavailable(&format!(
                    "The microphone uses a sample format VoxClean can't record ({other})."
                )));
            }
        }
        .map_err(microphone_error)?;
        stream.play().map_err(microphone_error)?;
        report_levels(Arc::clone(&shared), on_level);

        Ok(Self {
            stream,
            shared,
            sample_rate: config.sample_rate,
        })
    }

    pub fn pause(&self) {
        self.shared.paused.store(true, Ordering::Relaxed);
        // Releases the device where the backend supports pausing. The flag
        // alone already keeps paused audio out of the recording.
        let _ = self.stream.pause();
    }

    pub fn resume(&self) -> AppResult<()> {
        self.stream.play().map_err(microphone_error)?;
        self.shared.paused.store(false, Ordering::Relaxed);
        Ok(())
    }

    /// Stops recording and returns the audio, resampled for Whisper. Slow
    /// for long recordings: call it off the async runtime.
    pub fn finish(self) -> AppResult<Audio> {
        self.shared.paused.store(true, Ordering::Relaxed);
        let samples = std::mem::take(&mut *lock(&self.shared.samples));
        if samples.is_empty()
            && let Some(reason) = lock(&self.shared.failure).take()
        {
            return Err(unavailable(&format!(
                "The microphone stopped working ({reason})."
            )));
        }
        let sample_rate = self.sample_rate;
        drop(self);
        Audio::from_mono(samples, sample_rate)
    }
}

impl Drop for Recorder {
    fn drop(&mut self) {
        // Ends the level thread; dropping the stream closes the microphone.
        self.shared.stopped.store(true, Ordering::Relaxed);
    }
}

impl Shared {
    fn push(&self, frames: impl Iterator<Item = f32>) {
        if self.paused.load(Ordering::Relaxed) {
            return;
        }
        let mut samples = lock(&self.samples);
        let start = samples.len();
        samples.extend(frames);
        let level = rms(&samples[start..]);
        self.level.fetch_max(level.to_bits(), Ordering::Relaxed);
        self.heard.store(true, Ordering::Relaxed);
    }

    fn fail(&self, err: cpal::Error) {
        // An overrun loses a few milliseconds; the recording carries on.
        if matches!(err.kind(), ErrorKind::Xrun) {
            return;
        }
        lock(&self.failure).get_or_insert_with(|| err.to_string());
    }
}

fn build_stream<T>(
    device: &cpal::Device,
    config: StreamConfig,
    shared: &Arc<Shared>,
) -> Result<cpal::Stream, cpal::Error>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    let channels = usize::from(config.channels).max(1);
    let mut dc_filter = DcFilter::new(config.sample_rate);
    let on_data = Arc::clone(shared);
    let on_error = Arc::clone(shared);
    device.build_input_stream(
        config,
        move |data: &[T], _: &cpal::InputCallbackInfo| {
            on_data.push(data.chunks_exact(channels).map(|frame| {
                let mono =
                    frame.iter().map(|&s| f32::from_sample_(s)).sum::<f32>() / channels as f32;
                dc_filter.apply(mono)
            }));
        },
        move |err| on_error.fail(err),
        None,
    )
}

fn report_levels(shared: Arc<Shared>, on_level: impl Fn(f32) + Send + 'static) {
    thread::spawn(move || {
        let mut level = 0.0;
        loop {
            thread::sleep(LEVEL_INTERVAL);
            if shared.stopped.load(Ordering::Relaxed) {
                break;
            }
            // When no buffer landed in this interval, repeat the last level
            // rather than flash the meter to zero.
            if shared.heard.swap(false, Ordering::Relaxed) {
                level = meter_level(f32::from_bits(shared.level.swap(0, Ordering::Relaxed)));
            }
            if !shared.paused.load(Ordering::Relaxed) {
                on_level(level);
            }
        }
    });
}

/// A one-pole high-pass filter that removes DC offset. Some microphones
/// start with a large offset that takes most of a second to fade (seen on a
/// laptop's built-in mic), which would otherwise show as a loud opening in
/// the meter and the waveform.
struct DcFilter {
    coefficient: f32,
    last_input: Option<f32>,
    last_output: f32,
}

impl DcFilter {
    fn new(sample_rate: u32) -> Self {
        Self {
            coefficient: 1.0 - TAU * DC_CUTOFF_HZ / sample_rate.max(1) as f32,
            last_input: None,
            last_output: 0.0,
        }
    }

    fn apply(&mut self, input: f32) -> f32 {
        // Starting from the first sample avoids a jump when audio begins
        // away from zero.
        let previous = self.last_input.replace(input).unwrap_or(input);
        self.last_output = input - previous + self.coefficient * self.last_output;
        self.last_output
    }
}

/// Places an RMS level on the 0–1 meter: [`METER_FLOOR_DB`] and below is 0,
/// full scale is 1.
fn meter_level(rms: f32) -> f32 {
    if rms.is_nan() || rms <= 0.0 {
        return 0.0;
    }
    let dbfs = 20.0 * rms.log10();
    ((dbfs - METER_FLOOR_DB) / -METER_FLOOR_DB).clamp(0.0, 1.0)
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn unavailable(reason: &str) -> AppError {
    AppError::MicrophoneUnavailable {
        reason: reason.to_string(),
    }
}

fn microphone_error(err: cpal::Error) -> AppError {
    match err.kind() {
        ErrorKind::PermissionDenied => unavailable("VoxClean isn't allowed to use the microphone."),
        ErrorKind::DeviceBusy => unavailable("The microphone is in use by another app."),
        ErrorKind::DeviceNotAvailable => unavailable("The microphone is no longer connected."),
        _ => unavailable(&format!("Couldn't start the microphone ({err}).")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn meter_spans_minus_60_dbfs_to_full_scale() {
        assert_eq!(meter_level(0.0), 0.0);
        assert_eq!(meter_level(f32::NAN), 0.0);
        assert_eq!(meter_level(0.0005), 0.0);
        assert!((meter_level(0.001)).abs() < 1e-6);
        assert!((meter_level(0.0316) - 0.5).abs() < 0.01); // -30 dBFS
        assert_eq!(meter_level(1.0), 1.0);
        assert_eq!(meter_level(2.0), 1.0);
    }

    fn filtered(input: impl Iterator<Item = f32>) -> Vec<f32> {
        let mut filter = DcFilter::new(48_000);
        input.map(|sample| filter.apply(sample)).collect()
    }

    #[test]
    fn dc_filter_removes_a_constant_offset() {
        let output = filtered(std::iter::repeat_n(0.5, 4_800));
        assert!(output.iter().all(|s| s.abs() < 1e-6));
    }

    #[test]
    fn dc_filter_removes_an_offset_that_fades_out() {
        // Like the built-in mic: starting at -1 and fading to 0 over ~0.7 s.
        // What's left is no louder than its room noise (RMS 0.02).
        let output = filtered((0..48_000).map(|i| -(-(i as f32) / 9_600.0).exp()));
        let loudest = output.iter().fold(0.0f32, |max, s| max.max(s.abs()));
        assert!(loudest < 0.021, "loudest sample {loudest}");
    }

    #[test]
    fn dc_filter_keeps_a_voice_band_tone() {
        let tone: Vec<f32> = (0..48_000)
            .map(|i| 0.5 * (TAU * 200.0 * i as f32 / 48_000.0).sin())
            .collect();
        let output = filtered(tone.iter().copied());
        // Once the filter settles, a 200 Hz tone keeps 98% of its level.
        let kept = rms(&output[4_800..]) / rms(&tone[4_800..]);
        assert!(kept > 0.975, "kept {kept}");
    }

    #[test]
    fn paused_audio_stays_out_of_the_recording() {
        let shared = Shared::default();
        shared.push([0.5, 0.5].into_iter());
        shared.paused.store(true, Ordering::Relaxed);
        shared.push([0.9; 4].into_iter());
        assert_eq!(*lock(&shared.samples), vec![0.5, 0.5]);
        assert_eq!(f32::from_bits(shared.level.load(Ordering::Relaxed)), 0.5);
    }

    #[test]
    fn the_level_keeps_the_loudest_buffer() {
        let shared = Shared::default();
        shared.push([0.2; 4].into_iter());
        shared.push([0.6; 4].into_iter());
        shared.push([0.1; 4].into_iter());
        assert!((f32::from_bits(shared.level.load(Ordering::Relaxed)) - 0.6).abs() < 1e-6);
    }

    /// Needs a microphone: `cargo test -- --ignored records_from_the_default_microphone`.
    #[test]
    #[ignore]
    fn records_from_the_default_microphone() {
        let devices = list_input_devices().unwrap();
        println!("{devices:#?}");
        let levels = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&levels);
        let recorder = Recorder::start(None, move |level| lock(&seen).push(level)).unwrap();
        thread::sleep(Duration::from_millis(1_050));
        let clip = recorder.finish().unwrap().clip();
        println!("{clip:?}\nlevels: {:?}", lock(&levels));
        let json = serde_json::to_value(clip).unwrap();
        assert!((900..=1_200).contains(&json["durationMs"].as_u64().unwrap()));
        assert!(lock(&levels).len() >= 8);
    }
}
