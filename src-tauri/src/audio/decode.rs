//! Audio file decoding with Symphonia.

use std::fs::File;
use std::io;
use std::path::Path;

use symphonia::core::codecs::CodecParameters;
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::errors::Error as DecodeError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::{MediaSourceStream, MediaSourceStreamOptions};
use symphonia::core::meta::MetadataOptions;

use super::Audio;
use crate::error::{AppError, AppResult};

/// Decodes the first audio track of the file at `path`, mixed down to mono
/// and resampled for Whisper. Slow for long files: call it off the async
/// runtime.
pub fn decode_file(path: &Path) -> AppResult<Audio> {
    let file_name = path.file_name().map_or_else(
        || path.display().to_string(),
        |name| name.to_string_lossy().into_owned(),
    );
    let unsupported = || AppError::UnsupportedFormat {
        file: file_name.clone(),
    };
    let unreadable = |err: &io::Error| AppError::FileUnreadable {
        file: file_name.clone(),
        reason: match err.kind() {
            io::ErrorKind::NotFound => "the file no longer exists".into(),
            io::ErrorKind::PermissionDenied => "VoxClean isn't allowed to read it".into(),
            _ => err.to_string(),
        },
    };

    let file = File::open(path).map_err(|err| unreadable(&err))?;
    let stream = MediaSourceStream::new(Box::new(file), MediaSourceStreamOptions::default());
    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|ext| ext.to_str()) {
        hint.with_extension(extension);
    }

    let mut format = symphonia::default::get_probe()
        .probe(
            &hint,
            stream,
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .map_err(|_| unsupported())?;
    let track = format
        .default_track(TrackType::Audio)
        .ok_or_else(unsupported)?;
    let track_id = track.id;
    let Some(CodecParameters::Audio(params)) = &track.codec_params else {
        return Err(unsupported());
    };
    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(params, &AudioDecoderOptions::default())
        .map_err(|_| unsupported())?;

    let mut mono = Vec::new();
    let mut interleaved = Vec::new();
    let mut sample_rate = None;
    loop {
        let packet = match format.next_packet() {
            Ok(Some(packet)) => packet,
            Ok(None) => break,
            // Plenty of files end without a clean end-of-stream marker.
            Err(DecodeError::IoError(err)) if err.kind() == io::ErrorKind::UnexpectedEof => break,
            // A chained stream (e.g. a second OGG stream): only the first is read.
            Err(DecodeError::ResetRequired) => break,
            Err(DecodeError::IoError(err)) => return Err(unreadable(&err)),
            Err(_) => return Err(unsupported()),
        };
        if packet.track_id != track_id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(buffer) => {
                let spec = buffer.spec();
                sample_rate.get_or_insert(spec.rate());
                let channels = spec.channels().count().max(1);
                buffer.copy_to_vec_interleaved::<f32>(&mut interleaved);
                mono.extend(
                    interleaved
                        .chunks_exact(channels)
                        .map(|frame| frame.iter().sum::<f32>() / channels as f32),
                );
            }
            // A damaged packet: skip it and keep going, as players do.
            Err(DecodeError::DecodeError(_)) => continue,
            Err(DecodeError::IoError(err)) => return Err(unreadable(&err)),
            Err(_) => return Err(unsupported()),
        }
    }

    match sample_rate {
        Some(rate) if !mono.is_empty() => Audio::from_mono(mono, rate),
        _ => Err(unsupported()),
    }
}

#[cfg(test)]
mod tests {
    use std::f32::consts::TAU;
    use std::fs;

    use super::*;
    use crate::audio::testing::{temp_path, write_wav};

    #[test]
    fn decodes_a_stereo_wav_to_16_khz_mono() {
        let path = temp_path("stereo.wav");
        // Half a second at 44.1 kHz: a tone on the left, silence on the right.
        let samples: Vec<i16> = (0..22_050)
            .flat_map(|i| {
                let tone = (TAU * 220.0 * i as f32 / 44_100.0).sin();
                [(tone * 16_000.0) as i16, 0]
            })
            .collect();
        write_wav(&path, 44_100, 2, &samples);

        let audio = decode_file(&path).unwrap();
        fs::remove_file(&path).unwrap();

        assert_eq!(audio.samples.len(), 8_000);
        // Mixing down halves the left channel: 16000 / 32768 / 2 ≈ 0.244.
        let loudest = audio.samples.iter().fold(0.0f32, |max, s| max.max(s.abs()));
        assert!((0.23..0.26).contains(&loudest), "loudest sample {loudest}");
        let json = serde_json::to_value(audio.clip()).unwrap();
        assert_eq!(json["durationMs"], 500);
    }

    #[test]
    fn names_the_file_it_cannot_read() {
        let path = temp_path("notes.mp3");
        fs::write(&path, "these are not the samples you are looking for").unwrap();

        let result = decode_file(&path);
        fs::remove_file(&path).unwrap();

        let Err(err) = result else {
            panic!("decoded a text file");
        };

        assert_eq!(err.code(), "unsupported_format");
        assert!(
            err.to_string()
                .contains(&format!("“{}”", path.file_name().unwrap().display()))
        );
    }

    #[test]
    fn reports_a_missing_file() {
        let Err(err) = decode_file(&temp_path("gone.wav")) else {
            panic!("decoded a file that doesn't exist");
        };
        assert_eq!(err.code(), "file_unreadable");
        assert!(err.to_string().ends_with("the file no longer exists."));
    }
}
